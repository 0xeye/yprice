import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllPrices } from '@/services/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Prices endpoint called', { method: req.method });
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    console.log('Fetching all prices from Redis...');
    const prices = await getAllPrices();
    console.log('Prices fetched:', prices.length);
    res.status(200).json(prices);
  } catch (error) {
    console.error('Error fetching all prices:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}