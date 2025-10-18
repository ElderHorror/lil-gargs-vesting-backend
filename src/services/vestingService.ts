import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { GenericStreamClient, getBN, ICluster, IChain, ICreateStreamData } from '@streamflow/stream';
import BN from 'bn.js';
import { VestingConfig, VestingData, ClaimResult } from '../types';
import { NFTChecker } from './nftChecker';

export class VestingService {
  private connection: Connection;
  public streamClient: GenericStreamClient<IChain.Solana>;
  private nftChecker: NFTChecker;
  private feeWallet: PublicKey;
  private claimFeeSOL: number;

  constructor(
    connection: Connection,
    feeWallet: PublicKey,
    claimFeeSOL: number,
    cluster: ICluster = ICluster.Devnet,
    nftCollectionAddress?: PublicKey
  ) {
    this.connection = connection;
    this.streamClient = new GenericStreamClient<IChain.Solana>({
      chain: IChain.Solana,
      clusterUrl: connection.rpcEndpoint,
      cluster: cluster,
      commitment: 'confirmed',
    });
    this.nftChecker = new NFTChecker(connection, nftCollectionAddress);
    this.feeWallet = feeWallet;
    this.claimFeeSOL = claimFeeSOL;
  }

  /**
   * Create a vesting stream for a recipient
   * Admin function
   */
  async createVesting(
    admin: Keypair,
    config: VestingConfig
  ): Promise<VestingData> {
    try {
      // Calculate vesting duration
      const vestingDuration = config.endTime - config.startTime; // Total duration
      const amountPerSecond = config.totalAmount / vestingDuration;
      
      // Debug logging
      console.log('Debug - Timestamps:');
      console.log(`  start: ${config.startTime} (${new Date(config.startTime * 1000).toISOString()})`);
      console.log(`  cliff: ${config.cliffTime} (${new Date(config.cliffTime * 1000).toISOString()})`);
      console.log(`  end: ${config.endTime} (${new Date(config.endTime * 1000).toISOString()})`);
      console.log(`  cliff > start: ${config.cliffTime > config.startTime}`);
      console.log(`  end > cliff: ${config.endTime > config.cliffTime}`);
      
      // Prepare Streamflow vesting parameters
      const streamParams: ICreateStreamData = {
        recipient: config.recipient.toBase58(),
        tokenId: config.tokenMint.toBase58(),
        start: config.startTime,
        amount: getBN(config.totalAmount, 9), // Assuming 9 decimals, adjust as needed
        period: 1, // Release period in seconds (1 = continuous)
        cliff: config.cliffTime, // Cliff is absolute timestamp (must be >= start)
        cliffAmount: getBN(0, 9), // No cliff amount, all vests linearly
        amountPerPeriod: getBN(Math.floor(amountPerSecond), 9),
        name: 'Custom Token Vesting',
        canTopup: false,
        cancelableBySender: true,
        cancelableByRecipient: false,
        transferableBySender: false,
        transferableByRecipient: false,
        automaticWithdrawal: false,
        withdrawalFrequency: 0,
      };

      // Create the stream
      const { txId, metadataId } = await this.streamClient.create(
        streamParams,
        { sender: admin }
      );

      console.log('Vesting stream created:', metadataId);
      console.log('Transaction ID:', txId);

      const vestingData: VestingData = {
        id: metadataId,
        config,
        streamflowId: metadataId,
        createdAt: Date.now(),
      };

      return vestingData;
    } catch (error) {
      console.error('Error creating vesting:', error);
      throw error;
    }
  }

  /**
   * Calculate claimable amount based on vesting schedule and NFT tier
   */
  async calculateClaimable(
    vestingData: VestingData,
    userWallet: PublicKey,
    skipNFTCheck: boolean = false
  ): Promise<{ claimable: number; percentage: number; eligible: boolean }> {
    const now = Math.floor(Date.now() / 1000);
    const { config } = vestingData;

    let nftPercentage = 100; // Default to 100% if NFT check is skipped

    // Check NFT eligibility (optional)
    if (!skipNFTCheck && config.nftTiers && config.nftTiers.length > 0) {
      const eligibility = await this.nftChecker.checkEligibility(
        userWallet,
        config.nftTiers
      );

      if (!eligibility.eligible) {
        return { claimable: 0, percentage: 0, eligible: false };
      }
      nftPercentage = eligibility.percentage;
    }

    // Calculate vested amount based on time
    let vestedPercentage = 0;

    if (now < config.cliffTime) {
      // Before cliff, nothing is vested
      vestedPercentage = 0;
    } else if (now >= config.endTime) {
      // After end, everything is vested
      vestedPercentage = 100;
    } else {
      // Linear vesting between cliff and end
      const elapsed = now - config.cliffTime;
      const total = config.endTime - config.cliffTime;
      vestedPercentage = (elapsed / total) * 100;
    }

    // Apply NFT tier percentage
    const effectivePercentage = (vestedPercentage * nftPercentage) / 100;
    const claimableAmount = (config.totalAmount * effectivePercentage) / 100;

    return {
      claimable: Math.floor(claimableAmount),
      percentage: nftPercentage,
      eligible: true,
    };
  }

  /**
   * Claim vested tokens with fee
   * User function
   */
  async claimVesting(
    vestingData: VestingData,
    userKeypair: Keypair,
    skipNFTCheck: boolean = false
  ): Promise<ClaimResult> {
    try {
      const userWallet = userKeypair.publicKey;

      // Check eligibility and calculate claimable
      const { claimable, eligible } = await this.calculateClaimable(
        vestingData,
        userWallet,
        skipNFTCheck
      );

      if (!eligible) {
        return {
          success: false,
          error: 'User does not meet NFT requirements',
        };
      }

      if (claimable <= 0) {
        return {
          success: false,
          error: 'No tokens available to claim yet',
        };
      }

      // Create transaction for fee payment
      const transaction = new Transaction();

      // Add fee transfer instruction
      const feeInLamports = this.claimFeeSOL * LAMPORTS_PER_SOL;
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: userWallet,
          toPubkey: this.feeWallet,
          lamports: feeInLamports,
        })
      );

      // Send fee transaction
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = userWallet;
      transaction.sign(userKeypair);

      const feeSignature = await this.connection.sendRawTransaction(
        transaction.serialize()
      );
      await this.connection.confirmTransaction(feeSignature);

      console.log('Fee paid:', feeSignature);

      // Withdraw from Streamflow stream
      const withdrawResult = await this.streamClient.withdraw(
        {
          id: vestingData.streamflowId,
          amount: getBN(claimable, 9),
        },
        { invoker: userKeypair }
      );

      console.log('Tokens claimed:', withdrawResult.txId);

      return {
        success: true,
        signature: withdrawResult.txId,
        amountClaimed: claimable,
        feePaid: this.claimFeeSOL,
      };
    } catch (error) {
      console.error('Error claiming vesting:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get vesting stream info
   */
  async getVestingInfo(streamId: string) {
    try {
      const stream = await this.streamClient.getOne({ id: streamId });
      return stream;
    } catch (error) {
      console.error('Error getting vesting info:', error);
      throw error;
    }
  }

  /**
   * Cancel vesting (admin only)
   */
  async cancelVesting(streamId: string, admin: Keypair) {
    try {
      const result = await this.streamClient.cancel(
        { id: streamId },
        { invoker: admin }
      );
      return result;
    } catch (error) {
      console.error('Error canceling vesting:', error);
      throw error;
    }
  }
}
