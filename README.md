# NFT-Gated Token Vesting System

A production-ready Solana vesting system that distributes custom tokens to NFT holders using Streamflow Protocol.

## ✨ Features

- **NFT-Based Eligibility**: Automatically detect NFT holders via Helius API
- **Streamflow Integration**: Secure on-chain vesting with Streamflow Protocol
- **Dual Modes**: Snapshot (one-time) or Dynamic (continuous sync)
- **Multi-Collection Support**: Support multiple NFT collections with tier-based allocations
- **Claim Verification**: Optional NFT verification at claim time
- **Grace Period**: Allow claims after vesting ends
- **Automated Reclaim**: Recover unclaimed tokens after grace period
- **Cost Efficient**: ~0.002 SOL per vesting (mostly recoverable)

## 📋 Prerequisites

- Node.js 18+
- Solana wallet with SOL for transactions
- Helius API key (for NFT detection)
- Supabase account (for database)
- Custom SPL token mint

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and fill in:
```bash
# Solana
RPC_ENDPOINT=https://api.mainnet-beta.solana.com
ADMIN_PRIVATE_KEY=your_private_key_base58

# Token
CUSTOM_TOKEN_MINT=your_token_mint_address

# NFT Collection
NFT_COLLECTION_ADDRESS=your_collection_address
NFT_THRESHOLD=1

# APIs
HELIUS_API_KEY=your_helius_api_key

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Fees
CLAIM_FEE_SOL=0.01
FEE_WALLET=your_fee_wallet_address

# Vesting
VESTING_DURATION_DAYS=365
```

### 3. Set Up Database
See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for detailed instructions.

### 4. Choose Your Mode

**Snapshot Mode** (One-time allocation):
```bash
npm run snapshot
```

**Dynamic Mode** (Continuous sync):
```bash
npm run sync:daemon
```

## 📚 Documentation

- [Installation Guide](./INSTALLATION.md) - Detailed setup instructions
- [Supabase Setup](./SUPABASE_SETUP.md) - Database configuration
- [Usage Guide](./USAGE.md) - How to use the system
- [Security Guide](./SECURITY.md) - Best practices
- [Dynamic Vesting](./DYNAMIC_VESTING.md) - Dynamic mode details

## 🛠️ Available Commands

```bash
# Production
npm run build              # Build TypeScript
npm start                  # Start production server

# Development
npm run dev                # Start development server

# Snapshot Mode
npm run snapshot           # Take snapshot and create vestings

# Dynamic Mode
npm run sync:daemon        # Run continuous sync daemon
npm run sync:once          # Run single sync

# Maintenance
npm run reclaim:expired    # Reclaim expired vestings
npm run reclaim:preview    # Preview reclaimable vestings

# Mode Management
npm run mode:snapshot      # Switch to snapshot mode
npm run mode:dynamic       # Switch to dynamic mode
npm run mode:status        # Check current mode
```

## 💰 Cost Analysis

**Per User Costs (Mainnet):**
- Create vesting: 0.002005 SOL (~0.002 SOL recoverable)
- User claims: 0.000005 SOL
- Reclaim: 0.000005 SOL

**For 100 Users:**
- Total cost: ~0.2 SOL
- Recoverable: ~0.2 SOL
- Net cost: ~0.0005 SOL

## 🏗️ Architecture

```
src/
├── config.ts              # Configuration
├── types.ts               # TypeScript types
├── index.ts               # Main entry point
├── services/
│   ├── heliusNFTService.ts    # NFT detection
│   ├── vestingService.ts      # Vesting operations
│   └── supabaseService.ts     # Database operations
├── takeSnapshot.ts        # Snapshot mode
├── syncEligibility.ts     # Dynamic sync (single)
├── syncDaemon.ts          # Dynamic sync (daemon)
├── reclaimExpired.ts      # Reclaim expired tokens
├── switchMode.ts          # Mode management
└── batchCreate.ts         # Batch operations
```

## 🔒 Security

- Never commit `.env` file
- Use service role key only on backend
- Validate all user inputs
- Monitor claim transactions
- Set up alerts for unusual activity

See [SECURITY.md](./SECURITY.md) for detailed security practices.

## 📊 Monitoring

Track key metrics:
- Total vestings created
- Claims processed
- Tokens distributed
- Failed transactions
- Unclaimed tokens

## 🤝 Support

For issues or questions:
1. Check documentation
2. Review error logs
3. Check Supabase logs
4. Verify RPC endpoint status

## 📄 License

MIT
