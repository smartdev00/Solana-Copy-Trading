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
  Connection,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  ParsedInstruction,
  ParsedAccountData,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { liquidityStateV4Layout, Raydium, ApiV3PoolInfoStandardItem } from '@raydium-io/raydium-sdk-v2';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { logBuyOrSellTrigeer, logError, logLine, logSkipped, logger, roundToDecimal } from './utils';
import { BN } from '@coral-xyz/anchor';
import BigNumber from 'bignumber.js';
import { executeTransaction, getDeserialize, getQuoteForSwap, getSerializedTransaction } from './jupiter';
import { TokenListType, AnalyzeType } from './types';

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
const LIMIT_ORDER = 1.25; // for test
const SLIPPAGE = 50;
const ERROR_SOUND_SKIP_TIME = 10000;

const soundFilePaths = {
  botStart: path.join(__dirname, '../sounds/bot-start.mp3'),
  buyTrade: path.join(__dirname, '../sounds/bot-buy-trade.mp3'),
  buyTradeCopied: path.join(__dirname, '../sounds/bot-buy-trade-copied.mp3'),
  sellTrade: path.join(__dirname, '../sounds/bot-sell-trade.mp3'),
  sellTradeCopied: path.join(__dirname, '../sounds/bot-sell-trade-copied.mp3'),
  botError: path.join(__dirname, '../sounds/bot-error.mp3'),
};

sound.play(soundFilePaths.botStart);

let prevError = '';

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

let buyTokenList: TokenListType[] = [];

