import { Request, Response, NextFunction } from 'express';

/**
 * Admin Authentication Middleware
 * Verifies that the request comes from an authorized admin wallet
 * Admin wallets are configured via ADMIN_WALLETS environment variable
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    // Get admin wallet from request (query for GET, body for POST/PUT)
    const adminWallet = req.body?.adminWallet || req.query?.adminWallet;

    // Check if admin wallet is provided
    if (!adminWallet || typeof adminWallet !== 'string') {
      return res.status(401).json({ 
        error: 'Admin authentication required. Please provide adminWallet parameter.' 
      });
    }

    // Get admin wallets from environment variable
    const adminWalletsEnv = process.env.ADMIN_WALLETS || '';
    
    if (!adminWalletsEnv) {
      console.error('⚠️  ADMIN_WALLETS environment variable not set!');
      return res.status(500).json({ 
        error: 'Admin authentication not configured. Please set ADMIN_WALLETS environment variable.' 
      });
    }

    // Parse comma-separated list of admin wallets
    const adminWallets = adminWalletsEnv
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
