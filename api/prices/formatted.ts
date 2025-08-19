import { Request, Response } from 'express';
import { getAllPrices } from '../../src/services/redis.js';

export default async function handler(req: Request, res: Response) {
  try {
    const allPrices = await getAllPrices();
    
    // Transform the price data into the required format with bigint strings
    const formattedData: { [chainId: string]: { [address: string]: string } } = {};
    
    for (const price of allPrices) {
      const chainIdStr = price.chainId.toString();
      
      if (!formattedData[chainIdStr]) {
        formattedData[chainIdStr] = {};
      }
      
      // Convert price to match Yearn's format (appears to be price * 1e8 or similar)
      // Based on Yearn's API, prices look like "4238580000" for ~$42.38
      const priceScaled = Math.floor(price.price * 1e8);
      formattedData[chainIdStr][price.address] = priceScaled.toString();
    }
    
    res.json(formattedData);
  } catch (error) {
    console.error('Error fetching formatted prices:', error);
    res.status(500).json({ error: 'Failed to fetch formatted prices' });
  }
}