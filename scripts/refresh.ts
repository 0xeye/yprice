import { updatePrices } from '../src/services/priceFetcher';
import { redis } from '../src/services/redis';

async function main() {
  console.log('Starting manual price refresh...');
  
  try {
    await updatePrices();
    console.log('Price refresh completed successfully');
  } catch (error) {
    console.error('Error during price refresh:', error);
    process.exit(1);
  } finally {
    await redis.quit();
  }
}

main();