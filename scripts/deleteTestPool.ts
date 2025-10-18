import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Delete test pool
 * Usage: npm run test:delete-pool
 */

async function deleteTestPool() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const POOL_ID = 'be66883a-991e-44b9-8e2e-6bc3f6611ac5'; // The test pool we just created

  console.log('🗑️  Deleting test pool:', POOL_ID);

  // Delete vestings first (foreign key constraint)
  const { error: vestingError } = await supabase
    .from('vestings')
    .delete()
    .eq('vesting_stream_id', POOL_ID);

  if (vestingError) {
    console.error('❌ Failed to delete vestings:', vestingError);
  } else {
    console.log('✅ Deleted vestings');
  }

  // Delete pool
  const { error: poolError } = await supabase
    .from('vesting_streams')
    .delete()
    .eq('id', POOL_ID);

  if (poolError) {
    console.error('❌ Failed to delete pool:', poolError);
  } else {
    console.log('✅ Deleted pool');
  }

  console.log('\n✅ Done!');
}

deleteTestPool()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
