import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import sound from 'sound-play';
import bs58 from 'bs58';
import chalk from 'chalk';
import { Metaplex } from '@metaplex-foundation/js';
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  Connection,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  ParsedInstruction,
  ParsedAccountData,
  LAMPORTS_PER_SOL,
  Transaction,
} from '@solana/web3.js';
import {
  liquidityStateV4Layout,
  MARKET_STATE_LAYOUT_V3,
  SPL_MINT_LAYOUT,
  LiquidityPoolKeys,
  Market,
  Raydium,
  ApiV3PoolInfoStandardItem,
  printSimulate,
} from '@raydium-io/raydium-sdk-v2';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { AnalyzeType, logBuyOrSellTrigeer, logError, logLine, logSkipped, logger, roundToDecimal } from './utils';
import { BN } from '@coral-xyz/anchor';
import { executeTransaction, getDeserialize, getQuoteForSwap, getSerializedTransaction } from './jupiter';

dotenv.config({ path: './.env' });

// Initialize parameters from environment variables
const connection1 = new Connection(process.env.CONNECTION_URL_1 || '', {
  wsEndpoint: process.env.CONNECTION_WSS_URL_1,
  commitment: 'confirmed',
});
const connection2 = new Connection(process.env.CONNECTION_URL_2 || '', {
  wsEndpoint: process.env.CONNECTION_WSS_URL_2,
  commitment: 'confirmed',
});
const TARGET_WALLET_ADDRESS = new PublicKey(process.env.TARGET_WALLET_ADDRESS || '');
const TARGET_WALLET_MIN_TRADE = parseInt(process.env.TARGET_WALLET_MIN_TRADE || '0');
const RAYDIUM_LIQUIDITYPOOL_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const RAYDIUM_AUTHORITY_V4 = new PublicKey('5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1');
const JUPITER_AGGREGATOR_V6 = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const SOL_ADDRESS = new PublicKey('So11111111111111111111111111111111111111112');
const WALLET = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY || ''));
const TRADE_AMOUNT = parseInt(process.env.TRADE_AMOUNT || '0');
const COMPUTE_PRICE = 100000;
const LIMIT_ORDER = 1.25;
const SLIPPAGE = 50;

const soundFilePaths = {
  botStart: path.join(__dirname, '../sounds/bot-start.mp3'),
  buyTrade: path.join(__dirname, '../sounds/bot-buy-trade.mp3'),
  buyTradeCopied: path.join(__dirname, '../sounds/bot-buy-trade-copied.mp3'),
  sellTrade: path.join(__dirname, '../sounds/bot-sell-trade.mp3'),
  sellTradeCopied: path.join(__dirname, '../sounds/bot-sell-trade-copied.mp3'),
};

// sound.play(soundFilePaths.botStart);

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
  fs.writeFileSync(LOG_FILE, 'Timestamp, Action, Wallet, Token, Amount (SOL), Reason\n');
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

async function monitorNewToken() {
  console.info(chalk.bgWhite.black('       🛠  BOT INITIALIZED       '));
  console.log('🔍 Monitoring Target Wallet:', chalk.magenta(TARGET_WALLET_ADDRESS.toString()));
  console.info(
    `🔷 Min Trade Size: ${chalk.yellow(TARGET_WALLET_MIN_TRADE / LAMPORTS_PER_SOL)} SOL | Trading Amount:`,
    TRADE_AMOUNT / LAMPORTS_PER_SOL,
    'SOL'
  );
  console.log(chalk.gray('-------------------------------------------------------------------------'));
  let pool = false;

  try {
    await connection1.onLogs(
      TARGET_WALLET_ADDRESS,
      async ({ logs, err, signature }) => {
        if (err) {
          return;
        }

        if (pool === true) {
          return;
        }
        console.log(signature);

        // SmartFox Identify the dex
        const dex = identifyDex(logs);
        if (!dex) {
          return;
        }
        pool = true;

        // SmartFox Skip the already processed transaction
        if (processedTransactionSignatures.includes(signature)) {
          return;
        }

        // OB Get the transaction from signature
        const transaction = await connection1.getParsedTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        // If no transaction
        if (!transaction) {
          return;
        }

        await processTransaction(transaction, signature, dex);

        processedTransactionSignatures.push(signature);
        // OB Remove the first item if the array exceed the limitation of length
        if (processedTransactionSignatures.length > processedTransactionSignaturesLimitCount) {
          processedTransactionSignatures.shift();
        }
      },
      'confirmed'
    );
  } catch (error) {
    console.error('Error while monitorNewToken:', error);
  }
}

