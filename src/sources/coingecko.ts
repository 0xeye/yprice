import type { Price, Token } from '../types/index.js';

const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/token_price';

interface CoinGeckoResponse {
  [address: string]: {
    usd: number;
  };
}

export function remapVaultToPrice(tokens: Token[]): Price[] {
  return tokens.map(token => ({
    chainId: token.chainId,
    address: token.address.toLowerCase(),
    price: token.price || 0,
    time: Date.now(),
    source: 'kong',
  }));
}

export async function fetchPricesFromCoinGecko(tokens: Token[]): Promise<Price[]> {
  const prices: Price[] = [];
  const apiKey = process.env.COINGECKO_API_KEY;
  
  // Group tokens by chainId
  const tokensByChain = tokens.reduce((acc, token) => {
    if (!acc[token.chainId]) acc[token.chainId] = [];
    acc[token.chainId].push(token);
    return acc;
  }, {} as Record<number, Token[]>);
  
  for (const [chainId, chainTokens] of Object.entries(tokensByChain)) {
    const platform = getCoinGeckoPlatform(parseInt(chainId));
    if (!platform) continue;
    
    // CoinGecko has a limit of 100 addresses per request
    const chunks = [];
    for (let i = 0; i < chainTokens.length; i += 100) {
      chunks.push(chainTokens.slice(i, i + 100));
    }
    
    for (const chunk of chunks) {
      const addresses = chunk.map(t => t.address).join(',');
      const url = `${COINGECKO_API}/${platform}?contract_addresses=${addresses}&vs_currencies=usd`;
      
      try {
        const headers: Record<string, string> = {};
        if (apiKey) {
          headers['x-cg-demo-api-key'] = apiKey;
        }
        
        const response = await fetch(url, { headers });
        const data: CoinGeckoResponse = await response.json() as any;
        
        for (const [address, value] of Object.entries(data)) {
          const token = chunk.find(t => t.address.toLowerCase() === address.toLowerCase());
          
          if (token && value.usd > 0) {
            prices.push({
              chainId: parseInt(chainId),
              address: token.address.toLowerCase(),
              price: value.usd,
              time: Date.now(),
              source: 'coingecko',
            });
          }
        }
      } catch (error) {
        console.error(`CoinGecko fetch error for chain ${chainId}:`, error);
      }
      
      // Rate limit: 30 calls/minute for free tier
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  return prices;
}

function getCoinGeckoPlatform(chainId: number): string | null {
  const platformMap: Record<number, string> = {
    1: 'ethereum',
    10: 'optimistic-ethereum',
    137: 'polygon-pos',
    250: 'fantom',
    8453: 'base',
    42161: 'arbitrum-one',
  };
  return platformMap[chainId] || null;
}