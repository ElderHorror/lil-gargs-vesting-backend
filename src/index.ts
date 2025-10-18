/**
 * Main entry point for the vesting system
 * Export all services and types for external use
 */

export { VestingService } from './services/vestingService';
export { NFTChecker } from './services/nftChecker';
export { getConnection, config } from './config';
export * from './types';
