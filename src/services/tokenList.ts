import type { Token } from '../types';

const KONG_GRAPHQL_URL = 'https://kong.yearn.farm/api/gql';

interface KongVault {
  chainId: number;
  address: string;
  name: string;
  asset: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  };
  pricePerShare: bigint;
  decimals: number;
}

export async function fetchTokenList(chainId: number): Promise<Token[]> {
  const tokens: Token[] = [];
  
  try {
    // GraphQL query to fetch vaults and their underlying assets
    const query = `
      query GetVaults($chainId: Int!) {
        vaults(chainId: $chainId) {
          chainId
          address
          name
          asset {
            address
            symbol
            name
            decimals
          }
          pricePerShare
          decimals
        }
      }
    `;
    
    const response = await fetch(KONG_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { chainId },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Kong API returned ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json() as any;
    
    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }
    
    const vaults: KongVault[] = result.data?.vaults || [];

    const vaultTokens = vaults.map(vault => ({
      chainId: vault.chainId,
      address: vault.address.toLowerCase(),
      symbol: `yv${vault.asset.symbol}`,
      decimals: vault.decimals,
      price: vault.pricePerShare ? Number(vault.pricePerShare) / 10 ** (vault.decimals || 18) : 0,
      assetAddress: vault.asset.address.toLowerCase(), // Ensure lowercase for consistency
    }));

    const underlyingTokens = vaults.map(vault => ({
      chainId: vault.chainId,
      address: vault.asset.address.toLowerCase(),
      symbol: vault.asset.symbol,
      decimals: vault.asset.decimals,
    }));

    console.log(`Fetched ${vaultTokens.length} vault tokens and ${underlyingTokens.length} underlying tokens from Kong for chain ${chainId}`);
    return [...vaultTokens, ...underlyingTokens];
  } catch (error) {
    console.error(`Kong GraphQL error for chain ${chainId}:`, error);
  }
  
  return tokens;
}
