import { createClient } from '@supabase/supabase-js';
import { HeliusNFTService } from './services/heliusNFTService';
import { PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

dotenv.config();

const POOL_ID = '405a07a0-7a04-4f02-8a72-270e6a81defb';

async function processSnapshotForPool() {
  console.log('🔄 Processing snapshot for pool:', POOL_ID);
  
  // Initialize Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get pool details
  const { data: pool, error: poolError } = await supabase
    .from('vesting_streams')
    .select('*')
    .eq('id', POOL_ID)
    .single();

  if (poolError || !pool) {
    console.error('❌ Failed to fetch pool:', poolError);
    return;
  }

  console.log('📋 Pool:', pool.name);
  console.log('💰 Total Amount:', pool.total_pool_amount);
  console.log('📜 Rules:', JSON.stringify(pool.nft_requirements, null, 2));

  const rules = pool.nft_requirements || [];
  
  if (!rules || rules.length === 0) {
    console.error('❌ No NFT rules found for this pool');
    return;
  }

  // Initialize Helius
  const heliusService = new HeliusNFTService(
    process.env.HELIUS_API_KEY!,
    'mainnet-beta'
  );

  // Track all allocations
  const walletAllocations = new Map<string, {
    total: number;
    nftCount: number;
    sources: Array<{ ruleName: string; amount: number }>;
  }>();

  // Process each rule
  for (const rule of rules) {
    if (!rule.enabled) {
      console.log(`⏭️  Skipping disabled rule: ${rule.name}`);
      continue;
    }

    console.log(`\n📋 Processing rule: ${rule.name}`);
    console.log(`  Contract: ${rule.nftContract}`);
    console.log(`  Threshold: ${rule.threshold}`);
    console.log(`  Allocation: ${rule.allocationValue} ${rule.allocationType}`);

    try {
      // Get NFT holders
      const nftContract = new PublicKey(rule.nftContract);
      const holders = await heliusService.getAllHolders(nftContract);
      
      console.log(`  Found ${holders.length} total holders`);

      // Filter by threshold
      const eligible = holders.filter(h => h.nftCount >= rule.threshold);
      console.log(`  ${eligible.length} holders meet threshold`);

      if (eligible.length === 0) {
        console.log(`  ⚠️ No eligible holders for this rule`);
        continue;
      }

      // Calculate total NFTs for weighted distribution
      const totalNFTs = eligible.reduce((sum, h) => sum + h.nftCount, 0);
      console.log(`  Total NFTs: ${totalNFTs}`);

      // Calculate pool share for this rule
      let poolShare: number;
      if (rule.allocationType === 'PERCENTAGE') {
        poolShare = (pool.total_pool_amount * rule.allocationValue) / 100;
      } else {
        poolShare = rule.allocationValue * totalNFTs; // Fixed amount per NFT
      }

      console.log(`  Pool share: ${poolShare.toFixed(2)} tokens`);

      // Allocate to each holder (weighted by NFT count)
      for (const holder of eligible) {
        let amount: number;
        
        if (rule.allocationType === 'PERCENTAGE') {
          // Weighted allocation: (holder's NFTs / total NFTs) × pool share
          amount = (holder.nftCount / totalNFTs) * poolShare;
        } else {
          // Fixed amount per NFT
          amount = holder.nftCount * rule.allocationValue;
        }

        const existing = walletAllocations.get(holder.wallet);
        if (existing) {
          existing.total += amount;
          existing.nftCount += holder.nftCount;
          existing.sources.push({ ruleName: rule.name, amount });
        } else {
          walletAllocations.set(holder.wallet, {
            total: amount,
            nftCount: holder.nftCount,
            sources: [{ ruleName: rule.name, amount }],
          });
        }
      }

      console.log(`  ✅ Allocated to ${eligible.length} wallets`);
    } catch (error) {
      console.error(`  ❌ Error processing rule:`, error);
    }
  }

  console.log(`\n📊 Total allocations: ${walletAllocations.size} wallets`);
  console.log(`💰 Total allocated: ${Array.from(walletAllocations.values()).reduce((sum, a) => sum + a.total, 0).toFixed(2)} tokens`);

  // Commit allocations to database
  console.log('\n💾 Committing allocations to database...');
  
  let created = 0;
  let errors = 0;

  for (const [wallet, allocation] of walletAllocations.entries()) {
    try {
      const { error } = await supabase
        .from('vestings')
        .insert({
          user_wallet: wallet,
          token_amount: allocation.total,
          vesting_stream_id: POOL_ID,
          nft_count: allocation.nftCount,
          tier: 1,
          vesting_mode: 'snapshot',
          snapshot_locked: true,
          is_active: true,
          is_cancelled: false,
        });

      if (error) {
        console.error(`  ❌ Failed to create vesting for ${wallet}:`, error.message);
        errors++;
      } else {
        console.log(`  ✅ Created vesting for ${wallet.slice(0, 4)}...${wallet.slice(-4)}: ${allocation.total.toFixed(2)} tokens (${allocation.nftCount} NFTs)`);
        created++;
      }
    } catch (err) {
      console.error(`  ❌ Error creating vesting for ${wallet}:`, err);
      errors++;
    }
  }

  console.log(`\n✅ Snapshot processing complete!`);
  console.log(`   Created: ${created}`);
  console.log(`   Errors: ${errors}`);
}

// Run the script
processSnapshotForPool()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
