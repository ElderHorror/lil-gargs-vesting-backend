import { createClient } from '@supabase/supabase-js';
import { HeliusNFTService } from './services/heliusNFTService';
import { PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

dotenv.config();

// Get pool ID from command line argument or use default
const POOL_ID = process.argv[2] || '405a07a0-7a04-4f02-8a72-270e6a81defb';

async function processSnapshotForPool() {
  // Initialize Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // If no pool ID provided, list all pools
  if (!process.argv[2]) {
    console.log('📋 Listing all snapshot pools:\n');
    const { data: pools, error: listError } = await supabase
      .from('vesting_streams')
      .select('id, name, vesting_mode, total_pool_amount, created_at')
      .eq('vesting_mode', 'snapshot')
      .order('created_at', { ascending: false });

    if (listError) {
      console.error('❌ Failed to list pools:', listError);
      return;
    }

    if (!pools || pools.length === 0) {
      console.log('No snapshot pools found.');
      return;
    }

    pools.forEach((p: any, i: number) => {
      console.log(`${i + 1}. ${p.name}`);
      console.log(`   ID: ${p.id}`);
      console.log(`   Amount: ${p.total_pool_amount}`);
      console.log(`   Created: ${new Date(p.created_at).toLocaleString()}\n`);
    });

    console.log('💡 To process a pool, run:');
    console.log('   npm run snapshot:process-pool <POOL_ID>');
    return;
  }

  console.log('🔄 Processing snapshot for pool:', POOL_ID);

  // Get pool details
  const { data: pool, error: poolError } = await supabase
    .from('vesting_streams')
    .select('*')
    .eq('id', POOL_ID)
    .single();

  if (poolError || !pool) {
    console.error('❌ Failed to fetch pool:', poolError);
    console.log('\n💡 Run without arguments to list all pools:');
    console.log('   npm run snapshot:process-pool');
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
    // Normalize rule format (handle both old and new formats)
    const normalizedRule = {
      name: rule.name,
      nftContract: rule.nftContract || rule.collection,
      threshold: rule.threshold || rule.min_nfts || 1,
      allocationType: rule.allocationType,
      allocationValue: rule.allocationValue,
      enabled: rule.enabled !== false, // Default to true if not specified
    };

    if (!normalizedRule.enabled) {
      console.log(`⏭️  Skipping disabled rule: ${normalizedRule.name}`);
      continue;
    }

    console.log(`\n📋 Processing rule: ${normalizedRule.name}`);
    console.log(`  Contract: ${normalizedRule.nftContract}`);
    console.log(`  Threshold: ${normalizedRule.threshold}`);
    console.log(`  Allocation: ${normalizedRule.allocationValue} ${normalizedRule.allocationType}`);

    try {
      // Get NFT holders with retry logic
      console.log(`  🔍 Fetching NFT holders from Helius...`);
      const nftContract = new PublicKey(normalizedRule.nftContract);
      
      let holders;
      try {
        holders = await heliusService.getAllHolders(nftContract);
      } catch (heliusError) {
        console.error(`  ❌ Failed to fetch holders from Helius:`, heliusError);
        console.log(`  ⚠️ Skipping rule "${normalizedRule.name}" due to Helius API error`);
        console.log(`  💡 Try again later or check your Helius API key and network connection`);
        continue;
      }
      
      console.log(`  ✅ Found ${holders.length} total holders`);

      // Filter by threshold
      const eligible = holders.filter(h => h.nftCount >= normalizedRule.threshold);
      console.log(`  📊 ${eligible.length} holders meet threshold of ${normalizedRule.threshold}`);

      if (eligible.length === 0) {
        console.log(`  ⚠️ No eligible holders for this rule`);
        continue;
      }

      // Calculate total NFTs for weighted distribution
      const totalNFTs = eligible.reduce((sum, h) => sum + h.nftCount, 0);
      console.log(`  Total NFTs: ${totalNFTs}`);

      // Calculate pool share for this rule
      let poolShare: number;
      if (normalizedRule.allocationType === 'PERCENTAGE') {
        poolShare = (pool.total_pool_amount * normalizedRule.allocationValue) / 100;
      } else {
        poolShare = normalizedRule.allocationValue * totalNFTs; // Fixed amount per NFT
      }

      console.log(`  Pool share: ${poolShare.toFixed(2)} tokens`);

      // Allocate to each holder (weighted by NFT count)
      for (const holder of eligible) {
        let amount: number;
        
        if (normalizedRule.allocationType === 'PERCENTAGE') {
          // Weighted allocation: (holder's NFTs / total NFTs) × pool share
          amount = (holder.nftCount / totalNFTs) * poolShare;
        } else {
          // Fixed amount per NFT
          amount = holder.nftCount * normalizedRule.allocationValue;
        }

        const existing = walletAllocations.get(holder.wallet);
        if (existing) {
          existing.total += amount;
          existing.nftCount += holder.nftCount;
          existing.sources.push({ ruleName: normalizedRule.name, amount });
        } else {
          walletAllocations.set(holder.wallet, {
            total: amount,
            nftCount: holder.nftCount,
            sources: [{ ruleName: normalizedRule.name, amount }],
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
