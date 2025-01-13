import dotenv from "dotenv";
import path from 'path';
import fs from 'fs';
import sound from 'sound-play';
import bs58 from 'bs58';

import {
  Keypair,
  PublicKey,
  ParsedInstruction,
  TransactionInstruction,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  Connection,
} from '@solana/web3.js';

// Process command-line arguments
// The app requires strictly one command-line argument which must be a path to configuration file
// For example `npm run start config.env`

if (process.argv.length !== 3) {
  console.error('Error launching app:');
  console.error('Application requires exactly one command-line parameter which must be a path to configuration file.');
  console.error('For example `npm run start config.env`');
  process.exit();
}

// Check configuration file and initialize environment variables

const pathToConfigurationFile = path.join(__dirname, process.argv[2]);
if (!fs.existsSync(pathToConfigurationFile)) {
  console.error('Error launching app:');
  console.error(`Configuration file ${pathToConfigurationFile} not found.`);
  process.exit();
}
dotenv.config({ path: pathToConfigurationFile });

// Initialize parameters from environment variables

const connection1 = new Connection(process.env.CONNECTION_URL_1 || "",  {commitment: "confirmed"});
const connection2 = new Connection(process.env.CONNECTION_URL_2 || "", {commitment: "confirmed"});
const TARGET_WALLET_ADDRESS = new PublicKey(process.env.TARGET_WALLET_ADDRESS || "");
const TARGET_WALLET_MIN_TRADE = parseInt(process.env.TARGET_WALLET_MIN_TRADE || "0");
const RAYDIUM_LIQUIDITYPOOL_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const SOL_ADDRESS = new PublicKey('So11111111111111111111111111111111111111112');
const WALLET = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY || ""));
const TRADE_AMOUNT = parseInt(process.env.TRADE_AMOUNT || "0");
const COMPUTE_PRICE = 100000;
const LIMIT_ORDER = 1.25;
const SLIPPAGE = 5;

const soundFilePaths = {
    botStart: path.join(__dirname, "../sounds/bot-start.mp3"),
    buyTrade: path.join(__dirname, "../sounds/bot-buy-trade.mp3"),
    buyTradeCopied: path.join(__dirname, "../sounds/bot-buy-trade-copied.mp3"),
    sellTrade: path.join(__dirname, "../sounds/bot-sell-trade.mp3"),
    sellTradeCopied: path.join(__dirname, "../sounds/bot-sell-trade-copied.mp3")
}

import { 
  LIQUIDITY_STATE_LAYOUT_V4, 
  Liquidity, 
  MARKET_STATE_LAYOUT_V3, 
  SPL_MINT_LAYOUT, 
  LiquidityPoolKeys, 
  Market
} from "@raydium-io/raydium-sdk";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

/* import { 
  connection1,
  connection2, 
  WALLET,
  TARGET_WALLET_ADDRESS, 
  RAYDIUM_LIQUIDITYPOOL_V4, 
  SOL_ADDRESS,
  TRADE_AMOUNT,
  TARGET_WALLET_MIN_TRADE,
  COMPUTE_PRICE,
  LIMIT_ORDER,
  SLIPPAGE
} from './config.js'; */

const LAMPORTS_IN_SOL = 1_000_000_000;

// Confirm the bot started working
console.info('Gamesoft Interactive, 2025');
console.info('Copy trading bot for Solana.');
console.info('Using configuration file', pathToConfigurationFile);
console.info('Target wallet address', process.env.TARGET_WALLET_ADDRESS);
console.info('Target wallet minimal trade size', TARGET_WALLET_MIN_TRADE / LAMPORTS_IN_SOL, 'SOL');
console.info('Trading amount', TRADE_AMOUNT / LAMPORTS_IN_SOL, 'SOL');

//sound.play(soundFilePaths.botStart);

/*
 * Stores timestamp when the app started
 * Used to prevent processing transactions created before app launch
 */

let appStartedAtSeconds = Math.floor(Date.now() / 1000);

/*
 * Trade log filename (ensure it is ignored by Git)
 * TODO: Specify through configuration file
 */

const LOG_FILE = 'trade_log.csv';