async function monitorNewToken() {
  console.info(chalk.bgWhite.black('       🛠  BOT INITIALIZED       '));
  console.log('🔍 Monitoring Target Wallet:', chalk.magenta(TARGET_WALLET_ADDRESS.toString()));
  console.info(
    `🔷 Min Trade Size: ${chalk.yellow(TARGET_WALLET_MIN_TRADE / LAMPORTS_PER_SOL)} SOL | Trading Amount:`,
    TRADE_AMOUNT / LAMPORTS_PER_SOL,
    'SOL'
  );
  console.log(chalk.gray('-------------------------------------------------------------------------'));
  // let pool = false;

  try {
    await connection1.onLogs(
      TARGET_WALLET_ADDRESS,
      async ({ logs, err, signature }) => {
        if (err) {
          return;
        }

        // if (pool === true) {
        //   return;
        // }

        // SmartFox Identify the dex
        const dex = identifyDex(logs);
        if (!dex) {
          return;
        }
        // pool = true;

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
  } catch (error: any) {
    handleError(error.message || 'Unexpected error while monitoring target wallet.');
  }
}

async function handleError(error: string) {
  try {
    logError(error); // Await logError if it's asynchronous
    if (prevError !== error) {
      sound.play(soundFilePaths.botError); // Await sound.play if it's asynchronous
      prevError = error;
      setTimeout(() => {
        prevError = '';
      }, ERROR_SOUND_SKIP_TIME);
    }
  } catch (err) {
    console.error('Error handling error:', err); // Log any errors that occur
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
    return null;
  }
}

/*
 * Process specific transaction
 */
async function processTransaction(transaction: ParsedTransactionWithMeta, signature: string, dex: string) {
  try {
    // SmartFox Analyze transaction, get poolAccount, solAccount and tokenAccount account
    const analyze = await analyzeTransaction(transaction, signature, dex);

    logger(analyze);
    let solDiff = 0;
    if (analyze.type === 'Buy') solDiff = analyze.from.amount;
    if (analyze.type === 'Sell') solDiff = analyze.to.amount;

    // Skip trades below the minimum threshold
    if (solDiff !== 0 && solDiff * LAMPORTS_PER_SOL < TARGET_WALLET_MIN_TRADE) {
      logSkipped(solDiff);
      logLine();
      // sound.play(soundFilePaths.buyTrade);
      return;
    }
    logLine();

    let swapResult: { success: boolean; signature: string | null } = {
      success: false,
      signature: null,
    };

    // Copy the buy action of target wallet
    if (analyze.type === 'Buy') {
      // sound.play(soundFilePaths.buyTradeCopied);
      const mintOut = new PublicKey(analyze.to.token_address);

      // Execute the purchase transaction
      if (analyze.dex === 'Raydium' && analyze.pool_address) {
        swapResult = await raydiumSwap(SOL_ADDRESS, new PublicKey(analyze.pool_address), TRADE_AMOUNT);
      } else if (analyze.dex === 'Jupiter') {
        swapResult = await jupiterSwap(SOL_ADDRESS, mintOut, TRADE_AMOUNT);
      }

      // If purchase succeeds
      if (swapResult.success && swapResult.signature) {
        const transaction = await connection1.getParsedTransaction(swapResult.signature, 'confirmed');
        if (!transaction) {
          throw new Error('Invalid transaction signature.');
        }
        const swapSize = await getTradeSize(transaction, analyze.dex, SOL_ADDRESS, mintOut);

        // Add token to buy token list
        buyTokenList.push({
          amount: swapSize.diffOther,
          dex: analyze.dex,
          fee: swapSize.diffSol - TRADE_AMOUNT / LAMPORTS_PER_SOL,
          mint: mintOut,
          sold: false,
          decimals: analyze.to.decimals,
          symbol: analyze.to.symbol,
          pool: analyze.pool_address,
        });

        logBuyOrSellTrigeer(true, TRADE_AMOUNT / 1_000_000_000, swapSize.diffOther, analyze.to.symbol); // Log the purchase success message

        // If purchase failed
      } else {
        handleError('Purchase failed');
      }

      // Copy the sell action of target wallet
    } else if (analyze.type === 'Sell') {
      // sound.play(soundFilePaths.sellTradeCopied);

      const mintIn = new PublicKey(analyze.from.token_address);

      // Find the index of token in token list
      const index = buyTokenList.findIndex((token) => token.mint.equals(mintIn));

      // Skip if you never bought this token
      if (index === -1) {
        return;
      }
      const token = buyTokenList[index];

      // Execute swap
      if (analyze.dex === 'Raydium' && analyze.pool_address) {
        swapResult = await raydiumSwap(
          mintIn,
          new PublicKey(analyze.pool_address),
          Math.floor(token.amount * 10 ** token.decimals)
        );
      } else if (analyze.dex === 'Jupiter') {
        swapResult = await jupiterSwap(mintIn, SOL_ADDRESS, Math.floor(token.amount * 10 ** token.decimals));
      }

      // If sale succeeds
      if (swapResult.success && swapResult.signature) {
        const { diffSol, profit } = await calculateProfit(swapResult.signature, token);
        logBuyOrSellTrigeer(false, diffSol, token.amount, analyze.to.symbol, profit.toString()); // Log sale success message

        buyTokenList.splice(index, 1); // Remove the token from buy list

        // If sale failed
      } else {
        handleError('Sale failed');
      }
    }
  } catch (error: any) {
    handleError(error.message || 'Unexpected error while processing the transaction.');
  }
}

async function calculateProfit(signature: string, token: TokenListType) {
  try {
    const transaction = await connection1.getParsedTransaction(signature, 'confirmed');
    if (!transaction) {
      throw new Error(`No transaction with this signature: ${signature}`);
    }

    const swapSize = await getTradeSize(transaction, token.dex, SOL_ADDRESS, token.mint);

    const usedSol = TRADE_AMOUNT / LAMPORTS_PER_SOL + token.fee;
    const profit = ((swapSize.diffSol - usedSol) * 100) / usedSol;

    return { diffSol: swapSize.diffSol, profit };
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while calculating profit.');
  }
}

/**
 * Obtains trade size for transaction with specified transaction
 */
async function getTradeSize(
  transaction: ParsedTransactionWithMeta,
  dex: string,
  solAccount?: PublicKey,
  otherAccount?: PublicKey
) {
  try {
    if (dex === 'Raydium') {
      const postTokenBalances = transaction.meta?.postTokenBalances?.filter(
        (p) => p.owner === RAYDIUM_AUTHORITY_V4.toString()
      );
      const preTokenBalances = transaction.meta?.preTokenBalances?.filter(
        (p) => p.owner === RAYDIUM_AUTHORITY_V4.toString()
      );

      const decimals = postTokenBalances?.find((p) => p.mint === otherAccount?.toString())?.uiTokenAmount.decimals || 0;

      const diffSol = new BigNumber(
        postTokenBalances?.find((p) => p.mint === solAccount?.toString())?.uiTokenAmount.uiAmount || 0
      )
        .minus(
          new BigNumber(preTokenBalances?.find((p) => p.mint === solAccount?.toString())?.uiTokenAmount.uiAmount || 0)
        )
        .toNumber();

      const diffOther = new BigNumber(
        postTokenBalances?.find((p) => p.mint === otherAccount?.toString())?.uiTokenAmount.uiAmount || 0
      )
        .minus(
          new BigNumber(preTokenBalances?.find((p) => p.mint === otherAccount?.toString())?.uiTokenAmount.uiAmount || 0)
        )
        .toNumber();

      return {
        diffSol: Math.abs(roundToDecimal(diffSol)),
        diffOther: Math.abs(roundToDecimal(diffOther, decimals)),
        isBuy: diffSol > 0 ? true : false,
      };
    } else {
      const transfers = getJupiterTransfers(transaction);

      const [tokenIn, tokenOut] = await Promise.all([
        getTokenMintAddress(transfers[0].source, transfers[0].destination),
        getTokenMintAddress(transfers[1].source, transfers[1].destination),
      ]);

      const diffSol =
        tokenIn?.mint === SOL_ADDRESS.toString()
          ? (transfers[0].amount as number) / LAMPORTS_PER_SOL
          : (transfers[1].amount as number) / LAMPORTS_PER_SOL;

      const diffOther =
        tokenIn?.mint === SOL_ADDRESS.toString()
          ? (transfers[1].amount as number) / 10 ** (tokenOut?.decimals || 0)
          : (transfers[0].amount as number) / 10 ** (tokenIn?.decimals || 0);

      return {
        diffSol: Math.abs(roundToDecimal(diffSol)),
        diffOther: Math.abs(roundToDecimal(diffOther)),
        isBuy: diffSol > 0 ? true : false,
      };
    }
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while calculating trade size.');
  }
}

// Get the first and last transfers
function getJupiterTransfers(transaction: ParsedTransactionWithMeta) {
  try {
    const instructions = transaction.transaction.message.instructions as PartiallyDecodedInstruction[];
    const swapIxIdx = instructions.findIndex((ix) => {
      return ix.programId.equals(JUPITER_AGGREGATOR_V6);
    });

    if (swapIxIdx === -1) {
      throw new Error('Non Jupiter Swap');
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

    if (transfers.length < 2) {
      throw new Error('Invalid Jupiter Swap');
    }

    return [transfers[0], transfers[transfers.length - 1]];
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while extracting transfers from jupiter dex.');
  }
}

/**
 * Analyzes transaction
 */
async function analyzeTransaction(transaction: ParsedTransactionWithMeta, signature: string, dex: string) {
  let solAccount: PublicKey | undefined;
  let tokenAccount: PublicKey | undefined;
  let poolAccount: PublicKey | undefined;
  try {
    const instructions = transaction.transaction.message.instructions as PartiallyDecodedInstruction[];

    if (dex === 'Jupiter') {
      const transfers = getJupiterTransfers(transaction);

      const [tokenIn, tokenOut] = await Promise.all([
        getTokenMintAddress(transfers[0].source, transfers[0].destination),
        getTokenMintAddress(transfers[1].source, transfers[1].destination),
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
        pool_address: null,
        from: {
          token_address: tokenIn?.mint as string,
          amount: (transfers[0].amount as number) / 10 ** (tokenIn?.decimals || 0),
          symbol: tokenIn?.symbol,
          decimals: tokenIn?.decimals,
        },
        to: {
          token_address: tokenOut?.mint as string,
          amount: (transfers[1].amount as number) / 10 ** (tokenOut?.decimals || 0),
          symbol: tokenOut?.symbol,
          decimals: tokenOut?.decimals,
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
        throw new Error('No Raydium or Jupiter swap transaction.');
      }

      // OB Get information of pool account
      const poolInfo = await connection1.getAccountInfo(poolAccount, { commitment: 'confirmed' });
      if (!poolInfo) {
        throw new Error('Invalid Raydium pool account.');
      }

      // OB Decode the data of information of pool account
      const poolData = liquidityStateV4Layout.decode(poolInfo?.data);
      solAccount = poolData.baseMint.equals(SOL_ADDRESS) ? poolData.baseMint : poolData.quoteMint;
      tokenAccount = poolData.baseMint.equals(SOL_ADDRESS) ? poolData.quoteMint : poolData.baseMint;

      const trade = await getTradeSize(transaction, 'Raydium', solAccount, tokenAccount);
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
          decimals: trade.isBuy ? LAMPORTS_PER_SOL : tokenInfor?.decimals,
        },
        to: {
          token_address: tokenAccount.toString(),
          amount: trade.diffOther,
          symbol: !trade.isBuy ? 'SOL' : tokenInfor?.symbol,
          decimals: !trade.isBuy ? LAMPORTS_PER_SOL : tokenInfor?.decimals,
        },
      } as AnalyzeType;
    }
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while analyzing transaction.');
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
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while fetching token mint address.');
  }
}

// SmartFox Swap on raydium dex
async function raydiumSwap(mintInPub: PublicKey, pool: PublicKey, inAmount: number) {
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
      amountIn: new BN(inAmount),
      mintIn: mintIn.address,
      mintOut: mintOut.address,
      slippage: 0.01,
    });

    const { execute } = await raydium.liquidity.swap({
      poolInfo,
      poolKeys,
      amountIn: new BN(inAmount),
      amountOut: out.minAmountOut,
      fixedSide: 'in',
      inputMint: mintIn.address,
      computeBudgetConfig: {
        microLamports: 1000000,
        units: 500000,
      },
    });

    const { txId } = await execute({ sendAndConfirm: true });

    if (txId) {
      return { success: true, signature: txId };
    } else {
      return { success: false, signature: null };
    }
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while swapping on Raydium');
  }
}

