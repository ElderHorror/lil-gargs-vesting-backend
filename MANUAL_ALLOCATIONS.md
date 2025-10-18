# Manual Allocations Guide

For vesting pools **without NFT requirements** (airdrops, team allocations, investor vestings), you need to manually add users to the pool.

---

## 🎯 When to Use Manual Allocations

Use manual allocations for:
- **Team vestings** - Allocate tokens to team members
- **Investor vestings** - Allocate tokens to investors
- **Airdrops** - Distribute tokens to specific wallets
- **Partnerships** - Allocate tokens to partners
- **Any pool without NFT gating**

---

## 🚀 Quick Start

### 1. Create Pool Without NFT Rules

When creating a pool in the admin dashboard:
- Leave the "NFT Requirements" section empty
- Or set `nft_requirements: []` in the database

### 2. Add Users via Script

Edit `scripts/addManualAllocations.ts`:

```typescript
const POOL_ID = 'your-pool-id-here'; // Get from vesting_streams table

const ALLOCATIONS: ManualAllocation[] = [
  { wallet: 'FiKEWEJfcyd49MNwLvxnkzZbRJ2tm11zFUkZu11yFAud', amount: 10000, tier: 1 },
  { wallet: 'AnotherWallet123...', amount: 5000, tier: 2 },
  { wallet: 'ThirdWallet456...', amount: 2500, tier: 3 },
];
```

### 3. Run the Script

```bash
npm run allocations:manual
```

---

## 📋 Step-by-Step Guide

### Step 1: Get Pool ID

Find your pool ID from the `vesting_streams` table:

```sql
SELECT id, name, total_pool_amount, vesting_mode 
FROM vesting_streams 
WHERE name = 'Your Pool Name';
```

### Step 2: Prepare Allocation List

Create a list of wallets and amounts:

```typescript
const ALLOCATIONS = [
  { 
    wallet: 'wallet_address_1', 
    amount: 10000,  // Token amount (in whole tokens, not base units)
    tier: 1,        // Optional: tier level
    nftCount: 0     // Optional: NFT count (for display)
  },
  // Add more...
];
```

### Step 3: Verify Total Amount

Ensure total allocations don't exceed pool amount:

```typescript
const totalAllocated = ALLOCATIONS.reduce((sum, a) => sum + a.amount, 0);
// Must be <= pool.total_pool_amount
```

### Step 4: Run Script

```bash
cd backend
npm run allocations:manual
```

**Output:**
```
🚀 Adding manual allocations to pool: pool-123
📊 Total allocations: 3
💰 Total tokens: 17500

✅ Pool found: Team Vesting
   Mode: snapshot
   Total pool amount: 100000

✅ Added FiKEWEJfcyd49MNwLvxnkzZbRJ2tm11zFUkZu11yFAud - 10000 tokens
✅ Added AnotherWallet123... - 5000 tokens
✅ Added ThirdWallet456... - 2500 tokens

📊 Summary:
   ✅ Success: 3
   ❌ Errors: 0
   ⏭️  Skipped: 0
```

---

## 🔧 Alternative: Direct SQL Insert

You can also add allocations directly via SQL:

```sql
INSERT INTO vestings (
  vesting_stream_id,
  user_wallet,
  token_amount,
  share_percentage,
  tier,
  nft_count,
  is_active,
  is_cancelled
) VALUES 
  (
    'pool-id-here',
    'wallet_address_1',
    10000,
    10.0,  -- (10000 / 100000) * 100 = 10%
    1,
    0,
    true,
    false
  ),
  (
    'pool-id-here',
    'wallet_address_2',
    5000,
    5.0,
    2,
    0,
    true,
    false
  );
```

---

## ⚠️ Important Notes

### 1. No Automatic Sync
- Manual allocations are **static**
- They won't update automatically
- To change allocations, update the `vestings` table directly

### 2. Snapshot Mode
- For snapshot pools, add allocations **before** start time
- Snapshot scheduler will skip pools without NFT requirements
- The pool will be marked as `snapshot_taken: true`

### 3. Dynamic Mode
- Dynamic sync will skip pools without NFT requirements
- Users are added once and don't change
- Essentially behaves like snapshot mode

### 4. Claims Work Normally
- Users can claim tokens normally
- No NFT validation happens during claims
- All other vesting logic applies (cliff, duration, etc.)

---

## 📊 Example Use Cases

### Team Vesting
```typescript
const ALLOCATIONS = [
  { wallet: 'founder1...', amount: 50000, tier: 1 },
  { wallet: 'founder2...', amount: 50000, tier: 1 },
  { wallet: 'dev1...', amount: 10000, tier: 2 },
  { wallet: 'dev2...', amount: 10000, tier: 2 },
  { wallet: 'marketing...', amount: 5000, tier: 3 },
];
```

### Investor Vesting
```typescript
const ALLOCATIONS = [
  { wallet: 'investor_a...', amount: 100000, tier: 1 },
  { wallet: 'investor_b...', amount: 75000, tier: 2 },
  { wallet: 'investor_c...', amount: 50000, tier: 3 },
];
```

### Airdrop
```typescript
const ALLOCATIONS = [
  { wallet: 'user1...', amount: 100 },
  { wallet: 'user2...', amount: 100 },
  { wallet: 'user3...', amount: 100 },
  // ... hundreds more
];
```

---

## 🔍 Verification

After adding allocations, verify in Supabase:

```sql
-- Check all vestings for a pool
SELECT 
  user_wallet,
  token_amount,
  share_percentage,
  tier,
  is_active
FROM vestings
WHERE vesting_stream_id = 'your-pool-id'
ORDER BY token_amount DESC;

-- Check total allocated
SELECT 
  COUNT(*) as total_users,
  SUM(token_amount) as total_allocated
FROM vestings
WHERE vesting_stream_id = 'your-pool-id';
```

---

## 🚨 Troubleshooting

### "Pool not found"
- Check the pool ID is correct
- Verify pool exists in `vesting_streams` table

### "Total allocations exceed pool amount"
- Reduce allocation amounts
- Or increase `total_pool_amount` in the pool

### "Already exists"
- User already has a vesting in this pool
- Update existing record or skip

### Users can't claim
- Check `is_active = true`
- Check `is_cancelled = false`
- Verify pool start time has passed
- Check if claims are globally enabled (`config.enable_claims`)

---

## 📚 Related Documentation

- `AUDIT_REPORT.md` - System overview
- `SECURITY_CHECKLIST.md` - Security best practices
- `CRON_SETUP.md` - Automated task setup
