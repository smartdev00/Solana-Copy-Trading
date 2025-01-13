# Solana Copy Trading Bot

## Overview

The Solana Copy Trading Bot is an automated trading solution designed to replicate token buy and sell trades from specific Solana wallets in real time. The bot leverages the Solana blockchain’s capabilities along with the Helius API to monitor target wallets and execute trades based on pre-defined rules such as Take Profit (TP). The bot is designed for Windows environments and is suitable for users with basic to intermediate technical knowledge.

---

## Features

- **Real-Time Trade Copying**:
  - Monitors a single target Solana wallet for buy/sell activity.
  - Automatically replicates trades on your designated wallet.

- **Customizable Trade Parameters**:
  - Define trade size.
  - Set Take Profit (TP) thresholds for trades.
  - Define a minimum trade size threshold for copying target wallet trades.

- **Transaction Safety**:
  - Only sells tokens if:
    - The source wallet sells the token.
    - TP targets are triggered.
	- 100% of the token held in your wallet is sold when the tracked wallet sells the same token.

- **Support for Liquidity Pools**:
  - Integrates with Raydium Liquidity Pool for token swaps (does not trade on riskier marketplaces such as pump.fun).

- **Ease of Use**:
  - Configuration via a single `config.ts` file.
  - Human-readable JSON logs for tracking trades.

- **Requires Wrapped Solana (WSOL)**:
  - The bot uses WSOL for all trading activities. Ensure your wallet has sufficient WSOL before running the bot.
  - Refer to the [Copy Trading - Prepare Wallet with WSOL](copy-trading-get-wsol.pdf) guide for detailed steps to prepare your wallet.

---

## Prerequisites

To run the Solana Copy Trading Bot, ensure you have the following:

1. **Windows Pro PC**
2. **Software Requirements**:
   - Node.js (v16 or higher)
   - TypeScript
   - Yarn (optional, if preferred over npm)
3. **Accounts and API Keys**:
   - A Solana wallet (private key required).
   - Helius RPC API key (for blockchain interaction).
4. **Dependencies**:
   - `@solana/web3.js`
   - `@raydium-io/raydium-sdk`
   - `dotenv`
   - `bs58`

---

## Setup Instructions

### Step 1: Install Required Software

