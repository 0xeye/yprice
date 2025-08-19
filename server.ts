import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';

// Import API handlers
import pricesHandler from './api/prices';
import healthcheckHandler from './api/healthcheck';
import chainPricesHandler from './api/prices/[chainId]';
import tokenPricesHandler from './api/prices/[tokens]';
import testHandler from './api/test';
import debugHandler from './api/debug';
import refreshHandler from './api/refresh';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Convert Vercel handlers to Express handlers
const vercelToExpress = (handler: any) => {
  return async (req: Request, res: Response) => {
    const vercelReq = {
      ...req,
      query: req.query,
      cookies: req.cookies,
      body: req.body,
    };
    
    const vercelRes = {
      status: (code: number) => ({
        json: (data: any) => res.status(code).json(data),
        send: (data: any) => res.status(code).send(data),
      }),
      json: (data: any) => res.json(data),
      send: (data: any) => res.send(data),
    };
    
    await handler(vercelReq, vercelRes);
  };
};

// Routes
app.get('/api/test', vercelToExpress(testHandler));
app.get('/api/debug', vercelToExpress(debugHandler));
app.get('/api/healthcheck', vercelToExpress(healthcheckHandler));
app.post('/api/refresh', vercelToExpress(refreshHandler));
app.get('/api/prices', vercelToExpress(pricesHandler));
app.get('/api/prices/:chainId', (req, res) => {
  req.query.chainId = req.params.chainId;
  vercelToExpress(chainPricesHandler)(req, res);
});
app.get('/api/prices/:tokens', (req, res) => {
  req.query.tokens = req.params.tokens;
  vercelToExpress(tokenPricesHandler)(req, res);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET /api/test');
  console.log('  GET /api/debug');
  console.log('  GET /api/healthcheck');
  console.log('  POST /api/refresh - Trigger price update');
  console.log('  GET /api/prices');
  console.log('  GET /api/prices/:chainId');
  console.log('  GET /api/prices/:tokens');
});