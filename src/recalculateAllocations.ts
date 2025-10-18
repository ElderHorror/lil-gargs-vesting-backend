/**
 * Recalculate Allocations to Equal Distribution
 * 
 * Updates all existing vestings to use equal distribution per wallet
 * instead of weighted by NFT count.
 * 
 * Run: npx ts-node src/recalculateAllocations.ts
 */

import { createClient } from '@supabase/supabase-js';
import { config } from './config';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

async function recalculateAllocations() {
  console.log('🔄 Recalculating Allocations to Equal Distribution\n');
  console.log('═'.repeat(60));
  
  try {
    // Get all active pools
    const { data: pools, error: poolError } = await supabase
      .from('vesting_streams')
      .select('id, name, total_pool_amount')
      .eq('is_active', true);
    
    if (poolError) {
      throw poolError;
    }
    
    if (!pools || pools.length === 0) {
      console.log('⚠️  No active pools found');
      return;
    }
    
    console.log(`\n📊 Found ${pools.length} active pool(s)\n`);
    
    // Process each pool
    for (const pool of pools) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Pool: ${pool.name}`);
      console.log(`Total: ${pool.total_pool_amount.toLocaleString()} tokens`);
      console.log(`${'─'.repeat(60)}`);
      
      // Get pool rules
      const { data: poolData } = await supabase
        .from('vesting_streams')
        .select('nft_requirements')
        .eq('id', pool.id)
        .single();
      
      const requirements = poolData?.nft_requirements || [];
      
      // Get all vestings for this pool
      const { data: vestings, error: vestingError } = await supabase
        .from('vestings')
        .select('id, user_wallet, nft_count, token_amount, tier')
        .eq('vesting_stream_id', pool.id)
        .eq('is_active', true);
      
      if (vestingError) {
        console.error(`❌ Error fetching vestings:`, vestingError);
        continue;
      }
      
      if (!vestings || vestings.length === 0) {
        console.log('⚠️  No vestings found for this pool');
        continue;
      }
      
      console.log(`Eligible Wallets: ${vestings.length}`);
      
      if (requirements.length === 0) {
        console.log('⚠️  No rules found, using equal split');
        // Simple equal distribution
        const tokensPerWallet = pool.total_pool_amount / vestings.length;
        const sharePercentage = 100 / vestings.length;
        
        let updated = 0;
        for (const vesting of vestings) {
          const { error } = await supabase
            .from('vestings')
            .update({
              token_amount: tokensPerWallet,
              share_percentage: sharePercentage,
            })
            .eq('id', vesting.id);
          
          if (!error) updated++;
        }
        console.log(`✅ Updated ${updated} vestings`);
        continue;
      }
      
      console.log('\nUpdating vestings by rule...');
      
      let updated = 0;
      let errors = 0;
      
      // Process each rule
      for (const rule of requirements) {
        if (!rule.enabled) continue;
        
        // Find wallets that meet this rule's threshold
        const eligibleForRule = vestings.filter((v: any) => v.nft_count >= (rule.threshold || 0));
        
        if (eligibleForRule.length === 0) {
          console.log(`\nRule "${rule.name}": No eligible wallets`);
          continue;
        }
        
        // Rule's allocationValue% of pool, split equally among eligible wallets
        const ruleTotalTokens = (rule.allocationValue / 100) * pool.total_pool_amount;
        const tokensPerWallet = ruleTotalTokens / eligibleForRule.length;
        const sharePercentage = rule.allocationValue / eligibleForRule.length;
        
        console.log(`\nRule "${rule.name}": ${rule.allocationValue}% of pool = ${ruleTotalTokens.toLocaleString()} tokens`);
        console.log(`  ${eligibleForRule.length} wallets → ${tokensPerWallet.toLocaleString()} tokens each (${sharePercentage.toFixed(4)}%)`);
        
        for (const vesting of eligibleForRule) {
          try {
            const { error: updateError } = await supabase
              .from('vestings')
              .update({
                token_amount: tokensPerWallet,
                share_percentage: sharePercentage,
              })
              .eq('id', vesting.id);
            
            if (updateError) throw updateError;
            
            updated++;
            console.log(`    ✅ ${vesting.user_wallet.slice(0, 8)}... - ${vesting.token_amount.toLocaleString()} → ${tokensPerWallet.toLocaleString()}`);
            
          } catch (err) {
            errors++;
            console.error(`    ❌ Failed to update ${vesting.user_wallet}:`, err);
          }
        }
      }
      
      console.log(`\n✅ Updated ${updated} vestings`);
      if (errors > 0) {
        console.log(`❌ ${errors} errors`);
      }
    }
    
    console.log('\n' + '═'.repeat(60));
    console.log('✅ Recalculation Complete!\n');
    console.log('Run test again: npm run test:distribution\n');
    
  } catch (error) {
    console.error('\n❌ Recalculation failed:', error);
    throw error;
  }
}

// Run recalculation
recalculateAllocations();
