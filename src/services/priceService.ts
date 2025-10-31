import { Connection, PublicKey } from '@solana/web3.js';
import { PythHttpClient, getPythProgramKeyForCluster } from '@pythnetwork/client';

/**
 * Service for fetching real-time token prices
 */
export class PriceService {
  private connection: Connection;
  private pythClient: PythHttpClient;
  
  // Pyth price feed IDs
  private readonly SOL_USD_FEED = 'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD'; // Mainnet
  // For devnet, use: 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG'

  constructor(connection: Connection, cluster: 'devnet' | 'mainnet-beta' = 'mainnet-beta') {
    this.connection = connection;
    const pythProgramKey = getPythProgramKeyForCluster(cluster);
    this.pythClient = new PythHttpClient(connection, pythProgramKey);
  }

  /**
   * Get current SOL/USD price from CoinGecko (primary) with Pyth fallback
   */
  async getSolPrice(): Promise<number> {
    // Use CoinGecko as primary source
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
      );
      const data: any = await response.json();
      const price = data.solana?.usd;
      
      if (price) {
        console.log(`SOL/USD price from CoinGecko: $${price}`);
        return price;
      }
    } catch (error) {
      console.warn('Failed to fetch CoinGecko price, trying Pyth:', error);
    }

    // Fallback to Pyth oracle
    try {
      const data = await this.pythClient.getData();
      const solUsdPrice = data.productPrice.get(this.SOL_USD_FEED);
      
      if (solUsdPrice && solUsdPrice.price) {
        const price = solUsdPrice.price;
        console.log(`SOL/USD price from Pyth: $${price}`);
        return price;
      }
    } catch (error) {
      console.error('Failed to fetch Pyth price:', error);
    }

    // Final fallback to hardcoded value
    console.log('Using hardcoded fallback: $150');
    return 150;
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
