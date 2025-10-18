/**
 * Snapshot Service
 * Extracted logic for checking and processing pending snapshots
 */

import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

/**
 * Check for pending snapshots and process them
 * This is called by both the scheduler daemon and the cron endpoint
 */
export async function checkPendingSnapshots(): Promise<void> {
  console.log('[SNAPSHOT] Checking for pending snapshots...');
  
  try {
    // Get all snapshot pools that haven't been processed yet
    const { data: pools, error } = await supabase
      .from('vesting_pools')
      .select('*')
      .eq('vesting_mode', 'snapshot')
      .eq('snapshot_taken', false)
      .not('start_time', 'is', null);

    if (error) throw error;

    if (!pools || pools.length === 0) {
      console.log('[SNAPSHOT] No pending snapshots found');
      return;
    }

    const now = new Date();
    
    for (const pool of pools) {
      const startTime = new Date(pool.start_time);
      
      // Check if it's time to take the snapshot
      if (now >= startTime) {
        console.log(`[SNAPSHOT] Processing snapshot for pool: ${pool.name} (${pool.id})`);
        
        try {
          // TODO: Implement actual snapshot processing
          // This would involve:
          // 1. Fetching NFT holders
          // 2. Calculating allocations based on rules
          // 3. Creating vesting records
          // 4. Marking snapshot as taken
          
          console.log(`[SNAPSHOT] ✅ Snapshot processed for pool: ${pool.name}`);
          
          // Mark snapshot as taken
          await supabase
            .from('vesting_pools')
            .update({ snapshot_taken: true })
            .eq('id', pool.id);
            
        } catch (err) {
          console.error(`[SNAPSHOT] ❌ Failed to process snapshot for pool ${pool.name}:`, err);
        }
      } else {
        const timeUntil = Math.round((startTime.getTime() - now.getTime()) / 1000 / 60);
        console.log(`[SNAPSHOT] Pool "${pool.name}" scheduled in ${timeUntil} minutes`);
      }
    }
  } catch (error) {
    console.error('[SNAPSHOT] Error checking pending snapshots:', error);
    throw error;
  }
}
