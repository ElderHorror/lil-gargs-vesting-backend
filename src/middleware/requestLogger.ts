import { Request, Response, NextFunction } from 'express';

/**
 * Request logging middleware
 * Logs all incoming requests with timing and response status
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const { method, url, ip } = req;
  
  // Log request
  console.log(`[${new Date().toISOString()}] ${method} ${url} - IP: ${ip}`);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const { statusCode } = res;
    const statusEmoji = statusCode >= 500 ? '❌' : statusCode >= 400 ? '⚠️' : '✅';
    
    console.log(
      `${statusEmoji} [${new Date().toISOString()}] ${method} ${url} - ${statusCode} - ${duration}ms`
    );

    // Log slow requests
    if (duration > 3000) {
      console.warn(`🐌 Slow request detected: ${method} ${url} took ${duration}ms`);
    }

    // Log errors
    if (statusCode >= 500) {
      console.error(`🚨 Server error: ${method} ${url} - ${statusCode}`);
    }
  });

  next();
}

/**
 * Admin action logger
 * Logs admin operations to database for audit trail
 */
export async function logAdminAction(params: {
  action: string;
  adminWallet: string;
  targetWallet?: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
}) {
  const { action, adminWallet, targetWallet, details, ipAddress, userAgent } = params;

  try {
    // Import here to avoid circular dependencies
    const { createClient } = await import('@supabase/supabase-js');
    const { config } = await import('../config');
    
    const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

    await supabase.from('admin_logs').insert({
      action,
      admin_wallet: adminWallet,
      target_wallet: targetWallet,
      details: details ? JSON.stringify(details) : null,
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    console.log(`📝 Admin action logged: ${action} by ${adminWallet}`);
  } catch (error) {
    console.error('Failed to log admin action:', error);
    // Don't throw - logging failure shouldn't break the operation
  }
}
