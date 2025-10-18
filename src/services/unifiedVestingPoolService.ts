import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { VestingService } from './vestingService';
import { SupabaseService } from './supabaseService';
import { SnapshotConfigService } from './snapshotConfigService';
import { HeliusNFTService } from './heliusNFTService';
import { SnapshotConfig, AllocationResult, SnapshotProcessResult } from '../types';

/**
 * Unified Vesting Pool Service
 * Handles both snapshot and dynamic allocations in a single pool contract
 */
export class UnifiedVestingPoolService {
  private snapshotConfigService: SnapshotConfigService;

  constructor(
    private connection: Connection,
    private vestingService: VestingService,
    private dbService: SupabaseService,
    private heliusService: HeliusNFTService,
    private adminKeypair: Keypair
  ) {
    this.snapshotConfigService = new SnapshotConfigService(heliusService);
  }

  /**
   * Process snapshot configuration and create allocations
   */
  async processSnapshot(
    config: SnapshotConfig,
    onProgress?: (status: string) => void
  ): Promise<SnapshotProcessResult> {
    console.log('📸 Processing snapshot configuration...');
    console.log(`Pool Size: ${config.poolSize.toLocaleString()}`);
    console.log(`Rules: ${config.rules.filter(r => r.enabled).length}\n`);

    try {
      // Process all rules and calculate allocations
      const result = await this.snapshotConfigService.processSnapshotRules(
        config,
        onProgress
      );

      console.log('\n📊 SNAPSHOT PROCESSING COMPLETE');
      console.log(`Total Wallets: ${result.totalWallets}`);
      console.log(`Total Allocated: ${result.totalAllocated.toLocaleString()}`);
      console.log(`Pool Utilization: ${((result.totalAllocated / config.poolSize) * 100).toFixed(2)}%`);
      
      console.log('\nBreakdown by Rule:');
      result.breakdown.forEach((item) => {
        console.log(`  ${item.ruleName}:`);
        console.log(`    - Eligible Wallets: ${item.eligibleWallets}`);
        console.log(`    - Total NFTs: ${item.totalNfts}`);
        console.log(`    - Allocation: ${item.allocation.toLocaleString()}`);
      });

      if (result.errors.length > 0) {
        console.log('\n⚠️  Errors:');
        result.errors.forEach((e) => console.log(`  - ${e}`));
      }

      return result;
    } catch (error) {
      console.error('❌ Snapshot processing failed:', error);
      throw error;
    }
  }

  /**
   * Upload allocations to blockchain in batches
   */
  async uploadAllocations(
    allocations: AllocationResult[],
    config: SnapshotConfig,
    onProgress?: (current: number, total: number) => void
  ): Promise<{
    successful: number;
    failed: number;
    errors: string[];
  }> {
    console.log('\n📤 Uploading allocations to blockchain...');
    
    const batches = this.snapshotConfigService.batchAllocations(allocations, 150);
    const result = {
      successful: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      if (onProgress) {
        onProgress(i + 1, batches.length);
      }

      console.log(`\nProcessing batch ${i + 1}/${batches.length} (${batch.length} wallets)...`);

      for (const allocation of batch) {
        try {
          // Create vesting stream for this wallet
          const vestingData = await this.vestingService.createVesting(
            this.adminKeypair,
            {
              recipient: new PublicKey(allocation.address),
              startTime: config.cycleStartTime,
              cliffTime: config.cycleStartTime,
              endTime: config.cycleStartTime + config.cycleDuration,
              totalAmount: allocation.amount,
              nftTiers: [], // Not needed for unified pool
              tokenMint: this.adminKeypair.publicKey, // TODO: Use actual token mint
            }
          );

          // Save to database
          await this.dbService.createVesting({
            user_wallet: allocation.address,
            nft_count: 0, // Will be populated from sources
            streamflow_stream_id: vestingData.streamflowId,
            token_amount: allocation.amount,
            vesting_mode: 'snapshot',
            snapshot_locked: true,
            claim_verification_enabled: false, // Unified pool doesn't need verification
            grace_period_end: new Date(
              (config.cycleStartTime + config.cycleDuration) * 1000
            ).toISOString(),
          });

          result.successful++;
          console.log(`  ✅ ${allocation.address}: ${allocation.amount.toLocaleString()}`);
        } catch (error) {
          result.failed++;
          const errorMsg = `Failed to create vesting for ${allocation.address}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`;
          result.errors.push(errorMsg);
          console.error(`  ❌ ${errorMsg}`);
        }
      }
    }

    console.log('\n📊 UPLOAD COMPLETE');
    console.log(`Successful: ${result.successful}`);
    console.log(`Failed: ${result.failed}`);

    return result;
  }

  /**
   * Add dynamic allocation for a single wallet
   */
  async addDynamicAllocation(
    wallet: PublicKey,
    amount: number,
    startTime: number,
    duration: number
  ): Promise<{ success: boolean; streamflowId?: string; error?: string }> {
    try {
      console.log(`Adding dynamic allocation for ${wallet.toBase58()}: ${amount.toLocaleString()}`);

      // Create vesting stream
      const vestingData = await this.vestingService.createVesting(
        this.adminKeypair,
        {
          recipient: wallet,
          startTime,
          cliffTime: startTime,
          endTime: startTime + duration,
          totalAmount: amount,
          nftTiers: [],
          tokenMint: this.adminKeypair.publicKey, // TODO: Use actual token mint
        }
      );

      // Save to database
      await this.dbService.createVesting({
        user_wallet: wallet.toBase58(),
        nft_count: 0,
        streamflow_stream_id: vestingData.streamflowId,
        token_amount: amount,
        vesting_mode: 'dynamic',
        snapshot_locked: false,
        claim_verification_enabled: false,
        grace_period_end: new Date((startTime + duration) * 1000).toISOString(),
      });

      console.log(`✅ Dynamic allocation created: ${vestingData.streamflowId}`);

      return {
        success: true,
        streamflowId: vestingData.streamflowId,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to add dynamic allocation: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Get preview for a single rule
   */
  async getRulePreview(
    rule: { nftContract: string; threshold: number; allocationType: 'FIXED' | 'PERCENTAGE'; allocationValue: number },
    poolSize: number
  ) {
    return this.snapshotConfigService.calculateRulePreview(
      { ...rule, id: '', name: '', enabled: true },
      poolSize
    );
  }

  /**
   * Get summary for all rules
   */
  async getSnapshotSummary(
    config: SnapshotConfig,
    onProgress?: (current: number, total: number) => void
  ) {
    return this.snapshotConfigService.calculateSnapshotSummary(config, onProgress);
  }
}
