import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config';
import * as readline from 'readline';

/**
 * Database Cleanup Script
 * Clears all pre-existing pools, vestings, and claim history
 * 
 * Usage: npx ts-node scripts/clearDatabase.ts [--confirm]
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

async function clearDatabase(autoConfirm: boolean = false) {
  console.log('🗑️  Database Cleanup Script\n');
  console.log('This will DELETE:');
  console.log('  - All vesting pools (vesting_streams)');
  console.log('  - All user vestings (vestings)');
  console.log('  - All claim history (claim_history)');
  console.log('  - All eligibility checks');
  console.log('  - All sync logs');
  console.log('  - All claim attempts');
  console.log('  - All admin logs\n');
  console.log('⚠️  WARNING: This action CANNOT be undone!\n');

  if (!autoConfirm) {
    const answer = await question('Type "DELETE ALL" to confirm: ');
    if (answer !== 'DELETE ALL') {
      console.log('❌ Cleanup cancelled');
      rl.close();
      process.exit(0);
    }
  }

  console.log('\n🔄 Connecting to database...');
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

  try {
    // Get counts before deletion
    console.log('\n📊 Current database state:');
    const { count: poolCount } = await supabase.from('vesting_streams').select('*', { count: 'exact', head: true });
    const { count: vestingCount } = await supabase.from('vestings').select('*', { count: 'exact', head: true });
    const { count: claimCount } = await supabase.from('claim_history').select('*', { count: 'exact', head: true });
    
    console.log(`  - Pools: ${poolCount}`);
    console.log(`  - Vestings: ${vestingCount}`);
    console.log(`  - Claims: ${claimCount}`);

    if (poolCount === 0 && vestingCount === 0 && claimCount === 0) {
      console.log('\n✅ Database is already empty!');
      rl.close();
      return;
    }

    console.log('\n🗑️  Starting deletion...\n');

    // Delete in order (respecting foreign key constraints)
    
    // 1. Delete claim attempts
    console.log('  Deleting claim attempts...');
    const { error: claimAttemptsError } = await supabase.from('claim_attempts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (claimAttemptsError) console.error('    Error:', claimAttemptsError.message);
    else console.log('    ✓ Claim attempts deleted');

    // 2. Delete claim history
    console.log('  Deleting claim history...');
    const { error: claimError } = await supabase.from('claim_history').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (claimError) console.error('    Error:', claimError.message);
    else console.log('    ✓ Claim history deleted');

    // 3. Delete vestings
    console.log('  Deleting vestings...');
    const { error: vestingError } = await supabase.from('vestings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (vestingError) console.error('    Error:', vestingError.message);
    else console.log('    ✓ Vestings deleted');

    // 4. Delete vesting streams (pools)
    console.log('  Deleting vesting streams...');
    const { error: poolError } = await supabase.from('vesting_streams').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (poolError) console.error('    Error:', poolError.message);
    else console.log('    ✓ Vesting streams deleted');

    // 5. Delete eligibility checks
    console.log('  Deleting eligibility checks...');
    const { error: eligibilityError } = await supabase.from('eligibility_checks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (eligibilityError) console.error('    Error:', eligibilityError.message);
    else console.log('    ✓ Eligibility checks deleted');

    // 6. Delete sync logs
    console.log('  Deleting sync logs...');
    const { error: syncError } = await supabase.from('sync_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (syncError) console.error('    Error:', syncError.message);
    else console.log('    ✓ Sync logs deleted');

    // 7. Delete admin logs
    console.log('  Deleting admin logs...');
    const { error: adminError } = await supabase.from('admin_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (adminError) console.error('    Error:', adminError.message);
    else console.log('    ✓ Admin logs deleted');

    console.log('\n✅ Database cleanup complete!');
    console.log('\n📝 Note: Config table was NOT modified');
    console.log('⚠️  Streamflow streams (if any) were NOT cancelled - use reclaimStreamflowRent.ts for that\n');

  } catch (error) {
    console.error('\n❌ Error during cleanup:', error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Check for --confirm flag
const autoConfirm = process.argv.includes('--confirm');
clearDatabase(autoConfirm);
