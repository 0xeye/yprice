import { createPublicClient, http, parseAbi, type Address, type MulticallParameters } from 'viem';
import { mainnet, optimism, polygon, fantom, base, arbitrum } from 'viem/chains';
import type { Token } from '../types/index.js';

// Chain configurations
const CHAIN_CONFIGS = {
  1: { chain: mainnet, rpcUrl: process.env.RPC_URL_MAINNET || 'https://eth.llamarpc.com' },
  10: { chain: optimism, rpcUrl: process.env.RPC_URL_OPTIMISM || 'https://mainnet.optimism.io' },
  137: { chain: polygon, rpcUrl: process.env.RPC_URL_POLYGON || 'https://polygon-rpc.com' },
  250: { chain: fantom, rpcUrl: process.env.RPC_URL_FANTOM || 'https://rpc.ftm.tools' },
  8453: { chain: base, rpcUrl: process.env.RPC_URL_BASE || 'https://mainnet.base.org' },
  42161: { chain: arbitrum, rpcUrl: process.env.RPC_URL_ARBITRUM || 'https://arb1.arbitrum.io/rpc' },
} as const;

const STABLE_LP_ABI = parseAbi([
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function totalSupply() external view returns (uint256)',
  'function decimals() external view returns (uint8)',
]);

export interface LPTokenData {
  token0: string;
  token1: string;
  chainId: number;
  reserve0: bigint;
  reserve1: bigint;
}

/**
 * Detect LP tokens by checking getReserves on all provided assets
 */
export async function detectLPTokens(
  assetsWithoutPriceByChain: Map<number, string[]>
): Promise<Map<string, LPTokenData>> {
  const lpTokenData = new Map<string, LPTokenData>();
  
  // Check getReserves on all unpriced assets
  for (const [chainId, addresses] of assetsWithoutPriceByChain) {
    const chainConfig = CHAIN_CONFIGS[chainId as keyof typeof CHAIN_CONFIGS];
    if (!chainConfig) continue;
    
    console.log(`Checking ${addresses.length} assets for LP tokens on chain ${chainId}...`);
    
    const client = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });
    
    // Process in batches of 50
    for (let i = 0; i < addresses.length; i += 50) {
      const batch = addresses.slice(i, i + 50);
      
      try {
        // Create contracts for getReserves checks
        const contracts: MulticallParameters['contracts'] = batch.map(address => ({
          address: address as Address,
          abi: STABLE_LP_ABI,
          functionName: 'getReserves',
        }));
        
        const results = await client.multicall({
          contracts,
          allowFailure: true,
        });
        
        // Collect addresses that have reserves
        const lpAddresses: string[] = [];
        const reservesMap = new Map<string, [bigint, bigint]>();
        
        for (let j = 0; j < batch.length; j++) {
          if (results[j].status === 'success' && results[j].result) {
            const [reserve0, reserve1] = results[j].result as [bigint, bigint, number];
            if (reserve0 > 0n || reserve1 > 0n) {
              lpAddresses.push(batch[j]);
              reservesMap.set(batch[j], [reserve0, reserve1]);
            }
          }
        }
        
        // If we found LP tokens, get their token0/token1
        if (lpAddresses.length > 0) {
          const followUpContracts: MulticallParameters['contracts'] = [];
          for (const address of lpAddresses) {
            followUpContracts.push(
              { address: address as Address, abi: STABLE_LP_ABI, functionName: 'token0' },
              { address: address as Address, abi: STABLE_LP_ABI, functionName: 'token1' }
            );
          }
          
          const followUpResults = await client.multicall({
            contracts: followUpContracts,
            allowFailure: true,
          });
          
          // Process follow-up results
          for (let j = 0; j < lpAddresses.length; j++) {
            const token0Result = followUpResults[j * 2];
            const token1Result = followUpResults[j * 2 + 1];
            
            if (token0Result.status === 'success' && token1Result.status === 'success') {
              const [reserve0, reserve1] = reservesMap.get(lpAddresses[j])!;
              lpTokenData.set(lpAddresses[j], {
                token0: (token0Result.result as string).toLowerCase(),
                token1: (token1Result.result as string).toLowerCase(),
                chainId,
                reserve0,
                reserve1,
              });
            }
          }
        }
      } catch (error) {
        console.error(`LP token batch check failed for chain ${chainId}:`, error);
      }
    }
  }
  
  console.log(`Found ${lpTokenData.size} LP tokens`);
  return lpTokenData;
}

