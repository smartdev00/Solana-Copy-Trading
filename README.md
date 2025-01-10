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
  - Configuration via `.env` and `config.ts` files.
  - Human-readable JSON logs for tracking trades.

- **Utilises Wrapped Solana (WSOL)**:
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

After cloning the repository, the folder structure will look like this:

```plaintext
copy-trading-bot/
├── src/
│   ├── config.ts
│   ├── index.ts
├── sounds/
│   ├── bot-start.wav
│   ├── bot-error.wav
│   ├── bot-buy-trade.wav
│   ├── bot-buy-trade-copied.wav
│   ├── bot-sell-trade.wav
│   ├── bot-sell-trade-copied.wav
├── .env.sample
├── README.md
├── tsconfig.json
├── package.json
├── package-lock.json
├── .gitignore
```

### Step 3: Install Dependencies

Run the following command to install all required dependencies:
```
npm install
```

### Step 4: Configure the Bot

The bot's configuration follows this flow:
- `.env`: Contains sensitive and private information such as API keys, target wallet address, and wallet private key. This file is stored locally and not shared on GitHub.
- `config.ts`: Reads values from `.env` and defines parameters for the bot. This file references `.env` variables for sensitive data, ensuring security.
- `index.ts`: Main bot logic file that uses parameters defined in `config.ts` to perform trading actions.

1. Copy `.env.sample` to `.env`:
   ```bash
   cp .env.sample .env
   ```

2. Open `.env` and fill in the required details:
   - `CONNECTION_URL_1`: Replace the placeholder API key with your actual Helius API key.
   - `CONNECTION_URL_2`: Replace the placeholder API key with your actual Helius API key.
   - `TARGET_WALLET_ADDRESS`: Public key of the wallet to copy trades from.
   - `WALLET_PRIVATE_KEY`: Replace with your private key (base58-encoded).

3. Adjust parameters in `config.ts` as needed.
   - `TARGET_WALLET_MIN_TRADE`: Minimum trade size (in lamports) to copy. Trades below this value are ignored (e.g., 10000000000 for 10 SOL).
   - `RAYDIUM_LIQUIDITYPOOL_V4`: Static variable defining the liquidity pool (default: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`).
   - `SOL_ADDRESS`: Static variable defining the wrapped Solana token address (default: `So11111111111111111111111111111111111111112`).
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

### Step 6: Running the Bot

1. Build the project:
   ```bash
   npm run build
   ```

2. Start the bot:
   ```bash
   npm run start
   ```

3. You should see a message similar to:
   ```
   Waiting to copy trade wallet ...PNAQ3
   ```

---

## Configuration Guide

### Key Parameters in `config.ts`

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

## Recent Improvements (Updated January 10, 2025)

1. **Minimum Value of Target Wallet Trade**:
   - The bot now includes the ability to filter trades based on a configurable minimum trade size (e.g., `TARGET_WALLET_MIN_TRADE`). Trades below this threshold will be ignored, ensuring only "high commitment" trades are copied.
   
2. **Target Wallet Check Interval**:
   - The interval for checking the target wallet's activity has been changed from 400 milliseconds to 5 seconds (5000 milliseconds). This reduces API usage and ensures more efficient monitoring while maintaining timely updates.

3. **Historical Transaction Filtering**:
   - The bot now includes timestamp filtering logic to ensure only new transactions are processed. Historical transactions that occurred before the bot started running are ignored.
  
4. **Log Reporting**:
   - The bot now logs all trades and reasons for non-copied trades in CSV format. This includes timestamps, actions, wallet addresses, token details, amounts, and explanatory reasons. The log file can be opened in Excel for easy analysis.

5. **Sound Alerts**:
  - Audio notifications added for significant events (e.g., bot start, trades detected, errors).

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