// Create log file if not exists and add headers
if (!fs.existsSync(LOG_FILE)) { 
  fs.writeFileSync(LOG_FILE, 'Timestamp,Action,Wallet,Token,Amount (SOL),Reason\n'); 
}

/**
 * How many latest transactions to check for target wallet with each main loop iteration
 */
const signaturesForAddressLimitCount = 10;

/**
 * Stores transaction signatures which has been already processed.
 * Used to prevent processing transactions more than once.
 */
const processedTransactionSignatures: string[] = [];

/**
 * How many processed transaction signatures to store at most.
 * This value must be higher than signaturesForAddressLimitCount but not too much. x10 is probably enough.
 */
const processedTransactionSignaturesLimitCount = signaturesForAddressLimitCount * 10;

let buyTokenList: PublicKey[] = [];

/*
 * Primary function invoked by main loop and calling all subsequent functions during its work
 */

async function trackTargetWallet() {

    let signatures;

    try {
        signatures = await connection1.getSignaturesForAddress(TARGET_WALLET_ADDRESS, {limit: signaturesForAddressLimitCount});
    } catch (error: any) {
        console.error('Error fetching signatures:', error.cause);
        return;
    }

    for (const signatureInfo of signatures) {
        // Send for processing only unprocessed transactions
        // Do not send transactions created before app launch
        if (signatureInfo.blockTime && signatureInfo.blockTime > appStartedAtSeconds && !processedTransactionSignatures.includes(signatureInfo.signature)) {
            await processTransaction(signatureInfo);
            processedTransactionSignatures.push(signatureInfo.signature);
            if (processedTransactionSignatures.length > processedTransactionSignaturesLimitCount)
                processedTransactionSignatures.shift(); // Remove first value to keep this list relatively short
        }
    }
}

/*
 * Process specific transaction
 */

async function processTransaction(signatureInfo: any) {

    console.info('');
    console.log('Transaction detected:');
    console.log('Signature:', signatureInfo.signature);
    console.info('Timestamp:', signatureInfo.blockTime && new Date(signatureInfo.blockTime * 1000).toLocaleString() || 'None');    

    const { signature, err } = signatureInfo;
     
    if (err) return;

    const res = await analyzeSignature(connection1, signature);

    //console.info('res', res);

    if (res && res.isBuy && res.mint && res.pool) {

        console.info('\x1b[32mSwap transaction\x1b[0m');
        console.info('Mint:', res.mint.toString());
        console.info('Pool:', res.pool.toString());

        const tradeSize = await getTradeSize(connection1, res.signature);

        // Skip trades below the minimum threshold
        if (tradeSize < TARGET_WALLET_MIN_TRADE) {
            logToFile('Skipped', TARGET_WALLET_ADDRESS.toString(), res.mint.toString(), (tradeSize / 1_000_000_000).toString(), 'Below minimum trade size');
            console.log(`Skipped: Value (${tradeSize / 1000000000} SOL) below threshold (${TARGET_WALLET_MIN_TRADE / 1000000000} SOL).`);
            sound.play(soundFilePaths.buyTrade);
            return;
        }

        logToFile('Buy Detected', TARGET_WALLET_ADDRESS.toString(), res.mint.toString(), (tradeSize / 1_000_000_000).toString());
        console.log(`Target: buy ${res.mint} token on ${res.pool} pool`);
        sound.play(soundFilePaths.buyTradeCopied);
        const buy =  await Buy(connection1, res.mint, res.pool);
        console.log('Buy: ', buy);

        if (buy && buy.mint && buy.poolKeys) {
            sound.play(soundFilePaths.sellTrade);
            sellWithLimitOrder(connection2, buy.mint, buy.poolKeys);
        }
    } else {
        console.info('Not a swap transaction.');
    }
}

/**
 * Obtains trade size for transaction with specified signature
 */

async function getTradeSize(connection: Connection, signature: string): Promise<number> {

    let transactionDetails;
    try {
        transactionDetails = await connection.getParsedTransaction(signature, {commitment: "confirmed", maxSupportedTransactionVersion: 0});
    } catch (error) {
        console.error('Error fetching trade size:', error);
        return 0;
    }

    const postBalances = transactionDetails?.meta?.postBalances || [];
    const preBalances = transactionDetails?.meta?.preBalances || [];

    if (postBalances.length > 0 && preBalances.length > 0) {
      const tradeSize = Math.abs(postBalances[0] - preBalances[0]); // Difference in balances
      return tradeSize;
    }

    return 0;  
}

