# Database & Streamflow Cleanup Guide

This guide explains how to clean up pre-existing pools and reclaim rent from Streamflow streams.

## Overview

Your vesting system has two layers:
1. **Database Layer** - Stores pool configurations, user vestings, and claim history in Supabase
2. **Streamflow Layer** - Optional on-chain vesting streams that hold tokens and manage vesting schedules

When cleaning up, you need to handle both layers separately.

---

## 🗑️ Database Cleanup

### What Gets Deleted
- All vesting pools (`vesting_streams`)
- All user vestings (`vestings`)
- All claim history (`claim_history`)
- All eligibility checks
- All sync logs
- All claim attempts
- All admin logs

### What Stays
- Global config (`config` table)
- Streamflow streams (must be cancelled separately)

### Usage

#### Interactive Mode (Recommended)
```bash
npx ts-node scripts/clearDatabase.ts
```
You'll be prompted to type "DELETE ALL" to confirm.

#### Auto-Confirm Mode
```bash
npx ts-node scripts/clearDatabase.ts --confirm
```
Skips confirmation prompt (use with caution).

### Example Output
```
🗑️  Database Cleanup Script

This will DELETE:
  - All vesting pools (vesting_streams)
  - All user vestings (vestings)
  - All claim history (claim_history)
  ...

⚠️  WARNING: This action CANNOT be undone!

Type "DELETE ALL" to confirm: DELETE ALL

📊 Current database state:
  - Pools: 5
  - Vestings: 150
  - Claims: 42

🗑️  Starting deletion...
  ✓ Claim attempts deleted
  ✓ Claim history deleted
  ✓ Vestings deleted
  ✓ Vesting streams deleted
  ...

✅ Database cleanup complete!
```

---

## 💰 Streamflow Rent Reclaim

### What Happens
- **For completed streams**: Withdraws all vested tokens first, then cancels to reclaim rent
- **For active streams**: Cancels immediately, returning unvested tokens + rent to treasury
- **Rent reclaimed**: ~0.01266 SOL per stream returned to your treasury wallet

### Usage

#### Cancel All Streams (Interactive)
```bash
npx ts-node scripts/reclaimStreamflowRent.ts
```
Lists all streams and prompts for confirmation.

#### Cancel All Streams (Auto-Confirm)
```bash
npx ts-node scripts/reclaimStreamflowRent.ts --all
```
Cancels all streams without confirmation.

#### Cancel Specific Stream
```bash
npx ts-node scripts/reclaimStreamflowRent.ts <stream_id>
```
Example:
```bash
npx ts-node scripts/reclaimStreamflowRent.ts 5ybZBZFsyQPvHkxy8FVxaVqj9FvP8xGvN2Kj7Lm3Qwer
```

### Example Output
```
💰 Streamflow Rent Reclaim Tool

🔑 Admin wallet: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

🔍 Fetching all pools with Streamflow streams...

  Checking Genesis Pool (5ybZBZFsyQPvHkxy8FVxaVqj9FvP8xGvN2Kj7Lm3Qwer)...
    ✓ Status: Completed
    ✓ Remaining: 0 tokens

📋 Found 1 stream(s):

1. Genesis Pool
   Stream ID: 5ybZBZFsyQPvHkxy8FVxaVqj9FvP8xGvN2Kj7Lm3Qwer
   Status: Completed
   Remaining: 0 tokens

Cancel ALL streams? Type "YES" to confirm: YES

🔄 Starting cancellation process...

[1/1] Processing Genesis Pool...

🔄 Canceling stream: 5ybZBZFsyQPvHkxy8FVxaVqj9FvP8xGvN2Kj7Lm3Qwer
  ✓ Withdrew all vested tokens
  ✓ Stream cancelled! Signature: 3nZ8...
  ✓ Rent and unvested tokens returned to treasury
  ✓ Updated pool state to "cancelled"
  ✓ Marked associated vestings as cancelled

============================================================
📊 Summary:
  ✅ Successfully cancelled: 1
  ❌ Failed: 0
  📝 Total processed: 1
============================================================

💰 Rent and unvested tokens have been returned to your treasury wallet
   Treasury: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
```

---

## 🔄 Complete Cleanup Process

To fully clean up your vesting system:

### Step 1: Reclaim Streamflow Rent (Optional but Recommended)
```bash
npx ts-node scripts/reclaimStreamflowRent.ts
```
This returns rent (~0.01266 SOL per stream) and unvested tokens to your treasury.

### Step 2: Clear Database
```bash
npx ts-node scripts/clearDatabase.ts
```
This removes all pool and vesting data from Supabase.

### Step 3: Verify Cleanup
Check your database:
```sql
SELECT COUNT(*) FROM vesting_streams;  -- Should be 0
SELECT COUNT(*) FROM vestings;         -- Should be 0
SELECT COUNT(*) FROM claim_history;    -- Should be 0
```

Check your treasury wallet for returned SOL and tokens.

---

## ⚠️ Important Notes

### Database Cleanup
- **Irreversible**: Once deleted, data cannot be recovered
- **Foreign Keys**: Script deletes in correct order to respect constraints
- **Config Preserved**: Global config table is NOT modified
- **No Streamflow Action**: Database cleanup does NOT cancel Streamflow streams

### Streamflow Rent Reclaim
- **Rent Amount**: ~0.01266 SOL per stream (Streamflow protocol fee)
- **Unvested Tokens**: Returned to treasury if stream is cancelled early
- **Vested Tokens**: Automatically withdrawn for completed streams before cancellation
- **Database Update**: Script automatically updates pool state to "cancelled"
- **Rate Limiting**: Script waits 2 seconds between cancellations to avoid RPC rate limits

### Order Matters
1. **Reclaim rent FIRST** if you want to recover SOL and tokens
2. **Clear database SECOND** to remove records

If you clear the database first, you'll lose the `streamflow_stream_id` references and won't be able to easily cancel streams (you'd need to find stream IDs manually).

---

## 🛡️ Safety Features

Both scripts include:
- ✅ Confirmation prompts (unless using auto-confirm flags)
- ✅ Current state display before deletion
- ✅ Detailed progress logging
- ✅ Error handling with clear messages
- ✅ Summary reports

---

## 🔍 Troubleshooting

### "Failed to cancel stream"
- Stream may already be cancelled
- RPC endpoint may be rate-limited (wait and retry)
- Admin keypair may not have authority

### "Database error"
- Check Supabase connection in `.env`
- Verify service role key has proper permissions
- Check for active connections/locks

### "No streams found"
- All pools may already be cancelled
- Pools may not have `streamflow_stream_id` set (database-only pools)

---

## 📝 After Cleanup

After cleanup, you can:
1. Create new pools with fresh configurations
2. Re-sync user eligibility
3. Start a new vesting season

Your global config and admin settings remain intact.
