import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { GenericStreamClient, ICluster, IChain } from '@streamflow/stream';
import { NFTChecker } from './nftChecker';
import { VestingService } from './vestingService';
import { SupabaseService } from './supabaseService';
import { VestingModeService } from './vestingModeService';
import { EligibilitySyncResult, WalletEligibilityStatus, VestingConfig, VestingMode } from '../types';

/**
 * Eligibility Sync Service
 * Automatically adds/removes users from vesting based on NFT holdings
 */
export class EligibilitySyncService {
  private connection: Connection;
  private streamClient: GenericStreamClient<IChain.Solana>;
  private nftChecker: NFTChecker;
  private vestingService: VestingService;
  private dbService: SupabaseService;
  private modeService: VestingModeService;
  private adminKeypair: Keypair;
  private nftThreshold: number;

  constructor(
    connection: Connection,
    adminKeypair: Keypair,
    dbService: SupabaseService,
    vestingService: VestingService,
    modeService: VestingModeService,
    nftThreshold: number = 20,
    cluster: ICluster = ICluster.Devnet,
    nftCollectionAddress?: PublicKey
  ) {
    this.connection = connection;
    this.adminKeypair = adminKeypair;
    this.dbService = dbService;
    this.vestingService = vestingService;
    this.modeService = modeService;
    this.nftThreshold = nftThreshold;
    
    this.streamClient = new GenericStreamClient<IChain.Solana>({
      chain: IChain.Solana,
      clusterUrl: connection.rpcEndpoint,
      cluster: cluster,
      commitment: 'confirmed',
    });
    
    this.nftChecker = new NFTChecker(connection, nftCollectionAddress);
  }

