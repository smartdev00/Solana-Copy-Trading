import {
  PublicKey,
  TransactionSignature,
  ParsedInstruction,
  TransactionInstruction,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  Connection,
} from '@solana/web3.js';

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

import { 
  connection1,
  connection2, 
  WALLET,
  TARGET_WALLET_ADDRESS, 
  RAYDIUM_LIQUIDITYPOOL_V4, 
  SOL_ADDRESS,
  TRADE_AMOUNT,
  COMPUTE_PRICE,
  LIMIT_ORDER,
  SLIPPAGE,
  sleep 
} from './config'

let signatureList = new Set<TransactionSignature>();
let signatureCompletedList: TransactionSignature[] = [];
const SIGNATURE_COMPLETED_LIST_LIMIT = 20;
let buyTokenList: PublicKey[] = [];

async function trackTargetWallet() {
  try {
    const signatures = await connection1.getSignaturesForAddress(TARGET_WALLET_ADDRESS, {
      limit: 5,
    });

    for (const signatureInfo of signatures) {
      const { signature, err } = signatureInfo;
      
      if (!err && !signatureList.has(signature) && !signatureCompletedList.includes(signature)) {
        signatureList.add(signature);
      }
    }

    for (const signature of signatureList) {
      const res = await analyzeSignature(connection1, signature); 

      if(res && res.isBuy && res.mint && res.pool) {
        console.log(`Target: buy ${res.mint} token on ${res.pool} pool`)
        const buy =  await Buy(connection1, res.mint, res.pool);
        console.log('Buy: ', buy);

        if(buy && buy.mint && buy.poolKeys){
          sellWithLimitOrder(connection2, buy.mint, buy.poolKeys);
        }
      }
    }
  } catch (error) {
    console.error('Error fetching signatures:', error);
  }
}

function addToCompletedList(signature: TransactionSignature) {
  if (signatureCompletedList.length >= SIGNATURE_COMPLETED_LIST_LIMIT) {
    signatureCompletedList.shift(); // Remove oldest signature if limit is exceeded
  }
  signatureCompletedList.push(signature);
}

async function analyzeSignature(connection: Connection, signature: string) {
  signatureList.delete(signature);
  addToCompletedList(signature);   
  try {
    const transactionDetails = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
    let isBuy = true;
    let mintAddress: PublicKey | undefined;
    let poolAddress: PublicKey | undefined;
    console.log(`Analyze: ${signature}`);
    if (transactionDetails?.meta?.logMessages) {
      const logs = transactionDetails.meta.logMessages;          
      const isRaydiumLog = logs.some(log =>
        log.includes(RAYDIUM_LIQUIDITYPOOL_V4.toString())
      );          
      const isTransferLog = logs.some(log =>
        log.includes("Program log: Instruction: Transfer")
      );
  
      if (isRaydiumLog && isTransferLog) {    
        console.log('--- Detect Target Wallet Swap Transaction ---');  
        for (const instruction of transactionDetails.transaction.message.instructions) {  
          if ('accounts' in instruction && instruction.programId.equals(RAYDIUM_LIQUIDITYPOOL_V4)) {
            poolAddress = instruction.accounts[1];
            const poolAccount = await connection.getAccountInfo(
              poolAddress,
              "confirmed"
            );
            
            if(poolAccount) {
              const poolInfo = LIQUIDITY_STATE_LAYOUT_V4.decode(
                poolAccount.data
              );
              mintAddress = poolInfo.quoteMint.equals(SOL_ADDRESS) ? poolInfo.baseMint : poolInfo.quoteMint;
            }
          }
          const parsedInstruction = instruction as ParsedInstruction;
  
          if(parsedInstruction?.parsed?.type == 'createAccountWithSeed' && parsedInstruction?.parsed?.info?.lamports == '2039280'){
            isBuy = false;  
          }        
        }
      }
    }  
    return {signature, pool: poolAddress, mint: mintAddress, isBuy}
  } catch (error) {
    console.log('Error: analyze signature error!');
    return null;
  }
}

async function Buy(connection: Connection, mint: PublicKey, pool: PublicKey) {
  try {
    console.log('Buy start');
    if(buyTokenList.includes(mint)) {
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
        buyTokenList.push(mint);
        console.log(`Buy: buy token - ${res}`);
        return {mint: mint, poolKeys: poolKeys}
      } else {
        return null;
      }      
    }
  } catch (error) {
    console.log("Error: buy on raydium", error);
    return null;
  }
}

async function sellWithLimitOrder( connection: Connection, mint: PublicKey, poolKeys: LiquidityPoolKeys ) {
  let tokenBalanceString: string;
  const targetProfit = Math.floor(TRADE_AMOUNT * LIMIT_ORDER);
  const targetLoss = Math.floor(TRADE_AMOUNT / 2);
  const isCorrectOrder =
    poolKeys.baseMint.toString() === mint.toString() ? true : false;
  const baseVault = isCorrectOrder ? poolKeys.baseVault : poolKeys.quoteVault;
  const quoteVault = isCorrectOrder ? poolKeys.quoteVault : poolKeys.baseVault;
  const mintATA = getAssociatedTokenAddressSync(mint, WALLET.publicKey);
  try {
    tokenBalanceString = (await connection.getTokenAccountBalance(mintATA)).value.amount;
    const tokenBalance = BigInt(tokenBalanceString);
    /*Track Lp Reserves*/
    while (true) {
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

setInterval(trackTargetWallet, 400);