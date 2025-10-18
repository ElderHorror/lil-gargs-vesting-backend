import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { GenericStreamClient, getBN, ICluster, IChain, ICreateStreamData } from '@streamflow/stream';
import { VestingConfig } from '../types';

export interface BatchRecipient {
  wallet: PublicKey;
  amount: number; // In token base units
  name?: string;
}

export interface BatchVestingConfig {
  startTime: number;
  cliffTime: number;
  endTime: number;
  tokenMint: PublicKey;
}

export interface BatchResult {
  successful: Array<{ wallet: string; streamId: string }>;
  failed: Array<{ wallet: string; error: string }>;
  totalCreated: number;
  totalFailed: number;
}

/**
 * Service for creating multiple vesting streams efficiently
 */
export class BatchVestingService {
  private connection: Connection;
  private streamClient: GenericStreamClient<IChain.Solana>;

  constructor(
    connection: Connection,
    cluster: ICluster = ICluster.Mainnet
  ) {
    this.connection = connection;
    this.streamClient = new GenericStreamClient<IChain.Solana>({
      chain: IChain.Solana,
      clusterUrl: connection.rpcEndpoint,
      cluster: cluster,
      commitment: 'confirmed',
    });
  }

  /**
   * Create vesting streams for multiple recipients
   * Processes in batches to avoid rate limits
   */
  async createBatchVestings(
    admin: Keypair,
    recipients: BatchRecipient[],
    config: BatchVestingConfig,
    batchSize: number = 10
  ): Promise<BatchResult> {
    const result: BatchResult = {
      successful: [],
      failed: [],
      totalCreated: 0,
      totalFailed: 0,
    };

    console.log(`Creating ${recipients.length} vesting streams...`);
    console.log(`Batch size: ${batchSize}`);

    // Check admin balance
    const adminBalance = await this.connection.getBalance(admin.publicKey);
    const estimatedCost = recipients.length * 0.01 * LAMPORTS_PER_SOL; // Rough estimate
    
    if (adminBalance < estimatedCost) {
      throw new Error(
        `Insufficient admin balance. Need ~${estimatedCost / LAMPORTS_PER_SOL} SOL, have ${adminBalance / LAMPORTS_PER_SOL} SOL`
      );
    }

    // Process in batches
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(recipients.length / batchSize)}`);

      // Process batch concurrently
      const promises = batch.map(recipient =>
        this.createSingleVesting(admin, recipient, config)
      );

      const results = await Promise.allSettled(promises);

      // Collect results
      results.forEach((res, idx) => {
        const recipient = batch[idx];
        if (res.status === 'fulfilled') {
          result.successful.push({
            wallet: recipient.wallet.toBase58(),
            streamId: res.value,
          });
          result.totalCreated++;
          console.log(`✓ Created for ${recipient.wallet.toBase58().slice(0, 8)}...`);
        } else {
          result.failed.push({
            wallet: recipient.wallet.toBase58(),
            error: res.reason?.message || 'Unknown error',
          });
          result.totalFailed++;
          console.log(`✗ Failed for ${recipient.wallet.toBase58().slice(0, 8)}...: ${res.reason?.message}`);
        }
      });

      // Rate limiting delay between batches
      if (i + batchSize < recipients.length) {
        console.log('Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`\n=== Batch Creation Complete ===`);
    console.log(`Successful: ${result.totalCreated}`);
    console.log(`Failed: ${result.totalFailed}`);

    return result;
  }

  /**
   * Create a single vesting stream
   */
  private async createSingleVesting(
    admin: Keypair,
    recipient: BatchRecipient,
    config: BatchVestingConfig
  ): Promise<string> {
    const vestingDuration = config.endTime - config.cliffTime;
    const amountPerSecond = Math.floor(recipient.amount / vestingDuration);

    // Convert to BN properly - getBN expects the raw amount without decimals applied
    const BN = require('bn.js');
    const amount = new BN(recipient.amount.toString());
    const cliffAmount = new BN(0);
    const amountPerPeriod = new BN(amountPerSecond.toString());

    const streamParams: ICreateStreamData = {
      recipient: recipient.wallet.toBase58(),
      tokenId: config.tokenMint.toBase58(),
      start: config.startTime,
      amount: amount,
      period: 1,
      cliff: config.cliffTime,
      cliffAmount: cliffAmount,
      amountPerPeriod: amountPerPeriod,
      name: recipient.name || `Vesting - ${recipient.wallet.toBase58().slice(0, 8)}`,
      canTopup: false,
      cancelableBySender: true,
      cancelableByRecipient: false,
      transferableBySender: false,
      transferableByRecipient: false,
      automaticWithdrawal: true, // Must be true to allow withdrawals
      withdrawalFrequency: 0, // 0 = manual claiming only (no auto-withdrawor)
      canUpdateRate: false,
    };

    const { metadataId } = await this.streamClient.create(
      streamParams,
      { sender: admin }
    );

    return metadataId;
  }

  /**
   * Calculate total tokens needed for batch
   */
  static calculateTotalAmount(recipients: BatchRecipient[]): number {
    return recipients.reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * Validate batch before creation
   */
  static validateBatch(
    recipients: BatchRecipient[],
    config: BatchVestingConfig
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check recipients
    if (recipients.length === 0) {
      errors.push('No recipients provided');
    }

    // Check for duplicate wallets
    const wallets = new Set<string>();
    recipients.forEach((r, idx) => {
      const walletStr = r.wallet.toBase58();
      if (wallets.has(walletStr)) {
        errors.push(`Duplicate wallet at index ${idx}: ${walletStr}`);
      }
      wallets.add(walletStr);
    });

    // Check amounts
    recipients.forEach((r, idx) => {
      if (r.amount <= 0) {
        errors.push(`Invalid amount at index ${idx}: ${r.amount}`);
      }
    });

    // Check timestamps
    const now = Math.floor(Date.now() / 1000);
    if (config.startTime < now) {
      errors.push('Start time must be in the future');
    }
    if (config.cliffTime <= config.startTime) {
      errors.push('Cliff time must be after start time');
    }
    if (config.endTime <= config.cliffTime) {
      errors.push('End time must be after cliff time');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Retry failed vestings from a previous batch
   */
  async retryFailed(
    admin: Keypair,
    failedRecipients: Array<{ wallet: string; error: string }>,
    recipients: BatchRecipient[],
    config: BatchVestingConfig
  ): Promise<BatchResult> {
    const retryRecipients = failedRecipients
      .map(failed => recipients.find(r => r.wallet.toBase58() === failed.wallet))
      .filter((r): r is BatchRecipient => r !== undefined);

    console.log(`Retrying ${retryRecipients.length} failed vestings...`);
    return this.createBatchVestings(admin, retryRecipients, config);
  }
}
