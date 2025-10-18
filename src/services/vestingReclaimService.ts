import { PublicKey, Keypair } from '@solana/web3.js';
import { GenericStreamClient, IChain, getNumberFromBN } from '@streamflow/stream';
import { NFTChecker } from './nftChecker';
import { SupabaseService } from './supabaseService';
import { ReclaimResult } from '../types';

/**
 * Vesting Reclaim Service
 * Reclaims unclaimed tokens from expired vestings where users no longer meet NFT requirements
 */
export class VestingReclaimService {
  constructor(
    private nftChecker: NFTChecker,
    private dbService: SupabaseService,
    private streamClient: GenericStreamClient<IChain.Solana>,
    private adminKeypair: Keypair
  ) {}

  /**
   * Reclaim tokens from users who don't meet requirements after vesting ends
   */
  async reclaimExpiredVestings(): Promise<ReclaimResult> {
    const result: ReclaimResult = {
      checked: 0,
      reclaimed: 0,
      totalReclaimed: 0,
      errors: [],
    };

    const now = new Date();

    // Get all vestings past grace period
    const { data: expiredVestings, error } = await this.dbService.supabase
      .from('vestings')
      .select('*')
      .eq('is_active', true)
      .not('grace_period_end', 'is', null)
      .lt('grace_period_end', now.toISOString());

    if (error) {
      result.errors.push(`Failed to fetch expired vestings: ${error.message}`);
      return result;
    }

    if (!expiredVestings || expiredVestings.length === 0) {
      console.log('No expired vestings to reclaim');
      return result;
    }

    console.log(`Found ${expiredVestings.length} expired vestings to check`);

    for (const vesting of expiredVestings) {
      result.checked++;

      try {
        // Check if user still meets NFT requirement
        const currentNFTCount = await this.nftChecker.countNFTs(new PublicKey(vesting.user_wallet));

        const tier = this.getTierForNFTCount(vesting.nft_count);
        const meetsRequirement = currentNFTCount >= (tier || vesting.nft_count);

        if (meetsRequirement) {
          console.log(`✅ ${vesting.user_wallet} still eligible, skipping`);
          continue;
        }

        // User doesn't meet requirement - reclaim unclaimed tokens
        const stream = await this.streamClient.getOne({ id: vesting.streamflow_stream_id });

        const withdrawn = getNumberFromBN(stream.withdrawnAmount, 9);
        const total = getNumberFromBN(stream.depositedAmount, 9);
        const unclaimed = total - withdrawn;

        if (unclaimed <= 0) {
          console.log(`${vesting.user_wallet} already claimed everything`);
          // Still mark as cancelled for record keeping
          await this.dbService.updateVesting(vesting.user_wallet, {
            is_active: false,
            is_cancelled: true,
            cancelled_at: now.toISOString(),
            cancellation_reason: 'Fully claimed before expiry',
          });
          continue;
        }

        // Cancel stream (returns unclaimed to admin)
        await this.streamClient.cancel(
          { id: vesting.streamflow_stream_id },
          { invoker: this.adminKeypair }
        );

        // Update database
        await this.dbService.updateVesting(vesting.user_wallet, {
          is_active: false,
          is_cancelled: true,
          cancelled_at: now.toISOString(),
          cancellation_reason: 'NFT requirement not met at expiry',
        });

        // Log reclaim
        await this.dbService.logAdminAction({
          action: 'reclaim_expired_vesting',
          admin_wallet: this.adminKeypair.publicKey.toBase58(),
          target_wallet: vesting.user_wallet,
          details: {
            nft_count_at_expiry: currentNFTCount,
            required_nfts: tier || vesting.nft_count,
            unclaimed_amount: unclaimed,
            claimed_amount: withdrawn,
          },
        });

        result.reclaimed++;
        result.totalReclaimed += unclaimed;

        console.log(`💰 Reclaimed ${unclaimed} tokens from ${vesting.user_wallet}`);
      } catch (error) {
        const errorMsg = `Failed to reclaim from ${vesting.user_wallet}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        result.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    return result;
  }

  /**
   * Check which vestings will be reclaimable soon
   */
  async getUpcomingReclaims(daysAhead: number = 7): Promise<
    Array<{
      wallet: string;
      nftCount: number;
      requiredNFTs: number;
      unclaimedAmount: number;
      gracePeriodEnd: string;
    }>
  > {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const { data: upcomingVestings } = await this.dbService.supabase
      .from('vestings')
      .select('*')
      .eq('is_active', true)
      .not('grace_period_end', 'is', null)
      .lt('grace_period_end', futureDate.toISOString())
      .gt('grace_period_end', new Date().toISOString());

    const upcoming = [];

    for (const vesting of upcomingVestings || []) {
      try {
        const currentNFTCount = await this.nftChecker.countNFTs(new PublicKey(vesting.user_wallet));

        const tier = this.getTierForNFTCount(vesting.nft_count);
        const meetsRequirement = currentNFTCount >= (tier || vesting.nft_count);

        if (!meetsRequirement) {
          const stream = await this.streamClient.getOne({ id: vesting.streamflow_stream_id });

          const withdrawn = getNumberFromBN(stream.withdrawnAmount, 9);
          const total = getNumberFromBN(stream.depositedAmount, 9);
          const unclaimed = total - withdrawn;

          upcoming.push({
            wallet: vesting.user_wallet,
            nftCount: currentNFTCount,
            requiredNFTs: tier || vesting.nft_count,
            unclaimedAmount: unclaimed,
            gracePeriodEnd: vesting.grace_period_end,
          });
        }
      } catch (error) {
        console.error(`Failed to check ${vesting.user_wallet}:`, error);
      }
    }

    return upcoming;
  }

  /**
   * Get tier for NFT count
   */
  private getTierForNFTCount(nftCount: number): number | null {
    if (nftCount >= 50) return 50;
    if (nftCount >= 40) return 40;
    if (nftCount >= 30) return 30;
    if (nftCount >= 25) return 25;
    if (nftCount >= 20) return 20;
    return null;
  }
}
