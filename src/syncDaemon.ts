/**
 * Eligibility Sync Daemon
 * Continuously monitors and syncs eligibility at configured intervals
 * 
 * Usage: npm run sync:daemon
 */

import { Keypair } from '@solana/web3.js';
import { createClient } from '@supabase/supabase-js';
import bs58 from 'bs58';
import { config, getConnection } from './config';
import { EligibilitySyncService } from './services/eligibilitySyncService';
import { VestingService } from './services/vestingService';
import { SupabaseService } from './services/supabaseService';
import { ICluster } from '@streamflow/stream';

class SyncDaemon {
  private syncService!: EligibilitySyncService;
  private dbService!: SupabaseService;
  private adminKeypair!: Keypair;
  private isRunning = false;
  private syncIntervalMs: number;

  constructor() {
    this.syncIntervalMs = config.syncIntervalHours * 60 * 60 * 1000;
  }

  async initialize() {
    console.log('🤖 Initializing Eligibility Sync Daemon...\n');

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
    try {
      if (config.adminPrivateKey.startsWith('[')) {
        const secretKey = Uint8Array.from(JSON.parse(config.adminPrivateKey));
        this.adminKeypair = Keypair.fromSecretKey(secretKey);
      } else {
        const secretKey = bs58.decode(config.adminPrivateKey);
        this.adminKeypair = Keypair.fromSecretKey(secretKey);
      }
      console.log('✅ Admin wallet:', this.adminKeypair.publicKey.toBase58());
    } catch (error) {
      throw new Error('Invalid ADMIN_PRIVATE_KEY format');
    }

    // Initialize Supabase
    const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
    this.dbService = new SupabaseService(supabase);
    console.log('✅ Connected to Supabase');

    // Initialize services
    const vestingService = new VestingService(
      connection,
      config.feeWallet,
      config.claimFeeSOL,
      ICluster.Devnet,
      config.nftCollectionAddress
    );

    this.syncService = new EligibilitySyncService(
      connection,
      this.adminKeypair,
      this.dbService,
      vestingService,
      config.nftThreshold,
      ICluster.Devnet,
      config.nftCollectionAddress
    );

    console.log(`✅ Sync interval: ${config.syncIntervalHours} hours\n`);
  }

  async getWalletsToCheck(): Promise<string[]> {
    // Get all wallets that have ever had a vesting
    const allVestings = await this.dbService.getAllVestings();
    const wallets = new Set(allVestings.map(v => v.user_wallet));

    // TODO: Add your logic to get additional wallets
    // For example:
    // - Fetch from Discord API
    // - Fetch from your community database
    // - Fetch from a predefined list
    // const additionalWallets = await fetchCommunityWallets();
    // additionalWallets.forEach(w => wallets.add(w));

    return Array.from(wallets);
  }

  async runSync() {
    console.log('\n' + '='.repeat(60));
    console.log(`🔄 Starting sync at ${new Date().toISOString()}`);
    console.log('='.repeat(60) + '\n');

    try {
      // Get wallets to check
      const walletsToCheck = await this.getWalletsToCheck();
      
      if (walletsToCheck.length === 0) {
        console.log('⚠️  No wallets found to check');
        return;
      }

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
      const result = await this.syncService.syncEligibility(walletsToCheck, vestingConfig);

      // Display summary
      console.log('\n📊 Sync Summary:');
      console.log(`   Status: ${result.success ? '✅' : '❌'}`);
      console.log(`   Wallets: ${result.walletsChecked}`);
      console.log(`   Added: ${result.streamsCreated}`);
      console.log(`   Removed: ${result.streamsCancelled}`);
      console.log(`   Errors: ${result.errors.length}`);

      if (result.errors.length > 0) {
        console.log('\n⚠️  Errors encountered:');
        result.errors.slice(0, 5).forEach(e => console.log(`   - ${e}`));
        if (result.errors.length > 5) {
          console.log(`   ... and ${result.errors.length - 5} more`);
        }
      }

      const nextSync = new Date(Date.now() + this.syncIntervalMs);
      console.log(`\n⏰ Next sync scheduled for: ${nextSync.toISOString()}`);
    } catch (error) {
      console.error('❌ Sync failed:', error);
    }
  }

  async start() {
    if (this.isRunning) {
      console.log('⚠️  Daemon is already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Daemon started');
    console.log(`⏰ Sync interval: ${config.syncIntervalHours} hours`);
    console.log('Press Ctrl+C to stop\n');

    // Run initial sync
    await this.runSync();

    // Schedule periodic syncs
    const intervalId = setInterval(async () => {
      if (this.isRunning) {
        await this.runSync();
      }
    }, this.syncIntervalMs);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Shutting down daemon...');
      this.isRunning = false;
      clearInterval(intervalId);
      console.log('✅ Daemon stopped');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n\n🛑 Shutting down daemon...');
      this.isRunning = false;
      clearInterval(intervalId);
      console.log('✅ Daemon stopped');
      process.exit(0);
    });
  }
}

async function main() {
  const daemon = new SyncDaemon();
  await daemon.initialize();
  await daemon.start();
}

main().catch((error) => {
  console.error('❌ Daemon failed to start:', error);
  process.exit(1);
});
