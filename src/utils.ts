import chalk from 'chalk';

export const logger = (data: any) => {
  const timestamp = new Date().toLocaleString().slice(11, -1);
  if (data.type === 'Buy') {
    console.log(chalk.blue.bold(`[${timestamp}]`), chalk.blue.bgWhite.bold(data.type), data);
  } else {
    console.log(chalk.blue.bold(`[${timestamp}]`), chalk.redBright.bgBlue.bold(data.type), data);
  }
};

export const roundToDecimal = (value: number, decimals = 9): number => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};
