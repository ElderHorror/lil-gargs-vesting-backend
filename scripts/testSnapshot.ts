import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { checkAndTakeSnapshots } from '../src/snapshotScheduler';

dotenv.config();

/**
 * Test snapshot scheduler manually
 * Usage: npm run test:snapshot
 */

async function testSnapshot() {
  console.log('🧪 Testing Snapshot Scheduler\n');
  console.log('='.repeat(60));
  
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check for pools that need snapshots
  const { data: pools, error } = await supabase
    .from('vesting_streams')
    .select('*')
    .eq('is_active', true)
    .eq('vesting_mode', 'snapshot')
    .eq('snapshot_taken', false);

  if (error) {
    console.error('❌ Failed to fetch pools:', error);
    process.exit(1);
  }

  if (!pools || pools.length === 0) {
    console.log('ℹ️  No pools found that need snapshots');
    console.log('\n💡 To test:');
    console.log('   1. Create a snapshot pool with start_time in the past');
    console.log('   2. Set snapshot_taken = false');
    console.log('   3. Add NFT requirements to the pool');
    console.log('   4. Run this script again');
    process.exit(0);
  }

  console.log(`\n📋 Found ${pools.length} pool(s) that need snapshots:\n`);
  
  pools.forEach((pool, index) => {
    console.log(`${index + 1}. ${pool.name}`);
    console.log(`   ID: ${pool.id}`);
    console.log(`   Start Time: ${pool.start_time}`);
    console.log(`   NFT Requirements: ${pool.nft_requirements?.length || 0} rule(s)`);
    console.log('');
  });

  console.log('='.repeat(60));
  console.log('\n🚀 Running snapshot scheduler...\n');

  try {
    await checkAndTakeSnapshots();
    console.log('\n✅ Snapshot scheduler completed successfully!');
  } catch (err) {
    console.error('\n❌ Snapshot scheduler failed:', err);
    process.exit(1);
  }
}

testSnapshot()
  .then(() => {
    console.log('\n✅ Test completed!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  });