/**
 * Analyzes transaction
 * @param connection 
 * @param signature 
 * @returns 
 */
async function analyzeSignature(connection: Connection, signature: string) {

    let transactionDetails;
    try {
        transactionDetails = await connection.getParsedTransaction(signature, {commitment: "confirmed", maxSupportedTransactionVersion: 0});
    } catch (error) {
        console.log('Error: analyze signature error!');
        return null;
    }

    //console.info('Transaction details', transactionDetails);

    let isBuy = true;
    let mintAddress: PublicKey | undefined;
    let poolAddress: PublicKey | undefined;
    
    if (transactionDetails?.meta?.logMessages) {
      const logs = transactionDetails.meta.logMessages;          
      const isRaydiumLog = logs.some(log =>
        log.includes(RAYDIUM_LIQUIDITYPOOL_V4.toString())
      );          
      const isTransferLog = logs.some(log =>
        log.includes("Program log: Instruction: Transfer")
      );
  
      if (isRaydiumLog && isTransferLog) {    
        //console.log('--- Detect Target Wallet Swap Transaction ---');  
        for (const instruction of transactionDetails.transaction.message.instructions) {  
          if ('accounts' in instruction && instruction.programId.equals(RAYDIUM_LIQUIDITYPOOL_V4)) {
            poolAddress = instruction.accounts[1];
            const poolAccount = await connection.getAccountInfo(poolAddress, "confirmed");
            
            if(poolAccount) {
              const poolInfo = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data);
              mintAddress = poolInfo.quoteMint.equals(SOL_ADDRESS) ? poolInfo.baseMint : poolInfo.quoteMint;
            }
          }
          const parsedInstruction = instruction as ParsedInstruction;
  
          if(parsedInstruction?.parsed?.type == 'createAccountWithSeed' && parsedInstruction?.parsed?.info?.lamports == '2039280') {
            isBuy = false;  
          }        
        }
      }
    }  
    return {signature, pool: poolAddress, mint: mintAddress, isBuy}  
}

async function Buy(connection: Connection, mint: PublicKey, pool: PublicKey) {
  try {
    console.log('Buy start');
    if(buyTokenList.includes(mint)) {
      logToFile('Skipped', WALLET.publicKey.toString(), mint.toString(), (TRADE_AMOUNT / 1_000_000_000).toString(), 'Token already purchased'); 
      console.log('Token: already purchased this token!');
      return;
    };

    const poolKeys = await getLiquidityV4PoolKeys(connection, pool);
    if(poolKeys) {
      const swapInst = await getSwapTokenGivenInInstructions(
        WALLET.publicKey,
        poolKeys,
        SOL_ADDRESS,
        BigInt(TRADE_AMOUNT)
      );
      let buyInsts: TransactionInstruction[] = [];
      buyInsts.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: COMPUTE_PRICE,
        }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 75000 }),
        ...swapInst
      );
      let latestBlock = await connection.getLatestBlockhash();
      const newTokenTransactionMessage = new TransactionMessage({
        payerKey: WALLET.publicKey,
        recentBlockhash: latestBlock.blockhash,
        instructions: buyInsts,
      }).compileToV0Message();
      const versionedNewTokenTransaction = new VersionedTransaction(
        newTokenTransactionMessage
      );
      versionedNewTokenTransaction.sign([WALLET]);
      const res = await connection.sendRawTransaction(
        versionedNewTokenTransaction.serialize(),
        { skipPreflight: false }
      );
      console.log("SendRawTransaction: ", res)
      const confirmStatus = await connection.confirmTransaction(
        {
          signature: res,
          lastValidBlockHeight: latestBlock.lastValidBlockHeight,
          blockhash: latestBlock.blockhash,
        },
        "confirmed"
      );

      if(confirmStatus.value.err == null) {
        logToFile('Bot Buy', WALLET.publicKey.toString(), mint.toString(), (TRADE_AMOUNT / 1_000_000_000).toString());
        buyTokenList.push(mint);
        console.log(`Buy: buy token - ${res}`);
        return {mint: mint, poolKeys: poolKeys}
      } else {
        return null;
      }      
    }
  } catch (error) {
    logToFile('Error', WALLET.publicKey.toString(), mint?.toString() ||  'Unknown', '0', "Error: buy on raydium");
    console.log("Error: buy on raydium", error);
    return null;
  }
}

