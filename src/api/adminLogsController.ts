import { Request, Response } from 'express';
import { SupabaseService } from '../services/supabaseService';
import { getSupabaseClient } from '../lib/supabaseClient';

/**
 * Admin Logs API Controller
 * Handles admin activity logging and retrieval
 */
export class AdminLogsController {
  private dbService: SupabaseService;

  constructor() {
    const supabaseClient = getSupabaseClient();
    this.dbService = new SupabaseService(supabaseClient);
  }

  /**
   * GET /api/admin-logs
   * Get recent admin activity logs
   */
  async getAdminLogs(req: Request, res: Response) {
    try {
      const { limit = 50 } = req.query;

      const { data: logs, error } = await this.dbService.supabase
        .from('admin_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(Number(limit));

      if (error) {
        throw new Error(`Failed to fetch admin logs: ${error.message}`);
      }

      res.json(logs || []);
    } catch (error) {
      console.error('Failed to get admin logs:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/admin-logs
   * Create a new admin log entry
   */
  async createAdminLog(req: Request, res: Response) {
    try {
      const { action, admin_wallet, target_wallet, details, ip_address, user_agent } = req.body;

      if (!action || !admin_wallet) {
        return res.status(400).json({ error: 'action and admin_wallet are required' });
      }

      const { data: log, error } = await this.dbService.supabase
        .from('admin_logs')
        .insert({
          action,
          admin_wallet,
          target_wallet,
          details,
          ip_address,
          user_agent,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create admin log: ${error.message}`);
      }

      res.json({
        success: true,
        log,
      });
    } catch (error) {
      console.error('Failed to create admin log:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
