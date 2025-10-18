import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Quick Test Pool Setup
 * Creates a test pool with manual allocation for testing claims
 * 
 * Usage:
 *   1. Edit TEST_WALLET below to your test wallet address
 *   2. Run: npm run test:create-pool
 *   3. Test claiming via API or frontend
 */

async function createTestPool() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ============================================================================
  // CONFIGURATION - Edit these values
  // ============================================================================
  
  const TEST_WALLET: string = 'ABjnax7QfDmG6wR2KJoNc3UyiouwTEZ3b5tnTrLLyNSp'; // Your wallet that will claim
  const POOL_NAME = 'Test Pool - ' + new Date().toISOString().split('T')[0];
  const TOTAL_TOKENS = 100; // Total pool size (you have 500 GARG available)
  const ALLOCATION_AMOUNT = 50; // Amount allocated to test wallet
  const VESTING_DAYS = 30; // 30 day vesting
  const CLIFF_DAYS = 0; // No cliff for testing
  
  // ============================================================================
  // END CONFIGURATION
  // ============================================================================

  console.log('🚀 Creating test pool...\n');
  console.log('Configuration:');
  console.log(`  Pool Name: ${POOL_NAME}`);
  console.log(`  Total Tokens: ${TOTAL_TOKENS}`);
  console.log(`  Test Wallet: ${TEST_WALLET}`);
  console.log(`  Allocation: ${ALLOCATION_AMOUNT} tokens`);
  console.log(`  Vesting Duration: ${VESTING_DAYS} days`);
  console.log(`  Cliff: ${CLIFF_DAYS} days`);
  console.log('');

  // Validate wallet address
  if (TEST_WALLET === 'YOUR_WALLET_ADDRESS_HERE' || !TEST_WALLET || TEST_WALLET.length < 32) {
    console.error('❌ Please set TEST_WALLET to your actual wallet address!');
    console.error('   Edit the TEST_WALLET variable in this script.');
    process.exit(1);
  }

  try {
    // Step 1: Create vesting pool
    console.log('📝 Step 1: Creating vesting pool...');
    
    const startTime = new Date();
    const endTime = new Date(Date.now() + VESTING_DAYS * 24 * 60 * 60 * 1000);

    const { data: pool, error: poolError } = await supabase
      .from('vesting_streams')
      .insert({
        name: POOL_NAME,
        total_pool_amount: TOTAL_TOKENS,
        vesting_duration_days: VESTING_DAYS,
        cliff_duration_days: CLIFF_DAYS,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        is_active: true,
        vesting_mode: 'snapshot', // Use snapshot mode for manual allocation
        nft_requirements: [], // No NFT requirements
        tier_allocations: {},
        grace_period_days: 30,
        snapshot_taken: true, // Mark as taken since we're adding manually
      })
      .select()
      .single();

    if (poolError) {
      console.error('❌ Failed to create pool:', poolError);
      process.exit(1);
    }

    console.log(`✅ Pool created: ${pool.id}`);
    console.log(`   Start: ${startTime.toISOString()}`);
    console.log(`   End: ${endTime.toISOString()}`);
    console.log('');

    // Step 2: Add manual allocation
    console.log('📝 Step 2: Adding allocation for test wallet...');

    const { error: vestingError } = await supabase
      .from('vestings')
      .insert({
        vesting_stream_id: pool.id,
        user_wallet: TEST_WALLET,
        token_amount: ALLOCATION_AMOUNT,
        share_percentage: (ALLOCATION_AMOUNT / TOTAL_TOKENS) * 100,
        tier: 1,
        nft_count: 0,
        is_active: true,
        is_cancelled: false,
      });

    if (vestingError) {
      console.error('❌ Failed to add allocation:', vestingError);
      process.exit(1);
    }

    console.log(`✅ Allocation added: ${ALLOCATION_AMOUNT} tokens to ${TEST_WALLET}`);
    console.log('');

    // Step 3: Summary
    console.log('='.repeat(60));
    console.log('✅ Test Pool Created Successfully!');
    console.log('='.repeat(60));
    console.log('');
    console.log('📊 Pool Details:');
    console.log(`   ID: ${pool.id}`);
    console.log(`   Name: ${POOL_NAME}`);
    console.log(`   Total: ${TOTAL_TOKENS} tokens`);
    console.log(`   Allocated: ${ALLOCATION_AMOUNT} tokens (${(ALLOCATION_AMOUNT/TOTAL_TOKENS*100).toFixed(1)}%)`);
    console.log('');
    console.log('👤 Test Wallet:');
    console.log(`   Address: ${TEST_WALLET}`);
    console.log(`   Allocation: ${ALLOCATION_AMOUNT} tokens`);
    console.log('');
    console.log('⏰ Vesting Schedule:');
    console.log(`   Start: ${startTime.toLocaleString()}`);
    console.log(`   End: ${endTime.toLocaleString()}`);
    console.log(`   Cliff: ${CLIFF_DAYS} days`);
    console.log(`   Duration: ${VESTING_DAYS} days`);
    console.log('');
    console.log('🧪 How to Test:');
    console.log('   1. Make sure treasury wallet has tokens');
    console.log('   2. Test via API:');
    console.log(`      GET /api/user/vesting/summary?wallet=${TEST_WALLET}`);
    console.log(`      POST /api/user/vesting/claim`);
    console.log('   3. Or test via frontend when it\'s ready');
    console.log('');
    console.log('💡 Tip: Since vesting just started, you can claim immediately!');
    console.log('');

    // Calculate claimable amount
    const now = Date.now();
    const start = startTime.getTime();
    const end = endTime.getTime();
    const elapsed = now - start;
    const duration = end - start;
    const vestedPercentage = Math.min(elapsed / duration, 1);
    const claimableNow = Math.floor(ALLOCATION_AMOUNT * vestedPercentage);

    console.log('📈 Current Status:');
    console.log(`   Vested: ${(vestedPercentage * 100).toFixed(2)}%`);
    console.log(`   Claimable Now: ${claimableNow} tokens`);
    console.log('');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
createTestPool()
  .then(() => {
    console.log('✅ Done!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
