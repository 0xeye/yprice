import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPrices } from '@/services/redis';
import { updatePricesForTokens } from '@/services/priceFetcher';
import type { Price } from '@/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const tokensParam = req.query.tokens as string;
  
  try {
    // Parse tokens from format: chainId:address,chainId:address,...
    const tokenRequests = tokensParam.split(',').map(token => {
      const [chainId, address] = token.split(':');
      return {
        chainId: parseInt(chainId),
        address: address.toLowerCase(),
      };
    });
    
    // First try to get from cache
    const cachedPrices: Price[] = [];
    const tokensToFetch: Array<{ chainId: number; address: string }> = [];
    
    for (const token of tokenRequests) {
      const chainPrices = await getPrices(token.chainId);
      const price = chainPrices.find(p => p.address === token.address);
      
      if (price) {
        cachedPrices.push(price);
      } else {
        tokensToFetch.push(token);
      }
    }
    
    // Fetch missing prices
    let freshPrices: Price[] = [];
    if (tokensToFetch.length > 0) {
      freshPrices = await updatePricesForTokens(tokensToFetch);
    }
    
    // Combine cached and fresh prices
    const allPrices = [...cachedPrices, ...freshPrices];
    
    res.status(200).json(allPrices);
  } catch (error) {
    console.error('Error fetching token prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}