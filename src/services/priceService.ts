import { getPriceStorage } from '../storage';
import { PriceFetcherOrchestrator } from '../fetchers';
import { ERC20Token } from '../models';
import { logger } from '../utils';
import { progressTracker } from '../utils/progressTracker';
import tokenDiscoveryService from '../discovery/tokenDiscoveryService';
import { chunk } from 'lodash';

export class PriceService {
  private fetcher = new PriceFetcherOrchestrator();
  private fetchInterval: NodeJS.Timeout | null = null;

  async fetchAndStorePrices(chainId: number, tokens: ERC20Token[]): Promise<void> {
    try {
      const tokensWithNative = [...tokens];
      if (chainId === 1 || chainId === 10 || chainId === 42161 || chainId === 8453) {
        const wethAddresses = {
          1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          10: '0x4200000000000000000000000000000000000006',
          42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
          8453: '0x4200000000000000000000000000000000000006',
        };
        
        const wethAddress = wethAddresses[chainId as keyof typeof wethAddresses];
        if (wethAddress && !tokensWithNative.some(t => t.address.toLowerCase() === wethAddress)) {
          tokensWithNative.push({
            address: wethAddress,
            name: 'Wrapped Ether',
            symbol: 'WETH',
            decimals: 18,
            chainId,
          });
        }
      }
      
      const prices = await this.fetcher.fetchPrices(chainId, tokensWithNative);
      const storage = getPriceStorage();
      
      if (chainId === 1 || chainId === 10 || chainId === 42161 || chainId === 8453) {
        const wethAddresses = {
          1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          10: '0x4200000000000000000000000000000000000006',
          42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
          8453: '0x4200000000000000000000000000000000000006',
        };
        
        const wethAddress = wethAddresses[chainId as keyof typeof wethAddresses];
        const wethPrice = prices.get(wethAddress!);
        if (wethPrice) {
          prices.set('0x0000000000000000000000000000000000000000', {
            ...wethPrice,
            address: '0x0000000000000000000000000000000000000000',
          });
        }
      }
      
      const pricesArray = Array.from(prices.values());
      if (pricesArray.length > 0) {
        storage.storePrices(chainId, pricesArray);
      }
    } catch (error) {
      logger.error(`Error fetching prices for chain ${chainId}:`, error);
    }
  }

  async fetchDiscoveredTokens(forceRefresh: boolean = false): Promise<void> {
    try {
      const tokensByChain = await tokenDiscoveryService.discoverAllTokens(forceRefresh);
      
      const totalTokens = Array.from(tokensByChain.values()).reduce((sum, tokens) => sum + tokens.length, 0);
      logger.debug(`Discovery complete: ${tokensByChain.size} chains, ${totalTokens} total tokens`);
      
      // Process chains
      const processingKey = 'processing-all';
      progressTracker.start(processingKey, 'Processing Chains', tokensByChain.size);
      
      const chainPromises = Array.from(tokensByChain.entries()).map(async ([chainId, tokens]) => {
        if (tokens.length === 0) {
          progressTracker.increment(processingKey);
          return;
        }
        
        const batchSize = 500;
        const batches = chunk(tokens, batchSize);
        
        const chainKey = `chain-${chainId}`;
        progressTracker.start(chainKey, 'Fetching Prices', tokens.length, chainId);
        
        const batchGroups = chunk(batches, 3);
        for (const batchGroup of batchGroups) {
          await Promise.all(
            batchGroup.map(batch => this.fetchAndStorePrices(chainId, batch))
          );
          
          const processed = Math.min(
            batchGroups.indexOf(batchGroup) * 3 * batchSize + batchGroup.length * batchSize,
            tokens.length
          );
          progressTracker.update(chainKey, processed);
          
          if (batchGroups.indexOf(batchGroup) < batchGroups.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        
        progressTracker.complete(chainKey);
        progressTracker.increment(processingKey);
      });
      
      await Promise.all(chainPromises);
      progressTracker.complete(processingKey);
      
      const stats = progressTracker.getStats();
      logger.info(`✅ Price fetch complete: ${totalTokens} tokens processed${stats.errors > 0 ? ` (${stats.errors} errors)` : ''}`);
    } catch (error) {
      logger.error('Error fetching discovered tokens:', error);
    }
  }

  startPeriodicFetch(intervalMs: number = 60000): void {
    logger.info(`🚀 Starting price service (interval: ${intervalMs/1000}s)`);
    
    this.fetchDiscoveredTokens(true).catch(error => {
      logger.error('Error in initial price fetch:', error);
    });

    this.fetchInterval = setInterval(() => {
      const shouldRediscover = Date.now() % 3600000 < intervalMs;
      this.fetchDiscoveredTokens(shouldRediscover).catch(error => {
        logger.error('Error in periodic price fetch:', error);
      });
    }, intervalMs);
  }

  stopPeriodicFetch(): void {
    if (this.fetchInterval) {
      clearInterval(this.fetchInterval);
      this.fetchInterval = null;
      logger.info('⏹️ Stopped periodic price fetching');
    }
  }

  setVerboseLogging(verbose: boolean): void {
    logger.info(`Verbose logging ${verbose ? 'enabled' : 'disabled'}`);
  }
}

export default new PriceService();