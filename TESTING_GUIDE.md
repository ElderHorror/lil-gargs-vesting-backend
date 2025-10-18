# Testing the Snapshot Configuration System

## Quick Test

Run the test script to verify the snapshot system works:

```bash
npm run snapshot:test
```

This will:
1. ✅ Query your NFT collection via Helius
2. ✅ Calculate allocations based on rules
3. ✅ Show preview statistics
4. ✅ Generate batch allocations
5. ✅ **NOT upload to blockchain** (safe to run)

## What You'll See

### Test 1: Preview Individual Rules
- Shows eligible wallets per collection
- Total NFTs held
- Estimated allocation

### Test 2: Overall Summary
- Total unique wallets across all collections
- Total tokens allocated
- Pool utilization percentage
- Breakdown by collection

### Test 3: Full Snapshot Processing
- Detailed allocation calculations
- Shows first 5 wallet allocations
- Lists sources (which NFT collections contributed)

### Test 4: Batching
- Shows how allocations are split into batches of 150
- Ready for blockchain upload

## Expected Output

```
🧪 Testing Snapshot Configuration System
============================================================

📋 Configuration:
Pool Size: 5,000,000 tokens
Enabled Rules: 1
============================================================

📊 Test 1: Previewing Individual Rules

Rule: OG Holders
  Contract: 83sizftJAr24WF4Ji4c8qZdboiE6anNx4mUrVGQ8WhpF
  Threshold: 1 NFTs
  Type: PERCENTAGE
  Value: 50%
  ✅ Results:
     - Eligible Wallets: 150
     - Total NFTs: 300
     - Estimated Allocation: 2,500,000 tokens

📊 Test 2: Calculating Overall Summary
...
```

## Customizing the Test

Edit `src/testSnapshotConfig.ts` to add more rules:

```typescript
const testConfig: SnapshotConfig = {
  poolSize: 5_000_000,
  cycleStartTime: Math.floor(Date.now() / 1000),
  cycleDuration: 365 * 24 * 60 * 60,
  rules: [
    {
      id: '1',
      name: 'OG Holders',
      nftContract: '83sizftJAr24WF4Ji4c8qZdboiE6anNx4mUrVGQ8WhpF',
      threshold: 1,
      allocationType: 'PERCENTAGE',
      allocationValue: 50,
      enabled: true,
    },
    // Add more rules here
    {
      id: '2',
      name: 'Fused OGs',
      nftContract: 'YOUR_FUSED_COLLECTION_ADDRESS',
      threshold: 1,
      allocationType: 'PERCENTAGE',
      allocationValue: 25,
      enabled: true,
    },
  ],
};
```

## Testing the API Server

### 1. Start the API server:
```bash
npm run api:server
```

### 2. Test endpoints with curl:

**Get holders:**
```bash
curl -X POST http://localhost:3001/api/snapshot/holders \
  -H "Content-Type: application/json" \
  -d '{"contractAddress":"83sizftJAr24WF4Ji4c8qZdboiE6anNx4mUrVGQ8WhpF"}'
```

**Preview rule:**
```bash
curl -X POST http://localhost:3001/api/snapshot/preview-rule \
  -H "Content-Type: application/json" \
  -d '{
    "rule": {
      "id": "1",
      "name": "OG Holders",
      "nftContract": "83sizftJAr24WF4Ji4c8qZdboiE6anNx4mUrVGQ8WhpF",
      "threshold": 1,
      "allocationType": "PERCENTAGE",
      "allocationValue": 50,
      "enabled": true
    },
    "poolSize": 5000000
  }'
```

## Testing the Admin Console

### 1. Start the API server (in one terminal):
```bash
cd vesting
npm run api:server
```

### 2. Start the admin console (in another terminal):
```bash
cd admin-console
npm run dev
```

### 3. Open browser:
```
http://localhost:3000/admin
```

### 4. Test the UI:
1. Scroll to "Snapshot Configuration" panel
2. Set pool size (e.g., 5,000,000)
3. Click "Add Collection"
4. Enter your NFT contract: `83sizftJAr24WF4Ji4c8qZdboiE6anNx4mUrVGQ8WhpF`
5. Set threshold: 1
6. Choose allocation type
7. Watch the preview load automatically
8. Click "Calculate Summary" to see totals

## Troubleshooting

### Error: "HELIUS_API_KEY not set"
- Check `.env` file has `HELIUS_API_KEY=...`
- Restart the script after adding it

### Error: "Cannot find module 'express'"
```bash
npm install express cors @types/express @types/cors
```

### Error: "API error: 500"
- Check API server is running (`npm run api:server`)
- Check console logs for errors
- Verify NFT contract address is valid

### No holders found
- Verify the NFT collection address is correct
- Check if collection exists on devnet (your .env uses devnet)
- Try with a known collection that has holders

## Next Steps

Once testing passes:
1. ✅ Verify allocations look correct
2. ✅ Test with multiple collections
3. ✅ Test both FIXED and PERCENTAGE types
4. ✅ Run `npm run snapshot:config` to actually upload to blockchain
