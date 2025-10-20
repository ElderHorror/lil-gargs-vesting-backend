import { PublicKey } from '@solana/web3.js';
import { HeliusNFTService } from './heliusNFTService';
import { SnapshotRule, SnapshotConfig, AllocationResult, SnapshotProcessResult, HolderData } from '../types';

/**
 * Snapshot Configuration Service
 * Handles multi-collection snapshot processing with fixed/percentage allocations
 */
export class SnapshotConfigService {
  constructor(
    private heliusService: HeliusNFTService
  ) {}

  /**
   * Process snapshot rules and calculate allocations
   */
  async processSnapshotRules(
    config: SnapshotConfig,
    onProgress?: (status: string) => void
  ): Promise<SnapshotProcessResult> {
    const result: SnapshotProcessResult = {
      totalWallets: 0,
      totalAllocated: 0,
      breakdown: [],
      allocations: [],
      errors: [],
    };

    // Map to track allocations per wallet
    const walletAllocations = new Map<string, {
      total: number;
      sources: Array<{ ruleName: string; amount: number }>;
    }>();

    const enabledRules = config.rules.filter((r) => r.enabled);

    // Return empty result if no rules
    if (enabledRules.length === 0) {
      return result;
    }

    for (const rule of enabledRules) {
      if (onProgress) {
        onProgress(`Processing ${rule.name}...`);
      }

      try {
        // Skip rules with invalid contract addresses
        if (!rule.nftContract || rule.nftContract.trim() === '') {
          result.errors.push(`Rule "${rule.name}" has invalid contract address`);
          continue;
        }

        let contractPubkey: PublicKey;
        try {
          contractPubkey = new PublicKey(rule.nftContract);
        } catch (err) {
          result.errors.push(`Rule "${rule.name}" has invalid public key: ${rule.nftContract}`);
          continue;
        }

        // Query Helius for holders
        const holders = await this.heliusService.getAllHolders(contractPubkey);

        // Filter by threshold
        const eligible = holders.filter((h) => h.nftCount >= rule.threshold);
        const totalNfts = eligible.reduce((sum, h) => sum + h.nftCount, 0);

        let ruleAllocation = 0;

        // Calculate allocations based on type
        if (rule.allocationType === 'FIXED') {
          // Fixed amount per NFT (weighted by NFT count)
          for (const holder of eligible) {
            const amount = holder.nftCount * rule.allocationValue;
            ruleAllocation += amount;

            const existing = walletAllocations.get(holder.wallet);
            if (existing) {
              existing.total += amount;
              existing.sources.push({ ruleName: rule.name, amount });
            } else {
              walletAllocations.set(holder.wallet, {
                total: amount,
                sources: [{ ruleName: rule.name, amount }],
              });
            }
          }
        } else {
          // Percentage share of pool - WEIGHTED by NFT count
          const poolShare = config.poolSize * (rule.allocationValue / 100);
          
          // Calculate total NFTs for weighted distribution
          const totalNFTs = eligible.reduce((sum, h) => sum + h.nftCount, 0);

          for (const holder of eligible) {
            // Weighted allocation: (holder's NFTs / total NFTs) × pool share
            const amount = totalNFTs > 0 ? (holder.nftCount / totalNFTs) * poolShare : 0;
            ruleAllocation += amount;

            const existing = walletAllocations.get(holder.wallet);
            if (existing) {
              existing.total += amount;
              existing.sources.push({ ruleName: rule.name, amount });
            } else {
              walletAllocations.set(holder.wallet, {
                total: amount,
                sources: [{ ruleName: rule.name, amount }],
              });
            }
          }
        }

        // Add to breakdown
        result.breakdown.push({
          ruleName: rule.name,
          eligibleWallets: eligible.length,
          totalNfts,
          allocation: Math.floor(ruleAllocation),
        });

        result.totalAllocated += ruleAllocation;
      } catch (error) {
        const errorMsg = `Failed to process rule "${rule.name}": ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        result.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    // Convert to allocation array
    result.allocations = Array.from(walletAllocations.entries()).map(
      ([address, data]) => ({
        address,
        amount: Math.floor(data.total),
        sources: data.sources.map((s) => ({
          ...s,
          amount: Math.floor(s.amount),
        })),
      })
    );

    result.totalWallets = result.allocations.length;
    result.totalAllocated = Math.floor(result.totalAllocated);

    return result;
  }

  /**
   * Calculate preview for a single rule
   */
  async calculateRulePreview(
    rule: SnapshotRule,
    poolSize: number
  ): Promise<{
    eligibleWallets: number;
    totalNfts: number;
    estimatedAllocation: number;
  }> {
    const holders = await this.heliusService.getAllHolders(
      new PublicKey(rule.nftContract)
    );

    const eligible = holders.filter((h) => h.nftCount >= rule.threshold);
    const totalNfts = eligible.reduce((sum, h) => sum + h.nftCount, 0);

    let estimatedAllocation = 0;
    if (rule.allocationType === 'FIXED') {
      estimatedAllocation = totalNfts * rule.allocationValue;
    } else {
      estimatedAllocation = poolSize * (rule.allocationValue / 100);
    }

    return {
      eligibleWallets: eligible.length,
      totalNfts,
      estimatedAllocation: Math.floor(estimatedAllocation),
    };
  }

  /**
   * Calculate summary for all rules
   */
  async calculateSnapshotSummary(
    config: SnapshotConfig,
    onProgress?: (current: number, total: number) => void
  ): Promise<{
    totalWallets: number;
    totalAllocated: number;
    breakdown: Array<{ name: string; amount: number; wallets: number }>;
  }> {
    const breakdown = [];
    const uniqueWallets = new Set<string>();
    let totalAllocated = 0;

    const enabledRules = config.rules.filter((r) => r.enabled);

    // Return empty result if no rules
    if (enabledRules.length === 0) {
      return {
        totalWallets: 0,
        totalAllocated: 0,
        breakdown: [],
      };
    }

    for (let i = 0; i < enabledRules.length; i++) {
      const rule = enabledRules[i];

      if (onProgress) {
        onProgress(i + 1, enabledRules.length);
      }

      // Skip rules with invalid contract addresses
      if (!rule.nftContract || rule.nftContract.trim() === '') {
        console.warn(`Skipping rule "${rule.name}" - invalid contract address`);
        continue;
      }

      let contractPubkey: PublicKey;
      try {
        contractPubkey = new PublicKey(rule.nftContract);
      } catch (err) {
        console.warn(`Skipping rule "${rule.name}" - invalid public key: ${rule.nftContract}`);
        continue;
      }

      const holders = await this.heliusService.getAllHolders(contractPubkey);

      const eligible = holders.filter((h) => h.nftCount >= rule.threshold);
      const totalNfts = eligible.reduce((sum, h) => sum + h.nftCount, 0);

      // Track unique wallets
      eligible.forEach((h) => uniqueWallets.add(h.wallet));

      let allocation = 0;
      if (rule.allocationType === 'FIXED') {
        allocation = totalNfts * rule.allocationValue;
      } else {
        allocation = config.poolSize * (rule.allocationValue / 100);
      }

      breakdown.push({
        name: rule.name,
        amount: Math.floor(allocation),
        wallets: eligible.length,
      });

      totalAllocated += allocation;
    }

    return {
      totalWallets: uniqueWallets.size,
      totalAllocated: Math.floor(totalAllocated),
      breakdown,
    };
  }

  /**
   * Batch allocations into chunks for contract upload
   */
  batchAllocations(
    allocations: AllocationResult[],
    batchSize: number = 150
  ): AllocationResult[][] {
    const batches: AllocationResult[][] = [];

    for (let i = 0; i < allocations.length; i += batchSize) {
      batches.push(allocations.slice(i, i + batchSize));
    }

    return batches;
  }
}
