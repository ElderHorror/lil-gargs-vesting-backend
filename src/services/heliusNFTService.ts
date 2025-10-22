import { PublicKey } from '@solana/web3.js';

/**
 * Helius NFT Service
 * Uses Helius DAS API to detect NFT holders and count NFTs
 */
export class HeliusNFTService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, network: 'devnet' | 'mainnet-beta' = 'devnet') {
    this.apiKey = apiKey;
    // Use correct Helius RPC endpoints
    this.baseUrl = `https://${network === 'mainnet-beta' ? 'mainnet' : network}.helius-rpc.com/?api-key=${apiKey}`;
  }

  /**
   * Retry helper with exponential backoff
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries - 1) {
          const delay = initialDelay * Math.pow(2, attempt);
          console.log(`  ⏳ Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Get all holders of an NFT collection
   */
  async getAllHolders(collectionAddress: PublicKey): Promise<Array<{ wallet: string; nftCount: number }>> {
    try {
      let page = 1;
      let allAssets: any[] = [];
      let hasMore = true;

      // Fetch all pages using Helius DAS API
      while (hasMore) {
        const response = await this.retryWithBackoff(async () => {
          return await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: `get-assets-page-${page}`,
              method: 'getAssetsByGroup',
              params: {
                groupKey: 'collection',
                groupValue: collectionAddress.toBase58(),
                page: page,
                limit: 1000,
              },
            }),
          });
        }, 3, 2000); // 3 retries, starting with 2 second delay

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Helius API error:', response.status, errorText);
          throw new Error(`Helius API error: ${response.statusText} - ${errorText}`);
        }

        const data: any = await response.json();
        // Don't log full response - too large for production logs
        // console.log('Helius response:', JSON.stringify(data, null, 2));
        
        if (data.error) {
          console.error('Helius RPC error:', data.error);
          throw new Error(`Helius RPC error: ${data.error.message || JSON.stringify(data.error)}`);
        }
        
        const assets = data.result?.items || [];
        
        if (assets.length === 0) {
          hasMore = false;
        } else {
          allAssets = allAssets.concat(assets);
          page++;
          
          // If we got less than 1000, we're done
          if (assets.length < 1000) {
            hasMore = false;
          }
        }
      }
      
      // Group by owner
      const holderMap = new Map<string, number>();
      for (const asset of allAssets) {
        const owner = asset.ownership?.owner;
        if (owner) {
          holderMap.set(owner, (holderMap.get(owner) || 0) + 1);
        }
      }

      console.log(`   Fetched ${allAssets.length} NFTs from collection (${holderMap.size} unique holders)`);

      // Convert to array
      return Array.from(holderMap.entries()).map(([wallet, nftCount]) => ({
        wallet,
        nftCount,
      }));
    } catch (error) {
      console.error('Failed to get holders from Helius:', error);
      throw error;
    }
  }


  /**
   * Count NFTs owned by a wallet from specific collections
   */
  async countNFTsFromCollections(
    wallet: PublicKey,
    collections: PublicKey[]
  ): Promise<Map<string, number>> {
    try {
      const url = `${this.baseUrl}/?api-key=${this.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'nft-by-owner',
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: wallet.toBase58(),
            page: 1,
            limit: 1000,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Helius API error: ${response.statusText}`);
      }

      const data: any = await response.json();
      const nfts = data.result?.items || [];

      // Count NFTs per collection
      const collectionCounts = new Map<string, number>();
      
      for (const collection of collections) {
        const collectionAddr = collection.toBase58();
        const count = nfts.filter((nft: any) => {
          return nft.grouping?.some((g: any) => 
            g.group_key === 'collection' && g.group_value === collectionAddr
          );
        }).length;
        
        collectionCounts.set(collectionAddr, count);
      }

      return collectionCounts;
    } catch (error) {
      console.error('Failed to count NFTs:', error);
      throw error;
    }
  }

  /**
   * Count total NFTs owned by a wallet (from any collection)
   */
  async countAllNFTs(wallet: PublicKey): Promise<number> {
    try {
      const url = `${this.baseUrl}/?api-key=${this.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'nft-count',
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: wallet.toBase58(),
            page: 1,
            limit: 1000,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Helius API error: ${response.statusText}`);
      }

      const data: any = await response.json();
      return (data.result?.items || []).length;
    } catch (error) {
      console.error('Failed to count all NFTs:', error);
      throw error;
    }
  }

  /**
   * Check if wallet meets NFT requirements for a vesting stream
   */
  async checkEligibility(
    wallet: PublicKey,
    requirements: Array<{ collection: string; min_nfts: number; tier: number }>
  ): Promise<{ eligible: boolean; tier: number | null; nftCounts: Record<string, number> }> {
    try {
      const collections = requirements.map((r) => new PublicKey(r.collection));
      const collectionCounts = await this.countNFTsFromCollections(wallet, collections);

      const nftCounts: Record<string, number> = {};
      let highestTier: number | null = null;

      // Check each requirement
      for (const req of requirements) {
        const count = collectionCounts.get(req.collection) || 0;
        nftCounts[req.collection] = count;

        // If meets requirement, update highest tier
        if (count >= req.min_nfts) {
          if (highestTier === null || req.tier > highestTier) {
            highestTier = req.tier;
          }
        }
      }

      return {
        eligible: highestTier !== null,
        tier: highestTier,
        nftCounts,
      };
    } catch (error) {
      console.error('Failed to check eligibility:', error);
      throw error;
    }
  }
}
