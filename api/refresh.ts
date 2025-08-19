import type { VercelRequest, VercelResponse } from '@vercel/node';
import { updatePrices } from '@/services/priceFetcher';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Optional: Add authentication here for production
  // const authToken = req.headers.authorization;
  // if (authToken !== `Bearer ${process.env.REFRESH_TOKEN}`) {
  //   return res.status(401).json({ error: 'Unauthorized' });
  // }
  
  try {
    console.log('Manual refresh triggered via API');
    
    // Run update in background
    updatePrices().catch(error => {
      console.error('Background price update failed:', error);
    });
    
    res.status(200).json({ 
      message: 'Price refresh started',
      note: 'This runs in the background. Check /api/healthcheck for completion status.'
    });
  } catch (error) {
    console.error('Error triggering refresh:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}