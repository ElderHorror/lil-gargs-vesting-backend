/**
 * Manual Test Script for Vesting Claims
 * 
 * Run with: npx ts-node tests/manual-test.ts
 * 
 * This script simulates a full claim flow:
 * 1. Check vesting summary
 * 2. Initiate claim
 * 3. Complete claim
 * 4. Verify claim history
 */

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { config } from '../src/config';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'http://localhost:3001/api';
const connection = new Connection(config.rpcEndpoint, 'confirmed');

// Test wallet - try env var first, then file
let TEST_WALLET: Keypair;

if (process.env.TEST_WALLET_PRIVATE_KEY) {
  // Use environment variable
  TEST_WALLET = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(process.env.TEST_WALLET_PRIVATE_KEY))
  );
  console.log('✅ Using test wallet from environment variable');
} else {
  // Try to load from file
  const walletFile = path.join(__dirname, 'test-wallet.json');
  if (fs.existsSync(walletFile)) {
    const privateKeyArray = JSON.parse(fs.readFileSync(walletFile, 'utf-8'));
    TEST_WALLET = Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    console.log('✅ Using test wallet from file:', walletFile);
  } else {
    console.error('❌ No test wallet found!');
    console.log('\nPlease either:');
    console.log('1. Run setup script: npx ts-node tests/setup-test-wallet.ts');
    console.log('2. Set TEST_WALLET_PRIVATE_KEY environment variable');
    console.log('   Example: $env:TEST_WALLET_PRIVATE_KEY=\'[1,2,3,...]\'');
    process.exit(1);
  }
}

const wallet = TEST_WALLET.publicKey.toBase58();

async function testFullClaimFlow() {
  console.log('🧪 Testing Full Claim Flow\n');
  console.log('Wallet:', wallet);
  console.log('─'.repeat(60));
  
  try {
    // Step 1: List pools
    console.log('\n📋 Step 1: Listing pools...');
    const listResponse = await fetch(`${API_BASE}/user/vesting/list?wallet=${wallet}`);
    const listData = await listResponse.json() as any;
    
    if (!listData.success || listData.vestings.length === 0) {
      console.error('❌ No pools found for this wallet');
      return;
    }
    
    console.log(`✅ Found ${listData.vestings.length} pool(s):`);
    listData.vestings.forEach((pool: any, i: number) => {
      console.log(`   ${i + 1}. ${pool.poolName} (${pool.vestingMode})`);
    });
    
    const poolId = listData.vestings[0].poolId;
    console.log(`\n🎯 Testing with pool: ${listData.vestings[0].poolName}`);
    
    // Step 2: Get summary
    console.log('\n📊 Step 2: Getting vesting summary...');
    const summaryResponse = await fetch(
      `${API_BASE}/user/vesting/summary?wallet=${wallet}&poolId=${poolId}`
    );
    const summaryData = await summaryResponse.json() as any;
    
    if (!summaryData.success) {
      console.error('❌ Failed to get summary:', summaryData.error);
      return;
    }
    
    console.log('✅ Summary:');
    console.log(`   Total Eligible: ${summaryData.data.userShare.totalEligible.toLocaleString()} tokens`);
    console.log(`   Unlocked: ${summaryData.data.balances.unlocked.toLocaleString()} tokens`);
    console.log(`   Locked: ${summaryData.data.balances.locked.toLocaleString()} tokens`);
    console.log(`   Already Claimed: ${summaryData.data.balances.totalClaimed.toLocaleString()} tokens`);
    
    if (summaryData.data.balances.unlocked === 0) {
      console.log('\n⚠️ No tokens available to claim. Test complete.');
      return;
    }
    
    // Step 3: Initiate claim
    console.log('\n💰 Step 3: Initiating claim...');
    const claimResponse = await fetch(`${API_BASE}/user/vesting/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userWallet: wallet,
        poolId,
      }),
    });
    
    const claimData = await claimResponse.json() as any;
    
    if (!claimData.success || claimData.step !== 'fee_payment_required') {
      console.error('❌ Failed to initiate claim:', claimData.error);
      return;
    }
    
    console.log('✅ Claim initiated:');
    console.log(`   Claimable: ${claimData.claimDetails.amountClaimable.toLocaleString()} tokens`);
    console.log(`   Fee: $${claimData.feeDetails.amountUsd} USD (${claimData.feeDetails.amountSol.toFixed(4)} SOL)`);
    
    // Step 4: Sign and send fee transaction
    console.log('\n🔐 Step 4: Signing fee transaction...');
    const feeTransactionBuffer = Buffer.from(claimData.feeTransaction, 'base64');
    const feeTransaction = Transaction.from(feeTransactionBuffer);
    
    // Sign with test wallet
    feeTransaction.sign(TEST_WALLET);
    
    console.log('📤 Sending fee transaction...');
    const feeSignature = await connection.sendRawTransaction(feeTransaction.serialize());
    console.log('⏳ Confirming fee transaction...');
    await connection.confirmTransaction(feeSignature, 'confirmed');
    console.log(`✅ Fee paid! Signature: ${feeSignature}`);
    
    // Step 5: Complete claim
    console.log('\n🎁 Step 5: Completing claim...');
    const completeResponse = await fetch(`${API_BASE}/user/vesting/complete-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userWallet: wallet,
        feeSignature,
        poolId,
      }),
    });
    
    const completeData = await completeResponse.json() as any;
    
    if (!completeResponse.ok) {
      console.error('❌ Failed to complete claim:', completeData.error);
      return;
    }
    
    console.log('✅ Claim completed successfully!');
    console.log(`   Claimed: ${completeData.data.amountClaimed.toLocaleString()} tokens`);
    console.log(`   Token TX: ${completeData.data.tokenTransactionSignature}`);
    
    // Step 6: Verify claim history
    console.log('\n📜 Step 6: Verifying claim history...');
    const historyResponse = await fetch(
      `${API_BASE}/user/vesting/claim-history?wallet=${wallet}`
    );
    const historyData = await historyResponse.json() as any;
    
    if (historyData.success && historyData.data.length > 0) {
      console.log(`✅ Found ${historyData.data.length} claim(s) in history`);
      const latestClaim = historyData.data[0];
      console.log(`   Latest: ${latestClaim.amount.toLocaleString()} tokens on ${new Date(latestClaim.date).toLocaleString()}`);
    }
    
    console.log('\n' + '─'.repeat(60));
    console.log('🎉 Full claim flow test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  }
}

