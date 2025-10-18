import { Keypair, Connection } from '@solana/web3.js';
import { UnifiedVestingPoolService } from './services/unifiedVestingPoolService';
import { VestingService } from './services/vestingService';
import { SupabaseService } from './services/supabaseService';
import { HeliusNFTService } from './services/heliusNFTService';
import { SnapshotConfig } from './types';
import { config, getConnection } from './config';

/**
 * Process snapshot configuration with multiple NFT collections
 * 
 * Usage:
 * ts-node src/processSnapshotConfig.ts
 */

async function main() {
  console.log('🚀 Unified Vesting Pool - Snapshot Configuration Processor\n');

  // Initialize services
  const connection = getConnection();
  const adminKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(config.adminPrivateKey))
  );

  const dbService = new SupabaseService(
    config.supabaseUrl,
    config.supabaseServiceRoleKey
  );

  const vestingService = new VestingService(connection);
  const heliusService = new HeliusNFTService(config.heliusApiKey, 'devnet');

  const poolService = new UnifiedVestingPoolService(
    connection,
    vestingService,
    dbService,
    heliusService,
    adminKeypair
  );

  // Example snapshot configuration
  const snapshotConfig: SnapshotConfig = {
    poolSize: 5_000_000, // 5M tokens
    cycleStartTime: Math.floor(Date.now() / 1000),
    cycleDuration: 365 * 24 * 60 * 60, // 1 year
    rules: [
      {
        id: '1',
        name: 'OG Holders',
        nftContract: 'YOUR_OG_COLLECTION_ADDRESS',
        threshold: 1,
        allocationType: 'PERCENTAGE',
        allocationValue: 50, // 50% of pool
        enabled: true,
      },
      {
        id: '2',
        name: 'Fused OGs',
        nftContract: 'YOUR_FUSED_COLLECTION_ADDRESS',
        threshold: 1,
        allocationType: 'PERCENTAGE',
        allocationValue: 25, // 25% of pool
        enabled: true,
      },
      {
        id: '3',
        name: 'Mass Mint',
        nftContract: 'YOUR_MASS_MINT_COLLECTION_ADDRESS',
        threshold: 1,
        allocationType: 'PERCENTAGE',
        allocationValue: 25, // 25% of pool
        enabled: true,
      },
    ],
  };

  try {
    // Step 1: Process snapshot and calculate allocations
    console.log('Step 1: Processing snapshot rules...\n');
    const result = await poolService.processSnapshot(
      snapshotConfig,
      (status) => console.log(`  ${status}`)
    );

    // Step 2: Confirm before uploading
    console.log('\n⚠️  Ready to upload allocations to blockchain');
    console.log(`Total Wallets: ${result.totalWallets}`);
    console.log(`Total Allocated: ${result.totalAllocated.toLocaleString()}`);
    console.log(`\nPress Ctrl+C to cancel, or wait 10 seconds to continue...`);

    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Step 3: Upload allocations to blockchain
    console.log('\nStep 2: Uploading allocations...\n');
    const uploadResult = await poolService.uploadAllocations(
      result.allocations,
      snapshotConfig,
      (current, total) => {
        console.log(`  Progress: ${current}/${total} batches`);
      }
    );

    console.log('\n✅ SNAPSHOT CONFIGURATION COMPLETE');
    console.log(`Successful: ${uploadResult.successful}`);
    console.log(`Failed: ${uploadResult.failed}`);

    if (uploadResult.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      uploadResult.errors.slice(0, 10).forEach((e) => console.log(`  - ${e}`));
      if (uploadResult.errors.length > 10) {
        console.log(`  ... and ${uploadResult.errors.length - 10} more`);
      }
    }
  } catch (error) {
    console.error('\n❌ Failed to process snapshot:', error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
