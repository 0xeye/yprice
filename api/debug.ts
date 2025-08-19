import type { VercelRequest, VercelResponse } from '@vercel/node';
import { redis } from '@/services/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Debug endpoint called');
  
  try {
    // Test Redis connection
    console.log('Testing Redis ping...');
    const pong = await redis.ping();
    console.log('Redis ping response:', pong);
    
    // Get Redis info
    const info = await redis.info('server');
    const redisVersion = info.match(/redis_version:(.+)/)?.[1];
    
    // Check environment
    const redisUrl = process.env.REDIS_URL;
    const isUpstash = redisUrl?.includes('upstash.io');
    
    res.status(200).json({
      status: 'ok',
      redis: {
        connected: redis.status === 'ready',
        status: redis.status,
        ping: pong,
        version: redisVersion,
        isUpstash,
        url: redisUrl ? redisUrl.replace(/:[^:@]+@/, ':****@') : 'Not configured',
      },
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        hasRedisUrl: !!process.env.REDIS_URL,
      },
    });
  } catch (error: any) {
    console.error('Debug error:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
      redis: {
        status: redis.status,
        url: process.env.REDIS_URL ? 'Configured' : 'Not configured',
      },
    });
  }
}