async function sellWithLimitOrder( connection: Connection, mint: PublicKey, poolKeys: LiquidityPoolKeys ) {
  let tokenBalanceString: string;
  const targetProfit = Math.floor(TRADE_AMOUNT * LIMIT_ORDER);
  const targetLoss = Math.floor(TRADE_AMOUNT / 2);
  const isCorrectOrder = poolKeys.baseMint.toString() === mint.toString() ? true : false;
  const baseVault = isCorrectOrder ? poolKeys.baseVault : poolKeys.quoteVault;
  const quoteVault = isCorrectOrder ? poolKeys.quoteVault : poolKeys.baseVault;
  const mintATA = getAssociatedTokenAddressSync(mint, WALLET.publicKey);
  try {
    tokenBalanceString = (await connection.getTokenAccountBalance(mintATA)).value.amount;
    const tokenBalance = BigInt(tokenBalanceString);
    /*Track Lp Reserves*/
    while (true) {
      console.info('Track LP reserves');
      try {
        const lpReserve = (
          await connection.getMultipleParsedAccounts([
            baseVault,
            quoteVault,
          ])
        ).value;
        const baseData: any = lpReserve[0]?.data;
        const quoteData: any = lpReserve[1]?.data;
        const baseReserve = BigInt(
          baseData["parsed"]["info"]["tokenAmount"]["amount"]
        );
        const solReserve = BigInt(
          quoteData["parsed"]["info"]["tokenAmount"]["amount"]
        );
        const expectedSolAmount = expectAmountOut(
          tokenBalance,
          baseReserve,
          solReserve
        );
        if ( expectedSolAmount > BigInt(targetProfit) ) {           
          logToFile('Bot Sell', WALLET.publicKey.toString(), mint.toString(), (tokenBalance / BigInt(1000000000)).toString());
          console.log("Sell: detect profitable moment");
          const sellRes = await sellAllToken(
            connection,
            poolKeys.id,
            mint,
            tokenBalanceString
          );
          break;
        }
      } catch {
        console.log("lp catching error due to helius");
      }
      await sleep(100);
    }
  } catch {
    console.log("empty token balance");
    return null;
  }
}

function expectAmountOut(
  tokenAmount: bigint,
  tokenReserve: bigint,
  solReserve: bigint
) {
  const bigSlippage = BigInt((100 - SLIPPAGE) * 100);
  const res =
    ((tokenAmount + solReserve) * bigSlippage) /
    (BigInt(10000) * (tokenReserve + tokenAmount));
  return res;
}

async function sellAllToken(
  connection: Connection,
  pool: PublicKey,
  mint: PublicKey,
  tokenAmount: string
) {
  const tokenATA = getAssociatedTokenAddressSync(mint, WALLET.publicKey);
  const solATA = getAssociatedTokenAddressSync(SOL_ADDRESS, WALLET.publicKey);
  const tokenBalance = BigInt(tokenAmount);
  const poolKeys = await getLiquidityV4PoolKeys(connection1, pool);
  if (poolKeys && tokenBalance > BigInt(0)) {
    const swapInst = await getSwapTokenGivenInInstructions(
      WALLET.publicKey,
      poolKeys,
      mint,
      tokenBalance
    );
    let sellInsts: TransactionInstruction[] = [];
    sellInsts.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 10000000,
      }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 78000 }),
      ...swapInst,
      createCloseAccountInstruction(
        tokenATA,
        WALLET.publicKey,
        WALLET.publicKey,
        []
      )
    );
    let blockhash = await connection
      .getLatestBlockhash()
      .then((res) => res.blockhash);
    const newTokenTransactionMessage = new TransactionMessage({
      payerKey: WALLET.publicKey,
      recentBlockhash: blockhash,
      instructions: sellInsts,
    }).compileToV0Message();
    const versionedNewTokenTransaction = new VersionedTransaction(
      newTokenTransactionMessage
    );
    versionedNewTokenTransaction.sign([WALLET]);
    const res = await connection.sendRawTransaction(
      versionedNewTokenTransaction.serialize(),
      { skipPreflight: true }
    );
    console.log(`Sell: sell token - ${res}`);
  }
}

