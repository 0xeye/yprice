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
}

export async function fetchTokenList(chainId: number): Promise<Token[]> {
  const tokens: Token[] = [];
  const uniqueTokens = new Map<string, Token>();
  
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
    
    const result = await response.json();
    
    if (result.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }
    
    const vaults: KongVault[] = result.data?.vaults || [];
    
    // Extract unique tokens from vaults
    for (const vault of vaults) {
      // Add the vault token itself
      const vaultToken: Token = {
        chainId: vault.chainId,
        address: vault.address.toLowerCase(),
        symbol: `yv${vault.asset.symbol}`,
        decimals: 18, // Yearn vaults typically use 18 decimals
      };
      uniqueTokens.set(vaultToken.address, vaultToken);
      
      // Add the underlying asset
      if (vault.asset) {
        const assetToken: Token = {
          chainId: vault.chainId,
          address: vault.asset.address.toLowerCase(),
          symbol: vault.asset.symbol,
          decimals: vault.asset.decimals,
        };
        uniqueTokens.set(assetToken.address, assetToken);
      }
    }
    
    tokens.push(...uniqueTokens.values());
    console.log(`Fetched ${tokens.length} unique tokens from Kong for chain ${chainId}`);
    
  } catch (error) {
    console.error(`Kong GraphQL error for chain ${chainId}:`, error);
  }
  
  return tokens;
}
