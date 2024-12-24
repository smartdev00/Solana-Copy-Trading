## Set Config file

In the config.ts file

TARGET_WALLET_ADDRESS = new PublicKey('Your target wallet address'); 
RAYDIUM_LIQUIDITYPOOL_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');  (static variable)
SOL_ADDRESS = new PublicKey('So11111111111111111111111111111111111111112');  (static variable)
WALLET = Keypair.fromSecretKey(bs58.decode("Private key of your trading wallet"));
TRADE_AMOUNT = Amount for buying per tokens (10000000 = 0.01 SOL)
COMPUTE_PRICE = 100000; (static variable)
LIMIT_ORDER = 1.25; (You don't need to set this because it follows target wallet sell action)
SLIPPAGE = Input slipage (Default value is 5);

## Available Scripts

In the project directory, you can run:
### `npm run build`

### `npm start`
