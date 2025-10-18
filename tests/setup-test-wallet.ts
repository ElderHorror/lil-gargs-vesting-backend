/**
 * Test Wallet Setup Script
 * 
 * This script will:
 * 1. Generate a fresh test wallet
 * 2. Airdrop SOL (devnet only)
 * 3. Create vesting record in database
 * 4. Display wallet info for testing
 * 
 * Run with: npx ts-node tests/setup-test-wallet.ts
 */

import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config';
import * as fs from 'fs';
import * as path from 'path';

const connection = new Connection(config.rpcEndpoint, 'confirmed');
const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

async function setupTestWallet() {
  console.log('🔧 Setting up test wallet...\n');
  console.log('═'.repeat(60));
  
  try {
    // Step 1: Generate test wallet
    console.log('\n📝 Step 1: Generating test wallet...');
    const testWallet = Keypair.generate();
    const walletAddress = testWallet.publicKey.toBase58();
    const privateKeyArray = Array.from(testWallet.secretKey);
    
    console.log('✅ Wallet generated:');
    console.log(`   Address: ${walletAddress}`);
    console.log(`   Private Key: [${privateKeyArray.slice(0, 5).join(',')}...] (${privateKeyArray.length} bytes)`);
    
    // Save to file
    const walletFile = path.join(__dirname, 'test-wallet.json');
    fs.writeFileSync(walletFile, JSON.stringify(privateKeyArray));
    console.log(`   Saved to: ${walletFile}`);
    
    // Step 2: Airdrop SOL (devnet only)
    console.log('\n💰 Step 2: Airdropping SOL...');
    try {
      const airdropSignature = await connection.requestAirdrop(
        testWallet.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropSignature);
      
      const balance = await connection.getBalance(testWallet.publicKey);
      console.log(`✅ Airdrop successful!`);
      console.log(`   Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    } catch (err) {
      console.warn('⚠️ Airdrop failed (might be mainnet or rate limited)');
      console.log('   Please manually send SOL to:', walletAddress);
    }
    
    // Step 3: Get active pools
    console.log('\n📋 Step 3: Finding active pools...');
    const { data: pools, error: poolError } = await supabase
      .from('vesting_streams')
      .select('id, name, vesting_mode, total_pool_amount')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    
    if (poolError) {
      throw poolError;
    }
    
    if (!pools || pools.length === 0) {
      console.error('❌ No active pools found!');
      console.log('   Please create a pool first using the admin dashboard.');
      return;
    }
    
    console.log(`✅ Found ${pools.length} active pool(s):`);
    pools.forEach((pool, i) => {
      console.log(`   ${i + 1}. ${pool.name} (${pool.vesting_mode})`);
    });
    
    // Prefer snapshot pools for testing (no NFT requirement)
    const selectedPool = pools.find(p => p.vesting_mode === 'snapshot') || pools[0];
    console.log(`\n🎯 Using pool: ${selectedPool.name} (${selectedPool.vesting_mode})`);
    
    // Step 4: Create vesting record
    console.log('\n💾 Step 4: Creating vesting record...');
    
    // Check if vesting already exists
    const { data: existingVesting } = await supabase
      .from('vestings')
      .select('id')
      .eq('user_wallet', walletAddress)
      .eq('vesting_stream_id', selectedPool.id)
      .single();
    
    if (existingVesting) {
      console.log('⚠️ Vesting record already exists for this wallet/pool');
    } else {
      const tokenAmount = 100000000; // 100M tokens
      const nftCount = 10;
      const tier = 1; // Default tier
      const sharePercentage = (tokenAmount / selectedPool.total_pool_amount) * 100;
      
      const { data: vesting, error: vestingError } = await supabase
        .from('vestings')
        .insert({
          user_wallet: walletAddress,
          vesting_stream_id: selectedPool.id,
          token_amount: tokenAmount,
          nft_count: nftCount,
          tier: tier,
          vesting_mode: selectedPool.vesting_mode,
          is_active: true,
          share_percentage: sharePercentage,
        })
        .select()
        .single();
      
      if (vestingError) {
        throw vestingError;
      }
      
      console.log('✅ Vesting record created:');
      console.log(`   Pool: ${selectedPool.name}`);
      console.log(`   Token Amount: ${tokenAmount.toLocaleString()} tokens`);
      console.log(`   NFT Count: ${nftCount}`);
      console.log(`   Share: ${sharePercentage.toFixed(2)}%`);
    }
    
    // Step 5: Display environment variable
    console.log('\n🔐 Step 5: Environment Variable Setup');
    console.log('═'.repeat(60));
    console.log('\nCopy and paste this command to set your test wallet:\n');
    
    if (process.platform === 'win32') {
      console.log('PowerShell:');
      console.log(`$env:TEST_WALLET_PRIVATE_KEY='${JSON.stringify(privateKeyArray)}'`);
      console.log('\nCommand Prompt:');
      console.log(`set TEST_WALLET_PRIVATE_KEY=${JSON.stringify(privateKeyArray)}`);
    } else {
      console.log('Bash/Zsh:');
      console.log(`export TEST_WALLET_PRIVATE_KEY='${JSON.stringify(privateKeyArray)}'`);
    }
    
    console.log('\n═'.repeat(60));
    console.log('✅ Test wallet setup complete!\n');
    console.log('Next steps:');
    console.log('1. Set the environment variable above');
    console.log('2. Make sure backend is running: npm run api:server');
    console.log('3. Run tests: npm run test:manual');
    console.log('\n');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    throw error;
  }
}

// Run setup
setupTestWallet();