// SmartFox Swap on jupiter dex
async function jupiterSwap(mintIn: PublicKey, mintOut: PublicKey, inAmount: number) {
  try {
    const quote = await getQuoteForSwap(mintIn.toString(), mintOut.toString(), inAmount, SLIPPAGE);

    const swapTransaction = await getSerializedTransaction(quote, WALLET.publicKey.toString(), 500000);

    const deserializedTx = await getDeserialize(swapTransaction);

    deserializedTx.sign([WALLET]);

    const { signature, success } = await executeTransaction(connection1, deserializedTx);

    if (success) {
      return { success, signature };
    } else {
      return { success, signature: null };
    }
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while swapping on Jupiter.');
  }
}

async function monitorToSell() {
  try {
    while (true) {
      const indexesToDel: number[] = [];
      await Promise.all(
        buyTokenList.map(async (token, index) => {
          let success: boolean = false;
          let signature: string | null = null;

          // If token is bought on Jupiter dex
          if (token.dex === 'Jupiter') {
            const quote = await getQuoteForSwap(SOL_ADDRESS.toString(), token.mint.toString(), TRADE_AMOUNT, SLIPPAGE);
            if (quote.error) {
              return;
            }
            const targetAmount = token.amount * LIMIT_ORDER * 10 ** token.decimals; // target profit

            // If sell is non profitable
            if (Number(quote.outAmount) < targetAmount) {
              return;
            }

            // sound.play(soundFilePaths.sellTrade);
            // Sell token if its profitable
            ({ success, signature } = await jupiterSwap(
              token.mint,
              SOL_ADDRESS,
              Math.floor(token.amount * 10 ** token.decimals)
            ));

            // If token is bought on Raydium dex
          } else {
            const mint = token.mint;
            const pool = token.pool;

            // Return if no pool or non profitable
            if (!pool || (pool && !(await isProfitable(mint, new PublicKey(pool))))) {
              return;
            }
            // sound.play(soundFilePaths.sellTrade);

            ({ success, signature } = await raydiumSwap(
              mint,
              new PublicKey(pool),
              token.amount * 10 ** token.decimals
            ));
          }

          if (success && signature) {
            const { diffSol, profit } = await calculateProfit(signature, token);
            logBuyOrSellTrigeer(false, diffSol, token.amount, token.symbol, profit.toString()); // Log sale success message

            indexesToDel.unshift(index); // Add index of item to remove

            // If sale failed
          } else {
            handleError('Sale failed');
          }
        })
      );

      for (const index of indexesToDel) {
        buyTokenList.splice(index, 1);
      }
      await sleep(5000);
    }
  } catch (error: any) {
    handleError(error.message || 'Unexpected error while monitoring the point to sell token.');
  }
}

