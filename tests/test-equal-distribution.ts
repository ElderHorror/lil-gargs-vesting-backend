/**
 * Test Equal Distribution
 * 
 * Verifies that tokens are distributed equally per wallet,
 * not weighted by NFT count.
 * 
 * Run: npx ts-node tests/test-equal-distribution.ts
 */

import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

async function testEqualDistribution() {
  console.log('🧪 Testing Equal Distribution\n');
  console.log('═'.repeat(60));
  
  try {
    // Get all active vestings
    const { data: vestings, error } = await supabase
      .from('vestings')
      .select('user_wallet, token_amount, nft_count, share_percentage, vesting_stream_id')
      .eq('is_active', true)
      .order('vesting_stream_id');
    
    if (error) {
      throw error;
    }
    
    if (!vestings || vestings.length === 0) {
      console.log('⚠️  No active vestings found');
      return;
    }
    
    // Group by pool
    const poolGroups = new Map<string, typeof vestings>();
    for (const vesting of vestings) {
      const poolId = vesting.vesting_stream_id;
      if (!poolGroups.has(poolId)) {
        poolGroups.set(poolId, []);
      }
      poolGroups.get(poolId)!.push(vesting);
    }
    
    console.log(`\n📊 Found ${poolGroups.size} pool(s) with vestings\n`);
    
    // Test each pool
    for (const [poolId, poolVestings] of poolGroups) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Pool: ${poolId}`);
      console.log(`${'─'.repeat(60)}`);
      
      // Get pool details
      const { data: pool } = await supabase
        .from('vesting_streams')
        .select('name, total_pool_amount')
        .eq('id', poolId)
        .single();
      
      if (pool) {
        console.log(`Name: ${pool.name}`);
        console.log(`Total Pool: ${pool.total_pool_amount.toLocaleString()} tokens`);
      }
      
      console.log(`Eligible Wallets: ${poolVestings.length}`);
      console.log();
      
      // Check if all allocations are equal
      const allocations = poolVestings.map(v => v.token_amount);
      const firstAllocation = allocations[0];
      const allEqual = allocations.every(a => Math.abs(a - firstAllocation) < 0.01);
      
      if (allEqual) {
        console.log('✅ PASS: All wallets have equal allocation');
        console.log(`   Each wallet gets: ${firstAllocation.toLocaleString()} tokens`);
        console.log(`   Share percentage: ${poolVestings[0].share_percentage.toFixed(4)}%`);
      } else {
        console.log('❌ FAIL: Allocations are NOT equal');
        console.log('\nAllocations:');
        poolVestings.forEach((v, i) => {
          console.log(`   ${i + 1}. ${v.user_wallet.slice(0, 8)}... - ${v.token_amount.toLocaleString()} tokens (${v.nft_count} NFTs)`);
        });
      }
      
      // Show sample wallets
      console.log('\nSample Wallets:');
      poolVestings.slice(0, 5).forEach((v, i) => {
        console.log(`   ${i + 1}. ${v.user_wallet.slice(0, 8)}... - ${v.nft_count} NFTs → ${v.token_amount.toLocaleString()} tokens`);
      });
      
      if (poolVestings.length > 5) {
        console.log(`   ... and ${poolVestings.length - 5} more`);
      }
      
      // Verify math
      const totalAllocated = allocations.reduce((sum, a) => sum + a, 0);
      const expectedPerWallet = pool ? pool.total_pool_amount / poolVestings.length : 0;
      const expectedTotal = expectedPerWallet * poolVestings.length;
      
      console.log('\nMath Check:');
      console.log(`   Expected per wallet: ${expectedPerWallet.toLocaleString()}`);
      console.log(`   Actual per wallet: ${firstAllocation.toLocaleString()}`);
      console.log(`   Total allocated: ${totalAllocated.toLocaleString()}`);
      console.log(`   Expected total: ${expectedTotal.toLocaleString()}`);
      
      const mathCorrect = Math.abs(totalAllocated - expectedTotal) < 1;
      console.log(`   ${mathCorrect ? '✅' : '❌'} Math is ${mathCorrect ? 'correct' : 'incorrect'}`);
    }
    
    console.log('\n' + '═'.repeat(60));
    console.log('✅ Test Complete!\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  }
}

// Run test
testEqualDistribution();
