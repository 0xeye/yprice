import { fetchPricesFromCoinGecko, remapVaultToPrice } from '../sources/coingecko';
import { fetchTokenList } from './tokenList';
import { savePrices, setHealthcheck } from './redis';
import { SUPPORTED_CHAINS } from '../types';
import type { Price } from '../types';

export async function updatePrices(): Promise<void> {
  console.log('Starting price update...');
  
  for (const chainId of SUPPORTED_CHAINS) {
    try {
      console.log(`Fetching tokens for chain ${chainId}...`);
      const tokens = await fetchTokenList(chainId);
      console.log(`Found ${tokens.length} tokens for chain ${chainId}`);
      
      if (tokens.length === 0) continue;
      
      const vaultTokens = tokens.filter(token => token.price); // Priced via share price
      const assetTokens = tokens.filter(token => !token.price); // Priced via coingecko

      // Fetch missing prices from CoinGecko
      const tokenPrices: Price[] = await fetchPricesFromCoinGecko(assetTokens);
      const vaultPrices = remapVaultToPrice(vaultTokens);
      const prices = [...vaultPrices, ...tokenPrices];

      console.log(`Saving ${prices.length} prices for chain ${chainId}`);
      await savePrices(chainId, prices);
    } catch (error) {
      console.error(`Error updating prices for chain ${chainId}:`, error);
    }
  }
  
  // Update healthcheck timestamp
  await setHealthcheck();
  console.log('Price update completed');
}
