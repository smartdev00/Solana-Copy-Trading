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
import { logBuyOrSellTrigeer, logCircular, logError, logLine, logSkipped, logger, roundToDecimal } from './utils';
import { BN } from '@coral-xyz/anchor';
import BigNumber from 'bignumber.js';
import { executeTransaction, getDeserialize, getQuoteForSwap, getSerializedTransaction } from './jupiter';
import { TokenListType, AnalyzeType, TokenInforType } from './types';

if (process.argv.length !== 3) {
  console.error('Error launching app:');
  console.error('Application requires exactly one command-line parameter which must be a path to configuration file.');
  console.error('For example `npm run start config.env`');
  process.exit();
}

const pathToConfigurationFile = path.join(__dirname, process.argv[2]);
if (!fs.existsSync(pathToConfigurationFile)) {
  console.error('Error launching app:');
  console.error(`Configuration file ${pathToConfigurationFile} not found.`);
  process.exit();
}
dotenv.config({ path: pathToConfigurationFile });

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
const SLIPPAGE = 500;
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

    logToFile(
      analyze.type,
      TARGET_WALLET_ADDRESS.toString(),
      analyze.dex,
      analyze.type === 'Buy'
        ? analyze.to.token_address
        : analyze.type === 'Sell'
        ? analyze.from.token_address
        : analyze.from.token_address + analyze.to.token_address,
      analyze.type === 'Buy'
        ? analyze.from.amount.toString()
        : analyze.type === 'Sell'
        ? analyze.to.amount.toString()
        : '',
      'Monitored new transaction'
    );
    logger(analyze);
    let solDiff = 0;
    if (analyze.type === 'Buy') solDiff = analyze.from.amount;
    if (analyze.type === 'Sell') solDiff = analyze.to.amount;

    // Skip trades below the minimum threshold
    if (solDiff !== 0 && solDiff * LAMPORTS_PER_SOL < TARGET_WALLET_MIN_TRADE) {
      logSkipped(solDiff);
      logToFile(
        'Skipped',
        TARGET_WALLET_ADDRESS.toString(),
        analyze.dex,
        analyze.type === 'Buy'
          ? analyze.to.token_address
          : analyze.type === 'Sell'
          ? analyze.from.token_address
          : analyze.from.token_address + analyze.to.token_address,
        analyze.type === 'Buy'
          ? analyze.from.amount.toString()
          : analyze.type === 'Sell'
          ? analyze.to.amount.toString()
          : '',
        'Below minimum trade size'
      );
      logLine();
      // sound.play(soundFilePaths.buyTrade);
      return;
    }

    if (analyze.from.token_address === analyze.to.token_address) {
      logCircular();
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
        const transaction = await connection1.getParsedTransaction(swapResult.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        if (!transaction) {
          throw new Error('Invalid transaction signature.');
        }
        const swapSize = await getRaydiumTradeSize(transaction, SOL_ADDRESS, mintOut, WALLET.publicKey);

        // Add token to buy token list
        buyTokenList.push({
          amount: swapSize.from.amount,
          dex: analyze.dex,
          fee: swapSize.from.amount - TRADE_AMOUNT / LAMPORTS_PER_SOL,
          mint: mintOut,
          sold: false,
          decimals: analyze.to.decimals,
          symbol: analyze.to.symbol,
          pool: analyze.pool_address,
        });

        logToFile(
          'Buy Success',
          TARGET_WALLET_ADDRESS.toString(),
          analyze.dex,
          mintOut.toString(),
          swapSize.from.amount.toString(),
          'Succeed copying buy.'
        );

        logBuyOrSellTrigeer(true, TRADE_AMOUNT / 1_000_000_000, swapSize.from.amount, analyze.to.symbol); // Log the purchase success message

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
        logToFile(
          'Sell Success',
          TARGET_WALLET_ADDRESS.toString(),
          analyze.dex,
          mintIn.toString(),
          diffSol.toString(),
          'Succeed copying sell.'
        );

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
    const transaction = await connection1.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!transaction) {
      throw new Error(`No transaction with this signature: ${signature}`);
    }

    const swapSize = await getRaydiumTradeSize(transaction, SOL_ADDRESS, token.mint, WALLET.publicKey);

    const usedSol = TRADE_AMOUNT / LAMPORTS_PER_SOL + token.fee;
    const profit = ((swapSize.to.amount - usedSol) * 100) / usedSol;

    return { diffSol: swapSize.to.amount, profit };
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while calculating profit.');
  }
}

