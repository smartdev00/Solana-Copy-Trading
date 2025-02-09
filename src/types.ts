import { PublicKey } from '@solana/web3.js';

export interface TokenListType {
  mint: PublicKey;
  amount: number;
  fee: number;
  dex: string;
  sold: boolean;
  symbol: string;
  decimals: number;
  pool: string | null;
}

export type AnalyzeType = {
  signature: string;
  target_wallet: string;
  type: string;
  dex: string;
  pool_address: string | null;
  from: {
    token_address: string;
    amount: number;
    symbol: string;
    decimals: number;
  };
  to: {
    token_address: string;
    amount: number;
    symbol: string;
    decimals: number;
  };
};
