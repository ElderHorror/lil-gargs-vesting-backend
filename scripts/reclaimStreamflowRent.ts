import { createClient } from '@supabase/supabase-js';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../src/config';
import { StreamflowService } from '../src/services/streamflowService';
import * as readline from 'readline';

/**
 * Streamflow Rent Reclaim Script
 * Cancels Streamflow streams and reclaims rent + unvested tokens
 * 
 * For completed streams: Withdraws all tokens first, then cancels to reclaim rent
 * For active streams: Cancels immediately, returning unvested tokens + rent
 * 
 * Usage: 
 *   npx ts-node scripts/reclaimStreamflowRent.ts              # Interactive mode
 *   npx ts-node scripts/reclaimStreamflowRent.ts --all        # Cancel all streams
 *   npx ts-node scripts/reclaimStreamflowRent.ts <stream_id>  # Cancel specific stream
 */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

interface StreamInfo {
  streamId: string;
  poolId: string;
  poolName: string;
  depositedAmount: number;
  withdrawnAmount: number;
  remainingAmount: number;
  start: number;
  end: number;
  isCompleted: boolean;
  isActive: boolean;
}

async function getAdminKeypair(): Promise<Keypair> {
  try {
    if (config.adminPrivateKey.startsWith('[')) {
      const secretKey = Uint8Array.from(JSON.parse(config.adminPrivateKey));
      return Keypair.fromSecretKey(secretKey);
    } else {
      const decoded = bs58.decode(config.adminPrivateKey);
      return Keypair.fromSecretKey(decoded);
    }
  } catch (error) {
    console.error('❌ Failed to parse admin keypair:', error);
    throw new Error('Invalid admin private key in config');
  }
}

