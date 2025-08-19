import type { Price, Token } from '../types';

const DEFILLAMA_API = 'https://coins.llama.fi/prices/current';

interface DefiLlamaResponse {
  coins: {
    [key: string]: {
      decimals: number;
      price: number;
      symbol: string;
      timestamp: number;
      confidence: number;
    };
  };
}

export async function fetchPricesFromDefiLlama(tokens: Token[]): Promise<Price[]> {
  const prices: Price[] = [];
  
  // Group tokens by chainId for batch requests
  const tokensByChain = tokens.reduce((acc, token) => {
    if (!acc[token.chainId]) acc[token.chainId] = [];
    acc[token.chainId].push(token);
    return acc;
  }, {} as Record<number, Token[]>);
  
  for (const [chainId, chainTokens] of Object.entries(tokensByChain)) {
    const chain = getDefiLlamaChainName(parseInt(chainId));
    const addresses = chainTokens.map(t => `${chain}:${t.address}`).join(',');
    
    try {
      const response = await fetch(`${DEFILLAMA_API}?coins=${addresses}`);
      
      if (!response.ok) {
        throw new Error(`DefiLlama API returned ${response.status}: ${response.statusText}`);
      }
      
      const data: DefiLlamaResponse = await response.json();
      
      for (const [key, value] of Object.entries(data.coins)) {
        const address = key.split(':')[1];
        const token = chainTokens.find(t => t.address.toLowerCase() === address.toLowerCase());
        
        if (token && value.price > 0) {
          prices.push({
            chainId: parseInt(chainId),
            address: token.address.toLowerCase(),
            price: value.price,
            time: Date.now(),
            source: 'defillama',
          });
        }
      }
    } catch (error) {
      console.error(`DefiLlama fetch error for chain ${chainId}:`, error);
    }
  }
  
  return prices;
}

function getDefiLlamaChainName(chainId: number): string {
  const chainMap: Record<number, string> = {
    1: 'ethereum',
    10: 'optimism',
    137: 'polygon',
    250: 'fantom',
    8453: 'base',
    42161: 'arbitrum',
  };
  return chainMap[chainId] || 'ethereum';
}