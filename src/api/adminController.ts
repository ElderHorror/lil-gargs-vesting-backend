import { Request, Response } from 'express';
import { SupabaseService } from '../services/supabaseService';
import { getSupabaseClient } from '../lib/supabaseClient';

/**
 * Admin API Controller
 * Handles admin operations for pool management
 */
export class AdminController {
  private dbService: SupabaseService;

  constructor() {
    const supabaseClient = getSupabaseClient();
    this.dbService = new SupabaseService(supabaseClient);
  }

  /**
   * GET /api/admin/pool/:poolId/members
   * Get all members in a vesting pool with their allocations and NFT counts
   */
  async getPoolMembers(req: Request, res: Response) {
    try {
      const { poolId } = req.params;

      if (!poolId) {
        return res.status(400).json({ error: 'Pool ID is required' });
      }

      // Get all active vestings for this pool (exclude cancelled members)
      const { data: members, error } = await this.dbService.supabase
        .from('vestings')
        .select('id, user_wallet, token_amount, nft_count, tier, created_at, is_active, is_cancelled')
        .eq('vesting_stream_id', poolId)
        .eq('is_cancelled', false);

      if (error) {
        throw new Error(`Failed to fetch pool members: ${error.message}`);
      }

      res.json({
        success: true,
        members: members || []
      });
    } catch (error) {
      console.error('Failed to get pool members:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * PATCH /api/admin/pool/:poolId/member/:wallet
   * Update or remove a member from a vesting pool
   */
  async updatePoolMember(req: Request, res: Response) {
    try {
      const { poolId, wallet } = req.params;
      const { allocation, nftCount, remove } = req.body;

      if (!poolId || !wallet) {
        return res.status(400).json({ error: 'Pool ID and wallet are required' });
      }

      if (remove) {
        // Remove member from pool
        const { error } = await this.dbService.supabase
          .from('vestings')
          .update({ 
            is_active: false, 
            is_cancelled: true,
            cancellation_reason: 'Removed by admin'
          })
          .eq('vesting_stream_id', poolId)
          .eq('user_wallet', wallet);

        if (error) {
          throw new Error(`Failed to remove member: ${error.message}`);
        }

        res.json({
          success: true,
          message: 'Member removed successfully'
        });
      } else {
        // Update member allocation or NFT count
        const updates: any = {};
        if (allocation !== undefined) updates.token_amount = allocation;
        if (nftCount !== undefined) updates.nft_count = nftCount;

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ error: 'Either allocation or nftCount must be provided' });
        }

        const { error } = await this.dbService.supabase
          .from('vestings')
          .update(updates)
          .eq('vesting_stream_id', poolId)
          .eq('user_wallet', wallet);

        if (error) {
          throw new Error(`Failed to update member: ${error.message}`);
        }

        res.json({
          success: true,
          message: 'Member updated successfully'
        });
      }
    } catch (error) {
      console.error('Failed to update pool member:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * PATCH /api/admin/pool/:poolId/state
   * Pause, resume, or cancel a vesting pool
   */
  async updatePoolState(req: Request, res: Response) {
    try {
      const { poolId } = req.params;
      const { action, reason } = req.body;

      if (!poolId) {
        return res.status(400).json({ error: 'Pool ID is required' });
      }

      if (!action || !['pause', 'resume', 'cancel'].includes(action)) {
        return res.status(400).json({ error: 'Valid action (pause, resume, cancel) is required' });
      }

      // Update pool state using SupabaseService method
      let newState: string;
      switch (action) {
        case 'pause':
          newState = 'paused';
          break;
        case 'resume':
          newState = 'active';
          break;
        case 'cancel':
          newState = 'cancelled';
          break;
        default:
          newState = 'active';
      }

      try {
        await this.dbService.updatePoolState(poolId, newState);
      } catch (err) {
        throw new Error(`Failed to update pool state: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }

      // If cancelling, also cancel all vestings in this pool
      if (action === 'cancel') {
        await this.dbService.supabase
          .from('vestings')
          .update({ 
            is_active: false, 
            is_cancelled: true,
            cancellation_reason: reason || 'Pool cancelled by admin'
          })
          .eq('vesting_stream_id', poolId);
      }

      res.json({
        success: true,
        message: `Pool ${action}d successfully`
      });
    } catch (error) {
      console.error('Failed to update pool state:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