async function isProfitable(mint: PublicKey, pool: PublicKey) {
  try {
    const targetProfit = Math.floor(TRADE_AMOUNT * LIMIT_ORDER);
    const tokenBalance = await getATABalance(mint, WALLET.publicKey);
    const [solReserve, baseReserve] = await getReserves(mint, pool);

    const expectedSolAmount = expectAmountOut(tokenBalance, baseReserve, solReserve);

    if (expectedSolAmount > BigInt(targetProfit)) {
      return true;
    }
    return false;
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while calculating the profitability.');
  }
}

async function getReserves(mint: PublicKey, pool: PublicKey) {
  try {
    const raydium = await Raydium.load({
      connection: connection1,
      owner: WALLET,
    });

    const poolKeys = await raydium.liquidity.getRpcPoolInfo(pool.toString());
    const isCorrectOrder = poolKeys.baseMint.toString() === mint.toString() ? true : false;
    const baseVault = isCorrectOrder ? poolKeys.baseVault : poolKeys.quoteVault;
    const quoteVault = isCorrectOrder ? poolKeys.quoteVault : poolKeys.baseVault;

    const lpReserve = (await connection1.getMultipleParsedAccounts([baseVault, quoteVault])).value;
    const baseData: any = lpReserve[0]?.data;
    const quoteData: any = lpReserve[1]?.data;
    const baseReserve = BigInt(baseData['parsed']['info']['tokenAmount']['amount']);
    const solReserve = BigInt(quoteData['parsed']['info']['tokenAmount']['amount']);
    return [solReserve, baseReserve];
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while fetching reserves of pool.');
  }
}

