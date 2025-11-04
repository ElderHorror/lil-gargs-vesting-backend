import { PublicKey } from '@solana/web3.js';
import { HeliusNFTService } from '../src/services/heliusNFTService';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Deep diagnostic to check if we're missing holders
 */
async function deepDiagnostic() {
  const collectionAddress = 'Auteww5g78o8dx3ptqhY7iTBvkdMHVaHgucnTWFkNyVD';
  
  console.log('='.repeat(80));
  console.log('DEEP DIAGNOSTIC - Checking for missing holders');
  console.log('='.repeat(80));

  const heliusApiKey = process.env.HELIUS_API_KEY;
  if (!heliusApiKey) {
    console.error('❌ HELIUS_API_KEY not found');
    process.exit(1);
  }

  const heliusService = new HeliusNFTService(heliusApiKey, 'mainnet-beta');

  try {
    // Fetch with current implementation
    console.log('\n📊 Fetching with current implementation...\n');
    const holders = await heliusService.getAllHolders(new PublicKey(collectionAddress));
    
    console.log(`\n✅ Got ${holders.length} unique holders`);
    console.log(`✅ Total NFTs: ${holders.reduce((sum, h) => sum + h.nftCount, 0)}`);
    
    // Check if there are any holders with 0 NFTs (shouldn't happen)
    const zeroHolders = holders.filter(h => h.nftCount === 0);
    if (zeroHolders.length > 0) {
      console.log(`\n⚠️  Found ${zeroHolders.length} holders with 0 NFTs (bug?)`);
    }
    
    // Try direct API call to see total
    console.log('\n🔍 Making direct API call to check total...\n');
    const baseUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'direct-check',
        method: 'getAssetsByGroup',
        params: {
          groupKey: 'collection',
          groupValue: collectionAddress,
          page: 1,
          limit: 1,
        },
      }),
    });
    
    const data: any = await response.json();
    const apiTotal = data.result?.total;
    const apiTotalPages = data.result?.total_pages;
    
    console.log(`API Reports:`);
    console.log(`  - Total Assets: ${apiTotal}`);
    console.log(`  - Total Pages: ${apiTotalPages}`);
    console.log(`  - Limit per page: 1000`);
    
    if (apiTotal && apiTotal > 1000) {
      console.log(`\n⚠️  ISSUE FOUND: Collection has ${apiTotal} NFTs but we only fetched 1000!`);
      console.log(`   This means we need to fetch ${Math.ceil(apiTotal / 1000)} pages`);
    } else if (apiTotal) {
      console.log(`\n✅ All assets fetched (${apiTotal} total)`);
    }
    
    // Check if expected 128 vs actual 104
    const expected = 128;
    const actual = holders.length;
    if (actual < expected) {
      console.log(`\n❌ DISCREPANCY: Expected ${expected} holders, got ${actual}`);
      console.log(`   Missing: ${expected - actual} holders`);
      console.log(`\nPossible reasons:`);
      console.log(`   1. Some wallets have 0 NFTs (transferred out)`);
      console.log(`   2. NFTs are burned`);
      console.log(`   3. Collection metadata is outdated`);
      console.log(`   4. Helius API data is stale`);
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

deepDiagnostic().catch(console.error);
