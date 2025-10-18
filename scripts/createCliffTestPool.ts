import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

async function createCliffTestPool() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const TEST_WALLET: string = 'ABjnax7QfDmG6wR2KJoNc3UyiouwTEZ3b5tnTrLLyNSp';
  const POOL_NAME = 'Cliff Test - ' + new Date().toISOString().split('T')[0];
  const TOTAL_TOKENS = 100;
  const ALLOCATION = 50;
  
  // Vesting: 5 min cliff + 5 min vesting = 10 minutes total
  const START_TIME = new Date();
  const CLIFF_SECONDS = 5 * 60; // 5 minutes cliff
  const VESTING_SECONDS = 5 * 60; // 5 minutes vesting (after cliff)
  const TOTAL_SECONDS = CLIFF_SECONDS + VESTING_SECONDS; // 10 minutes total
  const END_TIME = new Date(START_TIME.getTime() + TOTAL_SECONDS * 1000);

  console.log('🚀 Creating cliff test pool');
  console.log('📅 Start time:', START_TIME.toISOString(), '(now)');
  console.log('⏰ Cliff: 5 minutes (300 seconds)');
  console.log('📊 Vesting: 5 minutes (300 seconds)');
  console.log('⏱️  Total duration: 10 minutes');
  console.log('👤 Test wallet:', TEST_WALLET);
  console.log('');
  console.log('🧪 Test scenario:');
  console.log('   - 0-5 min: Cliff period (CANNOT claim)');
  console.log('   - 5-10 min: Tokens unlock linearly (CAN claim)');
  console.log('   - After 10 min: 100% unlocked');
  console.log('');

  try {
    // Create pool
    const { data: pool, error: poolError } = await supabase
      .from('vesting_streams')
      .insert({
        name: POOL_NAME,
        total_pool_amount: TOTAL_TOKENS,
        vesting_duration_days: 30, // Keep for backward compatibility
        cliff_duration_days: 0, // Keep for backward compatibility
        vesting_duration_seconds: VESTING_SECONDS,
        cliff_duration_seconds: CLIFF_SECONDS,
        start_time: START_TIME.toISOString(),
        end_time: END_TIME.toISOString(),
        is_active: true,
        vesting_mode: 'snapshot',
        snapshot_taken: true,
        nft_requirements: [],
        tier_allocations: {},
        grace_period_days: 30,
      })
      .select()
      .single();

    if (poolError) throw poolError;

    // Add vesting for test wallet
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

    const cliffEndTime = new Date(START_TIME.getTime() + CLIFF_SECONDS * 1000);
    
    console.log('✅ Pool created:', pool.id);
    console.log('✅ Allocated', ALLOCATION, 'tokens to', TEST_WALLET);
    console.log('');
    console.log('⏰ Timeline:');
    console.log(`   ${START_TIME.toLocaleTimeString()} - Vesting starts (NOW)`);
    console.log(`   ${cliffEndTime.toLocaleTimeString()} - Cliff ends (in 5 min)`);
    console.log(`   ${END_TIME.toLocaleTimeString()} - Vesting ends (in 10 min)`);
    console.log('');
    console.log('🧪 Test:');
    console.log('   1. Try claiming NOW - should FAIL (cliff not passed)');
    console.log('   2. Wait 5 minutes - cliff ends');
    console.log('   3. Try claiming - should SUCCEED (tokens unlocking)');
    console.log('   4. Wait 10 minutes total - 100% unlocked!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createCliffTestPool()
  .then(() => {
    console.log('\n✅ Done!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
