/**
 * Manual Eligibility Sync Script
 * Run this to manually sync eligibility for all wallets
 * 
 * Usage: npm run sync
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { createClient } from '@supabase/supabase-js';
import bs58 from 'bs58';
import { config, getConnection } from './config';
import { EligibilitySyncService } from './services/eligibilitySyncService';
import { VestingService } from './services/vestingService';
import { SupabaseService } from './services/supabaseService';
import { ICluster } from '@streamflow/stream';

async function main() {
  console.log('🚀 Starting manual eligibility sync...\n');

  // Validate configuration
  if (!config.adminPrivateKey) {
    throw new Error('ADMIN_PRIVATE_KEY not set in .env');
  }
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Supabase credentials not set in .env');
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
  const vestingService = new VestingService(
    connection,
    config.feeWallet,
    config.claimFeeSOL,
    ICluster.Devnet,
    config.nftCollectionAddress
  );

  const syncService = new EligibilitySyncService(
    connection,
    adminKeypair,
    dbService,
    vestingService,
    config.nftThreshold,
    ICluster.Devnet,
    config.nftCollectionAddress
  );

  // Get wallets to check
  // Option 1: Get from command line arguments
  let walletsToCheck: string[] = process.argv.slice(2);

  // Option 2: If no arguments, get from database or a predefined list
  if (walletsToCheck.length === 0) {
    console.log('📋 No wallets provided via command line');
    console.log('📋 Fetching wallets from database...\n');
    
    // Get all wallets that have ever had a vesting
    const allVestings = await dbService.getAllVestings();
    walletsToCheck = allVestings.map(v => v.user_wallet);
    
    // TODO: Add your logic to get additional wallets to check
    // For example, from a community list, Discord members, etc.
    // walletsToCheck.push(...additionalWallets);
    
    if (walletsToCheck.length === 0) {
      console.log('⚠️  No wallets found to check');
      console.log('💡 Tip: Provide wallet addresses as arguments:');
      console.log('   npm run sync wallet1 wallet2 wallet3');
      return;
    }
  }

  console.log(`📊 Checking ${walletsToCheck.length} wallets\n`);

  // Prepare vesting configuration
  const now = Math.floor(Date.now() / 1000);
  const vestingConfig = {
    startTime: now,
    cliffTime: now + (config.vestingCliffDays * 24 * 60 * 60),
    endTime: now + (config.vestingDurationDays * 24 * 60 * 60),
    totalAmount: config.baseAllocationAmount,
    nftTiers: [],
    tokenMint: config.customTokenMint,
  };

  // Run sync
  const result = await syncService.syncEligibility(walletsToCheck, vestingConfig);

  // Display results
  console.log('\n' + '='.repeat(50));
  console.log('📊 SYNC RESULTS');
  console.log('='.repeat(50));
  console.log(`Status: ${result.success ? '✅ Success' : '❌ Failed'}`);
  console.log(`Wallets checked: ${result.walletsChecked}`);
  console.log(`Streams created: ${result.streamsCreated}`);
  console.log(`Streams cancelled: ${result.streamsCancelled}`);
  console.log(`Errors: ${result.errors.length}`);
  
  if (result.details.added.length > 0) {
    console.log('\n➕ Added wallets:');
    result.details.added.forEach(w => console.log(`   - ${w}`));
  }
  
  if (result.details.removed.length > 0) {
    console.log('\n➖ Removed wallets:');
    result.details.removed.forEach(w => console.log(`   - ${w}`));
  }
  
  if (result.errors.length > 0) {
    console.log('\n⚠️  Errors:');
    result.errors.forEach(e => console.log(`   - ${e}`));
  }
  
  console.log('='.repeat(50) + '\n');
}

main()
  .then(() => {
    console.log('✨ Sync completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Sync failed:', error);
    process.exit(1);
  });