async function getAllStreams(): Promise<StreamInfo[]> {
  console.log('🔍 Fetching all pools with Streamflow streams...\n');
  
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const streamflowService = new StreamflowService();

  const { data: pools, error } = await supabase
    .from('vesting_streams')
    .select('id, name, streamflow_stream_id')
    .not('streamflow_stream_id', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch pools: ${error.message}`);
  }

  if (!pools || pools.length === 0) {
    console.log('✅ No Streamflow streams found in database');
    return [];
  }

  const streams: StreamInfo[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const pool of pools) {
    try {
      console.log(`  Checking ${pool.name} (${pool.streamflow_stream_id})...`);
      const status = await streamflowService.getPoolStatus(pool.streamflow_stream_id);
      
      const isCompleted = now >= status.end;
      const isActive = now >= status.start && now < status.end;

      streams.push({
        streamId: pool.streamflow_stream_id,
        poolId: pool.id,
        poolName: pool.name,
        depositedAmount: status.depositedAmount,
        withdrawnAmount: status.withdrawnAmount,
        remainingAmount: status.remainingAmount,
        start: status.start,
        end: status.end,
        isCompleted,
        isActive,
      });

      console.log(`    ✓ Status: ${isCompleted ? 'Completed' : isActive ? 'Active' : 'Not Started'}`);
      console.log(`    ✓ Remaining: ${status.remainingAmount} tokens`);
    } catch (err: any) {
      console.log(`    ⚠️  Could not fetch stream status: ${err.message}`);
      // Add to list anyway so user can try to cancel it
      streams.push({
        streamId: pool.streamflow_stream_id,
        poolId: pool.id,
        poolName: pool.name,
        depositedAmount: 0,
        withdrawnAmount: 0,
        remainingAmount: 0,
        start: 0,
        end: 0,
        isCompleted: false,
        isActive: false,
      });
    }
  }

  return streams;
}

async function cancelStream(streamId: string, adminKeypair: Keypair): Promise<{ success: boolean; alreadyClosed: boolean }> {
  const streamflowService = new StreamflowService();
  
  try {
    console.log(`\n🔄 Canceling stream: ${streamId}`);
    const result = await streamflowService.cancelVestingPool(streamId, adminKeypair);
    
    if (result.signature === 'already_closed') {
      console.log('  ℹ️  Stream already closed - rent was previously reclaimed');
      return { success: true, alreadyClosed: true };
    }
    
    if (result.withdrew) {
      console.log('  ✓ Withdrew all vested tokens');
    }
    console.log(`  ✓ Stream cancelled! Signature: ${result.signature}`);
    console.log('  ✓ Rent and unvested tokens returned to treasury');
    
    return { success: true, alreadyClosed: false };
  } catch (error: any) {
    console.error(`  ❌ Failed to cancel stream: ${error.message}`);
    return { success: false, alreadyClosed: false };
  }
}

async function updateDatabaseAfterCancel(streamId: string) {
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  
  // Update pool state to 'cancelled'
  const { error: poolError } = await supabase
    .from('vesting_streams')
    .update({ state: 'cancelled' })
    .eq('streamflow_stream_id', streamId);

  if (poolError) {
    console.log(`  ⚠️  Could not update pool state: ${poolError.message}`);
  } else {
    console.log('  ✓ Updated pool state to "cancelled"');
  }

  // Mark all associated vestings as cancelled
  const { error: vestingError } = await supabase
    .from('vestings')
    .update({ 
      is_cancelled: true, 
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'Pool cancelled and rent reclaimed'
    })
    .eq('streamflow_stream_id', streamId);

  if (vestingError) {
    console.log(`  ⚠️  Could not update vestings: ${vestingError.message}`);
  } else {
    console.log('  ✓ Marked associated vestings as cancelled');
  }
}

async function main() {
  console.log('💰 Streamflow Rent Reclaim Tool\n');

  const args = process.argv.slice(2);
  const adminKeypair = await getAdminKeypair();
  
  console.log(`🔑 Admin wallet: ${adminKeypair.publicKey.toBase58()}\n`);

  // Mode 1: Cancel specific stream
  if (args.length > 0 && !args.includes('--all')) {
    const streamId = args[0];
    console.log(`📌 Canceling specific stream: ${streamId}\n`);
    
    const success = await cancelStream(streamId, adminKeypair);
    if (success) {
      await updateDatabaseAfterCancel(streamId);
      console.log('\n✅ Stream cancelled successfully!');
    } else {
      console.log('\n❌ Failed to cancel stream');
      process.exit(1);
    }
    
    rl.close();
    return;
  }

  // Mode 2: Cancel all streams
  const streams = await getAllStreams();
  
  if (streams.length === 0) {
    console.log('\n✅ No streams to cancel');
    rl.close();
    return;
  }

  console.log(`\n📋 Found ${streams.length} stream(s):\n`);
  streams.forEach((stream, index) => {
    console.log(`${index + 1}. ${stream.poolName}`);
    console.log(`   Stream ID: ${stream.streamId}`);
    console.log(`   Status: ${stream.isCompleted ? 'Completed' : stream.isActive ? 'Active' : 'Not Started'}`);
    console.log(`   Remaining: ${stream.remainingAmount} tokens`);
    console.log('');
  });

  if (!args.includes('--all')) {
    const answer = await question('Cancel ALL streams? Type "YES" to confirm: ');
    if (answer !== 'YES') {
      console.log('❌ Cancelled');
      rl.close();
      return;
    }
  }

  console.log('\n🔄 Starting cancellation process...\n');

  let successCount = 0;
  let alreadyClosedCount = 0;
  let failCount = 0;

  for (const stream of streams) {
    console.log(`\n[${ successCount + alreadyClosedCount + failCount + 1}/${streams.length}] Processing ${stream.poolName}...`);
    
    const result = await cancelStream(stream.streamId, adminKeypair);
    if (result.success) {
      await updateDatabaseAfterCancel(stream.streamId);
      if (result.alreadyClosed) {
        alreadyClosedCount++;
      } else {
        successCount++;
      }
    } else {
      failCount++;
    }

    // Wait 2 seconds between cancellations to avoid rate limits
    if (successCount + alreadyClosedCount + failCount < streams.length) {
      console.log('  ⏳ Waiting 2 seconds...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`  ✅ Successfully cancelled: ${successCount}`);
  console.log(`  ℹ️  Already closed: ${alreadyClosedCount}`);
  console.log(`  ❌ Failed: ${failCount}`);
  console.log(`  📝 Total processed: ${streams.length}`);
  console.log('='.repeat(60) + '\n');

  if (successCount > 0) {
    console.log('💰 Rent and unvested tokens have been returned to your treasury wallet');
    console.log(`   Treasury: ${adminKeypair.publicKey.toBase58()}\n`);
  }

  if (alreadyClosedCount > 0) {
    console.log('ℹ️  Note: Some streams were already closed - rent was previously reclaimed');
  }

  rl.close();
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  rl.close();
  process.exit(1);
});
