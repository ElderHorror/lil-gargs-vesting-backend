import { PublicKey, Keypair } from '@solana/web3.js';
import { GenericStreamClient, IChain, getBN, getNumberFromBN } from '@streamflow/stream';
import { NFTChecker } from './nftChecker';
import { SupabaseService } from './supabaseService';
import { ClaimVerificationResult } from '../types';

/**
 * Claim Verification Service
 * Verifies NFT holdings before allowing claims in snapshot mode
 */
export class ClaimVerificationService {
  constructor(
    private nftChecker: NFTChecker,
    private dbService: SupabaseService,
    private streamClient: GenericStreamClient<IChain.Solana>
  ) {}

  /**
   * Verify user still meets NFT requirements before allowing claim
   */
  async verifyClaimEligibility(userWallet: string): Promise<ClaimVerificationResult> {
    // Get user's vesting record
    const vesting = await this.dbService.getVesting(userWallet);

    if (!vesting) {
      return {
        canClaim: false,
        reason: 'No vesting found for this wallet',
        currentNFTCount: 0,
        requiredNFTCount: 0,
        claimableAmount: 0,
      };
    }

    // Check if vesting is active
    if (!vesting.is_active) {
      return {
        canClaim: false,
        reason: 'Vesting is not active',
        currentNFTCount: 0,
        requiredNFTCount: vesting.nft_count,
        claimableAmount: 0,
      };
    }

    // Check if claim verification is enabled for this vesting
    if (!vesting.claim_verification_enabled) {
      // Skip NFT check, just verify claimable amount
      return this.getClaimableAmount(userWallet, vesting);
    }

    // Get current NFT count
    const currentNFTCount = await this.nftChecker.countNFTs(new PublicKey(userWallet));

    // Get required NFT count (from original allocation)
    const requiredNFTCount = vesting.nft_count;
    const tier = this.getTierForNFTCount(requiredNFTCount);
    const tierMinNFTs = tier || requiredNFTCount;

    // Check if user still meets requirements
    const meetsRequirement = currentNFTCount >= tierMinNFTs;

    if (!meetsRequirement) {
      // Log failed attempt
      await this.logClaimAttempt(
        userWallet,
        currentNFTCount,
        tierMinNFTs,
        false,
        'Insufficient NFTs',
        0
      );

      return {
        canClaim: false,
        reason: `You need at least ${tierMinNFTs} NFTs to claim. You currently have ${currentNFTCount}.`,
        currentNFTCount,
        requiredNFTCount: tierMinNFTs,
        claimableAmount: 0,
      };
    }

    // Get claimable amount from Streamflow
    const result = await this.getClaimableAmount(userWallet, vesting);

    if (!result.canClaim) {
      await this.logClaimAttempt(
        userWallet,
        currentNFTCount,
        tierMinNFTs,
        false,
        result.reason,
        0
      );
      return result;
    }

    // All checks passed!
    await this.logClaimAttempt(
      userWallet,
      currentNFTCount,
      tierMinNFTs,
      true,
      'Verified',
      result.claimableAmount
    );

    return {
      ...result,
      currentNFTCount,
      requiredNFTCount: tierMinNFTs,
    };
  }

  /**
   * Get claimable amount from Streamflow
   */
  private async getClaimableAmount(
    userWallet: string,
    vesting: any
  ): Promise<ClaimVerificationResult> {
    try {
      const stream = await this.streamClient.getOne({ id: vesting.streamflow_stream_id });

      const now = Math.floor(Date.now() / 1000);
      const unlocked = stream.unlocked(now);
      const withdrawn = stream.withdrawnAmount;
      const claimable = getNumberFromBN(unlocked, 9) - getNumberFromBN(withdrawn, 9);

      if (claimable <= 0) {
        return {
          canClaim: false,
          reason: 'No tokens available to claim yet',
          currentNFTCount: 0,
          requiredNFTCount: 0,
          claimableAmount: 0,
        };
      }

      return {
        canClaim: true,
        reason: 'Eligible to claim',
        currentNFTCount: 0,
        requiredNFTCount: 0,
        claimableAmount: claimable,
      };
    } catch (error) {
      return {
        canClaim: false,
        reason: `Failed to fetch stream data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        currentNFTCount: 0,
        requiredNFTCount: 0,
        claimableAmount: 0,
      };
    }
  }

  /**
   * Process claim with verification
   */
  async processClaim(
    userWallet: string,
    userKeypair: Keypair
  ): Promise<{ success: boolean; amount: number; txSignature?: string; error?: string }> {
    // Verify eligibility first
    const verification = await this.verifyClaimEligibility(userWallet);

    if (!verification.canClaim) {
      return {
        success: false,
        amount: 0,
        error: verification.reason,
      };
    }

    // Get vesting info
    const vesting = await this.dbService.getVesting(userWallet);

    if (!vesting) {
      return {
        success: false,
        amount: 0,
        error: 'Vesting not found',
      };
    }

    try {
      // Withdraw from Streamflow
      const { ixs, tx } = await this.streamClient.withdraw(
        {
          id: vesting.streamflow_stream_id,
          amount: getBN(verification.claimableAmount, 9),
        },
        { invoker: userKeypair }
      );

      // Log successful claim
      await this.dbService.supabase.from('claim_history').insert({
        user_wallet: userWallet,
        amount_claimed: verification.claimableAmount,
        nft_count_at_claim: verification.currentNFTCount,
        tx_signature: tx.toString(),
      });

      console.log(`✅ ${userWallet} claimed ${verification.claimableAmount} tokens`);

      return {
        success: true,
        amount: verification.claimableAmount,
        txSignature: tx.toString(),
      };
    } catch (error) {
      console.error('Claim failed:', error);
      return {
        success: false,
        amount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Log claim attempt
   */
  private async logClaimAttempt(
    wallet: string,
    nftCount: number,
    requiredCount: number,
    success: boolean,
    reason: string,
    amount: number
  ) {
    await this.dbService.supabase.from('claim_attempts').insert({
      user_wallet: wallet,
      nft_count: nftCount,
      required_nft_count: requiredCount,
      success,
      reason,
      amount_attempted: amount,
    });
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
