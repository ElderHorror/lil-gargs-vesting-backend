import { PublicKey } from '@solana/web3.js';
import { HeliusNFTService } from '../src/services/heliusNFTService';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from backend directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Test script to diagnose NFT holder fetching issues
 * Tests the Helius API pagination and holder detection
 */
async function testNFTFetch() {
  const collectionAddress = 'Auteww5g78o8dx3ptqhY7iTBvkdMHVaHgucnTWFkNyVD';
  
  console.log('='.repeat(80));
  console.log('NFT HOLDER FETCH DIAGNOSTIC TEST');
  console.log('='.repeat(80));
  console.log(`Collection: ${collectionAddress}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('');

  const heliusApiKey = process.env.HELIUS_API_KEY;
  if (!heliusApiKey) {
    console.error('❌ HELIUS_API_KEY not found in environment variables');
    process.exit(1);
  }

  console.log(`✅ Helius API Key: ${heliusApiKey.substring(0, 8)}...${heliusApiKey.substring(heliusApiKey.length - 4)}`);
  console.log('');

  const heliusService = new HeliusNFTService(heliusApiKey, 'mainnet-beta');

  try {
    console.log('🔍 Fetching all holders from collection...');
    console.log('');

    const holders = await heliusService.getAllHolders(new PublicKey(collectionAddress));

    console.log('');
    console.log('='.repeat(80));
    console.log('RESULTS');
    console.log('='.repeat(80));
    console.log(`Total Unique Holders: ${holders.length}`);
    console.log(`Total NFTs: ${holders.reduce((sum, h) => sum + h.nftCount, 0)}`);
    console.log('');

    // Show distribution
    const distribution = new Map<number, number>();
    holders.forEach(h => {
      distribution.set(h.nftCount, (distribution.get(h.nftCount) || 0) + 1);
    });

    console.log('NFT Count Distribution:');
    Array.from(distribution.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([nftCount, holderCount]) => {
        console.log(`  ${nftCount} NFT${nftCount > 1 ? 's' : ''}: ${holderCount} holder${holderCount > 1 ? 's' : ''}`);
      });
    console.log('');

    // Show top 10 holders
    console.log('Top 10 Holders:');
    holders
      .sort((a, b) => b.nftCount - a.nftCount)
      .slice(0, 10)
      .forEach((h, i) => {
        console.log(`  ${i + 1}. ${h.wallet.substring(0, 8)}...${h.wallet.substring(h.wallet.length - 4)} - ${h.nftCount} NFT${h.nftCount > 1 ? 's' : ''}`);
      });
    console.log('');

    // Test multiple runs to check consistency
    console.log('='.repeat(80));
    console.log('CONSISTENCY TEST (Running 3 times)');
    console.log('='.repeat(80));
    
    const runs: number[] = [];
    for (let i = 1; i <= 3; i++) {
      console.log(`\nRun ${i}...`);
      const testHolders = await heliusService.getAllHolders(new PublicKey(collectionAddress));
      runs.push(testHolders.length);
      console.log(`  Result: ${testHolders.length} holders`);
      
      // Wait 2 seconds between runs
      if (i < 3) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log('');
    console.log('Consistency Check:');
    const allSame = runs.every(r => r === runs[0]);
    if (allSame) {
      console.log(`  ✅ All runs returned the same count: ${runs[0]}`);
    } else {
      console.log(`  ❌ INCONSISTENT RESULTS: ${runs.join(', ')}`);
      console.log(`  ⚠️  This indicates a pagination or API issue!`);
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('DIAGNOSTIC COMPLETE');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('');
    console.error('='.repeat(80));
    console.error('ERROR');
    console.error('='.repeat(80));
    console.error(error);
    process.exit(1);
  }
}

testNFTFetch().catch(console.error);
