export interface Price {
  chainId: number;
  address: string;
  price: number;
  time: number;
  source: string;
}

export interface Token {
  chainId: number;
  address: string;
  symbol?: string;
  decimals?: number;
  price?: number;
  assetAddress?: string;
}

export const SUPPORTED_CHAINS = [1, 10, 137, 250, 8453, 42161] as const;
export type ChainId = typeof SUPPORTED_CHAINS[number];

export const CHAIN_NAMES: Record<ChainId, string> = {
  1: 'ethereum',
  10: 'optimism',
  137: 'polygon',
  250: 'fantom',
  8453: 'base',
  42161: 'arbitrum',
};