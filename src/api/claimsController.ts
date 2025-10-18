import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { SupabaseService } from '../services/supabaseService';
import { config } from '../config';

/**
 * Claims API Controller
 * Handles claim history, statistics, and verification logs
 */
export class ClaimsController {
  private dbService: SupabaseService;

  constructor() {
    const supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
    this.dbService = new SupabaseService(supabaseClient);
  }

  /**
   * GET /api/claims
   * List recent claims with optional filters
   */
  async listClaims(req: Request, res: Response) {
    try {
      const { limit = 50, offset = 0, status, wallet } = req.query;

      let query = this.dbService.supabase
        .from('claims')
        .select('*')
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      if (status) {
        query = query.eq('status', status);
      }

      if (wallet) {
        query = query.eq('wallet', wallet);
      }

      const { data, error } = await query;

      if (error) throw error;

      res.json({
        claims: data || [],
        total: data?.length || 0,
      });
    } catch (error) {
      console.error('Failed to list claims:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/claims/stats
   * Get claim statistics
   */
  async getClaimStats(req: Request, res: Response) {
    try {
      // Get total claims count
      const { count: totalClaims } = await this.dbService.supabase
        .from('claims')
        .select('*', { count: 'exact', head: true });

      // Get approved claims
      const { count: approvedClaims } = await this.dbService.supabase
        .from('claims')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved');

      // Get flagged claims
      const { count: flaggedClaims } = await this.dbService.supabase
        .from('claims')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'flagged');

      // Get total amount claimed (sum)
      const { data: claimData } = await this.dbService.supabase
        .from('claims')
        .select('amount');

      const totalAmountClaimed = claimData?.reduce((sum: number, c: any) => sum + (c.amount || 0), 0) || 0;

      // Get claims in last 24h
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: claims24h } = await this.dbService.supabase
        .from('claims')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterday);

      res.json({
        totalClaims: totalClaims || 0,
        approvedClaims: approvedClaims || 0,
        flaggedClaims: flaggedClaims || 0,
        totalAmountClaimed,
        claims24h: claims24h || 0,
      });
    } catch (error) {
      console.error('Failed to get claim stats:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/claims/:id
   * Get claim details by ID
   */
  async getClaimDetails(req: Request, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'Claim ID is required' });
      }

      const { data, error } = await this.dbService.supabase
        .from('claims')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      if (!data) {
        return res.status(404).json({ error: 'Claim not found' });
      }

      res.json(data);
    } catch (error) {
      console.error('Failed to get claim details:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/claims/:id/flag
   * Flag a claim for review
   */
  async flagClaim(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { reason, adminWallet } = req.body;

      if (!id || !adminWallet) {
        return res.status(400).json({ error: 'Claim ID and adminWallet are required' });
      }

      const { error } = await this.dbService.supabase
        .from('claims')
        .update({ status: 'flagged', flag_reason: reason })
        .eq('id', id);

      if (error) throw error;

      await this.dbService.logAdminAction({
        action: 'flag_claim',
        admin_wallet: adminWallet,
        details: { claimId: id, reason },
      });

      res.json({
        success: true,
        message: 'Claim flagged successfully',
      });
    } catch (error) {
      console.error('Failed to flag claim:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/claims/wallet/:wallet
   * Get all claims for a specific wallet
   */
  async getWalletClaims(req: Request, res: Response) {
    try {
      const { wallet } = req.params;

      if (!wallet) {
        return res.status(400).json({ error: 'Wallet address is required' });
      }

      const { data, error } = await this.dbService.supabase
        .from('claims')
        .select('*')
        .eq('wallet', wallet)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json({
        wallet,
        claims: data || [],
        totalClaims: data?.length || 0,
        totalAmount: data?.reduce((sum: number, c: any) => sum + (c.amount || 0), 0) || 0,
      });
    } catch (error) {
      console.error('Failed to get wallet claims:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