function identifyDex(logs: string[]) {
  try {
    if (!logs.length) return null;
    if (logs.some((log) => log.includes(JUPITER_AGGREGATOR_V6.toString()))) {
      return 'Jupiter';
    }
    if (logs.some((log) => log.includes(RAYDIUM_LIQUIDITYPOOL_V4.toString()))) {
      return 'Raydium';
    }
    return null;
  } catch (error) {
    console.error('Error while identifying dex:', error);
    return null;
  }
}

/*
 * Process specific transaction
 */

async function processTransaction(transaction: ParsedTransactionWithMeta, signature: string, dex: string) {
  // SmartFox Analyze transaction, get poolAccount, solAccount and tokenAccount account
  const analyze = await analyzeTransaction(transaction, signature, dex);

  if (!analyze) {
    console.info(`${signature} is not a swap transaction.`);
    return;
  }

  logger(analyze);
  let solDiff = 0;
  if (analyze.type === 'Buy') solDiff = analyze.from.amount;
  if (analyze.type === 'Sell') solDiff = analyze.to.amount;

  // Skip trades below the minimum threshold
  if (solDiff !== 0 && solDiff * LAMPORTS_PER_SOL < TARGET_WALLET_MIN_TRADE) {
    logSkipped(solDiff);
    sound.play(soundFilePaths.buyTrade);
    return;
  }
  logLine();

  // sound.play(soundFilePaths.buyTradeCopied);
  const mintOut = new PublicKey(analyze.to.token_address);

  let buy: { success: boolean; outAmount: number | any; signature: string | null } = {
    success: false,
    outAmount: 0,
    signature: null,
  };

  if (analyze.type === 'Buy' && analyze.dex === 'Raydium') {
    buy = await raydiumSwap(SOL_ADDRESS, new PublicKey(analyze.pool_address));
  } else if (analyze.type === 'Buy' && analyze.dex === 'Jupiter') {
    buy = await jupiterSwap(SOL_ADDRESS, mintOut);
  }

  if (buy.success && buy.outAmount) {
    logBuyOrSellTrigeer(true, TRADE_AMOUNT / 1_000_000_000, buy.outAmount, analyze.to.symbol);
    buyTokenList.push(mintOut);
  }

  // if (buy && buy.mint && buy.poolKeys) {
  //   sound.play(soundFilePaths.sellTrade);
  //   sellWithLimitOrder(connection2, buy.mint, buy.poolKeys);
  // }
}

/**
 * Obtains trade size for transaction with specified transaction
 */
async function getTradeSize(transaction: ParsedTransactionWithMeta, solAccount: PublicKey, otherAccount: PublicKey) {
  const postTokenBalances = transaction.meta?.postTokenBalances;
  const preTokenBalances = transaction.meta?.preTokenBalances;

  const decimals =
    postTokenBalances?.find(
      (post) => post.mint === otherAccount.toString() && post.owner === RAYDIUM_AUTHORITY_V4.toString()
    )?.uiTokenAmount.decimals || 0;

  const diffSol =
    (postTokenBalances?.find(
      (post) => post.mint === solAccount.toString() && post.owner === RAYDIUM_AUTHORITY_V4.toString()
    )?.uiTokenAmount.uiAmount || 0) -
    (preTokenBalances?.find(
      (pre) => pre.mint === solAccount.toString() && pre.owner === RAYDIUM_AUTHORITY_V4.toString()
    )?.uiTokenAmount.uiAmount || 0);

  const diffOther =
    (postTokenBalances?.find(
      (post) => post.mint === otherAccount.toString() && post.owner === RAYDIUM_AUTHORITY_V4.toString()
    )?.uiTokenAmount.uiAmount || 0) -
    (preTokenBalances?.find(
      (pre) => pre.mint === otherAccount.toString() && pre.owner === RAYDIUM_AUTHORITY_V4.toString()
    )?.uiTokenAmount.uiAmount || 0);

  return {
    diffSol: Math.abs(roundToDecimal(diffSol)),
    diffOther: Math.abs(roundToDecimal(diffOther, decimals)),
    isBuy: diffSol > 0 ? true : false,
  };
}