// Get the first and last transfers
function getJupiterTransfers(transaction: ParsedTransactionWithMeta) {
  try {
    const instructions = transaction.transaction.message.instructions as PartiallyDecodedInstruction[];

    const startIxIdx = instructions.findIndex((ix) => {
      return ix.programId.equals(JUPITER_AGGREGATOR_V6);
    });

    const lastIxIdx =
      instructions.length -
      instructions.reverse().findIndex((ix) => {
        return ix.programId.equals(JUPITER_AGGREGATOR_V6);
      }) -
      1;

    if (lastIxIdx === -1) {
      throw new Error('Non Jupiter Swap');
    }

    console.log('lastIxIdx', lastIxIdx, startIxIdx);

    const transfers: { amount: any; source: any; destination: any; authority: any }[] = [];
    transaction.meta?.innerInstructions?.forEach((instruction) => {
      if (instruction.index <= lastIxIdx && instruction.index >= startIxIdx ) {
        (instruction.instructions as ParsedInstruction[]).forEach((ix) => {
          if (ix.parsed?.type === 'transfer' && ix.parsed.info.amount) {
            transfers.push({
              amount: ix.parsed.info.amount,
              source: ix.parsed.info.source,
              destination: ix.parsed.info.destination,
              authority: ix.parsed.info.authority,
            });
          } else if (ix.parsed?.type === 'transferChecked' && ix.parsed.info.tokenAmount.amount) {
            transfers.push({
              amount: ix.parsed.info.tokenAmount.amount,
              source: ix.parsed.info.source,
              destination: ix.parsed.info.destination,
              authority: ix.parsed.info.authority,
            });
          }
        });
      }
    });

    console.log('transfers', transfers);

    if (transfers.length < 2) {
      throw new Error('Invalid Jupiter Swap');
    }

    return [
      transfers[0],
      transfers[transfers.length - 1].authority === TARGET_WALLET_ADDRESS.toString()
        ? transfers[transfers.length - 2]
        : transfers[transfers.length - 1],
    ];
  } catch (error: any) {
    throw new Error(error.message || 'Unexpected error while extracting transfers from jupiter dex.');
  }
}

/**
 * Analyzes transaction
 */
async function analyzeTransaction(transaction: ParsedTransactionWithMeta, signature: string, dex: string) {
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

      let poolAccounts: PublicKey[] = [];

      // SmartFox Loop until will find the account that its owner is RAYDIUM_LIQUIDITYPOOL_V4
      for (const ix of instrsWithAccs) {
        const accounts = ix.accounts.filter((acc) => acc.toString() !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
        for (const acc of accounts) {
          const poolInfo = await connection1.getAccountInfo(acc, { commitment: 'confirmed' });

          if (
            poolInfo?.owner.equals(RAYDIUM_LIQUIDITYPOOL_V4) &&
            poolInfo.data.length === 752 &&
            !poolAccounts.some((p) => p.equals(acc))
          ) {
            poolAccounts.push(acc);
          }
        }
      }

      if (poolAccounts.length === 0) {
        throw new Error('No Raydium or Jupiter swap transaction.');
      }

      let fromInfor: TokenInforType;
      let toInfor: TokenInforType;
      let type: string = '';
      let from: { mint: PublicKey; amount: number };
      let to: { mint: PublicKey; amount: number };

      if (poolAccounts.length === 1) {
        const { baseMint, quoteMint } = await getInforFromRaydiumPool(poolAccounts[0]);
        const trade = await getRaydiumTradeSize(transaction, baseMint, quoteMint, RAYDIUM_AUTHORITY_V4);
        from = trade.to;
        to = trade.from;
        fromInfor = await getTokenInfo(connection1, from.mint);
        toInfor = await getTokenInfo(connection1, to.mint);
        type = trade.type === 'Sell' ? 'Buy' : trade.type === 'Buy' ? 'Sell' : 'Swap';
      } else {
        const { baseMint: baseMint1, quoteMint: quoteMint1 } = await getInforFromRaydiumPool(poolAccounts[0]);
        const { baseMint: baseMint2, quoteMint: quoteMint2 } = await getInforFromRaydiumPool(
          poolAccounts[poolAccounts.length - 1]
        );

        ({ from } = await getRaydiumTradeSize(transaction, baseMint1, quoteMint1, TARGET_WALLET_ADDRESS));
        ({ to } = await getRaydiumTradeSize(transaction, baseMint2, quoteMint2, TARGET_WALLET_ADDRESS));

        fromInfor = await getTokenInfo(connection1, from.mint);
        toInfor = await getTokenInfo(connection1, to.mint);
        type = 'Swap';
      }

      return {
        signature,
        target_wallet: TARGET_WALLET_ADDRESS.toString(),
        type,
        dex,
        pool_address: poolAccounts[0].toString(),
        from: {
          token_address: fromInfor.address,
          amount: from.amount,
          symbol: fromInfor.symbol,
          decimals: fromInfor.decimals,
        },
        to: {
          token_address: toInfor.address,
          amount: to.amount,
          symbol: toInfor.symbol,
          decimals: toInfor.decimals,
        },
      } as AnalyzeType;
    }
  } catch (error: any) {
    console.error(error);
    throw new Error(error.message || 'Unexpected error while analyzing transaction.');
  }
}

