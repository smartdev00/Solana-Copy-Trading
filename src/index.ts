import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import sound from 'sound-play';
import bs58 from 'bs58';
import fetch from 'cross-fetch';
import { Metaplex, amount } from '@metaplex-foundation/js';
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
} from '@solana/web3.js';
import {
  LIQUIDITY_STATE_LAYOUT_V4,
  Liquidity,
  MARKET_STATE_LAYOUT_V3,
  SPL_MINT_LAYOUT,
  LiquidityPoolKeys,
  Market,
} from '@raydium-io/raydium-sdk';

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  decodeTransferInstruction,
} from '@solana/spl-token';
import { AnalyzeType, logger, roundToDecimal } from './utils';

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
const JUPITER_AGGREGATOR_AUTHORITIES: PublicKey[] = [
  new PublicKey('9nnLbotNTcUhvbrsA6Mdkx45Sm82G35zo28AqUvjExn8'),
  new PublicKey('6U91aKa8pmMxkJwBCfPTmUEfZi6dHe7DcFq2ALvB2tbB'), //12
  new PublicKey('6LXutJvKUw8Q5ue2gCgKHQdAN4suWW8awzFVC6XCguFx'), //5
];
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SOL_ADDRESS = new PublicKey('So11111111111111111111111111111111111111112');
const WALLET = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY || ''));
const TRADE_AMOUNT = parseInt(process.env.TRADE_AMOUNT || '0');
const COMPUTE_PRICE = 100000;
const LIMIT_ORDER = 1.25;
const SLIPPAGE = 5;

const soundFilePaths = {
  botStart: path.join(__dirname, '../sounds/bot-start.mp3'),
  buyTrade: path.join(__dirname, '../sounds/bot-buy-trade.mp3'),
  buyTradeCopied: path.join(__dirname, '../sounds/bot-buy-trade-copied.mp3'),
  sellTrade: path.join(__dirname, '../sounds/bot-sell-trade.mp3'),
  sellTradeCopied: path.join(__dirname, '../sounds/bot-sell-trade-copied.mp3'),
};

const LAMPORTS_IN_SOL = 1_000_000_000;

// Confirm the bot started working
console.info('Target wallet minimal trade size', TARGET_WALLET_MIN_TRADE / LAMPORTS_IN_SOL, 'SOL');
console.info('Trading amount', TRADE_AMOUNT / LAMPORTS_IN_SOL, 'SOL');

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
  console.log('Monitoring wallet:', TARGET_WALLET_ADDRESS.toString());
  let loop = true;
  try {
    await connection1.onLogs(
      TARGET_WALLET_ADDRESS,
      async ({ logs, err, signature }) => {
        if (err) {
          return;
        }

        // SmartFox Identify the dex
        const dex = identifyDex(logs);
        if (!dex) {
          return;
        }

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

  // SmartFox log the detail information of swap transaction
  logger(analyze);

  // Skip trades below the minimum threshold
  // if (trade.diffSol < TARGET_WALLET_MIN_TRADE) {
  //   logToFile(
  //     'Skipped',
  //     TARGET_WALLET_ADDRESS.toString(),
  //     solAccount.toString(),
  //     trade.diffSol.toString(),
  //     'Below minimum trade size'
  //   );
  //   sound.play(soundFilePaths.buyTrade);
  //   return;
  // }

  sound.play(soundFilePaths.buyTradeCopied);
  // const buy = await Buy(connection1, tokenAccount, poolAccount);

  // if (buy && buy.mint && buy.poolKeys) {
  //   sound.play(soundFilePaths.sellTrade);
  //   sellWithLimitOrder(connection2, buy.mint, buy.poolKeys);
  // }
}

/**
 * Obtains trade size for transaction with specified signature
 */
// SmartFox Calculate correctly the trade size and confirm whether tx is buy or sell
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
      const poolData = LIQUIDITY_STATE_LAYOUT_V4.decode(poolInfo?.data);
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

async function Buy(connection: Connection, mint: PublicKey, pool: PublicKey) {
  try {
    if (buyTokenList.includes(mint)) {
      logToFile(
        'Skipped',
        WALLET.publicKey.toString(),
        mint.toString(),
        (TRADE_AMOUNT / 1_000_000_000).toString(),
        'Token already purchased'
      );
      console.log('Token: already purchased this token!');
      return;
    }

    const poolKeys = await getLiquidityV4PoolKeys(connection, pool);
    if (poolKeys) {
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
      const versionedNewTokenTransaction = new VersionedTransaction(newTokenTransactionMessage);
      versionedNewTokenTransaction.sign([WALLET]);
      const res = await connection.sendRawTransaction(versionedNewTokenTransaction.serialize(), {
        skipPreflight: false,
      });
      console.log('SendRawTransaction: ', res);
      const confirmStatus = await connection.confirmTransaction(
        {
          signature: res,
          lastValidBlockHeight: latestBlock.lastValidBlockHeight,
          blockhash: latestBlock.blockhash,
        },
        'confirmed'
      );

      if (confirmStatus.value.err == null) {
        logToFile('Bot Buy', WALLET.publicKey.toString(), mint.toString(), (TRADE_AMOUNT / 1_000_000_000).toString());
        buyTokenList.push(mint);
        console.log(`Buy: buy token - ${res}`);
        return { mint: mint, poolKeys: poolKeys };
      } else {
        return null;
      }
    }
  } catch (error) {
    logToFile('Error', WALLET.publicKey.toString(), mint?.toString() || 'Unknown', '0', 'Error: buy on raydium');
    console.log('Error: buy on raydium', error);
    return null;
  }
}

async function sellWithLimitOrder(connection: Connection, mint: PublicKey, poolKeys: LiquidityPoolKeys) {
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
        const lpReserve = (await connection.getMultipleParsedAccounts([baseVault, quoteVault])).value;
        const baseData: any = lpReserve[0]?.data;
        const quoteData: any = lpReserve[1]?.data;
        const baseReserve = BigInt(baseData['parsed']['info']['tokenAmount']['amount']);
        const solReserve = BigInt(quoteData['parsed']['info']['tokenAmount']['amount']);
        const expectedSolAmount = expectAmountOut(tokenBalance, baseReserve, solReserve);
        if (expectedSolAmount > BigInt(targetProfit)) {
          logToFile(
            'Bot Sell',
            WALLET.publicKey.toString(),
            mint.toString(),
            (tokenBalance / BigInt(1000000000)).toString()
          );
          console.log('Sell: detect profitable moment');
          const sellRes = await sellAllToken(connection, poolKeys.id, mint, tokenBalanceString);
          break;
        }
      } catch {
        console.log('lp catching error due to helius');
      }
      await sleep(100);
    }
  } catch {
    console.log('empty token balance');
    return null;
  }
}

