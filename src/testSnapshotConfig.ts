import { PublicKey } from '@solana/web3.js';
import { HeliusNFTService } from './services/heliusNFTService';
import { SnapshotConfigService } from './services/snapshotConfigService';
import { SnapshotConfig } from './types';
import { config } from './config';

/**
 * Test Snapshot Configuration System
 * 
 * This tests the snapshot processing without actually uploading to blockchain
 * 
 * Usage:
 * ts-node src/testSnapshotConfig.ts
 */

async function main() {
  console.log('🧪 Testing Snapshot Configuration System\n');
  console.log('='.repeat(60));

  // Initialize services
  const heliusService = new HeliusNFTService(config.heliusApiKey, 'devnet');
  const snapshotConfigService = new SnapshotConfigService(heliusService);

  // Test configuration with multiple collections and allocation types
  const testConfig: SnapshotConfig = {
    poolSize: 10_000_000, // 10M tokens (increased for multiple rules)
    cycleStartTime: Math.floor(Date.now() / 1000),
    cycleDuration: 365 * 24 * 60 * 60, // 1 year
    rules: [
      // Rule 1: Percentage allocation (50% of pool)
      {
        id: '1',
        name: 'OG Holders (Percentage)',
        nftContract: config.nftCollectionAddress?.toBase58() || 'REPLACE_WITH_REAL_ADDRESS',
        threshold: 1,
        allocationType: 'PERCENTAGE',
        allocationValue: 50, // 50% of pool = 5M tokens
        enabled: true,
      },
      // Rule 2: Fixed allocation (same collection, different threshold)
      {
        id: '2',
        name: 'OG Whales (Fixed)',
        nftContract: config.nftCollectionAddress?.toBase58() || 'REPLACE_WITH_REAL_ADDRESS',
        threshold: 10, // Must have 10+ NFTs
        allocationType: 'FIXED',
        allocationValue: 100000, // 100k tokens per NFT
        enabled: true,
      },
      // Rule 3: Lower threshold percentage
      {
        id: '3',
        name: 'All Holders (Small %)',
        nftContract: config.nftCollectionAddress?.toBase58() || 'REPLACE_WITH_REAL_ADDRESS',
        threshold: 1,
        allocationType: 'PERCENTAGE',
        allocationValue: 20, // 20% of pool = 2M tokens
        enabled: true,
      },
      // Rule 4: Bonus for high holders (fixed)
      {
        id: '4',
        name: 'Bonus Tier (5+ NFTs)',
        nftContract: config.nftCollectionAddress?.toBase58() || 'REPLACE_WITH_REAL_ADDRESS',
        threshold: 5,
        allocationType: 'FIXED',
        allocationValue: 50000, // 50k bonus per NFT
        enabled: true,
      },
    ],
  };

  console.log('\n📋 Configuration:');
  console.log(`Pool Size: ${testConfig.poolSize.toLocaleString()} tokens`);
  console.log(`Enabled Rules: ${testConfig.rules.filter(r => r.enabled).length}`);
  console.log('='.repeat(60));

  try {
    // Test 1: Preview individual rules
    console.log('\n📊 Test 1: Previewing Individual Rules\n');
    
    for (const rule of testConfig.rules.filter(r => r.enabled)) {
      console.log(`\nRule: ${rule.name}`);
      console.log(`  Contract: ${rule.nftContract}`);
      console.log(`  Threshold: ${rule.threshold} NFTs`);
      console.log(`  Type: ${rule.allocationType}`);
      console.log(`  Value: ${rule.allocationValue}${rule.allocationType === 'PERCENTAGE' ? '%' : ' tokens'}`);
      
      try {
        const preview = await snapshotConfigService.calculateRulePreview(
          rule,
          testConfig.poolSize
        );
        
        console.log(`  ✅ Results:`);
        console.log(`     - Eligible Wallets: ${preview.eligibleWallets}`);
        console.log(`     - Total NFTs: ${preview.totalNfts}`);
        console.log(`     - Estimated Allocation: ${preview.estimatedAllocation.toLocaleString()} tokens`);
      } catch (error) {
        console.log(`  ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Test 2: Calculate overall summary
    console.log('\n\n📊 Test 2: Calculating Overall Summary\n');
    console.log('Processing all rules...');
    
    const summary = await snapshotConfigService.calculateSnapshotSummary(
      testConfig,
      (current, total) => {
        console.log(`  Progress: ${current}/${total} collections processed`);
      }
    );

    console.log('\n✅ Summary Results:');
    console.log(`  Total Unique Wallets: ${summary.totalWallets}`);
    console.log(`  Total Allocated: ${summary.totalAllocated.toLocaleString()} tokens`);
    console.log(`  Pool Utilization: ${((summary.totalAllocated / testConfig.poolSize) * 100).toFixed(2)}%`);
    
    console.log('\n  Breakdown by Collection:');
    summary.breakdown.forEach((item) => {
      console.log(`    ${item.name}:`);
      console.log(`      - Wallets: ${item.wallets}`);
      console.log(`      - Allocation: ${item.amount.toLocaleString()} tokens`);
    });

    // Test 3: Process full snapshot
    console.log('\n\n📊 Test 3: Processing Full Snapshot\n');
    console.log('Calculating all allocations...');
    
    const result = await snapshotConfigService.processSnapshotRules(
      testConfig,
      (status) => console.log(`  ${status}`)
    );

    console.log('\n✅ Processing Results:');
    console.log(`  Total Wallets: ${result.totalWallets}`);
    console.log(`  Total Allocated: ${result.totalAllocated.toLocaleString()} tokens`);
    
    console.log('\n  Breakdown by Rule:');
    result.breakdown.forEach((item) => {
      console.log(`    ${item.ruleName}:`);
      console.log(`      - Eligible Wallets: ${item.eligibleWallets}`);
      console.log(`      - Total NFTs: ${item.totalNfts}`);
      console.log(`      - Allocation: ${item.allocation.toLocaleString()} tokens`);
    });

    // Show sample allocations
    console.log('\n  Sample Allocations (first 5):');
    result.allocations.slice(0, 5).forEach((allocation, i) => {
      console.log(`    ${i + 1}. ${allocation.address}`);
      console.log(`       Amount: ${allocation.amount.toLocaleString()} tokens`);
      console.log(`       Sources:`);
      allocation.sources.forEach((source) => {
        console.log(`         - ${source.ruleName}: ${source.amount.toLocaleString()} tokens`);
      });
    });

    if (result.allocations.length > 5) {
      console.log(`    ... and ${result.allocations.length - 5} more wallets`);
    }

    // Show errors if any
    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      result.errors.forEach((error) => {
        console.log(`  - ${error}`);
      });
    }

    // Test 4: Batching
    console.log('\n\n📊 Test 4: Testing Batch Allocation\n');
    const batches = snapshotConfigService.batchAllocations(result.allocations, 150);
    console.log(`  Total Allocations: ${result.allocations.length}`);
    console.log(`  Number of Batches: ${batches.length}`);
    console.log(`  Batch Size: 150`);
    console.log(`  Last Batch Size: ${batches[batches.length - 1]?.length || 0}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log('\n✨ Testing complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  });