async function getLiquidityV4PoolKeys(connection: Connection, pool: PublicKey) {
  try {
    const poolAccount = await connection.getAccountInfo(pool, "confirmed");
    if (!poolAccount) return null;
    const poolInfo = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data);
    if ( poolInfo.baseMint.toString() != SOL_ADDRESS.toString() && poolInfo.quoteMint.toString() != SOL_ADDRESS.toString() ) {
      return null;
    }

    const marketAccount = await connection.getAccountInfo(
      poolInfo.marketId,
      "confirmed"
    );
    if (!marketAccount) return null;
    const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);

    const lpMintAccount = await connection.getAccountInfo(
      poolInfo.lpMint,
      "confirmed"
    );
    if (!lpMintAccount) return null;
    const lpMintInfo = SPL_MINT_LAYOUT.decode(lpMintAccount.data);

    const poolKeys: LiquidityPoolKeys = {
      id: pool,
      baseMint: poolInfo.baseMint,
      quoteMint: poolInfo.quoteMint,
      lpMint: poolInfo.lpMint,
      baseDecimals: poolInfo.baseDecimal,
      quoteDecimals: poolInfo.quoteDecimal,
      lpDecimals: lpMintInfo.decimals,
      version: 4,
      programId: poolAccount.owner,
      authority: Liquidity.getAssociatedAuthority({
        programId: poolAccount.owner,
      }).publicKey,
      openOrders: poolInfo.openOrders,
      targetOrders: poolInfo.targetOrders,
      baseVault: poolInfo.baseVault,
      quoteVault: poolInfo.quoteVault,
      withdrawQueue: poolInfo.withdrawQueue,
      lpVault: poolInfo.lpVault,
      marketVersion: 3,
      marketProgramId: poolInfo.marketProgramId,
      marketId: poolInfo.marketId,
      marketAuthority: Market.getAssociatedAuthority({
        programId: poolInfo.marketProgramId,
        marketId: poolInfo.marketId,
      }).publicKey,
      marketBaseVault: marketInfo.baseVault,
      marketQuoteVault: marketInfo.quoteVault,
      marketBids: marketInfo.bids,
      marketAsks: marketInfo.asks,
      marketEventQueue: marketInfo.eventQueue,
      lookupTableAccount: PublicKey.default,
    };
    return poolKeys;
  } catch (error) {
    console.log('Error: get poolkeys error!');
    return null;
  }  
}

async function getSwapTokenGivenInInstructions (
  owner: PublicKey,
  poolKeys: LiquidityPoolKeys,
  tokenIn: PublicKey,
  _amountIn: bigint
) {
  const tokenOut = tokenIn.equals(poolKeys.baseMint) ? poolKeys.quoteMint : poolKeys.baseMint;
  const tokenInATA = getAssociatedTokenAddressSync(tokenIn, owner);
  const tokenOutATA = getAssociatedTokenAddressSync(tokenOut, owner);
  const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
    {
      poolKeys: poolKeys,
      userKeys: {
        tokenAccountIn: tokenInATA,
        tokenAccountOut: tokenOutATA,
        owner,
      },
      amountIn: _amountIn,
      minAmountOut: BigInt(0),
    },
    poolKeys.version
  );
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      tokenOutATA,
      owner,
      tokenOut
    ),
    ...innerTransaction.instructions,
  ];
};

// Performs logging to file
function logToFile(action: string, wallet: string, token: string, amount: string, reason = '') { 
  const timestamp = new Date().toISOString(); 
  const logEntry =  `${timestamp},${action},${wallet},${token},${amount},${reason}\n`; 
  fs.appendFileSync(LOG_FILE, logEntry); 
} 

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

setInterval(trackTargetWallet, 5000);