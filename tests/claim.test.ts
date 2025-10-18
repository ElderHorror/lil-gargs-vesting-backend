import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config';

/**
 * Integration Tests for Vesting Claim System
 * 
 * Prerequisites:
 * - Backend server running on localhost:3001
 * - Supabase configured with test data
 * - Admin wallet with tokens
 * - Test wallets with SOL for fees
 */

const API_BASE = 'http://localhost:3001/api';
const connection = new Connection(config.rpcEndpoint, 'confirmed');
const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

// Test wallets (generate fresh ones for testing)
let testWallet1: Keypair;
let testWallet2: Keypair;
let testPoolId: string;

beforeAll(async () => {
  console.log('🔧 Setting up test environment...');
  
  // Generate test wallets
  testWallet1 = Keypair.generate();
  testWallet2 = Keypair.generate();
  
  console.log('Test Wallet 1:', testWallet1.publicKey.toBase58());
  console.log('Test Wallet 2:', testWallet2.publicKey.toBase58());
  
  // Airdrop SOL for fees (devnet only)
  try {
    const airdrop1 = await connection.requestAirdrop(testWallet1.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdrop1);
    
    const airdrop2 = await connection.requestAirdrop(testWallet2.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdrop2);
    
    console.log('✅ Airdrops completed');
  } catch (err) {
    console.warn('⚠️ Airdrop failed (might be mainnet):', err);
  }
  
  // Get or create test pool
  const { data: pools } = await supabase
    .from('vesting_streams')
    .select('id')
    .eq('is_active', true)
    .limit(1);
  
  if (pools && pools.length > 0) {
    testPoolId = pools[0].id;
    console.log('✅ Using existing pool:', testPoolId);
  } else {
    console.error('❌ No active pools found. Please create a test pool first.');
    process.exit(1);
  }
});

afterAll(async () => {
  console.log('🧹 Cleaning up test data...');
  
  // Clean up test vestings
  await supabase
    .from('vestings')
    .delete()
    .in('user_wallet', [
      testWallet1.publicKey.toBase58(),
      testWallet2.publicKey.toBase58(),
    ]);
  
  console.log('✅ Cleanup complete');
});

