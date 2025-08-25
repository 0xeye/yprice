import { createPublicClient, http, parseAbi, getAddress, type Address, type MulticallParameters } from 'viem';
import { mainnet, optimism, polygon, fantom, base, arbitrum } from 'viem/chains';
import { fetchPricesFromCoinGecko } from '../sources/coingecko.js';
import { detectLPTokens, calculateLPPrices, type LPTokenData } from '../sources/stableLp.js';
import { fetchTokenList } from './tokenList.js';
import { savePrices, setHealthcheck } from './redis.js';
import { SUPPORTED_CHAINS } from '../types/index.js';
import type { Price, Token } from '../types/index.js';

// Chain configurations
const CHAIN_CONFIGS = {
  1: { chain: mainnet, rpcUrl: process.env.RPC_URL_MAINNET || 'https://eth.llamarpc.com' },
  10: { chain: optimism, rpcUrl: process.env.RPC_URL_OPTIMISM || 'https://mainnet.optimism.io' },
  137: { chain: polygon, rpcUrl: process.env.RPC_URL_POLYGON || 'https://polygon-rpc.com' },
  250: { chain: fantom, rpcUrl: process.env.RPC_URL_FANTOM || 'https://rpc.ftm.tools' },
  8453: { chain: base, rpcUrl: process.env.RPC_URL_BASE || 'https://mainnet.base.org' },
  42161: { chain: arbitrum, rpcUrl: process.env.RPC_URL_ARBITRUM || 'https://arb1.arbitrum.io/rpc' },
} as const;

const VIRTUAL_PRICE_ABI = parseAbi(['function get_virtual_price() external view returns (uint256)']);