async function getATABalance(mint: PublicKey, owner: PublicKey) {
  try {
    const mintATA = getAssociatedTokenAddressSync(mint, owner);
    const tokenBalanceString = (await connection1.getTokenAccountBalance(mintATA)).value.amount;
    return BigInt(tokenBalanceString);
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while fetching ATA balance.');
  }
}

function expectAmountOut(tokenAmount: bigint, tokenReserve: bigint, solReserve: bigint) {
  const outAmount = (tokenAmount * solReserve) / (tokenReserve + tokenAmount);
  return outAmount;
}

// Performs logging to file
function logToFile(action: string, wallet: string, token: string, amount: string, reason = '') {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp},${action},${wallet},${token},${amount},${reason}\n`;
  fs.appendFileSync(LOG_FILE, logEntry);
}

// OB get token info
async function getTokenInfo(connection: Connection, mint: PublicKey) {
  const metaplex = Metaplex.make(connection);

  try {
    const tokenMetadata = await metaplex.nfts().findByMint({ mintAddress: mint });
    return {
      name: tokenMetadata.name,
      symbol: tokenMetadata.symbol,
      address: tokenMetadata.address.toString(),
      decimals: tokenMetadata.mint.decimals,
    };
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while fetching information of token.');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Monitor target wallet's trade
monitorNewToken();

// Monitor whether it's profitable to sell the token.
// If so perform tradingm otherwise skip.
monitorToSell();