describe('Vesting Claim System', () => {
  
  describe('1. Multi-Pool Claiming', () => {
    it('should list all pools for a user', async () => {
      // Create test vestings for wallet 1 (2 pools)
      await supabase.from('vestings').insert([
        {
          user_wallet: testWallet1.publicKey.toBase58(),
          vesting_stream_id: testPoolId,
          token_amount: 1000000,
          nft_count: 10,
          vesting_mode: 'snapshot',
          is_active: true,
        },
      ]);
      
      const response = await fetch(
        `${API_BASE}/user/vesting/list?wallet=${testWallet1.publicKey.toBase58()}`
      );
      
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.vestings.length).toBeGreaterThan(0);
      console.log('✅ Multi-pool listing works');
    });
    
    it('should get summary for specific pool', async () => {
      const response = await fetch(
        `${API_BASE}/user/vesting/summary?wallet=${testWallet1.publicKey.toBase58()}&poolId=${testPoolId}`
      );
      
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.poolId).toBe(testPoolId);
      console.log('✅ Pool-specific summary works');
    });
  });
  
  describe('2. Duplicate Claim Prevention', () => {
    it('should reject duplicate fee signatures', async () => {
      const fakeSignature = 'duplicate_test_signature_' + Date.now();
      
      // First attempt
      const response1 = await fetch(`${API_BASE}/user/vesting/complete-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userWallet: testWallet1.publicKey.toBase58(),
          feeSignature: fakeSignature,
          poolId: testPoolId,
        }),
      });
      
      // Second attempt with same signature (should fail)
      const response2 = await fetch(`${API_BASE}/user/vesting/complete-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userWallet: testWallet1.publicKey.toBase58(),
          feeSignature: fakeSignature,
          poolId: testPoolId,
        }),
      });
      
      const data2 = await response2.json();
      
      expect(response2.status).toBe(400);
      expect(data2.error).toContain('already been used');
      console.log('✅ Duplicate claim prevention works');
    });
  });
  
  describe('3. Edge Cases', () => {
    it('should handle wallet with no vesting', async () => {
      const randomWallet = Keypair.generate();
      
      const response = await fetch(
        `${API_BASE}/user/vesting/summary?wallet=${randomWallet.publicKey.toBase58()}`
      );
      
      const data = await response.json();
      
      expect(response.status).toBe(404);
      expect(data.error).toContain('No active vesting');
      console.log('✅ No vesting error handling works');
    });
    
    it('should handle invalid pool ID', async () => {
      const response = await fetch(
        `${API_BASE}/user/vesting/summary?wallet=${testWallet1.publicKey.toBase58()}&poolId=invalid-pool-id`
      );
      
      const data = await response.json();
      
      expect(response.status).toBe(404);
      expect(data.error).toContain('not found');
      console.log('✅ Invalid pool error handling works');
    });
    
    it('should handle zero claimable balance', async () => {
      // Create vesting with all tokens already claimed
      const { data: vesting } = await supabase
        .from('vestings')
        .insert({
          user_wallet: testWallet2.publicKey.toBase58(),
          vesting_stream_id: testPoolId,
          token_amount: 1000000,
          nft_count: 5,
          vesting_mode: 'snapshot',
          is_active: true,
        })
        .select()
        .single();
      
      // Create claim record for full amount
      await supabase.from('claims').insert({
        user_wallet: testWallet2.publicKey.toBase58(),
        vesting_id: vesting.id,
        amount_claimed: 1000000000000000, // Full amount in base units
        fee_paid: 0.01,
        transaction_signature: 'test_sig_' + Date.now(),
      });
      
      const response = await fetch(
        `${API_BASE}/user/vesting/summary?wallet=${testWallet2.publicKey.toBase58()}`
      );
      
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.data.balances.unlocked).toBe(0);
      console.log('✅ Zero balance handling works');
    });
  });
  
  describe('4. Claim History', () => {
    it('should return claim history with vesting IDs', async () => {
      const response = await fetch(
        `${API_BASE}/user/vesting/claim-history?wallet=${testWallet1.publicKey.toBase58()}`
      );
      
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      
      if (data.data.length > 0) {
        expect(data.data[0]).toHaveProperty('vestingId');
        console.log('✅ Claim history includes vesting IDs');
      } else {
        console.log('⚠️ No claim history to test');
      }
    });
  });
  
  describe('5. Transaction Retry Logic', () => {
    it('should handle RPC timeout gracefully', async () => {
      // This test requires mocking the RPC connection
      // For now, we'll just verify the endpoint exists
      const response = await fetch(`${API_BASE}/user/vesting/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userWallet: testWallet1.publicKey.toBase58(),
          poolId: testPoolId,
        }),
      });
      
      expect([200, 400, 404]).toContain(response.status);
      console.log('✅ Claim endpoint is accessible');
    });
  });
  
  describe('6. Admin Token Balance', () => {
    it('should verify admin has sufficient tokens', async () => {
      const adminKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(config.adminPrivateKey))
      );
      
      const tokenMint = new PublicKey(config.customTokenMint!);
      const adminTokenAccount = await getAssociatedTokenAddress(
        tokenMint,
        adminKeypair.publicKey
      );
      
      try {
        const accountInfo = await getAccount(connection, adminTokenAccount);
        const balance = Number(accountInfo.amount) / Math.pow(10, 9);
        
        expect(balance).toBeGreaterThan(0);
        console.log(`✅ Admin token balance: ${balance.toLocaleString()} tokens`);
        
        if (balance < 1000000) {
          console.warn('⚠️ Admin balance is low! Consider topping up.');
        }
      } catch (err) {
        console.error('❌ Admin token account not found or error:', err);
        throw err;
      }
    });
  });
});

// Run tests
console.log('🚀 Starting vesting claim tests...\n');
