import { fetchTokenList } from '../src/services/tokenList';
import { fetchPricesFromCoinGecko } from '../src/sources/coingecko';

async function testVaultPrices() {
  console.log('Testing vault price calculation...\n');
  
  // Test with Ethereum (chain 1)
  const chainId = 1;
  console.log(`Fetching tokens for chain ${chainId}...`);
  
  const tokens = await fetchTokenList(chainId);
  console.log(`Found ${tokens.length} tokens\n`);
  
  // Find vault tokens
  const vaultTokens = tokens.filter(token => token.price && token.assetAddress);
  console.log(`Found ${vaultTokens.length} vault tokens\n`);
  
  // Show first few vault tokens
  vaultTokens.slice(0, 3).forEach(vault => {
    console.log(`Vault: ${vault.symbol}`);
    console.log(`  Address: ${vault.address}`);
    console.log(`  Asset Address: ${vault.assetAddress}`);
    console.log(`  PricePerShare: ${vault.price}`);
    console.log('');
  });
  
  // Fetch asset prices
  const assetTokens = tokens.filter(token => !token.price);
  console.log(`\nFetching prices for ${assetTokens.length} assets from CoinGecko...`);
  
  const prices = await fetchPricesFromCoinGecko(assetTokens.slice(0, 5)); // Test with first 5
  console.log(`\nFetched ${prices.length} asset prices`);
  
  // Show example calculation
  if (vaultTokens.length > 0 && prices.length > 0) {
    const vault = vaultTokens[0];
    const assetPrice = prices.find(p => p.address.toLowerCase() === vault.assetAddress?.toLowerCase());
    
    if (assetPrice) {
      console.log('\nExample vault price calculation:');
      console.log(`Vault: ${vault.symbol}`);
      console.log(`PricePerShare: ${vault.price}`);
      console.log(`Asset Price: $${assetPrice.price}`);
      console.log(`Vault Price: $${(vault.price! * assetPrice.price).toFixed(2)}`);
    }
  }
}

testVaultPrices().catch(console.error);