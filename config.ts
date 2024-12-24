import dotenv from "dotenv";
dotenv.config({ path: ".env" });
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import bs58 from 'bs58';

export const connection1 = new Connection(
    'https://mainnet.helius-rpc.com/?api-key=b70270fe-9d70-4687-ac6d-5c9b20059896', 
    {
        commitment: "confirmed",
    }
);

export const connection2 = new Connection(
    'https://mainnet.helius-rpc.com/?api-key=b70270fe-9d70-4687-ac6d-5c9b20059896', 
    {
        commitment: "confirmed",
    }
);

export const TARGET_WALLET_ADDRESS = new PublicKey('');
export const RAYDIUM_LIQUIDITYPOOL_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
export const SOL_ADDRESS = new PublicKey('So11111111111111111111111111111111111111112');
export const WALLET = Keypair.fromSecretKey(bs58.decode(""));
export const TRADE_AMOUNT = 10000000; //0.01 SOL
export const COMPUTE_PRICE = 100000;
export const LIMIT_ORDER = 1.25;
export const SLIPPAGE = 5;

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}