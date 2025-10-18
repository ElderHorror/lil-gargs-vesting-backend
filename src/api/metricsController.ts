import { Request, Response } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { createClient } from '@supabase/supabase-js';
import { SupabaseService } from '../services/supabaseService';
import { config } from '../config';

/**
 * Metrics API Controller
 * Aggregates dashboard metrics from various sources
 */
export class MetricsController {
  private dbService: SupabaseService;
  private connection: Connection;

  constructor() {
    const supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
    this.dbService = new SupabaseService(supabaseClient);
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
  }

  /**
   * GET /api/metrics/dashboard
   * Get aggregated dashboard metrics
   */
  async getDashboardMetrics(req: Request, res: Response) {
    try {
      // Get pool balance (from Supabase or blockchain)
      const poolBalance = await this.getPoolBalance();

      // Get eligible wallets count
      const eligibleWallets = await this.getEligibleWalletsCount();

      // Get next unlock time
      const nextUnlock = await this.getNextUnlockTime();

      // Get cycle window
      const cycleWindow = await this.getCycleWindow();

      res.json({
        poolBalance,
        eligibleWallets,
        nextUnlock,
        cycleWindow,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to get dashboard metrics:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/metrics/pool-balance
   * Get current pool balance
   */
  async getPoolBalanceEndpoint(req: Request, res: Response) {
    try {
      const balance = await this.getPoolBalance();

      res.json({
        balance,
        unit: 'tokens',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to get pool balance:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/metrics/eligible-wallets
   * Get count of eligible wallets
   */
  async getEligibleWalletsEndpoint(req: Request, res: Response) {
    try {
      const count = await this.getEligibleWalletsCount();

      res.json({
        count,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to get eligible wallets:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/metrics/activity-log
   * Get recent operational events
   */
  async getActivityLog(req: Request, res: Response) {
    try {
      const { limit = 20 } = req.query;

      const { data, error } = await this.dbService.supabase
        .from('admin_actions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(Number(limit));

      if (error) throw error;

      res.json({
        activities: data || [],
        total: data?.length || 0,
      });
    } catch (error) {
      console.error('Failed to get activity log:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Helper: Get pool balance from database or blockchain
   */
  private async getPoolBalance(): Promise<number> {
    try {
      // Get total pool amount from all active vesting streams
      const { data: streams } = await this.dbService.supabase
        .from('vesting_streams')
        .select('total_pool_amount')
        .eq('is_active', true);

      if (streams && streams.length > 0) {
        return streams.reduce((sum: number, s: any) => sum + (s.total_pool_amount || 0), 0);
      }

      return 0;
    } catch (error) {
      console.error('Error getting pool balance:', error);
      return 0;
    }
  }

  /**
   * Helper: Get eligible wallets count
   */
  private async getEligibleWalletsCount(): Promise<number> {
    try {
      // Count active vesting records (each represents an eligible wallet)
      const { count } = await this.dbService.supabase
        .from('vesting')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('is_cancelled', false);

      return count || 0;
    } catch (error) {
      console.error('Error getting eligible wallets:', error);
      return 0;
    }
  }

  /**
   * Helper: Get next unlock time
   */
  private async getNextUnlockTime(): Promise<string> {
    try {
      // Tokens unlock continuously based on vesting schedule
      // Show "Continuous" since it's linear vesting
      return 'Continuous';
    } catch (error) {
      console.error('Error getting next unlock:', error);
      return 'Continuous';
    }
  }

  /**
   * Helper: Get cycle window
   */
  private async getCycleWindow(): Promise<{ start: string; end: string; daysRemaining: number }> {
    try {
      // Get the earliest start time and latest end time from active streams
      const { data: streams } = await this.dbService.supabase
        .from('vesting_streams')
        .select('start_time, end_time')
        .eq('is_active', true)
        .order('start_time', { ascending: true })
        .limit(1);

      if (!streams || streams.length === 0) {
        return {
          start: 'N/A',
          end: 'N/A',
          daysRemaining: 0,
        };
      }

      const startDate = new Date(streams[0].start_time);
      const endDate = new Date(streams[0].end_time);
      const now = new Date();
      const daysRemaining = Math.max(0, Math.floor((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

      return {
        start: startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        end: endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        daysRemaining,
      };
    } catch (error) {
      console.error('Error getting cycle window:', error);
      return {
        start: 'N/A',
        end: 'N/A',
        daysRemaining: 0,
      };
    }
  }
}
