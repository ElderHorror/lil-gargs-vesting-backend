import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { GenericStreamClient, ICluster, IChain, getBN, getNumberFromBN } from '@streamflow/stream';
import { config } from '../config';

/**
 * Streamflow Integration Service
 * Creates and manages vesting pools on-chain using Streamflow Protocol
 */
export class StreamflowService {
  private client: GenericStreamClient<IChain.Solana>;
  private connection: Connection;

  constructor() {
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    this.client = new GenericStreamClient<IChain.Solana>({
      chain: IChain.Solana,
      clusterUrl: config.rpcEndpoint,
      cluster: ICluster.Mainnet,
      commitment: 'confirmed',
    });
  }

  /**
   * Create a vesting pool (stream) on Streamflow
   * Admin is the recipient, tokens vest over time, admin distributes to users
   */
  async createVestingPool(params: {
    adminKeypair: Keypair;
    tokenMint: PublicKey;
    totalAmount: number;
    startTime: number;
    endTime: number;
    cliffTime?: number;
    poolName: string;
  }): Promise<{ streamId: string; signature: string }> {
    const { adminKeypair, tokenMint, totalAmount, startTime, endTime, cliffTime, poolName } = params;

    try {
      console.log('Creating Streamflow pool...');
      console.log('Admin:', adminKeypair.publicKey.toBase58());
      console.log('Token Mint:', tokenMint.toBase58());
      console.log('Amount:', totalAmount);
      console.log('Duration:', startTime, '->', endTime);

      // Create stream where admin is BOTH sender and recipient
      // This allows admin to withdraw vested tokens and distribute them
      const duration = endTime - startTime;
      const amountPerPeriod = Math.max(1, Math.floor(totalAmount / duration));
      
      const createStreamParams = {
        recipient: adminKeypair.publicKey.toBase58(), // Admin receives the vested tokens
        tokenId: tokenMint.toBase58(),
        start: startTime,
        amount: getBN(totalAmount, 9), // 9 decimals for most SPL tokens
        period: 1, // Vesting updates every second
        cliff: cliffTime || startTime, // Cliff time (default to start if none)
        cliffAmount: getBN(0, 9), // No cliff amount, just time-based
        amountPerPeriod: getBN(amountPerPeriod, 9), // Ensure at least 1 token per period
        name: poolName,
        canTopup: false,
        cancelableBySender: true,
        cancelableByRecipient: false,
        transferableBySender: false,
        transferableByRecipient: false,
        automaticWithdrawal: false,
        withdrawalFrequency: 0,
        partner: undefined,
      };

      const createResult = await this.client.create(
        createStreamParams,
        { sender: adminKeypair }
      );

      console.log('Stream created! Result:', createResult);

      return {
        streamId: createResult.metadataId,
        signature: createResult.txId,
      };
    } catch (error) {
      console.error('Failed to create Streamflow pool:', error);
      throw error;
    }
  }

  /**
   * Get vested amount from pool at current time
   */
  async getVestedAmount(streamId: string): Promise<number> {
    try {
      const stream = await this.client.getOne({ id: streamId });
      
      if (!stream) {
        throw new Error('Stream not found');
      }

      // Calculate vested amount based on current time
      const now = Math.floor(Date.now() / 1000);
      const start = Number(stream.start);
      const end = Number(stream.end);
      const depositedAmount = getNumberFromBN(stream.depositedAmount, 9);

      if (now < start) {
        return 0; // Vesting hasn't started
      }

      if (now >= end) {
        return depositedAmount; // Fully vested
      }

      // Linear vesting calculation
      const elapsed = now - start;
      const duration = end - start;
      const vestedAmount = (depositedAmount * elapsed) / duration;

      return Math.floor(vestedAmount);
    } catch (error) {
      console.error('Failed to get vested amount:', error);
      throw error;
    }
  }

  /**
   * Withdraw vested tokens from pool to admin wallet
   * Admin then distributes to users who paid the claim fee
   */
  async withdrawFromPool(
    streamId: string,
    adminKeypair: Keypair,
    amount: number
  ): Promise<string> {
    try {
      console.log('Withdrawing from Streamflow pool:', streamId);
      console.log('Amount:', amount);

      const withdrawResult = await this.client.withdraw(
        {
          id: streamId,
          amount: getBN(amount, 9),
        },
        { invoker: adminKeypair }
      );

      console.log('Withdrawal successful! Signature:', withdrawResult.txId);
      return withdrawResult.txId;
    } catch (error) {
      console.error('Failed to withdraw from pool:', error);
      throw error;
    }
  }

  /**
   * Get pool status
   */
  async getPoolStatus(streamId: string) {
    try {
      const stream = await this.client.getOne({ id: streamId });

      if (!stream) {
        throw new Error('Stream not found');
      }

      const depositedAmount = getNumberFromBN(stream.depositedAmount, 9);
      const withdrawnAmount = getNumberFromBN(stream.withdrawnAmount, 9);
      const remainingAmount = depositedAmount - withdrawnAmount;

      return {
        streamId: streamId,
        depositedAmount,
        withdrawnAmount,
        remainingAmount,
        start: Number(stream.start),
        end: Number(stream.end),
        cliff: Number(stream.cliff),
        recipient: stream.recipient,
        mint: stream.mint,
      };
    } catch (error) {
      console.error('Failed to get pool status:', error);
      throw error;
    }
  }

  /**
   * Cancel and close the pool (emergency only)
   */
  async cancelPool(streamId: string, adminKeypair: Keypair): Promise<string> {
    try {
      const cancelResult = await this.client.cancel(
        { id: streamId },
        { invoker: adminKeypair }
      );

      console.log('Pool cancelled! Signature:', cancelResult.txId);
      return cancelResult.txId;
    } catch (error) {
      console.error('Failed to cancel pool:', error);
      throw error;
    }
  }
}
