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

      // Fetch asset prices from CoinGecko first
      const tokenPrices: Price[] = await fetchPricesFromCoinGecko(assetTokens);
      
      // Create a map of asset prices for easy lookup
      const assetPriceMap = new Map<string, number>();
      tokenPrices.forEach(price => {
        assetPriceMap.set(price.address.toLowerCase(), price.price);
      });
      
      // Calculate vault prices using pricePerShare * asset price
      const vaultPrices = vaultTokens.map(vault => {
        const assetAddress = vault.assetAddress?.toLowerCase();
        const assetPrice = assetAddress ? assetPriceMap.get(assetAddress) || 0 : 0;
        const vaultPrice = vault.price! * assetPrice;
        
        return {
          chainId: vault.chainId,
          address: vault.address.toLowerCase(),
          price: vaultPrice,
          time: Date.now(),
          source: 'kong',
        } as Price;
      });
      
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
