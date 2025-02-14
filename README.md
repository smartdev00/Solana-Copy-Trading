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
  - **Detailed log reporting** for all trades, skipped trades, and errors in CSV format (compatible with Excel for easy analysis).

- **Customizable Settings**:
  - Define trade size per transaction.
  - Set a **Take Profit (TP) threshold** to automate profit-taking.
  - Adjustable **minimum trade size** to filter out small trades.

- **Fast & Efficient**:
  - Optimized for **low latency trade execution**.
  - Uses the **Helius WebSockets API** for real-time transaction detection.
  - **Monitors live token prices via Helius RPC** to track Take Profit thresholds.

---

## Prerequisites

### **System Requirements**
- **Windows Pro PC**
- **Software Dependencies:**
  - Node.js **(v16 or higher)**
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

**Multiple Instances:**
- You **can run multiple instances of the bot** to track different target wallets.
- You **can use the same Helius API key for all instances.**

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

4. **CSV Logging Feature**:
   - Every trade, skipped trade, and reason for not copying is now logged in a CSV file.
   - Compatible with **Excel for easy trade analysis**.

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

## External Services, APIs and Mechanisms used by the Bot

### **1. Swap Detection - Monitoring Target Wallet in Real-Time**
- **How it Works:** 
  - The bot **monitors target wallet activity** for buy/sell swaps.
  - When a transaction occurs, **it does not contain all necessary swap details**.
  - The bot **fetches additional data** to fully analyze the transaction.
  
- **Services & APIs Used:**
  - **Helius WebSockets API**:
    - Listens for real-time transaction events affecting the target wallet.
    - Notifies the bot when a swap happens.
  - **Helius RPC API**:
    - Fetches **additional transaction details** (e.g., token data, sender/receiver addresses, swap amounts).
    - Queries Solana blockchain for structured transaction data.

- **Real-Time Monitoring Mechanism:**
  - The bot **subscribes to Helius WebSockets** to receive immediate notifications for wallet activity.
  - When an event occurs, it **requests enriched transaction details** via Helius RPC API.

---

### **2. Copy Trading - Buying Tokens**
- **How it Works:** 
  - Once a target wallet **executes a buy trade**, the bot checks if the trade **meets the minimum trade size threshold**.
  - If the conditions are met, the bot **executes a matching buy trade** as quickly as possible.

- **Services & APIs Used:**
  - **Helius WebSockets API**:
    - Detects when the target wallet executes a trade.
  - **Helius RPC API**:
    - Retrieves token addresses, amounts, and swap direction.
  - **Jupiter Quote API (`https://quote-api.jup.ag/v6`)**:
    - Fetches real-time price quotes for tokens.
    - Used to calculate expected trade amounts and slippage.
  - **Solana JSON-RPC (via Helius API)**:
    - Executes the buy trade **directly** on Raydium or Jupiter.

- **Trade Execution Mechanism:**
  - The bot **queries Jupiter's Quote API** to get the best swap route and expected slippage.
  - Uses **Solana JSON-RPC API** (via Helius) to interact with Raydium or Jupiter smart contracts for **trade execution**.

---

### **3. Copy Trading - Selling Tokens**
- **How it Works:** 
  - The bot **sells 100% of a token** when either of these conditions are met:
    1. **The target wallet sells the token**.
    2. **The token's live price reaches the Take Profit (TP) threshold**.

- **Services & APIs Used:**
  - **Helius WebSockets API**:
    - Detects when the target wallet sells a token.
  - **Helius RPC API**:
    - Fetches updated transaction data to verify the swap.
  - **Jupiter Quote API (`https://quote-api.jup.ag/v6`)**:
    - Monitors token prices in real-time.
    - Determines when TP price is hit.
  - **Solana JSON-RPC (via Helius API)**:
    - Executes sell transactions on Raydium or Jupiter.

- **Trade Execution Mechanism:**
  - When a sell trigger occurs (either target wallet sell or TP reached), the bot:
    1. Queries **Jupiter Quote API** for the latest price.
    2. Uses **Solana JSON-RPC API** to execute a market sell order.
    3. Stops monitoring the token once it is fully sold.

---

### **4. Real-Time Token Price Monitoring**
- **How it Works:** 
  - Once the bot has copy-traded a buy, it **continuously monitors the live price** of that token.
  - If the price exceeds the **Take Profit (TP) threshold**, the bot **sells 100% of the holding**.

- **Services & APIs Used:**
  - **Jupiter Quote API (`https://quote-api.jup.ag/v6`)**:
    - Fetches real-time token price data.
    - Helps determine when the TP threshold is reached.
  - **Helius RPC API**:
    - Verifies token balances after trades.

- **Price Monitoring Mechanism:**
  - The bot **polls Jupiter Quote API** for updated token prices.
  - If the price **hits the TP threshold**, it **executes a sell order** via Solana JSON-RPC API.

---

### **Summary of APIs & External Services Used**
| Function | Service Used | API/Endpoint |
|----------|-------------|--------------|
| **Target Wallet Swap Detection** | Helius WebSockets | `wss://rpc.helius.dev/v0/stream` |
| **Fetching Full Transaction Details** | Helius RPC API | `https://mainnet.helius-rpc.com` |
| **Fetching Real-Time Token Prices** | Jupiter Quote API | `https://quote-api.jup.ag/v6` |
| **Executing Buy/Sell Trades** | Solana JSON-RPC API (via Helius) | `https://mainnet.helius-rpc.com` |
| **Trading on Raydium/Jupiter** | Raydium/Jupiter Smart Contracts | Directly via JSON-RPC |

---

### **Final Notes**
- **The bot does NOT use Helius to execute trades.** Instead, it interacts **directly with Raydium and Jupiter smart contracts via Solana JSON-RPC**.
- **Helius WebSockets + RPC API work together**: WebSockets provide **instant notifications**, but **extra details** must be fetched via RPC.
- **Jupiter Quote API is used for price monitoring**, but **trades are executed directly on Solana**.

---

## License

This project is licensed under the **MIT License**. See `LICENSE` for details.