async function getRaydiumTradeSize(
  transaction: ParsedTransactionWithMeta,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  owner: PublicKey
) {
  try {
    const postTokenBalances = transaction.meta?.postTokenBalances?.filter((p) => p.owner === owner.toString());
    const preTokenBalances = transaction.meta?.preTokenBalances?.filter((p) => p.owner === owner.toString());

    const basePostTokenBal =
      postTokenBalances?.find((p) => p.mint === baseMint?.toString())?.uiTokenAmount.uiAmount || 0;
    const basePreTokenBal = preTokenBalances?.find((p) => p.mint === baseMint?.toString())?.uiTokenAmount.uiAmount || 0;

    const quotePostTokenBal =
      postTokenBalances?.find((p) => p.mint === quoteMint?.toString())?.uiTokenAmount.uiAmount || 0;
    const quotePreTokenBal =
      preTokenBalances?.find((p) => p.mint === quoteMint?.toString())?.uiTokenAmount.uiAmount || 0;

    const baseDiff = new BigNumber(basePostTokenBal).minus(new BigNumber(basePreTokenBal)).toNumber();
    const quoteDiff = new BigNumber(quotePostTokenBal).minus(new BigNumber(quotePreTokenBal)).toNumber();

    const [less, lessA, bigger, biggerA] =
      baseDiff < 0
        ? [baseMint, baseDiff, quoteMint, quoteDiff]
        : quoteDiff < 0
        ? [quoteMint, quoteDiff, baseMint, baseDiff]
        : [baseMint, baseDiff, quoteMint, quoteDiff];

    let type = '';
    if (less.equals(SOL_ADDRESS)) {
      type = 'Buy';
    } else if (bigger.equals(SOL_ADDRESS)) {
      type = 'Sell';
    } else {
      type = 'Swap';
    }

    return {
      from: {
        mint: less,
        amount: Math.abs(lessA),
      },
      to: {
        mint: bigger,
        amount: biggerA,
      },
      type,
    };
  } catch (error: any) {
    throw new Error(error.message || '');
  }
}

async function getInforFromRaydiumPool(pool: PublicKey) {
  try {
    const poolInfo = await connection1.getAccountInfo(pool, { commitment: 'confirmed' });
    if (!poolInfo) {
      throw new Error('Invalid Raydium pool account.');
    }

    const { baseMint, quoteMint } = liquidityStateV4Layout.decode(poolInfo?.data);

    return { baseMint: baseMint, quoteMint: quoteMint };
  } catch (error: any) {
    throw new Error(error.message || 'Error while decoding information of pool.');
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
      slippage: 0.1,
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

          // Successfully sold the token
          if (success && signature) {
            const { diffSol, profit } = await calculateProfit(signature, token);
            logBuyOrSellTrigeer(false, diffSol, token.amount, token.symbol, profit.toString()); // Log sale success message

            indexesToDel.unshift(index); // Add index of item to remove
            logToFile(
              'Sell Success',
              TARGET_WALLET_ADDRESS.toString(),
              token.dex,
              token.mint.toString(),
              diffSol.toString(),
              'Auto sell triggered'
            );

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
function logToFile(action: string, wallet: string, dex: string, token: string, amount: string, reason: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp},${action},${wallet},${dex},${token},${amount},${reason}\n`;
  fs.appendFileSync(LOG_FILE, logEntry);
}

// OB get token info
async function getTokenInfo(connection: Connection, mint: PublicKey): Promise<TokenInforType> {
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

// async function test(signature: string) {
//   try {
//     const transaction = await connection1.getParsedTransaction(signature, {
//       commitment: 'confirmed',
//       maxSupportedTransactionVersion: 0,
//     });
//     if (!transaction) return;
//     await processTransaction(transaction, signature, 'Jupiter');
//   } catch (error) {
//     console.error(error);
//   }
// }
// test('5sXcffDWpBwZ1EH5fex58YBuTwENinjEizNtjg6axnRjY5gBVaz9xcCWxTrN26xt3UpLvGk7sdvHJDhqezYVxp5B');
// test('4hawmPrGpPov8vUMNTGsouXhDqvgBd9wt9QsAZuDvYgJqqbY4g35X7ZFGixEKGotRWEgwjwQcK3z21Mst3NwDS5u');
//https://solscan.io/tx/f93BiTDDPybnPjrnqtEGaZZ8PGropvGZtReGqKtv92cWpZCefyshv9Ngz1QmqoXAtcZtNRNbJgsTrtoEyzYp8ak
