import { Connection, PublicKey } from '@solana/web3.js';
import { SupabaseService } from '../services/supabaseService';
import { HeliusNFTService } from '../services/heliusNFTService';
import { getConnection, config } from '../config';
import { createClient } from '@supabase/supabase-js';

/**
 * Sync a dynamic pool - check NFT holdings and update user allocations
 */
export async function syncDynamicPool(pool: any) {
  console.log(`\n🔄 Syncing dynamic pool: ${pool.name}`);
  console.log(`Pool ID: ${pool.id}`);
  
  const connection = getConnection();
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const dbService = new SupabaseService(supabase);
  
  // Get rules from pool's nft_requirements JSON field
  const rules = pool.nft_requirements || [];
  
  if (!rules || rules.length === 0) {
    console.log('⚠️ No rules found for this pool');
    console.log('Pool nft_requirements:', pool.nft_requirements);
    return;
  }
  
  // Filter only enabled rules
  const activeRules = rules.filter((r: any) => r.enabled !== false);
  
  console.log(`Found ${rules.length} active rule(s)`);
  
  // Process each rule
  for (const rule of activeRules) {
    console.log(`\n📋 Processing rule: ${rule.name}`);
    console.log(`  NFT Contract: ${rule.nftContract}`);
    console.log(`  Threshold: ${rule.threshold}`);
    console.log(`  Allocation: ${rule.allocationValue} ${rule.allocationType}`);
    
    try {
      // Validate NFT contract address
      let nftContract: PublicKey;
      try {
        nftContract = new PublicKey(rule.nftContract);
      } catch (err) {
        console.log(`  ⚠️ Skipping rule "${rule.name}" - invalid public key: ${rule.nftContract}`);
        continue;
      }
      
      // Get NFT holders using Helius
      const heliusService = new HeliusNFTService(config.heliusApiKey, 'mainnet-beta');
      const holders = await heliusService.getAllHolders(nftContract);
      
      console.log(`  Found ${holders.length} total holders`);
      
      // Filter by threshold
      const eligibleHolders = holders.filter((h: any) => h.nftCount >= rule.threshold);
      console.log(`  ${eligibleHolders.length} holders meet threshold of ${rule.threshold}`);
      
      // Calculate allocation per user
      let allocationPerUser: number;
      if (rule.allocationType === 'PERCENTAGE') {
        // Percentage of pool divided among eligible users
        const poolShare = (pool.total_pool_amount * rule.allocationValue) / 100;
        allocationPerUser = poolShare / eligibleHolders.length;
      } else {
        // Fixed amount per user
        allocationPerUser = rule.allocationValue;
      }
      
      console.log(`  Allocation per user: ${allocationPerUser.toFixed(2)} tokens`);
      
      // Add/update users
      for (const holder of eligibleHolders) {
        // Check if user already has vesting for this pool
        const { data: existing, error: fetchError } = await dbService.supabase
          .from('vestings')
          .select('*')
          .eq('user_wallet', holder.wallet)
          .eq('vesting_stream_id', pool.id)
          .maybeSingle();
        
        if (existing) {
          // Update existing allocation
          const { error: updateError } = await dbService.supabase
            .from('vestings')
            .update({
              token_amount: allocationPerUser,
              nft_count: holder.nftCount,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          
          if (updateError) {
            console.error(`  ❌ Failed to update ${holder.wallet}:`, updateError);
          } else {
            console.log(`  ✅ Updated ${holder.wallet.slice(0, 4)}...${holder.wallet.slice(-4)}: ${allocationPerUser.toFixed(2)} tokens`);
          }
        } else {
          // Create new vesting
          const { error: insertError } = await dbService.supabase
            .from('vestings')
            .insert({
              user_wallet: holder.wallet,
              vesting_stream_id: pool.id,
              token_amount: allocationPerUser,
              nft_count: holder.nftCount,
              tier: 1, // Default tier for dynamic vesting
              vesting_mode: 'dynamic',
              is_active: true,
              snapshot_locked: false,
            });
          
          if (insertError) {
            console.error(`  ❌ Failed to create ${holder.wallet}:`, insertError);
          } else {
            console.log(`  ✨ Created ${holder.wallet.slice(0, 4)}...${holder.wallet.slice(-4)}: ${allocationPerUser.toFixed(2)} tokens`);
          }
        }
      }
    } catch (error) {
      console.error(`  ❌ Error processing rule "${rule.name}":`, error);
    }
  }
  
  console.log(`\n✅ Sync completed for pool: ${pool.name}\n`);
}