1. Download and install [Node.js](https://nodejs.org/).
2. Verify installation:
   ```
   node -v
   npm -v
   ```

### Step 2: Clone the Repository

1. Clone the repository to your local machine:
   ```
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```
   cd copy-trading-bot
   ```

### Step 3: Install Dependencies

Run the following command to install all required dependencies:
```
npm install
```

### Step 4: Configure the Bot

1. Open `.env.sample` in a text editor and save it to a file with another name, e. g. `.env` or `my_config.env` or any other name you like.
2. Add your **Helius API Key**:
   - Locate the `CONNECTION_URL_1` and `CONNECTION_URL_2` settings in the `.env` file.
   - Replace the placeholder API key with your actual Helius API key:
      `CONNECTION_URL_1 = https://mainnet.helius-rpc.com/?api-key=<YOUT_API_KEY>`
      `CONNECTION_URL_2 = https://mainnet.helius-rpc.com/?api-key=<YOUT_API_KEY>`
3. Update the following parameters:
   - `TARGET_WALLET_ADDRESS`: Public key of the wallet to copy trades from.
   - `TARGET_WALLET_MIN_TRADE`: Minimum trade size (in lamports) to copy. Trades below this value are ignored (e.g., 10000000000 for 10 SOL).
   - `RAYDIUM_LIQUIDITYPOOL_V4`: Static variable defining the liquidity pool (default: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`).
   - `SOL_ADDRESS`: Static variable defining the wrapped Solana token address (default: `So11111111111111111111111111111111111111112`).
   - `WALLET_PRIVATE_KEY`: Replace with your private key (base58-encoded).
   - `TRADE_AMOUNT`: Amount of WSOL to use per trade (e.g., `10000000` for 0.01 WSOL).
   - `COMPUTE_PRICE`: A static variable for internal calculations (default: `100000`).
   - `LIMIT_ORDER`: Set Take Profit as a multiplier (e.g., `1.25` for 25% profit, but typically follows the target wallet's actions).
   - `SLIPPAGE`: Input slippage tolerance for trades (default value: `5`).

### Step 5: Install TypeScript

1. Ensure TypeScript is installed globally by running:
   ```
   tsc --version
   ```
2. If TypeScript is not recognized, install it globally:
   ```
   npm install -g typescript
   ```
3. Verify the installation by running:
   ```
   tsc --version
   ```

### Step 6: Compile the Bot

1. Navigate to the bot's main folder where the `tsconfig.json` file is located. For example:
   ```cmd
   cd C:\copy-trading-bot
   ```
2. Compile the TypeScript code into JavaScript to generate the `dist` folder and compile `.js` files:
   ```
   npm run build
   ```
3. Verify that the `dist` folder is created and contains the compiled `.js` files.

### Step 7: Start the Bot

Run the bot specifying path to your configuration file `.env` or `my_config.env` or whatever name you have chosen at step 4.1.
Note that the bot is running in its own `dist` folder, therefore you need to specify that configuration file is located in parent folder using `..` notation:
```bash
npm run start ../.env
```
or
```bash
npm run start ../my_config.env
```

---

## Configuration Guide

### Key Parameters in `.env.sample`

| Parameter              | Description                                                                                  |
|------------------------|----------------------------------------------------------------------------------------------|
| `TARGET_WALLET_ADDRESS`| The wallet address to monitor for trades.                                                   |
| `TARGET_WALLET_MIN_TRADE` | Minimum trade size (in lamports) to copy. Trades below this value will be ignored.          |
| `TRADE_AMOUNT`         | Amount to trade per transaction (in lamports; 1 WSOL = 1,000,000,000 lamports).             |
| `RAYDIUM_LIQUIDITYPOOL_V4` | Static variable for the Raydium Liquidity Pool.                                             |
| `SOL_ADDRESS`          | Static variable for the wrapped Solana token address.                                        |
| `WALLET`               | Your trading wallet’s private key in base58 format.                                         |
| `COMPUTE_PRICE`        | A static variable for internal calculations (default: `100000`).                            |
| `LIMIT_ORDER`          | Multiplier for setting Take Profit (TP) above the buy price (e.g., `1.25` for 25% profit).  |
| `SLIPPAGE`             | Maximum allowable price variation during trade execution (default: `5`).                    |

---

## Usage

1. Ensure the bot is running by executing:
   ```bash
   npm run start ../my_config.env
   ```
2. Monitor the console for real-time logs of:
   - Tokens bought and sold.
   - Current holdings and performance.

3. Edit `my_config.env` to adjust trade parameters and restart the bot if changes are made.

---

## Troubleshooting

| Issue                                     | Solution                                                                              |
|-------------------------------------------|--------------------------------------------------------------------------------------|
| Bot fails to start                        | Verify Node.js and TypeScript installations. Ensure dependencies are installed.       |
| Transactions not being copied             | Check `TARGET_WALLET_ADDRESS` and ensure the Helius API key is valid.                 |
| Unexpected token behavior                 | Ensure `TRADE_AMOUNT` is correctly set in lamports.                                   |
| Logs not updating                         | Check the bot’s connection to the Solana network. Restart if necessary.               |

---

## Example Copy Trades

Below are screenshots illustrating the bot correctly tracking and copying trades from the target wallet:

1. **Copy Trade Example 1**: The tracked wallet buys the `amigo` token by swapping WSOL. The bot copies this trade shortly afterward.

   ![Copy Trading Example 1](copy-trading-example1.png)

2. **Copy Trade Example 2**: The tracked wallet buys the `KAN` token by swapping WSOL. The bot copies this trade shortly afterward.

   ![Copy Trading Example 2](copy-trading-example2.png)

---

## Recent Improvements (Updated January 01, 2025)

1. **Minimum Value of Target Wallet Trade**:
   - The bot now includes the ability to filter trades based on a configurable minimum trade size (e.g., `TARGET_WALLET_MIN_TRADE`). Trades below this threshold will be ignored, ensuring only "high commitment" trades are copied.
   
2. **Target Wallet Check Interval**:
   - The interval for checking the target wallet's activity has been changed from 400 milliseconds to 5 seconds (5000 milliseconds). This reduces API usage and ensures more efficient monitoring while maintaining timely updates.

3. **Historical Transaction Filtering**:
   - The bot now includes timestamp filtering logic to ensure only new transactions are processed. Historical transactions that occurred before the bot started running are ignored.
  
4. **Log Reporting**:
   - The bot now logs all trades and reasons for non-copied trades in CSV format. This includes timestamps, actions, wallet addresses, token details, amounts, and explanatory reasons. The log file can be opened in Excel for easy analysis.

---

## Future Improvements

1. **Masking Bot Trades from Target Wallet**:
   - Consider advanced strategies for "front-running mitigation" or "transaction privacy," that can help obfuscate or disguise the activities of our bot (refer to Solana-Copy-Trading-Bot-Masking-Trades.pdf) for concepts.

2. **Support for Multiple Wallets**:
   - Enable tracking and copying trades from multiple Solana wallets simultaneously.

3. **Optional Token Liquidity Check**:
   - Implement a feature to evaluate token liquidity during tracked wallet buys and proceed with the trade only if liquidity is sufficient to avoid adverse price impacts.

4. **Optional Stop Loss (SL) Setting for Each Wallet**:
   - Add the ability to specify a Stop Loss percentage for each wallet, triggering an automatic sell if the SL threshold is reached.
   - **Developer response**: "This is impossible because of RPC node server issues. Without our own local node server, we cannot implement subscription-based functions such as a Stop Loss."

---

## License

This project is licensed under the MIT License. See `LICENSE` for details.