/**
 * Calculate prices for LP tokens
 */
export async function calculateLPPrices(
  lpTokenData: Map<string, LPTokenData>,
  assetPrices: Map<string, number>
): Promise<void> {
  if (lpTokenData.size === 0) return;
  
  // Group LP tokens by chain
  const lpTokensByChain = new Map<number, Array<[string, LPTokenData]>>();
  for (const [address, data] of lpTokenData) {
    if (!lpTokensByChain.has(data.chainId)) {
      lpTokensByChain.set(data.chainId, []);
    }
    lpTokensByChain.get(data.chainId)!.push([address, data]);
  }
  
  // Process each chain
  for (const [chainId, chainLpTokens] of lpTokensByChain) {
    const chainConfig = CHAIN_CONFIGS[chainId as keyof typeof CHAIN_CONFIGS];
    if (!chainConfig) continue;
    
    const client = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });
    
    try {
      // Batch get totalSupply, decimals, and token decimals
      const contracts: MulticallParameters['contracts'] = [];
      for (const [lpAddress, lpData] of chainLpTokens) {
        contracts.push(
          { address: lpAddress as Address, abi: STABLE_LP_ABI, functionName: 'totalSupply' },
          { address: lpAddress as Address, abi: STABLE_LP_ABI, functionName: 'decimals' },
          { address: lpData.token0 as Address, abi: parseAbi(['function decimals() external view returns (uint8)']), functionName: 'decimals' },
          { address: lpData.token1 as Address, abi: parseAbi(['function decimals() external view returns (uint8)']), functionName: 'decimals' }
        );
      }
      
      const results = await client.multicall({
        contracts,
        allowFailure: true,
      });
      
      // Process results and calculate prices
      for (let i = 0; i < chainLpTokens.length; i++) {
        const [lpAddress, lpData] = chainLpTokens[i];
        const baseIdx = i * 4;
        
        const totalSupplyResult = results[baseIdx];
        const decimalsResult = results[baseIdx + 1];
        const token0DecimalsResult = results[baseIdx + 2];
        const token1DecimalsResult = results[baseIdx + 3];
        
        if (totalSupplyResult.status === 'success' && decimalsResult.status === 'success' &&
            token0DecimalsResult.status === 'success' && token1DecimalsResult.status === 'success') {
          
          const totalSupply = totalSupplyResult.result as bigint;
          const decimals = decimalsResult.result as number;
          const token0Decimals = token0DecimalsResult.result as number;
          const token1Decimals = token1DecimalsResult.result as number;
          
          const token0Price = assetPrices.get(lpData.token0);
          const token1Price = assetPrices.get(lpData.token1);
          
          if (token0Price && token1Price && totalSupply > 0n) {
            // Calculate LP price using stored reserves
            const reserve0Normalized = Number(lpData.reserve0) / (10 ** token0Decimals);
            const reserve1Normalized = Number(lpData.reserve1) / (10 ** token1Decimals);
            const totalSupplyNormalized = Number(totalSupply) / (10 ** decimals);
            
            const totalValue = (token0Price * reserve0Normalized) + (token1Price * reserve1Normalized);
            const lpPrice = totalValue / totalSupplyNormalized;
            
            assetPrices.set(lpAddress, lpPrice);
            console.log(`Stable LP ${lpAddress} on chain ${chainId}: $${lpPrice.toFixed(4)}`);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to calculate LP prices for chain ${chainId}:`, error);
    }
  }
}