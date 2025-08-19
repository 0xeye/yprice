import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getHealthcheck } from '@/services/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const timestamp = await getHealthcheck();
    
    if (!timestamp) {
      return res.status(503).json({
        status: 'error',
        message: 'No healthcheck timestamp found',
      });
    }
    
    const now = Date.now();
    const age = now - timestamp;
    const maxAge = 35 * 60 * 1000; // 35 minutes
    
    if (age > maxAge) {
      return res.status(503).json({
        status: 'stale',
        timestamp,
        age,
        message: 'Price data is stale',
      });
    }
    
    res.status(200).json({
      status: 'healthy',
      timestamp,
      age,
    });
  } catch (error) {
    console.error('Error checking health:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
}