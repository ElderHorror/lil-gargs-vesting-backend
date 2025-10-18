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
      
      // Import and run snapshot check logic
      const { checkPendingSnapshots } = await import('../services/snapshotService');
      await checkPendingSnapshots();

      res.json({
        success: true,
        message: 'Snapshot check completed',
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
      
      // Import and run dynamic sync logic
      const { syncAllDynamicPools } = await import('../utils/syncDynamicPool');
      const result = await syncAllDynamicPools();

      res.json({
        success: true,
        message: 'Dynamic pool sync completed',
        result,
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
