import dotenv from "dotenv";
dotenv.config({ path: ".env" });
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import bs58 from 'bs58';

export const connection1 = new Connection(
    process.env.CONNECTION_URL_1 || "", 
    {
        commitment: "confirmed",
    }
);

export const connection2 = new Connection(
    process.env.CONNECTION_URL_2 || "", 
    {
        commitment: "confirmed",
    }
);

export const TARGET_WALLET_ADDRESS = new PublicKey(process.env.TARGET_WALLET_ADDRESS || "");
export const TARGET_WALLET_MIN_TRADE = parseInt(process.env.TARGET_WALLET_MIN_TRADE || "0");
export const RAYDIUM_LIQUIDITYPOOL_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
export const RAYDIUM_CONCENTRATED_LIQUIDITY = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK')
export const SOL_ADDRESS = new PublicKey('So11111111111111111111111111111111111111112');
export const WALLET = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY || ""));
export const TRADE_AMOUNT = parseInt(process.env.TRADE_AMOUNT || "0");
export const COMPUTE_PRICE = 100000;
export const LIMIT_ORDER = 1.25;
export const SLIPPAGE = 5;