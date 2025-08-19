import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Test endpoint hit!');
  res.status(200).json({ 
    message: 'API is working!',
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString()
  });
}