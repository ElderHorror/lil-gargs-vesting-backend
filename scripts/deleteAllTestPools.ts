import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

async function deleteAllTestPools() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log('🗑️  Deleting all test pools...\n');

  // Get all test pools
  const { data: pools, error: poolsError } = await supabase
    .from('vesting_streams')
    .select('id, name')
    .or('name.ilike.%Test Pool%,name.ilike.%Snapshot Test%');

  if (poolsError) {
    console.error('❌ Failed to fetch pools:', poolsError);
    process.exit(1);
  }

  if (!pools || pools.length === 0) {
    console.log('✅ No test pools found');
    process.exit(0);
  }

  console.log(`Found ${pools.length} test pool(s):\n`);
  pools.forEach((pool, i) => {
    console.log(`${i + 1}. ${pool.name} (${pool.id})`);
  });
  console.log('');

  // Get all vestings for these pools
  const { data: vestings } = await supabase
    .from('vestings')
    .select('id')
    .in('vesting_stream_id', pools.map(p => p.id));

  const vestingIds = vestings?.map(v => v.id) || [];

  // Delete claim history FIRST (foreign key constraint)
  if (vestingIds.length > 0) {
    const { error: claimError } = await supabase
      .from('claim_history')
      .delete()
      .in('vesting_id', vestingIds);

    if (claimError) {
      console.error('❌ Failed to delete claim history:', claimError);
    } else {
      console.log('✅ Deleted claim history');
    }
  }

  // Delete vestings
  for (const pool of pools) {
    const { error: vestingError } = await supabase
      .from('vestings')
      .delete()
      .eq('vesting_stream_id', pool.id);

    if (vestingError) {
      console.error(`❌ Failed to delete vestings for ${pool.name}:`, vestingError);
    } else {
      console.log(`✅ Deleted vestings for ${pool.name}`);
    }
  }

  // Delete pools
  const { error: poolDeleteError } = await supabase
    .from('vesting_streams')
    .delete()
    .in('id', pools.map(p => p.id));

  if (poolDeleteError) {
    console.error('❌ Failed to delete pools:', poolDeleteError);
    process.exit(1);
  }

  console.log('✅ Deleted all test pools');
  console.log('\n✅ Done!');
}

deleteAllTestPools()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
