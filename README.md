# Price API

A minimal, high-availability price API backend for Yearn tokens.

## Features

- Fetches prices from DefiLlama and CoinGecko (with fallback)
- Redis-based caching for high availability
- Vercel function deployments
- Minimal dependencies

## Setup

1. Install dependencies:
   ```bash
   bun install
   ```

2. Start Redis (using Docker):
   ```bash
   docker-compose up -d
   ```
   
   Or use Upstash for a hosted Redis instance.

3. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```

4. Run the development server:
   ```bash
   bun run dev
   ```

## API Endpoints

- `GET /api/prices` - Returns all prices across all chains
- `GET /api/prices/[chainId]` - Returns prices for a specific chain
- `GET /api/prices/[tokens]` - Returns prices for specific tokens
  - Format: `chainId:address,chainId:address,...`
  - Example: `/api/prices/1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48,10:0x7f5c764cbc14f9669b88837ca1490cca17c31607`
- `GET /api/healthcheck` - Returns the health status and last update timestamp

## Manual Price Update

To manually refresh prices:

```bash
bun run refresh
```

## Price Schema

```typescript
{
  chainId: number;
  address: string;
  price: number;     // USD price
  time: number;      // Timestamp
  source: string;    // 'defillama' or 'coingecko'
}
```

## Supported Chains

- Ethereum (1)
- Optimism (10)
- Polygon (137)
- Fantom (250)
- Base (8453)
- Arbitrum (42161)