  /**
   * Main sync function - checks all wallets and updates vesting streams
   */
  async syncEligibility(
    walletsToCheck: string[],
    vestingConfig: Omit<VestingConfig, 'recipient'>
  ): Promise<EligibilitySyncResult> {
    // Check mode first
    const mode = await this.modeService.getCurrentMode();

    if (mode === VestingMode.SNAPSHOT) {
      console.log('⚠️  System is in SNAPSHOT mode. Dynamic sync is disabled.');
      console.log('💡 Switch to DYNAMIC mode to enable automatic eligibility sync.');
      console.log('   Run: npm run mode:dynamic\n');
      return {
        success: false,
        walletsChecked: 0,
        streamsCreated: 0,
        streamsCancelled: 0,
        errors: ['System is in snapshot mode. Dynamic sync disabled.'],
        details: { added: [], removed: [], unchanged: [] },
      };
    }

    const startTime = new Date();
    const result: EligibilitySyncResult = {
      success: true,
      walletsChecked: 0,
      streamsCreated: 0,
      streamsCancelled: 0,
      errors: [],
      details: {
        added: [],
        removed: [],
        unchanged: [],
      },
    };

    console.log('🔄 DYNAMIC MODE: Running eligibility sync...');

    // Create sync log entry
    const { data: syncLog } = await this.dbService.supabase
      .from('sync_logs')
      .insert({
        sync_type: 'eligibility_sync',
        started_at: startTime.toISOString(),
        wallets_checked: 0,
        streams_created: 0,
        streams_cancelled: 0,
        errors: 0,
      })
      .select()
      .single();

    const syncLogId = syncLog?.id;

    console.log('🔄 Starting eligibility sync...');
    console.log(`📊 Checking ${walletsToCheck.length} wallets`);

    try {
      // Get all active vestings from database
      const activeVestings = await this.dbService.getActiveVestings();
      const activeVestingMap = new Map(
        activeVestings.map(v => [v.user_wallet, v])
      );

      // Check each wallet
      for (const wallet of walletsToCheck) {
        result.walletsChecked++;

        try {
          const status = await this.checkWalletEligibility(wallet, activeVestingMap);
          
          // Log eligibility check
          await this.dbService.supabase
            .from('eligibility_checks')
            .insert({
              wallet,
              nft_count: status.nftCount,
              eligible: status.eligible,
            });

          // Handle based on status
          if (status.eligible && !status.hasActiveStream) {
            // Add new user
            await this.addUser(wallet, status.nftCount, vestingConfig);
            result.streamsCreated++;
            result.details.added.push(wallet);
            console.log(`✅ Added ${wallet} (${status.nftCount} NFTs)`);
          } else if (!status.eligible && status.hasActiveStream) {
            // Remove user
            await this.removeUser(wallet, status.streamId!);
            result.streamsCancelled++;
            result.details.removed.push(wallet);
            console.log(`❌ Removed ${wallet} (${status.nftCount} NFTs)`);
          } else {
            // No change needed
            result.details.unchanged.push(wallet);
          }
        } catch (error) {
          const errorMsg = `Error processing ${wallet}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.errors.push(errorMsg);
          console.error(errorMsg);
        }
      }

      // Update sync log
      if (syncLogId) {
        await this.dbService.supabase
          .from('sync_logs')
          .update({
            completed_at: new Date().toISOString(),
            wallets_checked: result.walletsChecked,
            streams_created: result.streamsCreated,
            streams_cancelled: result.streamsCancelled,
            errors: result.errors.length,
            details: result.details,
          })
          .eq('id', syncLogId);
      }

      // Log admin action
      await this.dbService.logAdminAction({
        action: 'eligibility_sync',
        admin_wallet: this.adminKeypair.publicKey.toBase58(),
        details: {
          walletsChecked: result.walletsChecked,
          streamsCreated: result.streamsCreated,
          streamsCancelled: result.streamsCancelled,
          errors: result.errors.length,
        },
      });

      console.log('\n✨ Sync completed!');
      console.log(`📊 Wallets checked: ${result.walletsChecked}`);
      console.log(`➕ Streams created: ${result.streamsCreated}`);
      console.log(`➖ Streams cancelled: ${result.streamsCancelled}`);
      console.log(`⚠️  Errors: ${result.errors.length}`);

      result.success = result.errors.length === 0;
      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error('❌ Sync failed:', error);
      return result;
    }
  }

  /**
   * Check if a wallet is eligible and has active stream
   */
  private async checkWalletEligibility(
    wallet: string,
    activeVestingMap: Map<string, any>
  ): Promise<WalletEligibilityStatus> {
    const publicKey = new PublicKey(wallet);
    
    // Check NFT count
    const nftCount = await this.nftChecker.countNFTs(publicKey);
    const eligible = nftCount >= this.nftThreshold;
    
    // Check if has active stream
    const activeVesting = activeVestingMap.get(wallet);
    const hasActiveStream = !!activeVesting;
    
    return {
      wallet,
      nftCount,
      eligible,
      hasActiveStream,
      streamId: activeVesting?.streamflow_stream_id,
    };
  }

  /**
   * Add a new user by creating a vesting database record (no Streamflow)
   */
  private async addUser(
    wallet: string,
    nftCount: number,
    vestingConfig: Omit<VestingConfig, 'recipient'>
  ): Promise<void> {
    // Calculate allocation based on NFT count
    const allocationMultiplier = this.calculateAllocationMultiplier(nftCount);
    const totalAmount = Math.floor(vestingConfig.totalAmount * allocationMultiplier);
    
    // Get or create default vesting stream
    const config = await this.dbService.getConfig();
    let vestingStreamId = 1; // Default stream ID
    
    // Check if default stream exists, create if not
    const { data: existingStream } = await this.dbService.supabase
      .from('vesting_streams')
      .select('id')
      .eq('id', 1)
      .single();
    
    if (!existingStream) {
      // Create default vesting stream
      const { data: newStream } = await this.dbService.supabase
        .from('vesting_streams')
        .insert({
          name: 'Dynamic Vesting Pool',
          description: 'Automatically managed vesting for NFT holders',
          total_pool_amount: 0, // Will be updated as users are added
          vesting_duration_days: Math.floor((vestingConfig.endTime - vestingConfig.startTime) / (24 * 60 * 60)),
          cliff_duration_days: Math.floor((vestingConfig.cliffTime - vestingConfig.startTime) / (24 * 60 * 60)),
          is_active: true,
          start_time: new Date(vestingConfig.startTime * 1000).toISOString(),
          end_time: new Date(vestingConfig.endTime * 1000).toISOString(),
          vesting_mode: 'dynamic',
        })
        .select('id')
        .single();
      
      if (newStream) {
        vestingStreamId = newStream.id;
      }
    }
    
    // Create vesting record in database
    await this.dbService.createVesting({
      user_wallet: wallet,
      nft_count: nftCount,
      token_amount: totalAmount,
      vesting_stream_id: vestingStreamId,
    });
    
    // Log action
    await this.dbService.logAdminAction({
      action: 'create_vesting_auto',
      admin_wallet: this.adminKeypair.publicKey.toBase58(),
      target_wallet: wallet,
      details: {
        nft_count: nftCount,
        token_amount: totalAmount,
      },
    });
  }

  /**
   * Remove a user by cancelling their vesting (database only, no Streamflow)
   */
  private async removeUser(wallet: string, streamId: string): Promise<void> {
    try {
      // Update database - mark as cancelled
      await this.dbService.updateVesting(wallet, {
        is_active: false,
        is_cancelled: true,
        cancelled_at: new Date().toISOString(),
      });
      
      // Log action
      await this.dbService.logAdminAction({
        action: 'cancel_vesting_auto',
        admin_wallet: this.adminKeypair.publicKey.toBase58(),
        target_wallet: wallet,
        details: {
          reason: 'No longer meets NFT requirement',
        },
      });
    } catch (error) {
      console.error(`Failed to cancel vesting for ${wallet}:`, error);
      throw error;
    }
  }

  /**
   * Calculate allocation multiplier based on NFT count
   * You can customize this logic based on your tokenomics
   */
  private calculateAllocationMultiplier(nftCount: number): number {
    // Example: Base allocation for 20 NFTs, 5% more per additional NFT
    if (nftCount < this.nftThreshold) return 0;
    
    const baseMultiplier = 1.0;
    const additionalNFTs = nftCount - this.nftThreshold;
    const bonusPerNFT = 0.05; // 5% per additional NFT
    
    return baseMultiplier + (additionalNFTs * bonusPerNFT);
  }

  /**
   * Get sync history from database
   */
  async getSyncHistory(limit: number = 10) {
    const { data, error } = await this.dbService.supabase
      .from('sync_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Get eligibility check history for a wallet
   */
  async getWalletEligibilityHistory(wallet: string, limit: number = 10) {
    const { data, error } = await this.dbService.supabase
      .from('eligibility_checks')
      .select('*')
      .eq('wallet', wallet)
      .order('checked_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Manual check for a single wallet (useful for testing)
   */
  async checkSingleWallet(wallet: string): Promise<WalletEligibilityStatus> {
    const activeVestings = await this.dbService.getActiveVestings();
    const activeVestingMap = new Map(
      activeVestings.map(v => [v.user_wallet, v])
    );
    
    return this.checkWalletEligibility(wallet, activeVestingMap);
  }
}
