import { Request, Response } from 'express';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import { SupabaseService } from '../services/supabaseService';
import { config } from '../config';
import { getSupabaseClient } from '../lib/supabaseClient';

/**
 * Treasury Management API Controller
 * Monitors treasury wallet balance vs allocated/claimed amounts
 */
export class TreasuryController {
  private dbService: SupabaseService;
  private connection: Connection;

  constructor() {
    const supabaseClient = getSupabaseClient();
    this.dbService = new SupabaseService(supabaseClient);
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
  }

  /**
   * GET /api/treasury/status
   * Get treasury wallet status and allocation tracking
   */
  async getTreasuryStatus(req: Request, res: Response) {
    try {
      // Parse treasury keypair to get public key
      let treasuryPublicKey: PublicKey;
      try {
        if (config.treasuryPrivateKey.startsWith('[')) {
          // JSON array format: [1,2,3,...]
          const secretKey = Uint8Array.from(JSON.parse(config.treasuryPrivateKey));
          const keypair = Keypair.fromSecretKey(secretKey);
          treasuryPublicKey = keypair.publicKey;
        } else {
          // Base58 format (default Solana format)
          const decoded = bs58.decode(config.treasuryPrivateKey);
          const keypair = Keypair.fromSecretKey(decoded);
          treasuryPublicKey = keypair.publicKey;
        }
      } catch (err) {
        console.error('Failed to parse treasury key:', err);
        return res.status(500).json({ 
          error: 'Invalid treasury key configuration',
          hint: 'Treasury key must be in base58 or JSON array format'
        });
      }

      // Get treasury token balance
      const tokenMint = new PublicKey(config.customTokenMint!);
      const treasuryTokenAccount = await getAssociatedTokenAddress(
        tokenMint,
        treasuryPublicKey
      );

      let treasuryBalance = 0;
      const TOKEN_DECIMALS = 9;
      const TOKEN_DIVISOR = Math.pow(10, TOKEN_DECIMALS);
      
      try {
        const accountInfo = await getAccount(this.connection, treasuryTokenAccount);
        // Convert from base units (lamports) to human-readable tokens
        treasuryBalance = Number(accountInfo.amount) / TOKEN_DIVISOR;
      } catch (err) {
        // Token account doesn't exist yet
        treasuryBalance = 0;
      }

      // Get total allocated from database
      const { data: vestings } = await this.dbService.supabase
        .from('vestings')
        .select('token_amount')
        .eq('is_active', true)
        .eq('is_cancelled', false);

      const totalAllocated = vestings?.reduce((sum: number, v: any) => sum + v.token_amount, 0) || 0;

      // Get total claimed
      const { data: claims } = await this.dbService.supabase
        .from('claims')
        .select('amount_claimed');

      const totalClaimed = claims?.reduce((sum: number, c: any) => sum + Number(c.amount_claimed), 0) || 0;

      // Calculate metrics
      const remainingNeeded = totalAllocated - totalClaimed;
      const buffer = treasuryBalance - remainingNeeded;
      const bufferPercentage = remainingNeeded > 0 ? (buffer / remainingNeeded) * 100 : 0;

      // Determine status
      let status: 'healthy' | 'warning' | 'critical';
      if (buffer >= remainingNeeded * 0.2) {
        status = 'healthy'; // 20%+ buffer
      } else if (buffer >= 0) {
        status = 'warning'; // Some buffer but less than 20%
      } else {
        status = 'critical'; // Insufficient funds
      }

      // Get Streamflow pool info if deployed
      let streamflowPoolBalance = 0;
      try {
        const { data: activePool } = await this.dbService.supabase
          .from('vesting_streams')
          .select('streamflow_stream_id, total_pool_amount')
          .eq('is_active', true)
          .single();

        if (activePool?.streamflow_stream_id) {
          // Note: Would need StreamflowService here to get actual balance
          // For now, use the pool's total amount as reference
          streamflowPoolBalance = activePool.total_pool_amount;
        }
      } catch (err) {
        // No active pool or Streamflow not deployed
      }

      res.json({
        success: true,
        treasury: {
          address: treasuryPublicKey.toBase58(),
          balance: treasuryBalance,
          tokenMint: tokenMint.toBase58(),
        },
        allocations: {
          totalAllocated,
          totalClaimed,
          remainingNeeded,
        },
        status: {
          health: status,
          buffer,
          bufferPercentage: Math.round(bufferPercentage),
          sufficientFunds: buffer >= 0,
        },
        streamflow: {
          deployed: streamflowPoolBalance > 0,
          poolBalance: streamflowPoolBalance,
        },
        recommendations: this.getRecommendations(status, buffer, remainingNeeded),
      });
    } catch (error) {
      console.error('Failed to get treasury status:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/treasury/pools
   * Get treasury allocation breakdown by pool
   */
  async getPoolBreakdown(req: Request, res: Response) {
    try {
      const { data: streams } = await this.dbService.supabase
        .from('vesting_streams')
        .select('*')
        .eq('is_active', true);

      if (!streams) {
        return res.json({ success: true, pools: [] });
      }

      const poolBreakdown = [];

      for (const stream of streams) {
        // Get allocations for this pool
        const { data: vestings } = await this.dbService.supabase
          .from('vesting')
          .select('token_amount, user_wallet')
          .eq('vesting_stream_id', stream.id)
          .eq('is_active', true);

        const totalAllocated = vestings?.reduce((sum: number, v: any) => sum + v.token_amount, 0) || 0;
        const userCount = vestings?.length || 0;

        // Get claims for this pool
        const { data: claims } = await this.dbService.supabase
          .from('claims')
          .select('amount_claimed, vesting_id')
          .in('vesting_id', vestings?.map((v: any) => v.user_wallet) || []);

        const totalClaimed = claims?.reduce((sum: number, c: any) => sum + Number(c.amount_claimed), 0) || 0;

        poolBreakdown.push({
          id: stream.id,
          name: stream.name,
          description: stream.description,
          totalAllocated,
          totalClaimed,
          remainingNeeded: totalAllocated - totalClaimed,
          userCount,
          vestingDuration: stream.vesting_duration_days,
          cliffDuration: stream.cliff_duration_days,
          startTime: stream.start_time,
          endTime: stream.end_time,
        });
      }

      res.json({
        success: true,
        pools: poolBreakdown,
        summary: {
          totalPools: poolBreakdown.length,
          totalAllocated: poolBreakdown.reduce((sum, p) => sum + p.totalAllocated, 0),
          totalClaimed: poolBreakdown.reduce((sum, p) => sum + p.totalClaimed, 0),
          totalUsers: poolBreakdown.reduce((sum, p) => sum + p.userCount, 0),
        },
      });
    } catch (error) {
      console.error('Failed to get pool breakdown:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private getRecommendations(
    status: 'healthy' | 'warning' | 'critical',
    buffer: number,
    remainingNeeded: number
  ): string[] {
    const recommendations: string[] = [];

    if (status === 'critical') {
      recommendations.push('⚠️ URGENT: Treasury has insufficient funds to cover remaining vesting allocations');
      recommendations.push(`Transfer at least ${Math.abs(buffer)} tokens to treasury wallet immediately`);
    } else if (status === 'warning') {
      recommendations.push('⚠️ Treasury buffer is low (less than 20% of remaining needed)');
      recommendations.push(`Consider adding ${Math.ceil(remainingNeeded * 0.2 - buffer)} more tokens as buffer`);
    } else {
      recommendations.push('✅ Treasury is healthy with sufficient buffer');
    }

    return recommendations;
  }
}
