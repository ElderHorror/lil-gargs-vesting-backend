import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import { GenericStreamClient, getBN, ICluster, IChain, ICreateStreamData, ITopUpData } from '@streamflow/stream';
import { VestingConfig, VestingPool, UserAllocation, ClaimResult } from '../types';
import { NFTChecker } from './nftChecker';

/**
 * Multi-user vesting pool service
 * Allows multiple users to claim from a single vesting stream
 */
export class VestingPoolService {
  private connection: Connection;
  private streamClient: GenericStreamClient<IChain.Solana>;
  private nftChecker: NFTChecker;
  private feeWallet: PublicKey;
  private claimFeeSOL: number;
  private pools: Map<string, VestingPool>; // In-memory storage (use DB in production)

  constructor(
    connection: Connection,
    feeWallet: PublicKey,
    claimFeeSOL: number,
    cluster: ICluster = ICluster.Devnet
  ) {
    this.connection = connection;
    this.streamClient = new GenericStreamClient<IChain.Solana>({
      chain: IChain.Solana,
      clusterUrl: connection.rpcEndpoint,
      cluster: cluster,
      commitment: 'confirmed',
    });
    this.nftChecker = new NFTChecker(connection);
    this.feeWallet = feeWallet;
    this.claimFeeSOL = claimFeeSOL;
    this.pools = new Map();
  }

  /**
   * Create a vesting pool for multiple users
   * @param admin - Admin keypair (will be the stream recipient/manager)
   * @param config - Vesting configuration
   * @param userAllocations - Array of user wallets and their share percentages
   */
  async createVestingPool(
    admin: Keypair,
    config: VestingConfig,
    userAllocations: { wallet: PublicKey; sharePercentage: number }[]
  ): Promise<VestingPool> {
    try {
      // Validate total shares = 100%
      const totalShares = userAllocations.reduce((sum, u) => sum + u.sharePercentage, 0);
      if (Math.abs(totalShares - 100) > 0.01) {
        throw new Error(`Total share percentages must equal 100%, got ${totalShares}%`);
      }

      // Calculate vesting duration
      const vestingDuration = config.endTime - config.cliffTime;
      const amountPerSecond = config.totalAmount / vestingDuration;

      // Create Streamflow vesting stream with admin as recipient
      const streamParams: ICreateStreamData = {
        recipient: admin.publicKey.toBase58(), // Admin manages the pool
        tokenId: config.tokenMint.toBase58(),
        start: config.startTime,
        amount: getBN(config.totalAmount, 9),
        period: 1,
        cliff: config.cliffTime,
        cliffAmount: getBN(0, 9),
        amountPerPeriod: getBN(Math.floor(amountPerSecond), 9),
        name: 'Multi-User Vesting Pool',
        canTopup: true, // Allow refilling the pool
        cancelableBySender: true,
        cancelableByRecipient: false,
        transferableBySender: false,
        transferableByRecipient: false,
        automaticWithdrawal: false,
        withdrawalFrequency: 0,
      };

      const { txId, metadataId } = await this.streamClient.create(
        streamParams,
        { sender: admin }
      );

      console.log('Vesting pool created:', metadataId);
      console.log('Transaction ID:', txId);

      // Create pool data
      const pool: VestingPool = {
        id: metadataId,
        streamflowId: metadataId,
        totalAmount: config.totalAmount,
        users: userAllocations.map(u => ({
          wallet: u.wallet,
          sharePercentage: u.sharePercentage,
          claimed: 0,
          feePaid: false,
        })),
        nftTiers: config.nftTiers,
        config,
        createdAt: Date.now(),
      };

      // Store pool (in production, save to database)
      this.pools.set(metadataId, pool);

      return pool;
    } catch (error) {
      console.error('Error creating vesting pool:', error);
      throw error;
    }
  }

  /**
   * Calculate how much a user can claim from the pool
   */
  async calculateUserClaimable(
    poolId: string,
    userWallet: PublicKey,
    skipNFTCheck: boolean = false
  ): Promise<{ claimable: number; percentage: number; eligible: boolean; totalAllocation: number }> {
    const pool = this.pools.get(poolId);
    if (!pool) {
      throw new Error('Pool not found');
    }

    // Find user allocation
    const userAlloc = pool.users.find(u => u.wallet.equals(userWallet));
    if (!userAlloc) {
      return { claimable: 0, percentage: 0, eligible: false, totalAllocation: 0 };
    }

    const now = Math.floor(Date.now() / 1000);
    const { config } = pool;

    // Calculate user's total allocation from pool
    const userTotalAllocation = (pool.totalAmount * userAlloc.sharePercentage) / 100;

    let nftPercentage = 100;

    // Check NFT eligibility (optional)
    if (!skipNFTCheck && config.nftTiers && config.nftTiers.length > 0) {
      const eligibility = await this.nftChecker.checkEligibility(
        userWallet,
        config.nftTiers
      );

      if (!eligibility.eligible) {
        return { claimable: 0, percentage: 0, eligible: false, totalAllocation: userTotalAllocation };
      }
      nftPercentage = eligibility.percentage;
    }

    // Calculate vested percentage based on time
    let vestedPercentage = 0;

    if (now < config.cliffTime) {
      vestedPercentage = 0;
    } else if (now >= config.endTime) {
      vestedPercentage = 100;
    } else {
      const elapsed = now - config.cliffTime;
      const total = config.endTime - config.cliffTime;
      vestedPercentage = (elapsed / total) * 100;
    }

    // Calculate claimable amount
    const effectivePercentage = (vestedPercentage * nftPercentage) / 100;
    const totalClaimable = (userTotalAllocation * effectivePercentage) / 100;
    const claimable = Math.floor(totalClaimable - userAlloc.claimed);

    return {
      claimable: Math.max(0, claimable),
      percentage: nftPercentage,
      eligible: true,
      totalAllocation: userTotalAllocation,
    };
  }

