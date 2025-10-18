import { createClient } from '@supabase/supabase-js';
import { config } from './config';
import * as readline from 'readline';

/**
 * Clear all vesting data from Supabase
 * WARNING: This will delete ALL data!
 */

async function main() {
  console.log('⚠️  DATABASE RESET UTILITY ⚠️\n');
  console.log('This will DELETE ALL data from the following tables:');
  console.log('  - vestings');
  console.log('  - claim_history');
  console.log('  - admin_logs');
  console.log('');

  // Confirm with user
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question('Are you ABSOLUTELY SURE you want to delete all data? Type "DELETE ALL" to confirm: ', resolve);
  });
  rl.close();

  if (answer !== 'DELETE ALL') {
    console.log('❌ Aborted. No data was deleted.');
    process.exit(0);
  }

  console.log('\n🗑️  Starting database cleanup...\n');

  // Initialize Supabase
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

  try {
    // Delete in order (respecting foreign key constraints)
    // Using .not('id', 'is', null) to select all rows regardless of ID type
    
    // 1. Delete claim_history (references vestings)
    console.log('Deleting claim_history...');
    const { data: historyData, error: historyError } = await supabase
      .from('claim_history')
      .delete()
      .not('id', 'is', null)
      .select();
    if (historyError) throw historyError;
    const historyCount = historyData?.length || 0;
    console.log(`✅ Deleted ${historyCount} claim history records`);

    // 2. Delete vestings
    console.log('Deleting vestings...');
    const { data: vestingsData, error: vestingsError } = await supabase
      .from('vestings')
      .delete()
      .not('id', 'is', null)
      .select();
    if (vestingsError) throw vestingsError;
    const vestingsCount = vestingsData?.length || 0;
    console.log(`✅ Deleted ${vestingsCount} vestings`);

    // 3. Delete admin_logs
    console.log('Deleting admin_logs...');
    const { data: logsData, error: logsError } = await supabase
      .from('admin_logs')
      .delete()
      .not('id', 'is', null)
      .select();
    if (logsError) throw logsError;
    const logsCount = logsData?.length || 0;
    console.log(`✅ Deleted ${logsCount} admin logs`);

    console.log('\n✅ Database cleanup complete!');
    console.log('\n📊 Summary:');
    console.log(`   Claim History: ${historyCount}`);
    console.log(`   Vestings: ${vestingsCount}`);
    console.log(`   Admin Logs: ${logsCount}`);
    console.log('\n🎉 Database is now clean and ready for fresh data!');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

main().catch(console.error);
