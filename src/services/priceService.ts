import { Connection, PublicKey } from '@solana/web3.js';
import { PythHttpClient, getPythProgramKeyForCluster } from '@pythnetwork/client';

/**
 * Service for fetching real-time token prices
 */
export class PriceService {
  private connection: Connection;
  private pythClient: PythHttpClient;
  
  // Pyth price feed IDs
  private readonly SOL_USD_FEED = 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'; // Devnet
  // For mainnet, use: 'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD'

  constructor(connection: Connection, cluster: 'devnet' | 'mainnet-beta' = 'devnet') {
    this.connection = connection;
    const pythProgramKey = getPythProgramKeyForCluster(cluster);
    this.pythClient = new PythHttpClient(connection, pythProgramKey);
  }

  /**
   * Get current SOL/USD price from Pyth oracle
   */
  async getSolPrice(): Promise<number> {
    try {
      const data = await this.pythClient.getData();
      const solUsdPrice = data.productPrice.get(this.SOL_USD_FEED);
      
      if (!solUsdPrice || !solUsdPrice.price) {
        console.warn('Pyth price not available, using fallback');
        return this.getFallbackPrice();
      }

      const price = solUsdPrice.price;
      console.log(`SOL/USD price from Pyth: $${price}`);
      return price;
    } catch (error) {
      console.error('Failed to fetch Pyth price:', error);
      return this.getFallbackPrice();
    }
  }

  /**
   * Fallback to CoinGecko API if Pyth fails
   */
  private async getFallbackPrice(): Promise<number> {
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
      );
      const data: any = await response.json();
      const price = data.solana?.usd || 100; // Default to $100 if all fails
      console.log(`SOL/USD price from CoinGecko: $${price}`);
      return price;
    } catch (error) {
      console.error('Failed to fetch CoinGecko price:', error);
      console.log('Using hardcoded fallback: $100');
      return 100; // Final fallback
    }
  }

  /**
   * Calculate SOL amount needed for a USD fee
   */
  async calculateSolFee(feeUsd: number): Promise<{ solAmount: number; solPrice: number }> {
    const solPrice = await this.getSolPrice();
    const solAmount = feeUsd / solPrice;
    
    return {
      solAmount,
      solPrice,
    };
  }
}