  /**
   * User claims their share from the pool
   * Admin withdraws from Streamflow and transfers to user
   */
  async claimFromPool(
    poolId: string,
    userKeypair: Keypair,
    adminKeypair: Keypair,
    skipNFTCheck: boolean = false
  ): Promise<ClaimResult> {
    try {
      const pool = this.pools.get(poolId);
      if (!pool) {
        return { success: false, error: 'Pool not found' };
      }

      const userWallet = userKeypair.publicKey;

      // Calculate claimable
      const { claimable, eligible } = await this.calculateUserClaimable(
        poolId,
        userWallet,
        skipNFTCheck
      );

      if (!eligible) {
        return { success: false, error: 'User does not meet NFT requirements' };
      }

      if (claimable <= 0) {
        return { success: false, error: 'No tokens available to claim yet' };
      }

      // Find user allocation
      const userAlloc = pool.users.find(u => u.wallet.equals(userWallet));
      if (!userAlloc) {
        return { success: false, error: 'User not in pool' };
      }

      // Check if user needs to pay fee
      let feePaid = 0;
      if (!userAlloc.feePaid) {
        // Create fee payment transaction
        const feeTransaction = new Transaction();
        const feeInLamports = this.claimFeeSOL * LAMPORTS_PER_SOL;
        
        feeTransaction.add(
          SystemProgram.transfer({
            fromPubkey: userWallet,
            toPubkey: this.feeWallet,
            lamports: feeInLamports,
          })
        );

        const { blockhash } = await this.connection.getLatestBlockhash();
        feeTransaction.recentBlockhash = blockhash;
        feeTransaction.feePayer = userWallet;
        feeTransaction.sign(userKeypair);

        const feeSignature = await this.connection.sendRawTransaction(
          feeTransaction.serialize()
        );
        await this.connection.confirmTransaction(feeSignature);

        console.log('Fee paid:', feeSignature);
        userAlloc.feePaid = true;
        feePaid = this.claimFeeSOL;
      }

      // Admin withdraws from Streamflow
      const withdrawResult = await this.streamClient.withdraw(
        {
          id: pool.streamflowId,
          amount: getBN(claimable, 9),
        },
        { invoker: adminKeypair }
      );

      console.log('Withdrawn from stream:', withdrawResult.txId);

      // Transfer tokens from admin to user
      const adminTokenAccount = await getAssociatedTokenAddress(
        pool.config.tokenMint,
        adminKeypair.publicKey
      );

      const userTokenAccount = await getAssociatedTokenAddress(
        pool.config.tokenMint,
        userWallet
      );

      const transferTransaction = new Transaction();
      transferTransaction.add(
        createTransferInstruction(
          adminTokenAccount,
          userTokenAccount,
          adminKeypair.publicKey,
          claimable
        )
      );

      const { blockhash: transferBlockhash } = await this.connection.getLatestBlockhash();
      transferTransaction.recentBlockhash = transferBlockhash;
      transferTransaction.feePayer = adminKeypair.publicKey;
      transferTransaction.sign(adminKeypair);

      const transferSignature = await this.connection.sendRawTransaction(
        transferTransaction.serialize()
      );
      await this.connection.confirmTransaction(transferSignature);

      console.log('Tokens transferred to user:', transferSignature);

      // Update claimed amount
      userAlloc.claimed += claimable;

      return {
        success: true,
        signature: transferSignature,
        amountClaimed: claimable,
        feePaid,
      };
    } catch (error) {
      console.error('Error claiming from pool:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get pool information
   */
  getPool(poolId: string): VestingPool | undefined {
    return this.pools.get(poolId);
  }

  /**
   * Get user's status in a pool
   */
  getUserStatus(poolId: string, userWallet: PublicKey) {
    const pool = this.pools.get(poolId);
    if (!pool) return null;

    const userAlloc = pool.users.find(u => u.wallet.equals(userWallet));
    return userAlloc;
  }

  /**
   * Refill/topup a vesting pool with additional tokens
   * @param poolId - The pool ID to refill
   * @param admin - Admin keypair (must be the pool owner)
   * @param amount - Amount of tokens to add (in base units, e.g., lamports for 9 decimals)
   */
  async topupPool(
    poolId: string,
    admin: Keypair,
    amount: number
  ): Promise<{ success: boolean; txId?: string; error?: string }> {
    try {
      const pool = this.pools.get(poolId);
      if (!pool) {
        return { success: false, error: 'Pool not found' };
      }

      // Prepare topup parameters
      const topupParams: ITopUpData = {
        id: pool.streamflowId,
        amount: getBN(amount, 9),
      };

      // Execute topup
      const { txId } = await this.streamClient.topup(
        topupParams,
        { invoker: admin }
      );

      console.log('Pool topped up successfully');
      console.log('Transaction ID:', txId);
      console.log('Amount added:', amount / 1e9, 'tokens');

      // Update pool total amount
      pool.totalAmount += amount;

      return {
        success: true,
        txId,
      };
    } catch (error) {
      console.error('Error topping up pool:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
