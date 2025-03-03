import chalk from 'chalk';
import { AnalyzeType } from './types';

export const logLine = () => {
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
};

export const logSkipped = (solDiff: number) => {
  console.log(`${chalk.yellow('⚠  Skipped Trade')}: Below Minimum Trade Size (${solDiff} SOL)`);
  logLine();
};

export function logError(str?: string) {
  // console.log('❌', `${chalk.red('ERROR:')}: ${str || 'Failed to process transaction due to low balance.'}`);
  // logLine();
}

export function logCircular(str?: string) {
  console.log('🔄', `${chalk.red('CIRCULAR ARBITRAGE:')}: ${str || 'Input and Output mint are same.'}`);
  logLine();
}

export function logBuyOrSellTrigeer(
  isBuy: boolean,
  solAmount: number,
  mintAmount: number,
  symbol: string,
  signature: string,
  profit?: string
) {
  if (isBuy) {
    console.log(
      '🛒 ✅',
      `${chalk.green('BUY EXECUTED')}: Purchased ${mintAmount} ${chalk.yellow(symbol)} for ${solAmount} ${chalk.yellow(
        'SOL\n' + `📝 TX: ${chalk.cyan(`https://solscan.io/tx/${signature}`)}`
      )}`
    );
  } else {
    console.log(
      `🔴 ${chalk.red('SELL TRIGGERED')}: Sold ${mintAmount}% of ${chalk.yellow(
        symbol
      )} for ${solAmount} ${chalk.yellow('SOL')} (${chalk.green('Profit')}: ${profit}%)\n` +
        `📝 TX: ${chalk.cyan(`https://solscan.io/tx/${signature}`)}`
    );
  }
  logLine();
}

export const logger = (data: AnalyzeType) => {
  const currentDate = new Date(Date.now());
  const timestamp = currentDate.toLocaleTimeString().replace(' PM', '').replace(' AM', '');

  if (data.type === 'Buy') {
    console.log(
      `🟢${chalk.green.bold('[BUY]')} ${data.to.amount} ${chalk.yellow(data.to.symbol)} ➡ ${
        data.from.amount
      } ${chalk.yellow('SOL')} ${chalk.gray(`[${timestamp}]`)}`
    );
  } else if (data.type === 'Sell') {
    console.log(
      `🔴 ${chalk.red.bold('[SELL]')} ${data.from.amount} ${chalk.yellow(data.from.symbol)} ➡ ${
        data.to.amount
      } ${chalk.yellow('SOL')} ${chalk.gray(`[${timestamp}]`)}`
    );
  } else {
    console.log(
      `⚪${chalk.gray.bold('[SWAP]')} ${data.from.amount} ${chalk.yellow(data.from.symbol)} ➡ ${
        data.to.amount
      } ${chalk.yellow(data.to.symbol)} ${chalk.gray(`[${timestamp}]`)}`
    );
  }
  console.log(`📍 DEX: ${chalk.blue(data.dex)}`);
  console.log(`📝 TX: ${chalk.cyan(`https://solscan.io/tx/${data.signature}`)}`);
  console.log(`🤵 Wallet: ${chalk.magenta(`https://solscan.io/account/${data.target_wallet}`)}`);
  logLine();
};

export const roundToDecimal = (value: number, decimals = 9): number => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};
