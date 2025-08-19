import { fetchPricesFromDefiLlama } from '../sources/defillama';
import { fetchPricesFromCoinGecko } from '../sources/coingecko';
import { fetchTokenList } from './tokenList';
import { savePrices, setHealthcheck } from './redis';
import { SUPPORTED_CHAINS } from '../types';
import type { Price, Token } from '../types';

export async function updatePrices(): Promise<void> {
  console.log('Starting price update...');
  
  for (const chainId of SUPPORTED_CHAINS) {
    try {
      console.log(`Fetching tokens for chain ${chainId}...`);
      const tokens = await fetchTokenList(chainId);
      console.log(`Found ${tokens.length} tokens for chain ${chainId}`);
      
      if (tokens.length === 0) continue;
      
      // Fetch prices from DefiLlama first
      console.log(`Fetching prices from DefiLlama for chain ${chainId}...`);
      const defiLlamaPrices = await fetchPricesFromDefiLlama(tokens);
      
      // Find tokens without prices
      const tokensWithoutPrices = tokens.filter(token => 
        !defiLlamaPrices.find(p => p.address === token.address.toLowerCase())
      );
      
      // Try CoinGecko for missing prices
      let coingeckoPrices: Price[] = [];
      if (tokensWithoutPrices.length > 0) {
        console.log(`Fetching ${tokensWithoutPrices.length} missing prices from CoinGecko for chain ${chainId}...`);
        coingeckoPrices = await fetchPricesFromCoinGecko(tokensWithoutPrices);
      }
      
      // Combine prices (DefiLlama takes precedence)
      const allPrices = [...defiLlamaPrices, ...coingeckoPrices];
      
      console.log(`Saving ${allPrices.length} prices for chain ${chainId}`);
      await savePrices(chainId, allPrices);
    } catch (error) {
      console.error(`Error updating prices for chain ${chainId}:`, error);
    }
  }
  
  // Update healthcheck timestamp
  await setHealthcheck();
  console.log('Price update completed');
}

export async function updatePricesForTokens(tokens: Array<{ chainId: number; address: string }>): Promise<Price[]> {
  const prices: Price[] = [];
  
  // Group tokens by chainId
  const tokensByChain = tokens.reduce((acc, token) => {
    if (!acc[token.chainId]) acc[token.chainId] = [];
    acc[token.chainId].push({ chainId: token.chainId, address: token.address } as Token);
    return acc;
  }, {} as Record<number, Token[]>);
  
  for (const [chainId, chainTokens] of Object.entries(tokensByChain)) {
    try {
      // Try DefiLlama first
      const defiLlamaPrices = await fetchPricesFromDefiLlama(chainTokens);
      prices.push(...defiLlamaPrices);
      
      // Find tokens without prices
      const tokensWithoutPrices = chainTokens.filter(token => 
        !defiLlamaPrices.find(p => p.address === token.address.toLowerCase())
      );
      
      // Try CoinGecko for missing prices
      if (tokensWithoutPrices.length > 0) {
        const coingeckoPrices = await fetchPricesFromCoinGecko(tokensWithoutPrices);
        prices.push(...coingeckoPrices);
      }
    } catch (error) {
      console.error(`Error fetching prices for chain ${chainId}:`, error);
    }
  }
  
  return prices;
}