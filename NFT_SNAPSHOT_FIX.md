# NFT Snapshot Issue - Missing Wallet Fix

## Issue Description
A wallet that owns NFTs from the collection was not included in the snapshot results.

## Root Cause Analysis

### **CRITICAL**: Pagination Limit Bug

The most critical issue was in `countNFTsFromCollections()` and `countAllNFTs()` methods - **they only fetched the first 1000 NFTs** and didn't paginate through all results. This meant:

- If a wallet had more than 1000 NFTs, only the first 1000 were checked
- If the target collection NFTs were beyond the first 1000, the wallet would be excluded from the snapshot
- This affected wallets with large NFT portfolios

### Problem in `HeliusNFTService.getAllHolders()`

The original code only checked for `asset.ownership?.owner` when grouping NFT holders:

```typescript
const owner = asset.ownership?.owner;
if (owner) {
  holderMap.set(owner, (holderMap.get(owner) || 0) + 1);
}
```

**Issue**: If Helius API returns assets with different ownership structures (e.g., `asset.owner` or `asset.ownerAddress` instead of `asset.ownership.owner`), those wallets would be **silently skipped** from the snapshot.

### Why This Happens

Helius DAS API can return different response structures depending on:
- NFT standard (Token-2022 vs legacy SPL tokens)
- Metadata version
- API version changes
- Collection verification status

## Fixes Applied

### 1. **CRITICAL FIX**: Added Pagination to NFT Counting Methods

Both `countNFTsFromCollections()` and `countAllNFTs()` now paginate through **ALL** NFTs owned by a wallet:

```typescript
// Fetch ALL pages of NFTs for this wallet
let page = 1;
let allNfts: any[] = [];
let hasMore = true;

while (hasMore) {
  const response = await this.retryWithBackoff(async () => {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `nft-by-owner-page-${page}`,
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: wallet.toBase58(),
          page: page,
          limit: 1000,
        },
      }),
    });
  }, 3, 2000);

  const data = await response.json();
  const nfts = data.result?.items || [];
  
  if (nfts.length === 0 || nfts.length < 1000) {
    hasMore = false;
  } else {
    allNfts = allNfts.concat(nfts);
    page++;
  }
}

console.log(`📊 Fetched ${allNfts.length} total NFTs for wallet`);
```

**Impact**: Wallets with 1000+ NFTs will now have ALL their NFTs checked, not just the first 1000.

### 2. Multiple Ownership Structure Fallbacks

Updated the ownership detection to try multiple possible structures:

```typescript
const owner = asset.ownership?.owner || asset.owner || asset.ownerAddress;
```

This ensures wallets are captured regardless of which structure Helius returns.

### 3. Added Logging for Skipped Assets

```typescript
let skippedAssets = 0;

if (owner) {
  holderMap.set(owner, (holderMap.get(owner) || 0) + 1);
} else {
  skippedAssets++;
  // Log first 3 skipped assets for debugging
  if (skippedAssets <= 3) {
    console.warn('⚠️ Skipped asset with missing owner:', {
      id: asset.id,
      ownership: asset.ownership,
      owner: asset.owner,
      ownerAddress: asset.ownerAddress,
    });
  }
}
```

Now you'll see warnings if assets are being skipped, making it easier to diagnose issues.

### 4. Enhanced Debugging Output

Added detailed logging to help identify issues:

- **Sample asset structure** on first page to see what Helius is returning
- **Page-by-page progress** showing how many assets are fetched
- **Per-wallet NFT counts** when checking eligibility
- **Final summary** showing total assets, unique holders, and skipped count

Example output:
```
🔍 Sample asset structure: { id: '...', ownership: {...}, hasOwnership: true, ... }
📄 Page 1: Fetched 1000 assets (total: 1000)
📄 Page 2: Fetched 847 assets (total: 1847)
📊 Fetched 2847 total NFTs for wallet 5Qx7B3...
✅ Fetched 1847 NFTs from collection (234 unique holders, 0 skipped)
```

## Testing the Fix

### 1. Run a New Snapshot

1. Go to Admin Console → Create Pool
2. Configure your snapshot rules
3. Click "Process Snapshot"
4. Check the backend logs for:
   - Sample asset structure
   - Any skipped asset warnings
   - Final holder count

### 2. Verify the Missing Wallet

After running the snapshot, check if the previously missing wallet now appears in:
- The snapshot preview results
- The final allocations list
- The committed vesting records

### 3. Check Logs for Warnings

Look for these log messages:
- `⚠️ Skipped asset with missing owner:` - Shows which assets couldn't be processed
- `⚠️ Warning: Skipped X assets with missing ownership data` - Summary of skipped assets
- `🔍 Sample asset structure:` - Shows what structure Helius is returning

## If the Issue Persists

If the wallet is still missing after this fix, check:

1. **Wallet actually owns the NFT**: Verify on Solscan/Explorer
2. **Correct collection address**: Ensure you're using the right collection mint
3. **Threshold settings**: Check if the wallet meets the minimum NFT threshold
4. **Helius API response**: Look at the sample asset structure in logs

## Files Changed

- `backend/src/services/heliusNFTService.ts`
  - **Lines 105-147**: `getAllHolders()` - Added fallback ownership checks, skipped asset tracking, enhanced logging
  - **Lines 164-237**: `countNFTsFromCollections()` - **CRITICAL FIX**: Added pagination to fetch ALL NFTs (was only fetching first 1000)
  - **Lines 242-297**: `countAllNFTs()` - **CRITICAL FIX**: Added pagination to fetch ALL NFTs (was only fetching first 1000)

## Next Steps

1. Deploy the updated backend
2. Run a new snapshot for the affected pool
3. Monitor logs for any warnings
4. Verify all expected wallets are included
5. If issues persist, share the log output showing:
   - Sample asset structure
   - Any skipped asset warnings
   - The specific wallet address that's missing
