import { Connection, PublicKey } from '@solana/web3.js';
import { Metaplex } from '@metaplex-foundation/js';
import { EligibilityResult, NFTTier } from '../types';

export class NFTChecker {
  private connection: Connection;
  private metaplex: Metaplex;
  private collectionAddress?: PublicKey;

  constructor(connection: Connection, collectionAddress?: PublicKey) {
    this.connection = connection;
    this.metaplex = Metaplex.make(connection);
    this.collectionAddress = collectionAddress;
  }

  /**
   * Count NFTs owned by a wallet
   * If collectionAddress is set, only counts NFTs from that collection
   * Otherwise counts all NFTs
   */
  async countNFTs(walletAddress: PublicKey): Promise<number> {
    try {
      if (this.collectionAddress) {
        return await this.countNFTsByCollection(walletAddress, this.collectionAddress);
      } else {
        return await this.countNFTsByTokenAccounts(walletAddress);
      }
    } catch (error) {
      console.error('Error counting NFTs:', error);
      return 0;
    }
  }

  /**
   * Count NFTs from a specific verified collection
   */
  async countNFTsByCollection(
    walletAddress: PublicKey,
    collectionAddress: PublicKey
  ): Promise<number> {
    try {
      // Get all NFTs owned by wallet using Metaplex
      const nfts = await this.metaplex.nfts().findAllByOwner({ owner: walletAddress });

      let count = 0;
      for (const nft of nfts) {
        try {
          // Check if NFT belongs to the collection and is verified
          // The nft object already has collection info if it's loaded
          if (nft.collection) {
            if (
              nft.collection.address.equals(collectionAddress) &&
              nft.collection.verified
            ) {
              count++;
            }
          }
        } catch (error) {
          // Skip NFTs that fail to load
          continue;
        }
      }

      return count;
    } catch (error) {
      console.error('Error counting NFTs by collection:', error);
      return 0;
    }
  }

  /**
   * Check eligibility and determine tier based on NFT holdings
   */
  async checkEligibility(
    walletAddress: PublicKey,
    tiers: NFTTier[]
  ): Promise<EligibilityResult> {
    const nftCount = await this.countNFTs(walletAddress);

    // Sort tiers by minNFTs descending to find the highest tier the user qualifies for
    const sortedTiers = [...tiers].sort((a, b) => b.minNFTs - a.minNFTs);

    for (const tier of sortedTiers) {
      if (nftCount >= tier.minNFTs) {
        return {
          eligible: true,
          nftCount,
          tier,
          percentage: tier.percentage,
        };
      }
    }

    return {
      eligible: false,
      nftCount,
      percentage: 0,
    };
  }

  /**
   * Count NFTs by checking token accounts directly (faster)
   * This counts all NFTs (amount = 1, decimals = 0)
   */
  async countNFTsByTokenAccounts(walletAddress: PublicKey): Promise<number> {
    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        walletAddress,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      // Filter for NFTs (amount = 1, decimals = 0)
      let nftCount = 0;
      for (const account of tokenAccounts.value) {
        const parsedInfo = account.account.data.parsed.info;
        if (
          parsedInfo.tokenAmount.decimals === 0 &&
          parsedInfo.tokenAmount.uiAmount === 1
        ) {
          nftCount++;
        }
      }

      return nftCount;
    } catch (error) {
      console.error('Error counting NFTs by token accounts:', error);
      return 0;
    }
  }
}
