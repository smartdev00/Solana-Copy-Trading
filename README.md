# Solana Copy Trading Bot

## Overview

The **Solana Copy Trading Bot** is an advanced automated trading solution that **mirrors token swaps** (buy and sell trades) from a specific **target Solana wallet** in real time. The bot integrates with **Raydium and Jupiter decentralized exchanges (DEXs)**, monitoring wallet activity and executing trades based on pre-defined user parameters.

Designed to be **fast, efficient, and customizable**, the bot is intended for **Windows users** with **basic to intermediate technical knowledge**.

---

## Features

- **Real-Time Trade Copying**:
  - Monitors **a single target Solana wallet** for buy/sell activity.
  - Detects **buy/sell swaps** on both **Raydium and Jupiter** DEXs.
  - Executes copy trades instantly if the trade size threshold is met.

- **Automated Trade Execution**:
  - **BUY:** Automatically purchases the same tokens as the target wallet **if trade threshold is met**.
  - **SELL:** Automatically sells when:
    - The target wallet sells the token.
    - The **Take Profit (TP)** price target is hit.

- **Smart Notifications & Logs**:
  - **Enhanced command prompt interface** with **color-coded logs** (via Chalk.js).
  - **Sound alerts for trade events** (optional mute feature included).
  - **Detailed log reporting** for all trades, skipped trades, and errors.

- **Customizable Settings**:
  - Define trade size per transaction.
  - Set a **Take Profit (TP) threshold** to automate profit-taking.
  - Adjustable **minimum trade size** to filter out small trades.

- **Fast & Efficient**:
  - Optimized for **low latency trade execution**.
  - Uses the **Helius WebSockets API** for real-time transaction detection.

---

## Prerequisites

### **System Requirements**
- **Windows Pro PC**
- **Software Dependencies:**
  - Node.js **(v16 or higher)**
  - TypeScript
  - Yarn (optional, if preferred over npm)
- **Solana Wallet:**
  - A **private Solana wallet** for executing trades.
  - Ensure the wallet is funded with **WSOL (Wrapped Solana)** for trading.
- **Helius API Key**:
  - Required to connect to the Solana blockchain and fetch transaction data.

---

## Setup Instructions

### **Step 1: Install Required Software**

1. Download and install [Node.js](https://nodejs.org/).
2. Verify installation:
   ```bash
   node -v
   npm -v
   ```

### **Step 2: Clone the Repository**

```bash
git clone <repository-url>
cd copy-trading-bot
```

### **Step 3: Install Dependencies**

```bash
npm install
```

### **Step 4: Configure the Bot**

1. Copy the sample environment file:
   ```bash
   cp .env.sample my_config.env
   ```
2. Open `my_config.env` and configure your settings:
   - `CONNECTION_URL`: Your **Helius RPC API key**.
   - `TARGET_WALLET_ADDRESS`: Public key of the wallet to copy trades from.
   - `WALLET_PRIVATE_KEY`: **Base58-encoded private key** of your wallet.
   - `TRADE_AMOUNT`: **Trade size per transaction** (in lamports).
   - `TAKE_PROFIT`: **Take profit threshold** (e.g., `1.25` for 25% profit).
   - `MUTE_SOUNDS`: Set to `true` to disable sound alerts.

### **Step 5: Running the Bot**

1. Build the project:
   ```bash
   npm run build
   ```
2. Start the bot with your configuration:
   ```bash
   npm run start ../my_config.env
   ```

You should see output similar to:
```
------------------------------------------------------------
🛠  BOT INITIALIZED
🔍 Monitoring Target Wallet: [wallet address]
🔹 Min Trade Size: 0.01 SOL | Trading Amount: 0.005 SOL
------------------------------------------------------------
```

---

## Configuration Guide

### **Key Parameters in `.env.sample`**

| Parameter              | Description                                                                                  |
|------------------------|----------------------------------------------------------------------------------------------|
| `TARGET_WALLET_ADDRESS`| The wallet address to monitor for trades.                                                   |
| `TARGET_WALLET_MIN_TRADE` | Minimum trade size (in lamports) to copy. Trades below this value are ignored.               |
| `TRADE_AMOUNT`         | Amount to trade per transaction (in lamports; 1 WSOL = 1,000,000,000 lamports).             |
| `RAYDIUM_LIQUIDITYPOOL` | Static variable for the Raydium Liquidity Pool.                                             |
| `SOL_ADDRESS`          | Static variable for the wrapped Solana token address.                                        |
| `WALLET`               | Your trading wallet’s private key in base58 format.                                         |
| `TAKE_PROFIT`          | Profit threshold above the buy price (e.g., `1.25` for 25% profit).                         |
| `MUTE_SOUNDS`          | Set `true` to disable sound notifications.                                                   |

---

## Recent Improvements (Updated February 10, 2025)

1. **Enhanced Command Prompt Interface**:
   - Clean and human-readable output with **color-coded logs** (via Chalk.js).

2. **Sound Notifications**:
   - All **audio notifications** (bot start, buy detected, buy copied, sell detected, errors) have been **fully implemented**.
   - Error sound now repeats **only every 10 seconds** to prevent spam.

3. **Jupiter DEX Support**:
   - The bot **now detects and copies trades** on both **Raydium and Jupiter**.

---

## Future Improvements

1. **Multi-Wallet Support**
   - Ability to **copy trade multiple wallets simultaneously** in a single instance.

2. **Liquidity-Based Trade Filtering**
   - Ensure sufficient liquidity exists before executing copy trades.

3. **More Customizable Trading Strategies**
   - Adding Stop Loss (SL) functionality.
   - Implementing **advanced trade execution options**.

---

## License

This project is licensed under the **MIT License**. See `LICENSE` for details.