export async function updatePrices(): Promise<void> {
  console.log('Starting price update...');
  
  // Step 1: Collect all vaults and unique assets across all chains
  const allVaults: Token[] = [];
  const allAssets: Token[] = [];
  const uniqueAssetAddresses = new Set<string>();
  
  for (const chainId of SUPPORTED_CHAINS) {
    try {
      console.log(`Fetching tokens for chain ${chainId}...`);
      const tokens = await fetchTokenList(chainId);
      
      const vaults = tokens.filter(token => token.price && token.assetAddress);
      const assets = tokens.filter(token => !token.price);
      
      allVaults.push(...vaults);
      allAssets.push(...assets);
      
      // Collect unique asset addresses from vaults
      vaults.forEach(vault => {
        if (vault.assetAddress) {
          uniqueAssetAddresses.add(vault.assetAddress.toLowerCase());
        }
      });
    } catch (error) {
      console.error(`Error fetching tokens for chain ${chainId}:`, error);
    }
  }
  
  console.log(`Found ${allVaults.length} vaults and ${uniqueAssetAddresses.size} unique assets`);
  
  // Step 2: Try to get virtual prices for all unique assets AND vaults on all chains
  const assetPrices = new Map<string, number>();
  const virtualPriceChecked = new Set<string>(); // Track which have been checked
  
  // Also check virtual prices on vaults themselves (for nested vaults)
  const allAddressesToCheck = new Set(uniqueAssetAddresses);
  allVaults.forEach(vault => {
    if (vault.address) {
      allAddressesToCheck.add(vault.address.toLowerCase());
    }
  });
  
  console.log(`Checking virtual prices for ${allAddressesToCheck.size} addresses (${uniqueAssetAddresses.size} assets + vaults)`);
  
  for (const chainId of SUPPORTED_CHAINS) {
    const chainConfig = CHAIN_CONFIGS[chainId as keyof typeof CHAIN_CONFIGS];
    if (!chainConfig) continue;
    
    const client = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });
    
    // Convert unique addresses to array for batching
    const addresses = Array.from(allAddressesToCheck);
    
    // Process in batches of 100
    for (let i = 0; i < addresses.length; i += 100) {
      const batch = addresses.slice(i, i + 100);
      
      try {
        // Multicall to get virtual prices
        const contracts: MulticallParameters['contracts'] = batch.map(address => ({
          address: getAddress(address), // Ensure proper checksum
          abi: VIRTUAL_PRICE_ABI,
          functionName: 'get_virtual_price',
        }));
        
        const results = await client.multicall({
          contracts,
          allowFailure: true,
        });
        
        // Process results
        results.forEach((result, index) => {
          const address = batch[index];
          virtualPriceChecked.add(address); // Mark as checked
          
          if (result.status === 'success' && result.result) {
            const virtualPrice = result.result as bigint;
            if (virtualPrice > 0n && !assetPrices.has(address)) {
              const vpNormalized = Number(virtualPrice) / 1e18;
              
              // For stablecoin pools (vp close to 1), use directly as USD price
              if (vpNormalized >= 0.9 && vpNormalized <= 1.5) {
                assetPrices.set(address, vpNormalized);
                console.log(`Found stable pool ${address} on chain ${chainId}: $${vpNormalized.toFixed(4)}`);
                
                // Debug specific asset
                if (address === '0xc522a6606bba746d7960404f22a3db936b6f4f50') {
                  console.log(`DEBUG: Added asset 0xc522a6606bba746d7960404f22a3db936b6f4f50 with price ${vpNormalized}`);
                }
              } else {
                // For other pools, need to multiply by ETH price
                // We'll handle this after we get ETH price from CoinGecko
                assetPrices.set(address, -vpNormalized); // Negative to indicate needs ETH multiplication
                console.log(`Found crypto pool ${address} on chain ${chainId} with virtual price: ${vpNormalized.toFixed(6)}`);
              }
            }
          }
        });
      } catch (error) {
        console.error(`Multicall error on chain ${chainId}:`, error);
      }
    }
  }
  
  // Step 3: Check for LP tokens by calling getReserves on all unpriced assets
  // Group assets without prices by chain
  const assetsWithoutPriceByChain = new Map<number, string[]>();
  
  for (const address of uniqueAssetAddresses) {
    if (!assetPrices.has(address)) {
      // Find which chain this asset belongs to
      const vault = allVaults.find(v => v.assetAddress?.toLowerCase() === address);
      if (vault) {
        if (!assetsWithoutPriceByChain.has(vault.chainId)) {
          assetsWithoutPriceByChain.set(vault.chainId, []);
        }
        assetsWithoutPriceByChain.get(vault.chainId)!.push(address);
      }
    }
  }
  
  // Detect LP tokens
  const lpTokenData = await detectLPTokens(assetsWithoutPriceByChain);
  
  // Step 4: Get remaining prices from CoinGecko
  const assetsNeedingCoinGecko: Token[] = [];
  
  // Add all regular assets
  assetsNeedingCoinGecko.push(...allAssets);
  
  // Add vault assets that don't have virtual prices and aren't LP tokens
  for (const address of uniqueAssetAddresses) {
    if (!assetPrices.has(address) && !lpTokenData.has(address)) {
      // Find which chain this asset belongs to by checking vaults
      const vault = allVaults.find(v => v.assetAddress?.toLowerCase() === address);
      if (vault) {
        assetsNeedingCoinGecko.push({
          chainId: vault.chainId,
          address: address,
          symbol: vault.symbol?.replace('yv', '') || 'UNKNOWN',
        });
      }
    }
  }
  
  // Add LP token underlying assets
  for (const [lpAddress, lpData] of lpTokenData) {
    if (!assetPrices.has(lpData.token0)) {
      assetsNeedingCoinGecko.push({ chainId: lpData.chainId, address: lpData.token0, symbol: 'UNKNOWN' });
    }
    if (!assetPrices.has(lpData.token1)) {
      assetsNeedingCoinGecko.push({ chainId: lpData.chainId, address: lpData.token1, symbol: 'UNKNOWN' });
    }
  }
  
  // Fetch from CoinGecko
  if (assetsNeedingCoinGecko.length > 0) {
    console.log(`Fetching ${assetsNeedingCoinGecko.length} prices from CoinGecko...`);
    const coinGeckoPrices = await fetchPricesFromCoinGecko(assetsNeedingCoinGecko);
    
    // Add to our price map
    coinGeckoPrices.forEach(price => {
      assetPrices.set(price.address.toLowerCase(), price.price);
    });
  }
  
  // Get ETH price for crypto pools
  let ethPrice = 0;
  const wethPrices = await fetchPricesFromCoinGecko([{
    chainId: 1,
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    symbol: 'WETH',
  }]);
  if (wethPrices.length > 0) {
    ethPrice = wethPrices[0].price;
  }
  
  // Fix negative prices (crypto pools that need ETH multiplication)
  for (const [address, price] of assetPrices) {
    if (price < 0 && ethPrice > 0) {
      const actualPrice = Math.abs(price) * ethPrice;
      assetPrices.set(address, actualPrice);
      console.log(`Crypto pool ${address}: $${actualPrice.toFixed(4)}`);
    }
  }
  
  // Step 5: Calculate LP token prices
  await calculateLPPrices(lpTokenData, assetPrices);
  
  // Step 6: Calculate vault prices and save by chain
  for (const chainId of SUPPORTED_CHAINS) {
    const chainVaults = allVaults.filter(v => v.chainId === chainId);
    const chainAssets = allAssets.filter(a => a.chainId === chainId);
    
    if (chainVaults.length === 0 && chainAssets.length === 0) continue;
    
    const prices: Price[] = [];
    
    // Add vault prices
    for (const vault of chainVaults) {
      const assetAddress = vault.assetAddress?.toLowerCase();
      
      // Debug specific vault
      if (vault.address.toLowerCase() === '0xf165a634296800812b8b0607a75deddcd4d3cc88') {
        console.log(`DEBUG: Processing target vault on chain ${chainId}:`, {
          vaultAddress: vault.address,
          assetAddress: assetAddress,
          pricePerShare: vault.price,
        });
      }
      
      // First, check if the vault itself has a virtual price (for nested vaults)
      let assetPrice = vault.address ? assetPrices.get(vault.address.toLowerCase()) || 0 : 0;
      
      // If not, check the underlying asset price
      if (assetPrice === 0 && assetAddress) {
        assetPrice = assetPrices.get(assetAddress) || 0;
      }
      
      // Debug specific vault
      if (vault.address.toLowerCase() === '0xf165a634296800812b8b0607a75deddcd4d3cc88') {
        console.log(`DEBUG: Asset price lookup for ${assetAddress}: ${assetPrice}`);
        console.log(`DEBUG: Available prices for assets starting with 'c522':`, 
          Array.from(assetPrices.entries())
            .filter(([addr]) => addr.includes('c522'))
            .map(([addr, price]) => ({ addr, price }))
        );
      }
      
      // If we have both asset price and pricePerShare, calculate vault price
      if (assetPrice > 0 && vault.price) {
        const vaultPrice = vault.price * assetPrice;
        prices.push({
          chainId: vault.chainId,
          address: vault.address.toLowerCase(),
          price: vaultPrice,
          time: Date.now(),
          source: 'yearn',
        });
        
        if (vault.address.toLowerCase() === '0xf165a634296800812b8b0607a75deddcd4d3cc88') {
          console.log(`DEBUG: Added vault to prices with price: ${vaultPrice}`);
        }
      } else if (vault.price && vault.price > 0 && assetAddress) {
        console.log(`No price for vault ${vault.address} (asset: ${assetAddress}, pricePerShare: ${vault.price})`);
      } else {
        console.log(`No price for vault ${vault.address} (asset: ${assetAddress})`);
      }
    }
    
    // Add asset prices that were fetched from CoinGecko
    for (const asset of chainAssets) {
      const price = assetPrices.get(asset.address.toLowerCase());
      if (price) {
        prices.push({
          chainId: asset.chainId,
          address: asset.address.toLowerCase(),
          price: price,
          time: Date.now(),
          source: 'coingecko',
        });
      }
    }
    
    // Debug: check if target vault is in the prices array
    const targetVaultPrice = prices.find(p => p.address === '0xf165a634296800812b8b0607a75deddcd4d3cc88');
    if (chainId === 1 && targetVaultPrice) {
      console.log(`DEBUG: Found target vault in chain 1 prices:`, targetVaultPrice);
    } else if (chainId === 1) {
      console.log(`DEBUG: Target vault NOT FOUND in chain 1 prices!`);
    }
    
    console.log(`Saving ${prices.length} prices for chain ${chainId}`);
    await savePrices(chainId, prices);
  }
  
  await setHealthcheck();
  console.log('Price update completed');
}