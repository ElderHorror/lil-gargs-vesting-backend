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
        .select('name, total_pool_amount, nft_requirements')
        .eq('id', poolId)
        .single();
      
      if (!pool) {
        console.log('⚠️  Pool not found');
        continue;
      }
      
      console.log(`Name: ${pool.name}`);
      console.log(`Total Pool: ${pool.total_pool_amount.toLocaleString()} tokens`);
      console.log(`Eligible Wallets: ${poolVestings.length}`);
      console.log();
      
      const requirements = (pool.nft_requirements as any[]) || [];
      
      if (requirements.length === 0) {
        console.log('⚠️  No rules found - checking equal distribution');
        
        // Check if all allocations are equal
        const allocations = poolVestings.map(v => v.token_amount);
        const firstAllocation = allocations[0];
        const allEqual = allocations.every(a => Math.abs(a - firstAllocation) < 0.01);
        
        if (allEqual) {
          console.log('✅ PASS: All wallets have equal allocation');
          console.log(`   Each wallet gets: ${firstAllocation.toLocaleString()} tokens`);
        } else {
          console.log('❌ FAIL: Allocations are NOT equal');
        }
      } else {
        console.log(`Found ${requirements.length} rule(s) - checking rule-based allocation`);
        
        // Check each rule
        for (const rule of requirements) {
          if (rule.enabled === false) continue;
          
          // Find wallets eligible for this rule
          const eligibleForRule = poolVestings.filter(v => v.nft_count >= (rule.threshold || 0));
          
          if (eligibleForRule.length === 0) {
            console.log(`\n  Rule "${rule.name}": No eligible wallets`);
            continue;
          }
          
          // Check if all eligible wallets get equal share
          const allocations = eligibleForRule.map(v => v.token_amount);
          const firstAllocation = allocations[0];
          const allEqual = allocations.every(a => Math.abs(a - firstAllocation) < 0.01);
          
          const expectedTotal = (rule.allocationValue / 100) * pool.total_pool_amount;
          const expectedPerWallet = expectedTotal / eligibleForRule.length;
          
          console.log(`\n  Rule "${rule.name}" (${rule.allocationValue}%):`);
          console.log(`    Eligible wallets: ${eligibleForRule.length}`);
          console.log(`    Expected per wallet: ${expectedPerWallet.toLocaleString()}`);
          console.log(`    Actual per wallet: ${firstAllocation.toLocaleString()}`);
          
          if (allEqual && Math.abs(firstAllocation - expectedPerWallet) < 0.01) {
            console.log(`    ✅ PASS: Equal distribution within rule`);
          } else {
            console.log(`    ❌ FAIL: Incorrect allocation`);
          }
        }
      }
      
      // Show sample wallets
      console.log('\nSample Wallets:');
      poolVestings.slice(0, 5).forEach((v, i) => {
        console.log(`   ${i + 1}. ${v.user_wallet.slice(0, 8)}... - ${v.nft_count} NFTs → ${v.token_amount.toLocaleString()} tokens`);
      });
      
      if (poolVestings.length > 5) {
        console.log(`   ... and ${poolVestings.length - 5} more`);
      }
      
      // Verify total allocation math
      const allAllocations = poolVestings.map((v: any) => v.token_amount);
      const totalAllocated = allAllocations.reduce((sum: number, a: number) => sum + a, 0);
      
      console.log('\nTotal Allocation Check:');
      console.log(`   Total allocated: ${totalAllocated.toLocaleString()} tokens`);
      console.log(`   Pool size: ${pool.total_pool_amount.toLocaleString()} tokens`);
      
      if (requirements.length > 0) {
        const totalRulePercentage = requirements.reduce((sum: number, r: any) => sum + (r.enabled !== false ? r.allocationValue : 0), 0);
        console.log(`   Total rules allocation: ${totalRulePercentage}%`);
      }
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
