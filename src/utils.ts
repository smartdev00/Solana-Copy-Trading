import chalk from 'chalk';

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

export const logger = (data: AnalyzeType) => {
  if (data.type === 'Buy') {
    console.log(
      `🟢 ${chalk.green.bold('[BUY]')} ${data.to.amount} ${chalk.yellow(data.to.symbol)} ➡ ${
        data.from.amount
      } ${chalk.yellow('SOL')}`
    );
  } else if (data.type === 'Sell') {
    console.log(
      `🔴 ${chalk.red.bold('[SELL]')} ${data.from.amount} ${chalk.yellow(data.from.symbol)} ➡ ${
        data.to.amount
      } ${chalk.yellow('SOL')}`
    );
  } else {
    console.log(
      `⚪ ${chalk.gray.bold('[SWAP]')} ${data.from.amount} ${chalk.yellow(data.from.symbol)} ➡ ${
        data.to.amount
      } ${chalk.yellow(data.to.symbol)}`
    );
  }
  console.log(`📍 DEX: ${chalk.blue(data.dex)}`);
  console.log(`📝 TX: ${chalk.cyan(`https://solscan.io/tx/${data.signature}`)}`);
  console.log(`🤵 Wallet: ${chalk.magenta(`https://solscan.io/account/${data.target_wallet}`)}`);
  console.log(chalk.gray('----------------------------------------------------------------------------------'));
};

export const roundToDecimal = (value: number, decimals = 9): number => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};
