import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

/**
 * Singleton Supabase Client
 * Reuses the same connection across all controllers to prevent connection exhaustion
 */
let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          'x-application-name': 'vesting-backend',
        },
      },
      // Connection pooling settings
      db: {
        schema: 'public',
      },
    });
    
    console.log('✅ Supabase client initialized');
  }
  
  return supabaseInstance;
}

/**
 * Close the Supabase connection (for graceful shutdown)
 */
export function closeSupabaseClient() {
  if (supabaseInstance) {
    // Supabase client doesn't have explicit close, but we can null it
    supabaseInstance = null;
    console.log('✅ Supabase client closed');
  }
}
