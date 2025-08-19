import Redis from 'ioredis';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Price } from '../types';

// Configure Redis with better error handling and Upstash-specific settings
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const isUpstash = redisUrl.includes('upstash.io');

// Parse URL to handle Upstash format properly
let redis: Redis;

if (isUpstash) {
  // Upstash requires specific configuration
  const urlParts = redisUrl.match(/redis:\/\/(.+):(.+)@(.+):(\d+)/);
  if (urlParts) {
    const [, username, password, host, port] = urlParts;
    redis = new Redis({
      host,
      port: parseInt(port),
      password,
      username: username !== 'default' ? username : undefined,
      tls: {},
      maxRetriesPerRequest: 3,
      enableReadyCheck: false, // Upstash doesn't support PING during auth
      connectTimeout: 10000,
      family: 4,
      retryStrategy: (times) => {
        if (times > 10) return null;
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
    });
  } else {
    throw new Error('Invalid Upstash Redis URL format');
  }
} else {
  // Local Redis
  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 10000,
    family: 4,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });
}

// Handle connection events
redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

redis.on('ready', () => {
  console.log('Redis client ready');
});

export async function savePrices(chainId: number, prices: Price[]): Promise<void> {
  const key = `prices:${chainId}`;
  const data = JSON.stringify(prices, null, 2);
  
  // Save to Redis
  await redis.set(key, data, 'EX', 3600); // 1 hour TTL
  
  // Save to JSON file
  try {
    const dataDir = join(process.cwd(), 'data');
    mkdirSync(dataDir, { recursive: true });
    
    const filePath = join(dataDir, `${chainId}.json`);
    writeFileSync(filePath, data, 'utf-8');
    console.log(`Saved ${prices.length} prices to ${filePath}`);
  } catch (error) {
    console.error(`Error saving prices to file for chain ${chainId}:`, error);
  }
}

export async function getPrices(chainId: number): Promise<Price[]> {
  const key = `prices:${chainId}`;
  const data = await redis.get(key);
  return data ? JSON.parse(data) : [];
}

export async function getAllPrices(): Promise<Price[]> {
  const keys = await redis.keys('prices:*');
  if (keys.length === 0) return [];
  
  const values = await redis.mget(...keys);
  const allPrices: Price[] = [];
  
  values.forEach((value) => {
    if (value) {
      allPrices.push(...JSON.parse(value));
    }
  });
  
  return allPrices;
}

export async function setHealthcheck(): Promise<void> {
  await redis.set('healthcheck', Date.now());
}

export async function getHealthcheck(): Promise<number | null> {
  const timestamp = await redis.get('healthcheck');
  return timestamp ? parseInt(timestamp) : null;
}

export { redis };