async function testDuplicateClaim() {
  console.log('\n🧪 Testing Duplicate Claim Prevention\n');
  console.log('─'.repeat(60));
  
  try {
    const fakeSignature = 'test_duplicate_' + Date.now();
    
    console.log('📤 Attempt 1: Sending claim with signature:', fakeSignature);
    const response1 = await fetch(`${API_BASE}/user/vesting/complete-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userWallet: wallet,
        feeSignature: fakeSignature,
      }),
    });
    
    console.log(`   Response: ${response1.status}`);
    
    console.log('\n📤 Attempt 2: Reusing same signature...');
    const response2 = await fetch(`${API_BASE}/user/vesting/complete-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userWallet: wallet,
        feeSignature: fakeSignature,
      }),
    });
    
    const data2 = await response2.json() as any;
    
    if (response2.status === 400 && data2.error.includes('already been used')) {
      console.log('✅ Duplicate claim correctly rejected!');
      console.log(`   Error: ${data2.error}`);
    } else {
      console.log('⚠️ Unexpected response:', data2);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

async function testEdgeCases() {
  console.log('\n🧪 Testing Edge Cases\n');
  console.log('─'.repeat(60));
  
  try {
    // Test 1: Invalid wallet
    console.log('\n🔍 Test 1: Invalid wallet address');
    const randomWallet = Keypair.generate().publicKey.toBase58();
    const response1 = await fetch(`${API_BASE}/user/vesting/summary?wallet=${randomWallet}`);
    const data1 = await response1.json();
    
    if (response1.status === 404) {
      console.log('✅ Correctly returns 404 for wallet with no vesting');
    } else {
      console.log('⚠️ Unexpected response:', data1);
    }
    
    // Test 2: Invalid pool ID
    console.log('\n🔍 Test 2: Invalid pool ID');
    const response2 = await fetch(
      `${API_BASE}/user/vesting/summary?wallet=${wallet}&poolId=invalid-pool-id`
    );
    const data2 = await response2.json();
    
    if (response2.status === 404) {
      console.log('✅ Correctly returns 404 for invalid pool');
    } else {
      console.log('⚠️ Unexpected response:', data2);
    }
    
    // Test 3: Missing parameters
    console.log('\n🔍 Test 3: Missing required parameters');
    const response3 = await fetch(`${API_BASE}/user/vesting/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data3 = await response3.json();
    
    if (response3.status === 400) {
      console.log('✅ Correctly returns 400 for missing parameters');
    } else {
      console.log('⚠️ Unexpected response:', data3);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Main test runner
async function runAllTests() {
  console.log('\n🚀 Starting Manual Test Suite\n');
  console.log('═'.repeat(60));
  
  try {
    await testFullClaimFlow();
    await testDuplicateClaim();
    await testEdgeCases();
    
    console.log('\n═'.repeat(60));
    console.log('✅ All tests completed!\n');
    
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests();
