import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Manual Pool Creation Script
 * 
 * This script allows you to create a vesting pool with manually specified wallets and allocations.
 * Perfect for airdrops, team vesting, or custom distributions.
 */

interface ManualAllocation {
  wallet: string;
  allocationType: 'PERCENTAGE' | 'FIXED';
  allocationValue: number;
  note?: string;
}

async function createManualPool() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ========================================
  // POOL CONFIGURATION
  // ========================================
  const POOL_NAME = 'Manual Test Pool - ' + new Date().toISOString().split('T')[0];
  const POOL_DESCRIPTION = 'Manually allocated vesting pool for testing';
  
  // Vesting schedule (in seconds for precision)
  const START_TIME = new Date(); // Starts now
  const CLIFF_SECONDS = 0; // No cliff
  const VESTING_SECONDS = 30 * 24 * 60 * 60; // 30 days
  const END_TIME = new Date(START_TIME.getTime() + VESTING_SECONDS * 1000);

  // ========================================
  // MANUAL ALLOCATIONS
  // ========================================
  const ALLOCATIONS: ManualAllocation[] = [
    {
      wallet: 'ABjnax7QfDmG6wR2KJoNc3UyiouwTEZ3b5tnTrLLyNSp',
      allocationType: 'FIXED',
      allocationValue: 100,
      note: 'Test wallet 1'
    },
    // Add more wallets here:
    // {
    //   wallet: 'WALLET_ADDRESS_HERE',
    //   allocationType: 'PERCENTAGE',
    //   allocationValue: 50, // 50% of pool
    //   note: 'Team member'
    // },
  ];

  // Calculate total pool amount (sum of fixed allocations)
  const TOTAL_POOL_AMOUNT = ALLOCATIONS
    .filter(a => a.allocationType === 'FIXED')
    .reduce((sum, alloc) => sum + alloc.allocationValue, 0);

  console.log('🚀 Creating manual vesting pool');
  console.log('📊 Pool:', POOL_NAME);
  console.log('💰 Total allocation:', TOTAL_POOL_AMOUNT, 'tokens');
  console.log('👥 Recipients:', ALLOCATIONS.length);
  console.log('📅 Start:', START_TIME.toISOString());
  console.log('⏰ Cliff:', CLIFF_SECONDS, 'seconds');
  console.log('📈 Vesting:', VESTING_SECONDS, 'seconds');
  console.log('');

  try {
    // Create pool
    const { data: pool, error: poolError } = await supabase
      .from('vesting_streams')
      .insert({
        name: POOL_NAME,
        description: POOL_DESCRIPTION,
        total_pool_amount: TOTAL_POOL_AMOUNT,
        vesting_duration_days: 30, // Backward compatibility
        cliff_duration_days: 0,
        vesting_duration_seconds: VESTING_SECONDS,
        cliff_duration_seconds: CLIFF_SECONDS,
        start_time: START_TIME.toISOString(),
        end_time: END_TIME.toISOString(),
        is_active: true,
        vesting_mode: 'manual',
        snapshot_taken: true, // Manual allocations are "pre-taken"
        nft_requirements: [],
        tier_allocations: {},
        grace_period_days: 30,
      })
      .select()
      .single();

    if (poolError) throw poolError;

    console.log('✅ Pool created:', pool.id);
    console.log('');

    // Create vestings for each allocation
    console.log('👥 Creating allocations...');
    for (const allocation of ALLOCATIONS) {
      // Calculate token amount based on allocation type
      let tokenAmount: number;
      let sharePercentage: number;
      
      if (allocation.allocationType === 'PERCENTAGE') {
        sharePercentage = allocation.allocationValue;
        tokenAmount = (TOTAL_POOL_AMOUNT * allocation.allocationValue) / 100;
      } else {
        // FIXED
        tokenAmount = allocation.allocationValue;
        sharePercentage = (allocation.allocationValue / TOTAL_POOL_AMOUNT) * 100;
      }

      const { error: vestingError } = await supabase
        .from('vestings')
        .insert({
          vesting_stream_id: pool.id,
          user_wallet: allocation.wallet,
          token_amount: tokenAmount,
          share_percentage: sharePercentage,
          tier: 1,
          nft_count: 0,
          is_active: true,
          is_cancelled: false,
        });

      if (vestingError) {
        console.error(`❌ Failed to create vesting for ${allocation.wallet}:`, vestingError);
      } else {
        console.log(`✅ ${allocation.wallet.slice(0, 8)}... - ${tokenAmount} tokens (${sharePercentage.toFixed(2)}%)${allocation.note ? ' - ' + allocation.note : ''}`);
      }
    }

    console.log('');
    console.log('✅ Manual pool created successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log(`   Pool ID: ${pool.id}`);
    console.log(`   Total: ${TOTAL_POOL_AMOUNT} tokens`);
    console.log(`   Recipients: ${ALLOCATIONS.length}`);
    console.log(`   Mode: manual`);
    console.log('');
    console.log('🎯 Users can now claim their vesting rewards!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createManualPool()
  .then(() => {
    console.log('\n✅ Done!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
