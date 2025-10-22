import { Request, Response } from 'express';
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import { SupabaseService } from '../services/supabaseService';
import { StreamflowService } from '../services/streamflowService';
import { config } from '../config';
import { getSupabaseClient } from '../lib/supabaseClient';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: {
    timestamp: { valid: boolean; message: string; adjustedStart?: number };
    solBalance: { valid: boolean; current: number; required: number; message: string };
    tokenBalance: { valid: boolean; current: number; required: number; message: string };
    treasury: { valid: boolean; address: string };
    allocations: { valid: boolean; total: number; message: string };
  };
  canProceedWithoutStreamflow: boolean;
}

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
   * Validate pool creation requirements
   */
  private async validatePoolCreation(params: {
    start_time?: string;
    total_pool_amount: number;
    vesting_mode: string;
    manual_allocations?: Array<{ allocationType: string; allocationValue: number }>;
    rules?: Array<{ 
      name: string; 
      nftContract: string; 
      threshold: number; 
      allocationType: string; 
      allocationValue: number;
      enabled: boolean;
    }>;
  }): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      checks: {
        timestamp: { valid: true, message: '' },
        solBalance: { valid: true, current: 0, required: 0.015, message: '' }, // ~0.01266 SOL + buffer
        tokenBalance: { valid: true, current: 0, required: params.total_pool_amount, message: '' },
        treasury: { valid: true, address: '' },
        allocations: { valid: true, total: 0, message: '' },
      },
      canProceedWithoutStreamflow: true,
    };

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
      result.checks.treasury.address = adminKeypair.publicKey.toBase58();

      // 1. Validate timestamp
      const startTimestamp = params.start_time 
        ? Math.floor(new Date(params.start_time).getTime() / 1000)
        : Math.floor(Date.now() / 1000);
      const nowTimestamp = Math.floor(Date.now() / 1000);

      if (startTimestamp < nowTimestamp) {
        result.checks.timestamp.valid = false;
        result.checks.timestamp.adjustedStart = nowTimestamp + 60;
        result.checks.timestamp.message = `Start time is in the past. Will be adjusted to ${new Date((nowTimestamp + 60) * 1000).toISOString()}`;
        result.warnings.push(result.checks.timestamp.message);
      } else {
        result.checks.timestamp.message = 'Start time is valid';
      }

      // 2. Check SOL balance
      const solBalance = await this.connection.getBalance(adminKeypair.publicKey);
      const solBalanceInSOL = solBalance / LAMPORTS_PER_SOL;
      result.checks.solBalance.current = solBalanceInSOL;

      if (solBalanceInSOL < 0.015) {
        result.checks.solBalance.valid = false;
        result.checks.solBalance.message = `Insufficient SOL for Streamflow deployment. Required: ~0.015 SOL, Available: ${solBalanceInSOL.toFixed(4)} SOL`;
        result.errors.push(result.checks.solBalance.message);
        result.valid = false;
      } else {
        result.checks.solBalance.message = `SOL balance sufficient: ${solBalanceInSOL.toFixed(4)} SOL`;
      }

      // 3. Check token balance
      if (config.customTokenMint) {
        try {
          const { getAssociatedTokenAddress } = await import('@solana/spl-token');
          const treasuryTokenAccount = await getAssociatedTokenAddress(
            config.customTokenMint,
            adminKeypair.publicKey
          );
          
          const tokenAccountInfo = await getAccount(this.connection, treasuryTokenAccount);
          const tokenBalance = Number(tokenAccountInfo.amount) / 1e9;
          result.checks.tokenBalance.current = tokenBalance;

          if (tokenBalance < params.total_pool_amount) {
            result.checks.tokenBalance.valid = false;
            result.checks.tokenBalance.message = `Insufficient tokens. Required: ${params.total_pool_amount}, Available: ${tokenBalance}`;
            result.errors.push(result.checks.tokenBalance.message);
            result.valid = false;
          } else {
            result.checks.tokenBalance.message = `Token balance sufficient: ${tokenBalance}`;
          }
        } catch (err) {
          result.checks.tokenBalance.valid = false;
          result.checks.tokenBalance.message = `Token account not found or error checking balance`;
          result.errors.push(result.checks.tokenBalance.message);
          result.valid = false;
        }
      }

      // 4. Validate allocations (manual mode only)
      if (params.vesting_mode === 'manual' && params.manual_allocations) {
        let totalPercentage = 0;
        let totalFixed = 0;

        for (const allocation of params.manual_allocations) {
          if (allocation.allocationType === 'PERCENTAGE') {
            totalPercentage += allocation.allocationValue;
          } else {
            totalFixed += allocation.allocationValue;
          }
        }

        result.checks.allocations.total = totalPercentage;

        // Check if percentages EXCEED 100% (ERROR - impossible to fulfill)
        if (totalPercentage > 100) {
          result.checks.allocations.valid = false;
          result.checks.allocations.message = `Percentage allocations sum to ${totalPercentage.toFixed(2)}%, which exceeds 100%. Cannot allocate more than the pool.`;
          result.errors.push(result.checks.allocations.message);
          result.valid = false;
        }
        // Warn if less than 100% (OK - remainder stays in treasury)
        else if (totalPercentage > 0 && totalPercentage < 100) {
          const unallocated = 100 - totalPercentage;
          result.checks.allocations.message = `Percentage allocations sum to ${totalPercentage.toFixed(2)}%. ${unallocated.toFixed(2)}% (${(params.total_pool_amount * unallocated / 100).toFixed(2)} tokens) will remain in treasury wallet.`;
          result.warnings.push(result.checks.allocations.message);
        }

        // Check if fixed amounts exceed pool (ERROR)
        if (totalFixed > params.total_pool_amount) {
          result.checks.allocations.valid = false;
          result.checks.allocations.message = `Fixed allocations (${totalFixed} tokens) exceed pool amount (${params.total_pool_amount} tokens)`;
          result.errors.push(result.checks.allocations.message);
          result.valid = false;
        }
        // Warn if fixed amounts leave remainder
        else if (totalFixed > 0 && totalFixed < params.total_pool_amount) {
          const unallocated = params.total_pool_amount - totalFixed;
          result.checks.allocations.message = `Fixed allocations total ${totalFixed} tokens. ${unallocated.toFixed(2)} tokens will remain in treasury wallet.`;
          result.warnings.push(result.checks.allocations.message);
        }

        if (result.checks.allocations.valid && result.checks.allocations.message === '') {
          result.checks.allocations.message = 'Allocations are valid (100% allocated)';
        }
      }

      // 5. Validate NFT rules (snapshot/dynamic modes)
      if ((params.vesting_mode === 'snapshot' || params.vesting_mode === 'dynamic') && params.rules) {
        // Check if at least one rule exists
        if (params.rules.length === 0) {
          result.checks.allocations.valid = false;
          result.checks.allocations.message = 'At least one NFT rule is required for snapshot/dynamic mode';
          result.errors.push(result.checks.allocations.message);
          result.valid = false;
        } else {
          let totalPercentage = 0;
          const enabledRules = params.rules.filter(r => r.enabled);

          if (enabledRules.length === 0) {
            result.warnings.push('No rules are enabled. Pool will have no eligible wallets.');
          }

          for (const rule of params.rules) {
            // Validate NFT contract address
            if (!rule.nftContract || rule.nftContract.length < 32) {
              result.checks.allocations.valid = false;
              result.checks.allocations.message = `Invalid NFT contract address in rule "${rule.name}"`;
              result.errors.push(result.checks.allocations.message);
              result.valid = false;
            }

            // Validate threshold
            if (rule.threshold <= 0) {
              result.checks.allocations.valid = false;
              result.checks.allocations.message = `Threshold must be greater than 0 in rule "${rule.name}"`;
              result.errors.push(result.checks.allocations.message);
              result.valid = false;
            }

            // Validate allocation value
            if (rule.allocationValue <= 0) {
              result.checks.allocations.valid = false;
              result.checks.allocations.message = `Allocation value must be greater than 0 in rule "${rule.name}"`;
              result.errors.push(result.checks.allocations.message);
              result.valid = false;
            }

            // Sum up percentages
            if (rule.allocationType === 'PERCENTAGE') {
              totalPercentage += rule.allocationValue;
            }
          }

          result.checks.allocations.total = totalPercentage;

          // Check if percentages exceed 100%
          if (totalPercentage > 100) {
            result.checks.allocations.valid = false;
            result.checks.allocations.message = `Rule allocations sum to ${totalPercentage.toFixed(2)}%, which exceeds 100%`;
            result.errors.push(result.checks.allocations.message);
            result.valid = false;
          } else if (totalPercentage > 0 && totalPercentage < 100) {
            const unallocated = 100 - totalPercentage;
            result.warnings.push(`Rule allocations sum to ${totalPercentage.toFixed(2)}%. ${unallocated.toFixed(2)}% of pool will remain unallocated.`);
          }

          if (result.checks.allocations.valid && result.checks.allocations.message === '') {
            result.checks.allocations.message = `${params.rules.length} rule(s) configured (${enabledRules.length} enabled)`;
          }
        }
      }

      // Determine if can proceed without Streamflow
      result.canProceedWithoutStreamflow = result.checks.treasury.valid && result.checks.allocations.valid;

    } catch (error) {
      result.valid = false;
      result.errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  /**
   * POST /api/pools/validate
   * Validate pool creation requirements before creating
   */
  async validatePool(req: Request, res: Response) {
    try {
      const { start_time, total_pool_amount, vesting_mode, manual_allocations, rules } = req.body;

      const validation = await this.validatePoolCreation({
        start_time,
        total_pool_amount,
        vesting_mode: vesting_mode || 'snapshot',
        manual_allocations,
        rules,
      });

      res.json(validation);
    } catch (error) {
      console.error('Failed to validate pool:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
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
        skipStreamflow, // Optional: skip Streamflow deployment
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

      // Run validation
      const validation = await this.validatePoolCreation({
        start_time,
        total_pool_amount,
        vesting_mode: vesting_mode || 'snapshot',
        manual_allocations,
      });

      // If validation fails and not skipping Streamflow, return error with options
      if (!validation.valid && !skipStreamflow) {
        return res.status(400).json({
          success: false,
          error: 'Pool validation failed',
          errorType: validation.checks.solBalance.valid ? 'INSUFFICIENT_TOKENS' : 'INSUFFICIENT_SOL',
          validation,
          options: {
            canProceedWithoutStreamflow: validation.canProceedWithoutStreamflow,
            canAdjustTimestamp: !validation.checks.timestamp.valid,
            adjustedTimestamp: validation.checks.timestamp.adjustedStart,
          },
          suggestions: [
            ...(!validation.checks.solBalance.valid ? [`Fund treasury wallet (${validation.checks.treasury.address}) with at least 0.015 SOL`] : []),
            ...(!validation.checks.tokenBalance.valid ? [`Fund treasury wallet with at least ${total_pool_amount} tokens`] : []),
            ...(validation.canProceedWithoutStreamflow ? ['Create pool without Streamflow deployment (database only)'] : []),
          ],
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

      // Auto-deploy to Streamflow (unless skipped)
      let streamflowId = null;
      let streamflowSignature = null;
      let streamflowError = null;
      
      if (!skipStreamflow) {
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
          const nowTimestamp = Math.floor(Date.now() / 1000);
          
          // Validate timestamps for Streamflow
          if (startTimestamp < nowTimestamp) {
            console.warn(`Start time ${startTimestamp} is in the past (now: ${nowTimestamp}). Adjusting to current time + 60 seconds.`);
            // Adjust start time to be 60 seconds in the future
            const adjustedStart = nowTimestamp + 60;
            const duration = endTimestamp - startTimestamp;
            const adjustedEnd = adjustedStart + duration;
            
            const streamflowResult = await this.streamflowService.createVestingPool({
              adminKeypair,
              tokenMint: config.customTokenMint!,
              totalAmount: stream.total_pool_amount,
              startTime: adjustedStart,
              endTime: adjustedEnd,
              poolName: stream.name,
            });
            
            streamflowId = streamflowResult.streamId;
            streamflowSignature = streamflowResult.signature;
          } else {
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
          }
          
          // Update DB with Streamflow ID
          await this.dbService.supabase
            .from('vesting_streams')
            .update({ streamflow_stream_id: streamflowId })
            .eq('id', stream.id);

          console.log('Pool deployed to Streamflow:', streamflowId);
        } catch (error) {
          streamflowError = error instanceof Error ? error.message : 'Unknown error';
          console.error('Failed to deploy to Streamflow (pool still created in DB):', streamflowError);
          // Don't fail the entire request - pool is still created in DB
        }
      } else {
        console.log('Skipping Streamflow deployment (skipStreamflow=true)');
      }

      res.json({
        success: true,
        stream: {
          ...stream,
          streamflow_stream_id: streamflowId,
        },
        streamflowDeployed: !!streamflowId,
        streamflowSignature,
        streamflowError,
        validation: !skipStreamflow ? validation : undefined,
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
          state: stream.state || 'active',
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
        state: stream.state || 'active',
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
   * PUT /api/pools/:id/allocations
   * Update manual pool allocations (add/remove/edit wallets)
   */
  async updateAllocations(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { allocations } = req.body;

      if (!id || !allocations || !Array.isArray(allocations)) {
        return res.status(400).json({ error: 'Pool ID and allocations array are required' });
      }

      // Get pool details
      const { data: pool, error: fetchError } = await this.dbService.supabase
        .from('vesting_streams')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !pool) {
        return res.status(404).json({ error: 'Pool not found' });
      }

      // Only allow editing manual mode pools
      if (pool.vesting_mode !== 'manual') {
        return res.status(400).json({ 
          error: 'Only manual mode pools can have allocations edited directly' 
        });
      }

      // Validate allocations
      let totalPercentage = 0;
      let totalFixed = 0;

      for (const allocation of allocations) {
        if (!allocation.wallet || allocation.wallet.length < 32) {
          return res.status(400).json({ 
            error: `Invalid wallet address: ${allocation.wallet}` 
          });
        }

        if (allocation.allocationValue <= 0) {
          return res.status(400).json({ 
            error: `Allocation value must be greater than 0 for wallet ${allocation.wallet}` 
          });
        }

        if (allocation.allocationType === 'PERCENTAGE') {
          totalPercentage += allocation.allocationValue;
        } else {
          totalFixed += allocation.allocationValue;
        }
      }

      // Check if percentages exceed 100%
      if (totalPercentage > 100) {
        return res.status(400).json({ 
          error: `Percentage allocations sum to ${totalPercentage.toFixed(2)}%, which exceeds 100%` 
        });
      }

      // Check if fixed amounts exceed pool
      if (totalFixed > pool.total_pool_amount) {
        return res.status(400).json({ 
          error: `Fixed allocations (${totalFixed}) exceed pool amount (${pool.total_pool_amount})` 
        });
      }

      // Delete existing vestings for this pool
      const { error: deleteError } = await this.dbService.supabase
        .from('vestings')
        .delete()
        .eq('vesting_stream_id', id);

      if (deleteError) {
        throw new Error(`Failed to delete old allocations: ${deleteError.message}`);
      }

      // Insert new allocations
      const vestingRecords = allocations.map((allocation: any) => {
        let tokenAmount: number;
        let sharePercentage: number;

        if (allocation.allocationType === 'PERCENTAGE') {
          sharePercentage = allocation.allocationValue;
          tokenAmount = (pool.total_pool_amount * allocation.allocationValue) / 100;
        } else {
          tokenAmount = allocation.allocationValue;
          sharePercentage = (allocation.allocationValue / pool.total_pool_amount) * 100;
        }

        return {
          vesting_stream_id: id,
          user_wallet: allocation.wallet,
          token_amount: tokenAmount,
          share_percentage: sharePercentage,
          tier: 1,
          nft_count: 0,
          is_active: true,
          is_cancelled: false,
        };
      });

      const { error: insertError } = await this.dbService.supabase
        .from('vestings')
        .insert(vestingRecords);

      if (insertError) {
        throw new Error(`Failed to insert new allocations: ${insertError.message}`);
      }

      res.json({
        success: true,
        message: `Successfully updated allocations for ${allocations.length} wallet(s)`,
        allocations: vestingRecords,
      });
    } catch (error) {
      console.error('Failed to update allocations:', error);
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
   * POST /api/pools/:id/cancel-streamflow
   * Cancel a Streamflow pool and reclaim rent + unvested tokens
   * Accepts either database pool ID or Streamflow stream ID
   */
  async cancelStreamflowPool(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { streamflowId } = req.body; // Optional: direct Streamflow ID

      if (!id && !streamflowId) {
        return res.status(400).json({ error: 'Pool ID or Streamflow ID is required' });
      }

      let streamId: string;
      let poolId: string | null = null;

      // If streamflowId provided directly, use it
      if (streamflowId) {
        streamId = streamflowId;
        
        // Try to find pool in database for cleanup
        const { data: pool } = await this.dbService.supabase
          .from('vesting_streams')
          .select('id')
          .eq('streamflow_stream_id', streamflowId)
          .single();
        
        if (pool) {
          poolId = pool.id;
        }
      } else {
        // Get pool details from database
        const { data: pool, error: poolError } = await this.dbService.supabase
          .from('vesting_streams')
          .select('*')
          .eq('id', id)
          .single();

        if (poolError || !pool) {
          return res.status(404).json({ error: 'Pool not found' });
        }

        if (!pool.streamflow_stream_id) {
          return res.status(400).json({ error: 'Pool is not deployed to Streamflow' });
        }

        streamId = pool.streamflow_stream_id;
        poolId = pool.id;
      }

      // Parse admin keypair
      let adminKeypair: Keypair;
      if (config.adminPrivateKey.startsWith('[')) {
        const secretKey = Uint8Array.from(JSON.parse(config.adminPrivateKey));
        adminKeypair = Keypair.fromSecretKey(secretKey);
      } else {
        const decoded = bs58.decode(config.adminPrivateKey);
        adminKeypair = Keypair.fromSecretKey(decoded);
      }

      // Cancel the stream
      const result = await this.streamflowService.cancelVestingPool(
        streamId,
        adminKeypair
      );

      // Update database if pool found
      if (poolId) {
        await this.dbService.supabase
          .from('vesting_streams')
          .update({ 
            is_active: false,
            streamflow_stream_id: null // Clear Streamflow ID
          })
          .eq('id', poolId);
      }

      res.json({
        success: true,
        signature: result.signature,
        streamflowId: streamId,
        message: 'Pool canceled successfully. Rent and unvested tokens returned to treasury.',
      });
    } catch (error) {
      console.error('Failed to cancel pool:', error);
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
