import { PublicKey } from '@solana/web3.js';

export interface TokenListType {
  mint: PublicKey;
  amount: number;
  fee: number;
  sold: boolean;
}

export type AnalyzeType = {
  signature: string;
  target_wallet: string;
  type: string;
  dex: string;
  pool_address: string;
  from: {
    token_address: string;
    amount: number;
    symbol: string;
  };
  to: {
    token_address: string;
    amount: number;
    symbol: string;
  };
};
