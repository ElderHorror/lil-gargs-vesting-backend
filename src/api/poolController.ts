import { Request, Response } from 'express';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { SupabaseService } from '../services/supabaseService';
import { StreamflowService } from '../services/streamflowService';
import { config } from '../config';
import { getSupabaseClient } from '../lib/supabaseClient';

/**
 * Pool Management API Controller
 * Handles vesting pool operations (list, details, topup, activity)
 */
export class PoolController {
  private dbService: SupabaseService;
  private connection: Connection;
  private streamflowService: StreamflowService;

  constructor() {
    const supabaseClient = getSupabaseClient();
    this.dbService = new SupabaseService(supabaseClient);
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    this.streamflowService = new StreamflowService();
  }

  /**
   * POST /api/pools
   * Create a new vesting pool
   */
  async createPool(req: Request, res: Response) {
    try {
      const {
        name,
        description,
        total_pool_amount,
        vesting_duration_days,
        cliff_duration_days,
        vesting_duration_seconds,
        cliff_duration_seconds,
        start_time,
        end_time,
        is_active,
        vesting_mode,
        rules, // Array of eligibility rules from frontend
        manual_allocations, // Array of {wallet, amount, tier?, note?} for manual mode
      } = req.body;

      if (!name || !total_pool_amount || vesting_duration_days === undefined) {
        return res.status(400).json({
          error: 'name, total_pool_amount, and vesting_duration_days are required',
        });
      }

      // Allow fractional days for testing (minimum 0.001 days = ~1.5 minutes)
      if (vesting_duration_days < 0.001) {
        return res.status(400).json({
          error: 'vesting_duration_days must be at least 0.001 (about 1.5 minutes)',
        });
      }

      // Convert fractional days to integer (round up to at least 1 day for DB storage)
      // For short test durations, we'll use 1 day in DB but track actual duration via start/end times
      const durationDaysInt = Math.max(1, Math.ceil(vesting_duration_days));
      const cliffDaysInt = cliff_duration_days ? Math.max(0, Math.ceil(cliff_duration_days)) : 0;

      // Convert rules to nft_requirements format
      const nftRequirements = rules ? rules.map((rule: any) => ({
        name: rule.name,
        nftContract: rule.nftContract,
        threshold: rule.threshold,
        allocationType: rule.allocationType,
        allocationValue: rule.allocationValue,
        enabled: rule.enabled !== false, // Default to true
      })) : [];

      const { data: stream, error } = await this.dbService.supabase
        .from('vesting_streams')
        .insert({
          name,
          description: description || '',
          total_pool_amount,
          vesting_duration_days: durationDaysInt,
          cliff_duration_days: cliffDaysInt,
          vesting_duration_seconds: vesting_duration_seconds || (vesting_duration_days * 86400),
          cliff_duration_seconds: cliff_duration_seconds || (cliffDaysInt * 86400),
          start_time: start_time || new Date().toISOString(),
          end_time: end_time || new Date(Date.now() + vesting_duration_days * 24 * 60 * 60 * 1000).toISOString(),
          is_active: is_active !== undefined ? is_active : true,
          vesting_mode: vesting_mode || 'snapshot',
          snapshot_taken: vesting_mode === 'manual' ? true : false, // Manual allocations are pre-taken
          nft_requirements: nftRequirements,
          tier_allocations: {}, // Empty object for now
          grace_period_days: 30,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create pool: ${error.message}`);
      }

      // If manual mode, create allocations for specified wallets
      if (vesting_mode === 'manual' && manual_allocations && Array.isArray(manual_allocations)) {
        console.log(`Creating ${manual_allocations.length} manual allocations...`);
        
        for (const allocation of manual_allocations) {
          const { wallet, allocationType, allocationValue, note } = allocation;
          
          // Calculate token amount based on allocation type
          let tokenAmount: number;
          let sharePercentage: number;
          
          if (allocationType === 'PERCENTAGE') {
            sharePercentage = allocationValue;
            tokenAmount = (total_pool_amount * allocationValue) / 100;
          } else {
            // FIXED
            tokenAmount = allocationValue;
            sharePercentage = (allocationValue / total_pool_amount) * 100;
          }

          const { error: vestingError } = await this.dbService.supabase
            .from('vestings')
            .insert({
              vesting_stream_id: stream.id,
              user_wallet: wallet,
              token_amount: tokenAmount,
              share_percentage: sharePercentage,
              tier: 1,
              nft_count: 0,
              is_active: true,
              is_cancelled: false,
            });

          if (vestingError) {
            console.error(`Failed to create vesting for ${wallet}:`, vestingError);
          } else {
            console.log(`✅ Allocated ${tokenAmount} tokens (${sharePercentage.toFixed(2)}%) to ${wallet}${note ? ' (' + note + ')' : ''}`);
          }
        }
      }

      // Auto-deploy to Streamflow
      let streamflowId = null;
      let streamflowSignature = null;
      
      try {
        console.log('Auto-deploying pool to Streamflow...');
        
        // Parse admin keypair
        let adminKeypair: Keypair;
        if (config.adminPrivateKey.startsWith('[')) {
          const secretKey = Uint8Array.from(JSON.parse(config.adminPrivateKey));
          adminKeypair = Keypair.fromSecretKey(secretKey);
        } else {
          const decoded = bs58.decode(config.adminPrivateKey);
          adminKeypair = Keypair.fromSecretKey(decoded);
        }

        const startTimestamp = Math.floor(new Date(stream.start_time).getTime() / 1000);
        const endTimestamp = Math.floor(new Date(stream.end_time).getTime() / 1000);
        
        const streamflowResult = await this.streamflowService.createVestingPool({
          adminKeypair,
          tokenMint: config.customTokenMint!,
          totalAmount: stream.total_pool_amount,
          startTime: startTimestamp,
          endTime: endTimestamp,
          poolName: stream.name,
        });

        streamflowId = streamflowResult.streamId;
        streamflowSignature = streamflowResult.signature;

        // Update DB with Streamflow ID
        await this.dbService.supabase
          .from('vesting_streams')
          .update({ streamflow_stream_id: streamflowId })
          .eq('id', stream.id);

        console.log('Pool deployed to Streamflow:', streamflowId);
      } catch (streamflowError) {
        console.error('Failed to deploy to Streamflow (pool still created in DB):', streamflowError);
        // Don't fail the entire request - pool is still created in DB
      }

      res.json({
        success: true,
        stream: {
          ...stream,
          streamflow_stream_id: streamflowId,
        },
        streamflowDeployed: !!streamflowId,
        streamflowSignature,
      });
    } catch (error) {
      console.error('Failed to create pool:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/pools
   * List all vesting pools with Streamflow status
   */
  async listPools(req: Request, res: Response) {
    try {
      // Get all vesting streams from database
      const { data: streams, error } = await this.dbService.supabase
        .from('vesting_streams')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch pools: ${error.message}`);
      }

      // Enrich with Streamflow status and stats
      const pools = await Promise.all((streams || []).map(async (stream: any) => {
        // Get user count and allocation stats
        const { data: vestings } = await this.dbService.supabase
          .from('vestings')
          .select('token_amount')
          .eq('vesting_stream_id', stream.id)
          .eq('is_active', true);

        const totalAllocated = vestings?.reduce((sum: number, v: any) => sum + Number(v.token_amount), 0) || 0;
        const userCount = vestings?.length || 0;

        // Get Streamflow status if deployed
        let streamflowStatus = null;
        if (stream.streamflow_stream_id && this.streamflowService) {
          try {
            const status = await this.streamflowService.getPoolStatus(stream.streamflow_stream_id);
            streamflowStatus = {
              vestedAmount: status.withdrawnAmount,
              depositedAmount: status.depositedAmount,
              vestedPercentage: (status.withdrawnAmount / status.depositedAmount) * 100,
            };
          } catch (err) {
            console.error('Failed to get Streamflow status:', err);
          }
        }

        return {
          id: stream.id,
          name: stream.name,
          description: stream.description,
          totalAmount: stream.total_pool_amount,
          vestingDuration: stream.vesting_duration_days,
          cliffDuration: stream.cliff_duration_days,
          isActive: stream.is_active,
          startTime: stream.start_time,
          endTime: stream.end_time,
          streamflowId: stream.streamflow_stream_id,
          vestingMode: stream.vesting_mode,
          createdAt: stream.created_at,
          stats: {
            userCount,
            totalAllocated,
          },
          streamflow: streamflowStatus,
        };
      }));

      res.json(pools);
    } catch (error) {
      console.error('Failed to list pools:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/pools/:id
   * Get pool details
   */
  async getPoolDetails(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'Pool ID is required' });
      }

      // Get pool from database
      const { data: stream, error } = await this.dbService.supabase
        .from('vesting_streams')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !stream) {
        return res.status(404).json({ error: 'Pool not found' });
      }

