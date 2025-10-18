import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

async function createSnapshotTestPool() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const TEST_WALLET: string = 'ABjnax7QfDmG6wR2KJoNc3UyiouwTEZ3b5tnTrLLyNSp';
  const POOL_NAME = 'Snapshot Test - ' + new Date().toISOString().split('T')[0];
  const TOTAL_TOKENS = 100;
  const ALLOCATION = 50;
  
  // Start in 2 minutes (so scheduler will pick it up soon)
  const START_TIME = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes from now
  const END_TIME = new Date(START_TIME.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  console.log('🚀 Creating snapshot test pool');
  console.log('📅 Start time:', START_TIME.toISOString(), '(in 2 minutes)');
  console.log('👤 Test wallet:', TEST_WALLET);

  try {
    // Create pool
    const { data: pool, error: poolError } = await supabase
      .from('vesting_streams')
      .insert({
        name: POOL_NAME,
        total_pool_amount: TOTAL_TOKENS,
        vesting_duration_days: 30,
        cliff_duration_days: 0,
        start_time: START_TIME.toISOString(),
        end_time: END_TIME.toISOString(),
        is_active: true,
        vesting_mode: 'snapshot',
        snapshot_taken: false, // NOT taken yet - scheduler will take it
        nft_requirements: [], // No NFT requirements - manual allocation
        tier_allocations: {},
        grace_period_days: 30,
      })
      .select()
      .single();

    if (poolError) throw poolError;

    // Manually add allocation for test wallet
    const { error: vestingError } = await supabase
      .from('vestings')
      .insert({
        vesting_stream_id: pool.id,
        user_wallet: TEST_WALLET,
        token_amount: ALLOCATION,
        share_percentage: (ALLOCATION / TOTAL_TOKENS) * 100,
        tier: 1,
        nft_count: 0,
        is_active: true,
        is_cancelled: false,
      });

    if (vestingError) throw vestingError;

    // Mark snapshot as taken since we added manually
    await supabase
      .from('vesting_streams')
      .update({ snapshot_taken: true })
      .eq('id', pool.id);

    console.log('✅ Pool created:', pool.id);
    console.log('✅ Allocated', ALLOCATION, 'tokens to', TEST_WALLET);
    console.log('⏰ Vesting starts in 2 minutes - tokens will unlock over 30 days');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createSnapshotTestPool()
  .then(() => {
    console.log('✅ Done!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
