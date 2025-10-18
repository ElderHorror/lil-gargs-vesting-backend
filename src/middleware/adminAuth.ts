import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { SupabaseService } from '../services/supabaseService';
import { config } from '../config';

/**
 * Admin Authentication Middleware
 * Verifies that the request comes from an authorized admin wallet
 * Frontend should be protected - this just validates the wallet address
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    // Get admin wallet from request (query for GET, body for POST/PUT)
    const adminWallet = req.body?.adminWallet || req.query?.adminWallet;

    // Check if admin wallet is provided
    if (!adminWallet || typeof adminWallet !== 'string') {
      return res.status(401).json({ 
        error: 'Admin authentication required. Please provide adminWallet parameter.' 
      });
    }

    // Get admin wallet from database config
    const supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
    const dbService = new SupabaseService(supabaseClient);
    const dbConfig = await dbService.getConfig();

    if (!dbConfig) {
      return res.status(500).json({ error: 'Configuration not found' });
    }

    // Check if wallet is authorized admin
    // Support both single wallet and comma-separated list
    const adminWallets = dbConfig.admin_wallet
      .split(',')
      .map(w => w.trim())
      .filter(w => w.length > 0);
    
    if (!adminWallets.includes(adminWallet)) {
      return res.status(403).json({ 
        error: 'Access denied. This wallet is not authorized as an admin.' 
      });
    }

    // Admin is verified, proceed to route handler
    next();
  } catch (error) {
    console.error('Admin auth middleware error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Authentication error',
    });
  }
}
