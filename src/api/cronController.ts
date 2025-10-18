import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Cron Job Controller
 * Endpoints for external cron services to trigger scheduled tasks
 * Secured with CRON_SECRET environment variable
 */
export class CronController {
  private cronSecret: string;

  constructor() {
    this.cronSecret = process.env.CRON_SECRET || '';
    if (!this.cronSecret) {
      console.warn('⚠️  CRON_SECRET not set! Cron endpoints will be insecure.');
    }
  }

  /**
   * Middleware to verify cron secret
   */
  private verifyCronSecret(req: Request, res: Response): boolean {
    const secret = req.headers['x-cron-secret'] || req.query.secret;
    
    if (!this.cronSecret) {
      return res.status(500).json({ error: 'Cron secret not configured' }), false;
    }

    if (secret !== this.cronSecret) {
      return res.status(401).json({ error: 'Invalid cron secret' }), false;
    }

    return true;
  }

  /**
   * POST /api/cron/snapshot
   * Trigger snapshot check (call hourly)
   */
  async triggerSnapshotCheck(req: Request, res: Response) {
    if (!this.verifyCronSecret(req, res)) return;

    try {
      console.log('[CRON] Snapshot check triggered');
      
      // Check for pending snapshots
      const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
      const { data: pools, error } = await supabase
        .from('vesting_pools')
        .select('*')
        .eq('vesting_mode', 'snapshot')
        .eq('snapshot_taken', false)
        .not('start_time', 'is', null);

      if (error) throw error;

      if (!pools || pools.length === 0) {
        return res.json({
          success: true,
          message: 'No pending snapshots found',
          snapshotsProcessed: 0,
          timestamp: new Date().toISOString(),
        });
      }

      const now = new Date();
      const processed = [];
      
      for (const pool of pools) {
        const startTime = new Date(pool.start_time);
        
        if (now >= startTime) {
          console.log(`[CRON] Processing snapshot for pool: ${pool.name}`);
          processed.push({ poolId: pool.id, poolName: pool.name, status: 'ready' });
          
          // Mark as taken (actual snapshot processing would happen here)
          await supabase
            .from('vesting_pools')
            .update({ snapshot_taken: true })
            .eq('id', pool.id);
        }
      }

      res.json({
        success: true,
        message: 'Snapshot check completed',
        snapshotsProcessed: processed.length,
        processed,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[CRON] Snapshot check failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/cron/sync-dynamic
   * Trigger dynamic pool sync (call daily)
   */
  async triggerDynamicSync(req: Request, res: Response) {
    if (!this.verifyCronSecret(req, res)) return;

    try {
      console.log('[CRON] Dynamic pool sync triggered');
      
      // Get all dynamic pools
      const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
      const { data: pools, error } = await supabase
        .from('vesting_pools')
        .select('*')
        .eq('vesting_mode', 'dynamic')
        .eq('is_active', true);

      if (error) throw error;

      if (!pools || pools.length === 0) {
        return res.json({
          success: true,
          message: 'No active dynamic pools to sync',
          poolsProcessed: 0,
          timestamp: new Date().toISOString(),
        });
      }

      // Sync each pool
      const { syncDynamicPool } = await import('../utils/syncDynamicPool');
      const results = [];
      
      for (const pool of pools) {
        try {
          await syncDynamicPool(pool);
          results.push({ poolId: pool.id, poolName: pool.name, success: true });
        } catch (err) {
          console.error(`Failed to sync pool ${pool.name}:`, err);
          results.push({ 
            poolId: pool.id, 
            poolName: pool.name, 
            success: false, 
            error: err instanceof Error ? err.message : 'Unknown error' 
          });
        }
      }

      res.json({
        success: true,
        message: 'Dynamic pool sync completed',
        poolsProcessed: pools.length,
        results,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[CRON] Dynamic sync failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/cron/health
   * Health check for cron service (no auth required)
   */
  async healthCheck(req: Request, res: Response) {
    res.json({
      status: 'ok',
      service: 'cron',
      timestamp: new Date().toISOString(),
      cronSecretConfigured: !!this.cronSecret,
    });
  }
}
