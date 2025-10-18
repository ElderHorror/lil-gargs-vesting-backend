# Vesting System Usage Guide

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Required configuration:
- **RPC_ENDPOINT**: Solana RPC endpoint (devnet/mainnet)
- **ADMIN_PRIVATE_KEY**: Admin wallet private key (JSON array or base58 format)
- **CUSTOM_TOKEN_MINT**: Your custom SPL token mint address
- **FEE_WALLET**: Wallet address to receive claim fees

### 3. Get Your Private Key

If you have a Solana CLI keypair, you can use it directly as a JSON array:

```bash
# Your keypair.json file contains an array like [1,2,3,...,64]
# Copy the entire array into .env as:
ADMIN_PRIVATE_KEY='[1,2,3,4,5,...]'
```

Or convert to base58:

```javascript
const fs = require('fs');
const bs58 = require('bs58');

const keypairJson = JSON.parse(fs.readFileSync('path/to/keypair.json'));
const privateKey = bs58.encode(Buffer.from(keypairJson));
console.log(privateKey);
```

## Core Functionality

### Admin: Create Vesting

```typescript
import { VestingService } from './services/vestingService';
import { getConnection, config } from './config';
import { Keypair, PublicKey } from '@solana/web3.js';
import { Types } from '@streamflow/stream';

// Initialize service
const connection = getConnection();
const vestingService = new VestingService(
  connection,
  config.feeWallet,
  config.claimFeeSOL,
  Types.ICluster.Devnet // or Types.ICluster.Mainnet
);

// Define NFT tiers
const nftTiers = [
  { minNFTs: 50, percentage: 100 }, // 50+ NFTs = 100%
  { minNFTs: 20, percentage: 75 },  // 20-49 NFTs = 75%
  { minNFTs: 10, percentage: 50 },  // 10-19 NFTs = 50%
  { minNFTs: 1, percentage: 25 },   // 1-9 NFTs = 25%
];

// Create vesting
const now = Math.floor(Date.now() / 1000);
const vestingConfig = {
  recipient: new PublicKey('USER_WALLET_ADDRESS'),
  startTime: now,
  cliffTime: now + 86400, // 1 day cliff
  endTime: now + 2592000, // 30 days total vesting
  totalAmount: 1000000000, // Amount in smallest units
  nftTiers,
  tokenMint: config.customTokenMint,
};

const vestingData = await vestingService.createVesting(
  adminKeypair,
  vestingConfig
);
```

### User: Check Eligibility

```typescript
// Check if user is eligible and how much they can claim
const { claimable, percentage, eligible } = await vestingService.calculateClaimable(
  vestingData,
  userWallet
);

console.log('Eligible:', eligible);
console.log('NFT Tier:', percentage + '%');
console.log('Claimable:', claimable);
```

### User: Claim Tokens

```typescript
// User claims vested tokens (pays $10 SOL fee)
const claimResult = await vestingService.claimVesting(
  vestingData,
  userKeypair
);

if (claimResult.success) {
  console.log('Claimed:', claimResult.amountClaimed);
  console.log('Fee Paid:', claimResult.feePaid, 'SOL');
  console.log('Transaction:', claimResult.signature);
}
```

## Testing

Run the test script:

```bash
npm run test
```

The test script will:
1. Create a vesting schedule (admin)
2. Check user eligibility based on NFT holdings
3. Calculate claimable amount
4. Attempt to claim tokens (with fee)

## Important Notes

### Token Decimals
The code assumes 9 decimals for tokens. Adjust in `vestingService.ts` if your token has different decimals:

```typescript
amount: getBN(config.totalAmount, YOUR_DECIMALS)
```

### Fee Amount
The claim fee is set in `.env` as `claimFeeSOL`. Adjust based on current SOL price to maintain ~$10 equivalent:

```
# If SOL = $100, then 0.1 SOL = $10
claimFeeSOL=0.1
```

### NFT Verification
The system counts **all NFTs** (any collection) owned by a wallet. An NFT is defined as a token with:
- Decimals = 0
- Amount = 1

### Vesting Schedule
- **Start Time**: When vesting begins
- **Cliff Time**: No tokens available until this time
- **End Time**: All tokens fully vested by this time
- Linear vesting occurs between cliff and end time

### NFT Tiers
Users are assigned to the highest tier they qualify for. Example:
- User with 25 NFTs → 75% tier
- User with 5 NFTs → 25% tier
- User with 0 NFTs → Not eligible

## Troubleshooting

### "User does not meet NFT requirements"
- Check that the user wallet holds NFTs (any collection)
- Verify the wallet has at least the minimum NFT count for the lowest tier
- NFTs are counted as tokens with decimals=0 and amount=1

### "No tokens available to claim yet"
- Check that cliff time has passed
- Verify current time is between cliff and end time
- Ensure vesting schedule is set correctly

### "Insufficient SOL for fee"
- User needs at least `claimFeeSOL + 0.01` SOL in wallet
- Fund the user wallet with SOL

### Streamflow Errors
- Ensure admin wallet has enough custom tokens to fund the vesting
- Check that token mint address is correct
- Verify RPC endpoint is working
