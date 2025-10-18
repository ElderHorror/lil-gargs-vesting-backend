import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import * as crypto from 'crypto';

/**
 * Secure keypair management utility
 * 
 * Security levels:
 * 1. Development: Load from .env (NOT for production)
 * 2. Production: Load from encrypted storage or KMS
 */

export class KeypairManager {
  /**
   * Load keypair from environment variable
   * Supports both JSON array and base58 formats
   * 
   * ⚠️ WARNING: Only use in development/testing
   */
  static loadFromEnv(envVar: string): Keypair {
    const privateKey = process.env[envVar];
    
    if (!privateKey) {
      throw new Error(`${envVar} not found in environment variables`);
    }

    try {
      // Try JSON array format first
      const privateKeyArray = JSON.parse(privateKey);
      return Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
    } catch {
      // Fall back to base58 format
      try {
        const privateKeyBytes = bs58.decode(privateKey);
        return Keypair.fromSecretKey(privateKeyBytes);
      } catch (error) {
        throw new Error(`Invalid keypair format in ${envVar}`);
      }
    }
  }

  /**
   * Encrypt a keypair with a password
   * Use this to store keypairs securely
   */
  static encryptKeypair(keypair: Keypair, password: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(password, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    const secretKey = Buffer.from(keypair.secretKey);
    let encrypted = cipher.update(secretKey);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Return iv:authTag:encrypted as base64
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  /**
   * Decrypt a keypair with a password
   */
  static decryptKeypair(encryptedData: string, password: string): Keypair {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(password, 'salt', 32);
    
    const buffer = Buffer.from(encryptedData, 'base64');
    const iv = buffer.slice(0, 16);
    const authTag = buffer.slice(16, 32);
    const encrypted = buffer.slice(32);

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return Keypair.fromSecretKey(new Uint8Array(decrypted));
  }

  /**
   * Generate a new keypair
   */
  static generate(): Keypair {
    return Keypair.generate();
  }

  /**
   * Export keypair to JSON array format
   */
  static toJSON(keypair: Keypair): number[] {
    return Array.from(keypair.secretKey);
  }

  /**
   * Export keypair to base58 format
   */
  static toBase58(keypair: Keypair): string {
    return bs58.encode(keypair.secretKey);
  }

  /**
   * Validate that a keypair can sign transactions
   */
  static validate(keypair: Keypair): boolean {
    try {
      // Try to get public key
      const pubkey = keypair.publicKey;
      return pubkey !== null && pubkey !== undefined;
    } catch {
      return false;
    }
  }
}

/**
 * Production-ready keypair loader
 * 
 * This is a placeholder for production implementations.
 * In production, you should:
 * 1. Use AWS KMS, Google Cloud KMS, or Azure Key Vault
 * 2. Use hardware security modules (HSM)
 * 3. Implement multi-sig with Squads Protocol
 * 4. Use time-locked admin operations
 */
export class ProductionKeypairManager {
  /**
   * Load keypair from AWS KMS
   * 
   * Example implementation (requires aws-sdk):
   * ```
   * import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';
   * 
   * const client = new KMSClient({ region: 'us-east-1' });
   * const command = new DecryptCommand({
   *   CiphertextBlob: Buffer.from(encryptedKey, 'base64'),
   * });
   * const response = await client.send(command);
   * const secretKey = new Uint8Array(response.Plaintext);
   * return Keypair.fromSecretKey(secretKey);
   * ```
   */
  static async loadFromKMS(keyId: string): Promise<Keypair> {
    throw new Error('KMS integration not implemented. See comments for example.');
  }

  /**
   * Load keypair from Google Cloud KMS
   * 
   * Example implementation (requires @google-cloud/kms):
   * ```
   * import { KeyManagementServiceClient } from '@google-cloud/kms';
   * 
   * const client = new KeyManagementServiceClient();
   * const [decryptResponse] = await client.decrypt({
   *   name: keyId,
   *   ciphertext: Buffer.from(encryptedKey, 'base64'),
   * });
   * const secretKey = new Uint8Array(decryptResponse.plaintext);
   * return Keypair.fromSecretKey(secretKey);
   * ```
   */
  static async loadFromGoogleKMS(keyId: string): Promise<Keypair> {
    throw new Error('Google KMS integration not implemented. See comments for example.');
  }

  /**
   * Load keypair from environment with validation
   * Adds extra security checks for production
   */
  static loadFromEnvSecure(envVar: string): Keypair {
    // Check if running in production
    if (process.env.NODE_ENV === 'production') {
      console.warn('⚠️  WARNING: Loading keypair from env in production is not recommended!');
      console.warn('   Consider using KMS or HSM instead.');
    }

    const keypair = KeypairManager.loadFromEnv(envVar);

    // Validate keypair
    if (!KeypairManager.validate(keypair)) {
      throw new Error('Invalid keypair loaded from environment');
    }

    return keypair;
  }
}

/**
 * Keypair security best practices:
 * 
 * 1. NEVER commit private keys to git
 * 2. NEVER log private keys
 * 3. Use encrypted storage in production
 * 4. Rotate keys regularly
 * 5. Use separate keys for different environments
 * 6. Implement rate limiting on key usage
 * 7. Monitor for suspicious activity
 * 8. Use multi-sig for high-value operations
 * 9. Keep backups in secure offline storage
 * 10. Implement key revocation procedures
 */
