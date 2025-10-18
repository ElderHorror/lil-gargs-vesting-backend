import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Script to manually add users to a vesting pool
 * Use this for pools without NFT requirements (airdrops, team allocations, etc.)
 * 
 * Usage:
 *   ts-node scripts/addManualAllocations.ts
 */

interface ManualAllocation {
  wallet: string;
  amount: number;
  tier?: number;
  nftCount?: number;
}

async function addManualAllocations() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ============================================================================
  // CONFIGURATION - Edit these values
  // ============================================================================
  
  const POOL_ID = 'your-pool-id-here'; // Get from vesting_streams table
  
  const ALLOCATIONS: ManualAllocation[] = [
    { wallet: 'wallet1...', amount: 10000, tier: 1 },
    { wallet: 'wallet2...', amount: 5000, tier: 2 },
    { wallet: 'wallet3...', amount: 2500, tier: 3 },
    // Add more allocations here
  ];

  // ============================================================================
  // END CONFIGURATION
  // ============================================================================

  console.log('🚀 Adding manual allocations to pool:', POOL_ID);
  console.log(`📊 Total allocations: ${ALLOCATIONS.length}`);
  console.log(`💰 Total tokens: ${ALLOCATIONS.reduce((sum, a) => sum + a.amount, 0)}`);
  console.log('');

  // Verify pool exists
  const { data: pool, error: poolError } = await supabase
    .from('vesting_streams')
    .select('*')
    .eq('id', POOL_ID)
    .single();

  if (poolError || !pool) {
    console.error('❌ Pool not found:', POOL_ID);
    process.exit(1);
  }

  console.log(`✅ Pool found: ${pool.name}`);
  console.log(`   Mode: ${pool.vesting_mode}`);
  console.log(`   Total pool amount: ${pool.total_pool_amount}`);
  console.log('');

  // Check if total allocations exceed pool amount
  const totalAllocated = ALLOCATIONS.reduce((sum, a) => sum + a.amount, 0);
  if (totalAllocated > pool.total_pool_amount) {
    console.error(`❌ Total allocations (${totalAllocated}) exceed pool amount (${pool.total_pool_amount})`);
    process.exit(1);
  }

  // Add each allocation
  let successCount = 0;
  let errorCount = 0;

  for (const allocation of ALLOCATIONS) {
    try {
      // Check if vesting already exists
      const { data: existing } = await supabase
        .from('vestings')
        .select('id')
        .eq('vesting_stream_id', POOL_ID)
        .eq('user_wallet', allocation.wallet)
        .single();

      if (existing) {
        console.log(`⏭️  Skipping ${allocation.wallet} - already exists`);
        continue;
      }

      // Insert vesting
      const { error: insertError } = await supabase
        .from('vestings')
        .insert({
          vesting_stream_id: POOL_ID,
          user_wallet: allocation.wallet,
          token_amount: allocation.amount,
          share_percentage: (allocation.amount / pool.total_pool_amount) * 100,
          tier: allocation.tier || 0,
          nft_count: allocation.nftCount || 0,
          is_active: true,
          is_cancelled: false,
        });

      if (insertError) {
        console.error(`❌ Failed to add ${allocation.wallet}:`, insertError.message);
        errorCount++;
      } else {
        console.log(`✅ Added ${allocation.wallet} - ${allocation.amount} tokens`);
        successCount++;
      }
    } catch (err) {
      console.error(`❌ Error processing ${allocation.wallet}:`, err);
      errorCount++;
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log(`   ⏭️  Skipped: ${ALLOCATIONS.length - successCount - errorCount}`);
  console.log('='.repeat(60));
}

// Run the script
addManualAllocations()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
