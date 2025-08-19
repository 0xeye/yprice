import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPrices } from '@/services/redis';
import { SUPPORTED_CHAINS } from '@/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const chainId = parseInt(req.query.chainId as string);
  
  if (!SUPPORTED_CHAINS.includes(chainId as any)) {
    return res.status(400).json({ error: 'Invalid chain ID' });
  }
  
  try {
    const prices = await getPrices(chainId);
    res.status(200).json(prices);
  } catch (error) {
    console.error(`Error fetching prices for chain ${chainId}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
}