function expectAmountOut(tokenAmount: bigint, tokenReserve: bigint, solReserve: bigint) {
  const bigSlippage = BigInt((100 - SLIPPAGE) * 100);
  const res = ((tokenAmount + solReserve) * bigSlippage) / (BigInt(10000) * (tokenReserve + tokenAmount));
  return res;
}

async function sellAllToken(connection: Connection, pool: PublicKey, mint: PublicKey, tokenAmount: string) {
  const tokenATA = getAssociatedTokenAddressSync(mint, WALLET.publicKey);
  const solATA = getAssociatedTokenAddressSync(SOL_ADDRESS, WALLET.publicKey);
  const tokenBalance = BigInt(tokenAmount);
  const poolKeys = await getLiquidityV4PoolKeys(connection1, pool);
  if (poolKeys && tokenBalance > BigInt(0)) {
    const swapInst = await getSwapTokenGivenInInstructions(WALLET.publicKey, poolKeys, mint, tokenBalance);
    let sellInsts: TransactionInstruction[] = [];
    sellInsts.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 10000000,
      }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 78000 }),
      ...swapInst,
      createCloseAccountInstruction(tokenATA, WALLET.publicKey, WALLET.publicKey, [])
    );
    let blockhash = await connection.getLatestBlockhash().then((res) => res.blockhash);
    const newTokenTransactionMessage = new TransactionMessage({
      payerKey: WALLET.publicKey,
      recentBlockhash: blockhash,
      instructions: sellInsts,
    }).compileToV0Message();
    const versionedNewTokenTransaction = new VersionedTransaction(newTokenTransactionMessage);
    versionedNewTokenTransaction.sign([WALLET]);
    const res = await connection.sendRawTransaction(versionedNewTokenTransaction.serialize(), { skipPreflight: true });
    console.log(`Sell: sell token - ${res}`);
  }
}

async function getLiquidityV4PoolKeys(connection: Connection, pool: PublicKey) {
  try {
    const poolAccount = await connection.getAccountInfo(pool, 'confirmed');
    if (!poolAccount) return null;
    const poolInfo = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data);
    if (
      poolInfo.baseMint.toString() != SOL_ADDRESS.toString() &&
      poolInfo.quoteMint.toString() != SOL_ADDRESS.toString()
    ) {
      return null;
    }

    const marketAccount = await connection.getAccountInfo(poolInfo.marketId, 'confirmed');
    if (!marketAccount) return null;
    const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);

    const lpMintAccount = await connection.getAccountInfo(poolInfo.lpMint, 'confirmed');
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

async function getSwapTokenGivenInInstructions(
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
    createAssociatedTokenAccountIdempotentInstruction(owner, tokenOutATA, owner, tokenOut),
    ...innerTransaction.instructions,
  ];
}

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

// setInterval(trackTargetWallet, 5000);
// trackTargetWallet();
monitorNewToken();
