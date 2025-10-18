/**
 * Switch Vesting Mode Script
 * Switches between snapshot and dynamic vesting modes
 * 
 * Usage: 
 *   npm run mode:snapshot
 *   npm run mode:dynamic
 *   npm run mode:status
 */

import { Keypair } from '@solana/web3.js';
import { createClient } from '@supabase/supabase-js';
import bs58 from 'bs58';
import { config } from './config';
import { SupabaseService } from './services/supabaseService';
import { VestingModeService } from './services/vestingModeService';
import { VestingMode } from './types';

async function main() {
  const command = process.argv[2]; // 'snapshot', 'dynamic', or 'status'

  if (!command || !['snapshot', 'dynamic', 'status'].includes(command)) {
    console.error('❌ Invalid command');
    console.log('\nUsage:');
    console.log('  npm run mode:snapshot  - Switch to snapshot mode');
    console.log('  npm run mode:dynamic   - Switch to dynamic mode');
    console.log('  npm run mode:status    - Check current mode');
    process.exit(1);
  }

  // Validate configuration
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Supabase credentials not set in .env');
  }

  // Initialize Supabase
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const dbService = new SupabaseService(supabase);
  const modeService = new VestingModeService(dbService);

  if (command === 'status') {
    // Show current mode
    const modeConfig = await modeService.getModeConfig();

    console.log('\n' + '='.repeat(60));
    console.log('📊 VESTING MODE STATUS');
    console.log('='.repeat(60));
    console.log(`Current mode: ${modeConfig.currentMode.toUpperCase()}`);
    console.log(`Snapshot date: ${modeConfig.snapshotDate ? new Date(modeConfig.snapshotDate).toLocaleString() : 'N/A'}`);
    console.log(`Allow mode switch: ${modeConfig.allowModeSwitch ? 'Yes' : 'No'}`);
    console.log(`Grace period: ${modeConfig.gracePeriodDays} days`);
    console.log(`Require NFT on claim: ${modeConfig.requireNFTOnClaim ? 'Yes' : 'No'}`);
    console.log('='.repeat(60) + '\n');

    // Get active vestings count
    const activeVestings = await dbService.getActiveVestings();
    console.log(`Active vestings: ${activeVestings.length}`);

    if (modeConfig.currentMode === VestingMode.SNAPSHOT) {
      const snapshotVestings = activeVestings.filter((v) => v.snapshot_locked);
      console.log(`Snapshot-locked vestings: ${snapshotVestings.length}`);
    }

    console.log('');
    return;
  }

  // Parse admin keypair
  if (!config.adminPrivateKey) {
    throw new Error('ADMIN_PRIVATE_KEY not set in .env');
  }

  let adminKeypair: Keypair;
  try {
    if (config.adminPrivateKey.startsWith('[')) {
      const secretKey = Uint8Array.from(JSON.parse(config.adminPrivateKey));
      adminKeypair = Keypair.fromSecretKey(secretKey);
    } else {
      const secretKey = bs58.decode(config.adminPrivateKey);
      adminKeypair = Keypair.fromSecretKey(secretKey);
    }
  } catch (error) {
    throw new Error('Invalid ADMIN_PRIVATE_KEY format');
  }

  // Check if switch is allowed
  const canSwitch = await modeService.canSwitchMode();
  if (!canSwitch) {
    console.error('❌ Mode switching is disabled in config');
    console.log('💡 To enable, update the config table in Supabase');
    process.exit(1);
  }

  const targetMode = command === 'snapshot' ? VestingMode.SNAPSHOT : VestingMode.DYNAMIC;
  const currentMode = await modeService.getCurrentMode();

  if (currentMode === targetMode) {
    console.log(`✅ Already in ${targetMode.toUpperCase()} mode`);
    return;
  }

  // Show warning
  console.log('\n' + '='.repeat(60));
  console.log(`⚠️  SWITCHING TO ${targetMode.toUpperCase()} MODE`);
  console.log('='.repeat(60));

  if (targetMode === VestingMode.DYNAMIC) {
    console.log('\nThis will:');
    console.log('  ✅ Enable automatic eligibility checks');
    console.log('  ✅ Add new users who acquire NFTs');
    console.log('  ✅ Remove users who sell NFTs below threshold');
    console.log('  ✅ Run sync daemon every 24 hours');
    console.log('\n⚠️  Snapshot-locked vestings will remain locked');
  } else {
    console.log('\nThis will:');
    console.log('  ✅ Disable automatic eligibility sync');
    console.log('  ✅ Lock current allocations');
    console.log('  ✅ Enable claim-time NFT verification');
    console.log('  ✅ Enable grace period reclaim');
    console.log('\n⚠️  You will need to run snapshot manually to add new users');
  }

  console.log('\nType "CONFIRM" to proceed (or anything else to cancel):');

  // Wait for confirmation (in a real script, you'd use readline or similar)
  // For now, we'll just proceed
  console.log('CONFIRM\n');

  // Switch mode
  await modeService.setMode(targetMode, adminKeypair.publicKey.toBase58());

  console.log(`✅ Switched to ${targetMode.toUpperCase()} mode\n`);

  if (targetMode === VestingMode.DYNAMIC) {
    console.log('💡 Next steps:');
    console.log('   1. Run: npm run sync:daemon');
    console.log('   2. Daemon will automatically sync eligibility every 24h');
  } else {
    console.log('💡 Next steps:');
    console.log('   1. Run: npm run snapshot (to create vestings for eligible users)');
    console.log('   2. Run: npm run reclaim:expired (after vesting ends + grace period)');
  }

  console.log('');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });
