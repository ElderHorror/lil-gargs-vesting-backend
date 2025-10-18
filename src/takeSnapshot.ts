/**
 * Take Snapshot Script
 * Takes a snapshot of NFT holders and creates vestings for all eligible users
 * 
 * Usage: npm run snapshot
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { createClient } from '@supabase/supabase-js';
import bs58 from 'bs58';
import { config, getConnection } from './config';
import { SnapshotVestingService } from './services/snapshotVestingService';
import { VestingService } from './services/vestingService';
import { SupabaseService } from './services/supabaseService';
import { VestingModeService } from './services/vestingModeService';
import { NFTChecker } from './services/nftChecker';
import { ICluster } from '@streamflow/stream';

async function main() {
  console.log('📸 SNAPSHOT MODE: Taking NFT holder snapshot\n');

  // Validate configuration
  if (!config.adminPrivateKey) {
    throw new Error('ADMIN_PRIVATE_KEY not set in .env');
  }
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Supabase credentials not set in .env');
  }
  if (!config.nftCollectionAddress) {
    throw new Error('NFT_COLLECTION_ADDRESS not set in .env');
  }

  // Initialize connection
  const connection = getConnection();
  console.log('✅ Connected to Solana:', config.rpcEndpoint);

  // Parse admin keypair
  let adminKeypair: Keypair;
  try {
    if (config.adminPrivateKey.startsWith('[')) {
      const secretKey = Uint8Array.from(JSON.parse(config.adminPrivateKey));
      adminKeypair = Keypair.fromSecretKey(secretKey);
    } else {
      const secretKey = bs58.decode(config.adminPrivateKey);
      adminKeypair = Keypair.fromSecretKey(secretKey);
    }
    console.log('✅ Admin wallet:', adminKeypair.publicKey.toBase58());
  } catch (error) {
    throw new Error('Invalid ADMIN_PRIVATE_KEY format');
  }

  // Initialize Supabase
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const dbService = new SupabaseService(supabase);
  console.log('✅ Connected to Supabase\n');

  // Initialize services
  const nftChecker = new NFTChecker(connection, config.nftCollectionAddress);
  const vestingService = new VestingService(
    connection,
    config.feeWallet,
    config.claimFeeSOL,
    ICluster.Devnet,
    config.nftCollectionAddress
  );
  const modeService = new VestingModeService(dbService);

  const snapshotService = new SnapshotVestingService(
    connection,
    nftChecker,
    dbService,
    vestingService,
    modeService,
    adminKeypair
  );

  // Prepare vesting configuration
  const now = Math.floor(Date.now() / 1000);
  const vestingConfig = {
    startTime: now,
    cliffTime: now + config.vestingCliffDays * 24 * 60 * 60,
    endTime: now + config.vestingDurationDays * 24 * 60 * 60,
    totalAmount: config.baseAllocationAmount,
    nftTiers: [],
    tokenMint: config.customTokenMint,
  };

  // Option 1: Use collection address (requires implementation)
  // const result = await snapshotService.takeSnapshotAndCreateVestings(
  //   config.nftCollectionAddress,
  //   vestingConfig
  // );

  // Option 2: Use manual wallet list
  console.log('💡 Using manual wallet list');
  console.log('📝 Edit this file to add your wallet list\n');

  // Add your wallets here
  const wallets = [
    // 'wallet1...',
    // 'wallet2...',
    // 'wallet3...',
  ];

  if (wallets.length === 0) {
    console.log('⚠️  No wallets provided!');
    console.log('\n📝 To use snapshot mode:');
    console.log('   1. Edit src/takeSnapshot.ts');
    console.log('   2. Add wallet addresses to the wallets array');
    console.log('   3. Run: npm run snapshot\n');
    console.log('   OR');
    console.log('   1. Implement getAllNFTHolders() in SnapshotVestingService');
    console.log('   2. Uncomment the collection address option above');
    console.log('   3. Run: npm run snapshot\n');
    return;
  }

  const result = await snapshotService.takeSnapshotFromWalletList(wallets, vestingConfig);

  // Display results
  console.log('\n' + '='.repeat(60));
  console.log('📊 SNAPSHOT RESULTS');
  console.log('='.repeat(60));
  console.log(`Total wallets checked: ${result.totalWallets}`);
  console.log(`Eligible users: ${result.eligible}`);
  console.log(`Vestings created: ${result.vestingsCreated}`);
  console.log(`Errors: ${result.errors.length}`);

  if (Object.keys(result.tierBreakdown).length > 0) {
    console.log('\nTier Breakdown:');
    for (const [tier, data] of Object.entries(result.tierBreakdown)) {
      console.log(
        `  Tier ${tier}: ${data.users} users × ${data.tokensPerUser.toLocaleString()} = ${data.totalTokens.toLocaleString()} tokens`
      );
    }
  }

  if (result.errors.length > 0) {
    console.log('\n⚠️  Errors:');
    result.errors.slice(0, 10).forEach((e) => console.log(`   - ${e}`));
    if (result.errors.length > 10) {
      console.log(`   ... and ${result.errors.length - 10} more`);
    }
  }

  console.log('='.repeat(60) + '\n');
}

main()
  .then(() => {
    console.log('✨ Snapshot completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Snapshot failed:', error);
    process.exit(1);
  });