      res.json({
        id: stream.id,
        name: stream.name,
        description: stream.description,
        totalAmount: stream.total_pool_amount,
        vestingDuration: stream.vesting_duration_days,
        cliffDuration: stream.cliff_duration_days,
        isActive: stream.is_active,
        startTime: stream.start_time,
        endTime: stream.end_time,
        createdAt: stream.created_at,
        nftRequirements: stream.nft_requirements || [],
        tierAllocations: stream.tier_allocations || {},
        vestingMode: stream.vesting_mode,
      });
    } catch (error) {
      console.error('Failed to get pool details:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * PUT /api/pools/:id/rules
   * Update a rule in the pool's nft_requirements
   */
  async updatePoolRule(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { ruleId, name, nftContract, threshold, allocationType, allocationValue } = req.body;

      if (!id || !ruleId) {
        return res.status(400).json({ error: 'Pool ID and rule ID are required' });
      }

      // Get current pool
      const { data: pool, error: fetchError } = await this.dbService.supabase
        .from('vesting_streams')
        .select('nft_requirements')
        .eq('id', id)
        .single();

      if (fetchError || !pool) {
        return res.status(404).json({ error: 'Pool not found' });
      }

      // Update the specific rule
      const nftRequirements = pool.nft_requirements || [];
      const ruleIndex = nftRequirements.findIndex((r: any) => 
        r.name === ruleId || nftRequirements.indexOf(r).toString() === ruleId.replace('rule-', '')
      );

      if (ruleIndex === -1) {
        return res.status(404).json({ error: 'Rule not found' });
      }

      nftRequirements[ruleIndex] = {
        name,
        collection: nftContract,
        min_nfts: threshold,
        allocationType,
        allocationValue,
      };

      // Update pool
      const { error: updateError } = await this.dbService.supabase
        .from('vesting_streams')
        .update({ nft_requirements: nftRequirements })
        .eq('id', id);

      if (updateError) {
        throw new Error(`Failed to update rule: ${updateError.message}`);
      }

      res.json({
        success: true,
        message: 'Rule updated successfully',
      });
    } catch (error) {
      console.error('Failed to update pool rule:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/pools/:id/streamflow-status
   * Get Streamflow pool status (vested amount, remaining, etc)
   */
  async getStreamflowStatus(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Get pool details
      const { data: pool, error: fetchError } = await this.dbService.supabase
        .from('vesting_streams')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !pool) {
        return res.status(404).json({ error: 'Pool not found' });
      }

      if (!pool.streamflow_stream_id) {
        return res.json({
          deployed: false,
          message: 'Pool not deployed to Streamflow',
        });
      }

      // Get Streamflow status
      const status = await this.streamflowService.getPoolStatus(pool.streamflow_stream_id);
      const vestedAmount = await this.streamflowService.getVestedAmount(pool.streamflow_stream_id);

      res.json({
        deployed: true,
        streamflowId: pool.streamflow_stream_id,
        ...status,
        vestedAmount,
        vestedPercentage: (vestedAmount / status.depositedAmount) * 100,
      });
    } catch (error) {
      console.error('Failed to get Streamflow status:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/pools/:id/rules
   * Add a new snapshot rule to an existing pool
   */
  async addRule(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { name, nftContract, threshold, allocationType, allocationValue, enabled } = req.body;

      // Get current pool
      const { data: pool, error: fetchError } = await this.dbService.supabase
        .from('vesting_streams')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !pool) {
        return res.status(404).json({ error: 'Pool not found' });
      }

      // Only allow adding rules to dynamic pools
      if (pool.vesting_mode !== 'dynamic') {
        return res.status(400).json({ 
          error: 'Can only add rules to dynamic pools. Snapshot pools are immutable after creation.' 
        });
      }

      // Get existing rules
      const existingRules = pool.nft_requirements || [];

      // Create new rule
      const newRule = {
        id: `rule-${Date.now()}`,
        name,
        nftContract,
        threshold,
        allocationType,
        allocationValue,
        enabled: enabled !== false,
      };

      // Add to rules array
      const updatedRules = [...existingRules, newRule];

      // Update pool
      const { error: updateError } = await this.dbService.supabase
        .from('vesting_streams')
        .update({ nft_requirements: updatedRules })
        .eq('id', id);

      if (updateError) {
        throw new Error(`Failed to update pool: ${updateError.message}`);
      }

      res.json({
        success: true,
        rule: newRule,
        message: 'Rule added successfully. Dynamic sync will process new allocations.',
      });
    } catch (error) {
      console.error('Failed to add rule:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/pools/:id/sync
   * Manually trigger sync for a dynamic pool
   */
  async syncPool(req: Request, res: Response) {
    try {
      const { id } = req.params;
      
      // Get pool
      const { data: pool } = await this.dbService.supabase
        .from('vesting_streams')
        .select('*')
        .eq('id', id)
        .single();
      
      if (!pool) {
        return res.status(404).json({ error: 'Pool not found' });
      }
      
      if (pool.vesting_mode !== 'dynamic') {
        return res.status(400).json({ error: 'Can only sync dynamic pools' });
      }
      
      console.log('🔄 Manually triggering sync for pool:', pool.name);
      
      // Import and run sync
      const { syncDynamicPool } = require('../utils/syncDynamicPool');
      await syncDynamicPool(pool);
      
      res.json({ success: true, message: 'Sync completed' });
    } catch (error) {
      console.error('Sync failed:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Sync failed' });
    }
  }

  /**
   * DELETE /api/pools/:id
   * Cancel/deactivate a vesting pool
   */
  async cancelPool(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Get pool details
      const { data: pool, error: fetchError } = await this.dbService.supabase
        .from('vesting_streams')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !pool) {
        return res.status(404).json({ error: 'Pool not found' });
      }

      // Check if pool is snapshot mode and already has allocations
      if (pool.vesting_mode === 'snapshot') {
        const { data: vestings } = await this.dbService.supabase
          .from('vestings')
          .select('id')
          .eq('vesting_stream_id', id)
          .eq('snapshot_locked', true);

        if (vestings && vestings.length > 0) {
          return res.status(400).json({ 
            error: 'Cannot cancel snapshot pool with locked allocations. Users have already been allocated tokens.' 
          });
        }
      }

      // Cancel Streamflow pool if deployed
      if (pool.streamflow_stream_id && this.streamflowService) {
        try {
          // Parse admin keypair
          let adminKeypair: Keypair;
          if (config.adminPrivateKey.startsWith('[')) {
            const secretKey = Uint8Array.from(JSON.parse(config.adminPrivateKey));
            adminKeypair = Keypair.fromSecretKey(secretKey);
          } else {
            const decoded = bs58.decode(config.adminPrivateKey);
            adminKeypair = Keypair.fromSecretKey(decoded);
          }

          await this.streamflowService.cancelPool(pool.streamflow_stream_id, adminKeypair);
          console.log('Streamflow pool cancelled:', pool.streamflow_stream_id);
        } catch (err) {
          console.error('Failed to cancel Streamflow pool:', err);
          // Continue with DB deactivation even if Streamflow cancel fails
        }
      }

      // Deactivate pool in database
      const { error: updateError } = await this.dbService.supabase
        .from('vesting_streams')
        .update({ is_active: false })
        .eq('id', id);

      if (updateError) {
        throw new Error(`Failed to deactivate pool: ${updateError.message}`);
      }

      // Deactivate all user vestings
      await this.dbService.supabase
        .from('vestings')
        .update({ is_active: false, is_cancelled: true, cancelled_at: new Date().toISOString() })
        .eq('vesting_stream_id', id);

      res.json({
        success: true,
        message: 'Pool cancelled successfully',
      });
    } catch (error) {
      console.error('Failed to cancel pool:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/pools/:id/deploy-streamflow
   * Deploy pool to Streamflow (creates on-chain vesting stream)
   */
  async deployToStreamflow(req: Request, res: Response) {
    try {
      const { id } = req.params;

      // Get pool details
      const { data: pool, error: fetchError } = await this.dbService.supabase
        .from('vesting_streams')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !pool) {
        return res.status(404).json({ error: 'Pool not found' });
      }

      if (pool.streamflow_stream_id) {
        return res.status(400).json({ error: 'Pool already deployed to Streamflow' });
      }

      // Parse admin keypair
      let adminKeypair: Keypair;
      try {
        if (config.adminPrivateKey.startsWith('[')) {
          const secretKey = Uint8Array.from(JSON.parse(config.adminPrivateKey));
          adminKeypair = Keypair.fromSecretKey(secretKey);
        } else {
          const decoded = bs58.decode(config.adminPrivateKey);
          adminKeypair = Keypair.fromSecretKey(decoded);
        }
      } catch (err) {
        return res.status(500).json({ error: 'Invalid admin key configuration' });
      }

      // Create Streamflow pool
      const startTime = Math.floor(new Date(pool.start_time).getTime() / 1000);
      const endTime = Math.floor(new Date(pool.end_time).getTime() / 1000);
      
      const result = await this.streamflowService.createVestingPool({
        adminKeypair,
        tokenMint: config.customTokenMint!,
        totalAmount: pool.total_pool_amount,
        startTime,
        endTime,
        poolName: pool.name,
      });

      // Update database with Streamflow ID
      const { error: updateError } = await this.dbService.supabase
        .from('vesting_streams')
        .update({ streamflow_stream_id: result.streamId })
        .eq('id', id);

      if (updateError) {
        throw new Error(`Failed to update pool: ${updateError.message}`);
      }

      res.json({
        success: true,
        streamflowId: result.streamId,
        signature: result.signature,
        message: 'Pool deployed to Streamflow successfully',
      });
    } catch (error) {
      console.error('Failed to deploy to Streamflow:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/pools/:id/topup
   * Top up a vesting pool (not implemented - manual transfers only)
   */
  async topupPool(req: Request, res: Response) {
    res.status(501).json({
      error: 'Topup not implemented. Admin manually transfers tokens for claims.',
    });
  }

  /**
   * GET /api/pools/:id/activity
   * Get pool vestings (user allocations)
   */
  async getPoolActivity(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'Pool ID is required' });
      }

      // Get all vestings for this pool
      const { data: vestings, error } = await this.dbService.supabase
        .from('vestings')
        .select('*')
        .eq('vesting_stream_id', id)
        .eq('is_active', true);

      if (error) {
        throw new Error(`Failed to fetch vestings: ${error.message}`);
      }

      res.json(vestings || []);
    } catch (error) {
      console.error('Failed to get pool activity:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/pools/:id/users/:wallet
   * Get user status in pool
   */
  async getUserStatus(req: Request, res: Response) {
    try {
      const { id, wallet } = req.params;

      if (!id || !wallet) {
        return res.status(400).json({ error: 'Pool ID and wallet are required' });
      }

      // Get user vesting record
      const { data: vesting, error } = await this.dbService.supabase
        .from('vestings')
        .select('*')
        .eq('vesting_stream_id', id)
        .eq('user_wallet', wallet)
        .single();

      if (error || !vesting) {
        return res.status(404).json({ error: 'User not found in pool' });
      }

      res.json({
        wallet: vesting.user_wallet,
        tokenAmount: vesting.token_amount,
        isActive: vesting.is_active,
        isCancelled: vesting.is_cancelled,
        createdAt: vesting.created_at,
      });
    } catch (error) {
      console.error('Failed to get user status:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
