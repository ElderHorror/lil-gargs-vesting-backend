import { createClient } from '@supabase/supabase-js';
import { config } from './config';

/**
 * Set the admin wallet address in the database config
 * This wallet will have access to the admin dashboard
 */

async function main() {
  const adminWallet = process.argv[2];
  const mode = process.argv[3]; // 'add' or 'replace' (default: replace)

  if (!adminWallet) {
    console.error('❌ Error: Please provide an admin wallet address');
    console.log('\nUsage:');
    console.log('  npm run admin:set <wallet_address> [mode]');
    console.log('\nModes:');
    console.log('  replace - Replace all admin wallets (default)');
    console.log('  add     - Add to existing admin wallets');
    console.log('\nExamples:');
    console.log('  npm run admin:set FiKEWEJfcyd49MNwLvxnkzZbRJ2tm11zFUkZu11yFAud');
    console.log('  npm run admin:set AnotherWallet123... add');
    process.exit(1);
  }

  console.log('🔐 Setting admin wallet...\n');
  console.log(`Wallet: ${adminWallet}`);
  console.log(`Mode: ${mode === 'add' ? 'Add to existing' : 'Replace all'}\n`);

  // Initialize Supabase
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

  try {
    // Check if config exists
    const { data: existingConfig, error: fetchError } = await supabase
      .from('config')
      .select('*')
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (existingConfig) {
      // Update existing config
      let newAdminWallets: string;
      
      if (mode === 'add') {
        // Add to existing wallets
        const existingWallets = existingConfig.admin_wallet
          .split(',')
          .map((w: string) => w.trim())
          .filter((w: string) => w.length > 0);
        
        if (existingWallets.includes(adminWallet)) {
          console.log('⚠️  Wallet already exists in admin list');
          return;
        }
        
        existingWallets.push(adminWallet);
        newAdminWallets = existingWallets.join(',');
        console.log(`Adding to existing admins: ${existingWallets.join(', ')}`);
      } else {
        // Replace all wallets
        newAdminWallets = adminWallet;
      }
      
      const { error: updateError } = await supabase
        .from('config')
        .update({ admin_wallet: newAdminWallets })
        .eq('id', existingConfig.id);

      if (updateError) throw updateError;
      console.log('✅ Admin wallet(s) updated successfully!');
      console.log(`Current admin wallets: ${newAdminWallets}`);
    } else {
      // Create new config
      const { error: insertError } = await supabase
        .from('config')
        .insert({
          admin_wallet: adminWallet,
          token_mint: config.customTokenMint?.toBase58() || '',
          claim_fee_sol: config.claimFeeSOL,
          claim_fee_usd: 10.0,
          vesting_mode: 'dynamic',
          allow_mode_switch: true,
        });

      if (insertError) throw insertError;
      console.log('✅ Config created with admin wallet!');
    }

    console.log('\n🎉 Done! This wallet can now access the admin dashboard.');
  } catch (error) {
    console.error('❌ Error setting admin wallet:', error);
    process.exit(1);
  }
}

main().catch(console.error);