/**
 * Analyzes transaction
 * @param signature
 * @returns
 */
async function analyzeTransaction(transaction: ParsedTransactionWithMeta, signature: string, dex: string) {
  let solAccount: PublicKey | undefined;
  let tokenAccount: PublicKey | undefined;
  let poolAccount: PublicKey | undefined;
  try {
    const instructions = transaction.transaction.message.instructions as PartiallyDecodedInstruction[];

    if (dex === 'Jupiter') {
      const swapIxIdx = instructions.findIndex((ix) => {
        return ix.programId.equals(JUPITER_AGGREGATOR_V6);
      });

      if (swapIxIdx === -1) {
        return null;
      }
      const transfers: any[] = [];
      transaction.meta?.innerInstructions?.forEach((instruction) => {
        if (instruction.index <= swapIxIdx) {
          (instruction.instructions as ParsedInstruction[]).forEach((ix) => {
            if (ix.parsed?.type === 'transfer' && ix.parsed.info.amount) {
              transfers.push({
                amount: ix.parsed.info.amount,
                source: ix.parsed.info.source,
                destination: ix.parsed.info.destination,
              });
            } else if (ix.parsed?.type === 'transferChecked' && ix.parsed.info.tokenAmount.amount) {
              transfers.push({
                amount: ix.parsed.info.tokenAmount.amount,
                source: ix.parsed.info.source,
                destination: ix.parsed.info.destination,
              });
            }
          });
        }
      });

      if (transfers.length === 0) {
        return null;
      }

      const [tokenIn, tokenOut] = await Promise.all([
        getTokenMintAddress(transfers[0].source, transfers[0].destination),
        getTokenMintAddress(transfers[transfers.length - 1].source, transfers[transfers.length - 1].destination),
      ]);

      return {
        signature,
        target_wallet: TARGET_WALLET_ADDRESS.toString(),
        type:
          tokenIn?.mint === SOL_ADDRESS.toString()
            ? 'Buy'
            : tokenOut?.mint === SOL_ADDRESS.toString()
            ? 'Sell'
            : 'Swap',
        dex,
        pool_address: '',
        from: {
          token_address: tokenIn?.mint as string,
          amount: (transfers[0].amount as number) / 10 ** (tokenIn?.decimals || 0),
          symbol: tokenIn?.symbol,
        },
        to: {
          token_address: tokenOut?.mint as string,
          amount: (transfers[transfers.length - 1].amount as number) / 10 ** (tokenOut?.decimals || 0),
          symbol: tokenOut?.symbol,
        },
      } as AnalyzeType;
    } else {
      // SmartFox Get all instructions from transaction
      const instrsWithAccs = instructions.filter((ix) => ix.accounts && ix.accounts.length > 0);

      // SmartFox Loop until will find the account that its owner is RAYDIUM_LIQUIDITYPOOL_V4
      outerLoop: for (const ix of instrsWithAccs) {
        const accounts = ix.accounts;
        for (const acc of accounts) {
          const poolInfo = await connection1.getAccountInfo(acc, { commitment: 'confirmed' });

          if (poolInfo?.owner.equals(RAYDIUM_LIQUIDITYPOOL_V4)) {
            poolAccount = acc;
            break outerLoop; // Exit the loop once the account is found
          }
        }
      }

      if (!poolAccount) {
        return null;
      }

      // OB Get information of pool account
      const poolInfo = await connection1.getAccountInfo(poolAccount, { commitment: 'confirmed' });
      if (!poolInfo) {
        return null;
      }

      // OB Decode the data of information of pool account
      const poolData = liquidityStateV4Layout.decode(poolInfo?.data);
      solAccount = poolData.baseMint.equals(SOL_ADDRESS) ? poolData.baseMint : poolData.quoteMint;
      tokenAccount = poolData.baseMint.equals(SOL_ADDRESS) ? poolData.quoteMint : poolData.baseMint;

      const trade = await getTradeSize(transaction, solAccount, tokenAccount);
      const tokenInfor = await getTokenInfo(connection1, tokenAccount);

      return {
        signature,
        target_wallet: TARGET_WALLET_ADDRESS.toString(),
        type: trade.isBuy ? 'Buy' : 'Sell',
        dex,
        pool_address: poolAccount.toString(),
        from: {
          token_address: solAccount.toString(),
          amount: trade.diffSol,
          symbol: trade.isBuy ? 'SOL' : tokenInfor?.symbol,
        },
        to: {
          token_address: tokenAccount.toString(),
          amount: trade.diffOther,
          symbol: !trade.isBuy ? 'SOL' : tokenInfor?.symbol,
        },
      } as AnalyzeType;
    }
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function getTokenMintAddress(source: string, destination: string) {
  try {
    let accountInfo = await connection1.getParsedAccountInfo(new PublicKey(source));
    if (!accountInfo.value) accountInfo = await connection1.getParsedAccountInfo(new PublicKey(destination));
    const tokenInfo = (accountInfo.value?.data as ParsedAccountData).parsed?.info;
    const tokenInfor = await getTokenInfo(connection1, new PublicKey(tokenInfo?.mint));
    const symbol =
      tokenInfor?.address !== SOL_ADDRESS.toString() && tokenInfor?.symbol === 'SOL' ? 'SPL Token' : tokenInfor?.symbol;
    return {
      mint: tokenInfo?.mint || null,
      decimals: Number(tokenInfo?.tokenAmount?.decimals),
      symbol,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}

// SmartFox Swap on raydium dex
async function raydiumSwap(mintInPub: PublicKey, pool: PublicKey) {
  try {
    const raydium = await Raydium.load({
      connection: connection1,
      owner: WALLET,
    });

    const poolKeys = await raydium.liquidity.getAmmPoolKeys(pool.toString());
    const poolInfo = (await raydium.api.fetchPoolById({ ids: pool.toString() }))[0] as ApiV3PoolInfoStandardItem;
    const rpcData = await raydium.liquidity.getRpcPoolInfo(pool.toString());

    const [baseReserve, quoteReserve, status] = [rpcData.baseReserve, rpcData.quoteReserve, rpcData.status.toNumber()];
    const baseIn = mintInPub.toString() === poolInfo.mintA.address;
    const [mintIn, mintOut] = baseIn ? [poolInfo.mintA, poolInfo.mintB] : [poolInfo.mintB, poolInfo.mintA];

    const out = raydium.liquidity.computeAmountOut({
      poolInfo: {
        ...poolInfo,
        baseReserve,
        quoteReserve,
        status,
        version: 4,
      },
      amountIn: new BN(TRADE_AMOUNT),
      mintIn: mintIn.address,
      mintOut: mintOut.address,
      slippage: 0.01,
    });

    const { execute, transaction } = await raydium.liquidity.swap({
      poolInfo,
      poolKeys,
      amountIn: new BN(TRADE_AMOUNT),
      amountOut: out.minAmountOut,
      fixedSide: 'in',
      inputMint: mintIn.address,
      computeBudgetConfig: {
        microLamports: 100000,
        units: 500000,
      },
    });

    // printSimulate([transaction as Transaction]);
    const { txId } = await execute({ sendAndConfirm: true });
    console.log('txId:', txId);

    if (txId) {
      return { success: true, outAmount: Number(out.amountOut) / 10 ** mintOut.decimals, signature: txId };
    } else {
      return { success: false, outAmount: 0, signature: null };
    }
  } catch (error) {
    console.error('Error: buy on raydium', error);
    logError();
    return { success: false, outAmount: 0, signature: null };
  }
}

// SmartFox Swap on jupiter dex
async function jupiterSwap(mintIn: PublicKey, mintOut: PublicKey) {
  try {
    const inAmount = TRADE_AMOUNT;
    const quote = await getQuoteForSwap(mintIn.toString(), mintOut.toString(), inAmount, SLIPPAGE);
    const swapTransaction = await getSerializedTransaction(quote, WALLET.publicKey.toString(), 500000);
    const deserializedTx = await getDeserialize(swapTransaction);
    deserializedTx.sign([WALLET]);
    const { signature, success } = await executeTransaction(connection1, deserializedTx);
    if (success) {
      return { success: true, outAmount: quote?.outAmount, signature };
    } else {
      return { success: false, outAmount: 0, signature: null };
    }
  } catch (error) {
    console.error(error);
    logError();
    return { success: false, outAmount: 0, signature: null };
  }
}

// async function sellWithLimitOrder(connection: Connection, mint: PublicKey, poolKeys: LiquidityPoolKeys) {
//   let tokenBalanceString: string;
//   const targetProfit = Math.floor(TRADE_AMOUNT * LIMIT_ORDER);
//   const targetLoss = Math.floor(TRADE_AMOUNT / 2);
//   const isCorrectOrder = poolKeys.baseMint.toString() === mint.toString() ? true : false;
//   const baseVault = isCorrectOrder ? poolKeys.baseVault : poolKeys.quoteVault;
//   const quoteVault = isCorrectOrder ? poolKeys.quoteVault : poolKeys.baseVault;
//   const mintATA = getAssociatedTokenAddressSync(mint, WALLET.publicKey);
//   try {
//     tokenBalanceString = (await connection.getTokenAccountBalance(mintATA)).value.amount;
//     const tokenBalance = BigInt(tokenBalanceString);
//     /*Track Lp Reserves*/
//     while (true) {
//       console.info('Track LP reserves');
//       try {
//         const lpReserve = (await connection.getMultipleParsedAccounts([baseVault, quoteVault])).value;
//         const baseData: any = lpReserve[0]?.data;
//         const quoteData: any = lpReserve[1]?.data;
//         const baseReserve = BigInt(baseData['parsed']['info']['tokenAmount']['amount']);
//         const solReserve = BigInt(quoteData['parsed']['info']['tokenAmount']['amount']);
//         const expectedSolAmount = expectAmountOut(tokenBalance, baseReserve, solReserve);
//         if (expectedSolAmount > BigInt(targetProfit)) {
//           logToFile(
//             'Bot Sell',
//             WALLET.publicKey.toString(),
//             mint.toString(),
//             (tokenBalance / BigInt(1000000000)).toString()
//           );
//           console.log('Sell: detect profitable moment');
//           const sellRes = await sellAllToken(connection, poolKeys.id, mint, tokenBalanceString);
//           break;
//         }
//       } catch {
//         console.log('lp catching error due to helius');
//       }
//       await sleep(100);
//     }
//   } catch {
//     logError();
//     return null;
//   }
// }

// function expectAmountOut(tokenAmount: bigint, tokenReserve: bigint, solReserve: bigint) {
//   const bigSlippage = BigInt((100 - SLIPPAGE) * 100);
//   const res = ((tokenAmount + solReserve) * bigSlippage) / (BigInt(10000) * (tokenReserve + tokenAmount));
//   return res;
// }

// Performs logging to file
function logToFile(action: string, wallet: string, token: string, amount: string, reason = '') {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp},${action},${wallet},${token},${amount},${reason}\n`;
  fs.appendFileSync(LOG_FILE, logEntry);
}

// OB get token info
export async function getTokenInfo(connection: Connection, mint: PublicKey) {
  const metaplex = Metaplex.make(connection);

  try {
    const tokenMetadata = await metaplex.nfts().findByMint({ mintAddress: mint });
    return {
      name: tokenMetadata.name,
      symbol: tokenMetadata.symbol,
      address: tokenMetadata.address.toString(),
      decimals: tokenMetadata.mint.decimals,
    };
  } catch (error) {
    console.error('Error fetching token metadata:', error);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

monitorNewToken();
