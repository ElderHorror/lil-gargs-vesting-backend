import { Request, Response } from 'express';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, getAccount, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { createClient } from '@supabase/supabase-js';
import { SupabaseService } from '../services/supabaseService';
import { StreamflowService } from '../services/streamflowService';
import { config } from '../config';

/**
 * User Vesting API Controller
 * Handles user-facing vesting operations (summary, history, claims)
 */
export class UserVestingController {
  private dbService: SupabaseService;
  private connection: Connection;
  private streamflowService: StreamflowService;

  constructor() {
    const supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
    this.dbService = new SupabaseService(supabaseClient);
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    this.streamflowService = new StreamflowService();
  }

  /**
   * GET /api/user/vesting/list?wallet=xxx
   * Get all active vestings for a wallet
   */
  async listUserVestings(req: Request, res: Response) {
    try {
      const { wallet } = req.query;

      if (!wallet || typeof wallet !== 'string') {
        return res.status(400).json({ error: 'wallet parameter is required' });
      }

      // Get ALL active vesting records for this wallet
      const { data: vestings, error: vestingError } = await this.dbService.supabase
        .from('vestings')
        .select('*, vesting_streams(*)')
        .eq('user_wallet', wallet)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (vestingError) {
        throw vestingError;
      }

      if (!vestings || vestings.length === 0) {
        return res.json({ success: true, vestings: [] });
      }

      // Return simplified list
      const vestingList = vestings.map((v: any) => ({
        id: v.id,
        poolId: v.vesting_stream_id,
        poolName: v.vesting_streams.name,
        vestingMode: v.vesting_mode,
        tokenAmount: v.token_amount,
        nftCount: v.nft_count,
        streamflowId: v.vesting_streams.streamflow_stream_id,
        createdAt: v.created_at,
      }));

      res.json({
        success: true,
        vestings: vestingList,
      });
    } catch (error) {
      console.error('Failed to list user vestings:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/user/vesting/summary?wallet=<address>&signature=<sig>&message=<msg>
   * Get user's vesting summary (pool total, share %, unlocked/locked balances, next unlock)
   */
  async getVestingSummary(req: Request, res: Response) {
    try {
      const { wallet, signature, message, poolId } = req.query;

      if (!wallet || typeof wallet !== 'string') {
        return res.status(400).json({ error: 'wallet parameter is required' });
      }

      // Verify wallet signature for authentication (optional for read operations)
      if (signature && message) {
        try {
          const nacl = await import('tweetnacl');
          const messageBuffer = new TextEncoder().encode(message as string);
          const signatureBuffer = Buffer.from(signature as string, 'base64');
          const publicKey = new PublicKey(wallet);

          const isValid = nacl.sign.detached.verify(
            messageBuffer,
            signatureBuffer,
            publicKey.toBytes()
          );

          if (!isValid) {
            return res.status(401).json({ error: 'Invalid signature' });
          }

          // Check message freshness
          const messageData = JSON.parse(message as string);
          const timestamp = messageData.timestamp;
          const now = Date.now();
          const fiveMinutes = 5 * 60 * 1000;
          
          if (!timestamp || Math.abs(now - timestamp) > fiveMinutes) {
            return res.status(401).json({ error: 'Signature expired' });
          }
        } catch (err) {
          return res.status(401).json({ error: 'Signature verification failed' });
        }
      }

      let userWallet: PublicKey;
      try {
        userWallet = new PublicKey(wallet);
      } catch (err) {
        return res.status(400).json({ error: 'Invalid wallet address' });
      }

      // Get ALL active vesting records for this wallet
      const { data: vestings, error: vestingError } = await this.dbService.supabase
        .from('vestings')
        .select('*, vesting_streams(*)')
        .eq('user_wallet', wallet)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (vestingError) {
        throw vestingError;
      }

      if (!vestings || vestings.length === 0) {
        return res.status(404).json({ error: 'No active vesting found for this wallet' });
      }

      // Use the most recent vesting (first in the list, ordered by created_at DESC)
      // TODO: Frontend should show all vestings and let user choose
      let vesting = vestings[0];

      if (poolId && typeof poolId === 'string') {
        const matchingVesting = vestings.find((v: any) => v.vesting_stream_id === poolId);

        if (!matchingVesting) {
          return res.status(404).json({ error: 'Vesting not found for specified pool' });
        }

        vesting = matchingVesting;
      }

      const stream = vesting.vesting_streams;
      
      if (vestings.length > 1) {
        console.log(`[SUMMARY] ⚠️ User has ${vestings.length} active vesting(s), showing pool: ${vesting.vesting_mode} "${stream.name}"`);
        console.log('[SUMMARY] Pools:', vestings.map((v: any) => ({
          mode: v.vesting_mode,
          pool: v.vesting_streams?.name,
          id: v.vesting_stream_id,
        })));
      } else {
        console.log(`[SUMMARY] User has 1 active vesting: ${vesting.vesting_mode} pool "${stream.name}"`);
      }

      // Get user's claim history
      const claimHistory = await this.dbService.getClaimHistory(wallet);
      const TOKEN_DECIMALS = 9;
      const TOKEN_DIVISOR = Math.pow(10, TOKEN_DECIMALS);
      const totalClaimedBaseUnits = claimHistory.reduce((sum, claim) => sum + Number(claim.amount_claimed), 0);
      const totalClaimed = totalClaimedBaseUnits / TOKEN_DIVISOR;

      // Calculate balances using Streamflow if deployed, otherwise use DB calculation
      const totalAllocation = vesting.token_amount;
      const now = Math.floor(Date.now() / 1000);
      const startTime = stream.start_time ? Math.floor(new Date(stream.start_time).getTime() / 1000) : now;
      const endTime = stream.end_time ? Math.floor(new Date(stream.end_time).getTime() / 1000) : now + (stream.vesting_duration_days * 24 * 60 * 60);
      const cliffTime = startTime + (stream.cliff_duration_days * 24 * 60 * 60);

      // Calculate vested amount
      let vestedAmount = 0;
      let vestedPercentage = 0;

      // If pool is deployed to Streamflow, get on-chain vested amount
      if (stream.streamflow_stream_id) {
        try {
          const streamflowVested = await this.streamflowService.getVestedAmount(stream.streamflow_stream_id);
          const poolTotal = stream.total_pool_amount;
          vestedPercentage = streamflowVested / poolTotal;
          vestedAmount = totalAllocation * vestedPercentage;
          console.log(`Streamflow vested: ${streamflowVested} / ${poolTotal} = ${vestedPercentage * 100}%`);
        } catch (err) {
          console.error('Failed to get Streamflow vested amount, falling back to DB calculation:', err);
          // Fall back to DB calculation
          vestedPercentage = this.calculateVestedPercentage(now, startTime, endTime, cliffTime);
          vestedAmount = totalAllocation * vestedPercentage;
        }
      } else {
        // No Streamflow - use DB calculation
        vestedPercentage = this.calculateVestedPercentage(now, startTime, endTime, cliffTime);
        vestedAmount = totalAllocation * vestedPercentage;
      }

      const unlockedBalance = Math.max(0, vestedAmount - totalClaimed);
      const lockedBalance = totalAllocation - vestedAmount;

      // Calculate next unlock time
      const nextUnlockSeconds = now < endTime ? endTime - now : 0;

      // Get pool total from stream
      const poolTotal = stream.total_pool_amount;

      // Calculate user's share percentage
      const sharePercentage = vesting.share_percentage || ((totalAllocation / poolTotal) * 100);

      // Check if claims are globally enabled
      const dbConfig = await this.dbService.getConfig();
      const claimsEnabled = dbConfig?.enable_claims !== false;

      res.json({
        success: true,
        data: {
          poolId: vesting.vesting_stream_id,
          poolTotal,
          distributionType: 'Based on NFT Holdings (%)',
          userShare: {
            percentage: sharePercentage,
            totalEligible: totalAllocation,
          },
          balances: {
            unlocked: unlockedBalance,
            locked: lockedBalance,
            totalClaimed,
          },
          nextUnlock: {
            seconds: Math.max(0, nextUnlockSeconds),
            timestamp: endTime,
          },
          vestingSchedule: {
            startTime,
            cliffTime,
            endTime,
          },
          nftCount: vesting.nft_count,
          tier: vesting.tier || 0,
          eligible: vesting.is_active && !vesting.is_cancelled,
          claimsEnabled, // Add this flag so frontend knows if claims are disabled
          streamflow: {
            deployed: !!stream.streamflow_stream_id,
            streamId: stream.streamflow_stream_id || null,
            vestedPercentage: vestedPercentage * 100,
          },
        },
      });
    } catch (error) {
      console.error('Failed to get vesting summary:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/user/vesting/history?wallet=<address>&signature=<sig>&message=<msg>
   * Get user's claim history
   */
  async getClaimHistory(req: Request, res: Response) {
    try {
      const { wallet, signature, message } = req.query;

      if (!wallet || typeof wallet !== 'string') {
        return res.status(400).json({ error: 'wallet parameter is required' });
      }

      // Verify wallet signature for authentication (optional for read operations)
      if (signature && message) {
        try {
          const nacl = await import('tweetnacl');
          const messageBuffer = new TextEncoder().encode(message as string);
          const signatureBuffer = Buffer.from(signature as string, 'base64');
          const publicKey = new PublicKey(wallet);

          const isValid = nacl.sign.detached.verify(
            messageBuffer,
            signatureBuffer,
            publicKey.toBytes()
          );

          if (!isValid) {
            return res.status(401).json({ error: 'Invalid signature' });
          }

          // Check message freshness
          const messageData = JSON.parse(message as string);
          const timestamp = messageData.timestamp;
          const now = Date.now();
          const fiveMinutes = 5 * 60 * 1000;
          
          if (!timestamp || Math.abs(now - timestamp) > fiveMinutes) {
            return res.status(401).json({ error: 'Signature expired' });
          }
        } catch (err) {
          return res.status(401).json({ error: 'Signature verification failed' });
        }
      }

      // Get claim history from database
      const history = await this.dbService.getClaimHistory(wallet);

      // Format history for frontend (convert from base units to human-readable)
      const TOKEN_DECIMALS = 9;
      const TOKEN_DIVISOR = Math.pow(10, TOKEN_DECIMALS);
      
      const formattedHistory = history.map((claim) => ({
        id: claim.id,
        date: claim.claimed_at,
        amount: Number(claim.amount_claimed) / TOKEN_DIVISOR,
        feePaid: Number(claim.fee_paid),
        transactionSignature: claim.transaction_signature,
        status: 'Claimed', // All records in history are claimed
      }));

      res.json({
        success: true,
        data: formattedHistory.map((claim) => ({
          ...claim,
          vestingId: history.find(ch => ch.id === claim.id)?.vesting_id || null,
        })),
      });
    } catch (error) {
      console.error('Failed to get claim history:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/user/vesting/claim
   * User claims their vested tokens
   * Body: { userWallet: string, signature: string, message: string }
   */
  async claimVesting(req: Request, res: Response) {
    try {
      // Check if claims are globally enabled
      const dbConfig = await this.dbService.getConfig();
      if (dbConfig && dbConfig.enable_claims === false) {
        return res.status(403).json({ 
          error: 'Claims are currently disabled by the administrator. Please try again later.' 
        });
      }

      const { userWallet, poolId } = req.body;

      if (!userWallet) {
        return res.status(400).json({ error: 'userWallet is required' });
      }

      // Parse treasury keypair (for token transfers)
      let treasuryKeypair: Keypair;
      try {
        if (config.treasuryPrivateKey.startsWith('[')) {
          // JSON array format
          const secretKey = Uint8Array.from(JSON.parse(config.treasuryPrivateKey));
          treasuryKeypair = Keypair.fromSecretKey(secretKey);
        } else {
          // Try base58 first, then base64
          try {
            const bs58 = await import('bs58');
            const decoded = bs58.default.decode(config.treasuryPrivateKey);
            treasuryKeypair = Keypair.fromSecretKey(decoded);
          } catch {
            // Fallback to base64
            const decoded = Buffer.from(config.treasuryPrivateKey, 'base64');
            treasuryKeypair = Keypair.fromSecretKey(decoded);
          }
        }
      } catch (err) {
        console.error('Treasury key parse error:', err);
        return res.status(500).json({ error: 'Invalid treasury key configuration' });
      }

      // Get user's vesting record
      let vesting = null;

      if (poolId) {
        vesting = await this.dbService.getVestingForPool(userWallet, poolId);

        if (!vesting) {
          return res.status(404).json({ error: 'No vesting found for this wallet in the specified pool' });
        }
      } else {
        vesting = await this.dbService.getVesting(userWallet);

        if (!vesting) {
          return res.status(404).json({ error: 'No vesting found for this wallet' });
        }
      }

      // Get the vesting stream (pool configuration)
      const { data: stream } = await this.dbService.supabase
        .from('vesting_streams')
        .select('*')
        .eq('id', vesting.vesting_stream_id)
        .single();

      if (!stream) {
        return res.status(404).json({ error: 'Vesting stream not found' });
      }

      // Validate NFT ownership (check if user still meets requirements)
      if (stream.nft_requirements && Array.isArray(stream.nft_requirements) && stream.nft_requirements.length > 0) {
        try {
          const { HeliusNFTService } = await import('../services/heliusNFTService');
          const helius = new HeliusNFTService(config.heliusApiKey, 'mainnet-beta');
          
          console.log('🔍 Validating NFT ownership for wallet:', userWallet);
          console.log('📋 Pool rules:', JSON.stringify(stream.nft_requirements, null, 2));
          
          // Check each rule to see if user meets at least one
          let meetsRequirements = false;
          
          for (const rule of stream.nft_requirements) {
            if (!rule.enabled) {
              console.log(`⏭️  Skipping disabled rule: ${rule.name}`);
              continue;
            }
            
            console.log(`\n🔎 Checking rule: ${rule.name}`);
            console.log(`   Contract: ${rule.nftContract}`);
            console.log(`   Threshold: ${rule.threshold}`);
            
            try {
              const holders = await helius.getAllHolders(new PublicKey(rule.nftContract));
              console.log(`   Found ${holders.length} total holders`);
              
              const userHolder = holders.find(h => h.wallet === userWallet);
              const nftCount = userHolder?.nftCount || 0;
              
              console.log(`   User NFT count: ${nftCount}`);
              console.log(`   Meets threshold? ${nftCount >= rule.threshold}`);
              
              if (nftCount >= rule.threshold) {
                meetsRequirements = true;
                console.log(`✅ User meets requirements for rule: ${rule.name}`);
                break;
              }
            } catch (err) {
              console.error(`❌ Failed to check NFT ownership for rule ${rule.name}:`, err);
            }
          }

          console.log(`\n🎯 Final result: meetsRequirements = ${meetsRequirements}\n`);

          if (!meetsRequirements) {
            return res.status(403).json({ 
              error: 'You no longer meet the NFT requirements for this vesting pool. Please ensure you hold the required NFTs.',
              debug: {
                wallet: userWallet,
                rules: stream.nft_requirements.map((r: any) => ({
                  name: r.name,
                  contract: r.nftContract,
                  threshold: r.threshold,
                  enabled: r.enabled,
                })),
              },
            });
          }
        } catch (err) {
          console.error('Failed to validate NFT ownership:', err);
          // Continue with claim if validation fails (don't block users due to RPC issues)
        }
      }

      // Get claim fee from config (reuse dbConfig from earlier)
      const claimFeeUsd = dbConfig?.claim_fee_usd || 10.0;

      // Calculate claimable amount (SAME LOGIC AS SUMMARY ENDPOINT)
      const totalAllocation = vesting.token_amount;
      const now = Math.floor(Date.now() / 1000);
      const startTime = stream.start_time ? Math.floor(new Date(stream.start_time).getTime() / 1000) : now;
      const endTime = stream.end_time ? Math.floor(new Date(stream.end_time).getTime() / 1000) : now + (stream.vesting_duration_days * 24 * 60 * 60);
      const cliffTime = startTime + (stream.cliff_duration_days * 24 * 60 * 60);

      // Calculate vested amount
      let vestedAmount = 0;
      let vestedPercentage = 0;

      // If pool is deployed to Streamflow, get on-chain vested amount
      if (stream.streamflow_stream_id) {
        try {
          const streamflowVested = await this.streamflowService.getVestedAmount(stream.streamflow_stream_id);
          const poolTotal = stream.total_pool_amount;
          vestedPercentage = streamflowVested / poolTotal;
          vestedAmount = totalAllocation * vestedPercentage;
          console.log(`[CLAIM] Streamflow vested: ${streamflowVested} / ${poolTotal} = ${vestedPercentage * 100}%`);
          console.log(`[CLAIM] User vested amount: ${vestedAmount} tokens`);
        } catch (err) {
          console.error('Failed to get Streamflow vested amount, falling back to DB calculation:', err);
          // Fall back to DB calculation
          vestedPercentage = this.calculateVestedPercentage(now, startTime, endTime, cliffTime);
          vestedAmount = totalAllocation * vestedPercentage;
        }
      } else {
        // No Streamflow - use DB calculation
        vestedPercentage = this.calculateVestedPercentage(now, startTime, endTime, cliffTime);
        vestedAmount = totalAllocation * vestedPercentage;
      }

      // Get previous claims
      const claimHistory = await this.dbService.getClaimHistory(userWallet);
      const TOKEN_DECIMALS = 9;
      const TOKEN_DIVISOR = Math.pow(10, TOKEN_DECIMALS);
      const totalClaimed = claimHistory.reduce((sum, claim) => sum + Number(claim.amount_claimed), 0) / TOKEN_DIVISOR;

      const unlockedBalance = Math.max(0, vestedAmount - totalClaimed);
      const claimableAmount = Math.floor(unlockedBalance);

      console.log(`[CLAIM] Total allocation: ${totalAllocation}`);
      console.log(`[CLAIM] Vested amount: ${vestedAmount}`);
      console.log(`[CLAIM] Total claimed: ${totalClaimed}`);
      console.log(`[CLAIM] Claimable: ${claimableAmount}`);

      if (claimableAmount <= 0) {
        return res.status(400).json({ error: 'No tokens available to claim' });
      }

      // Get real-time SOL/USD price from Pyth oracle
      const { PriceService } = await import('../services/priceService');
      const priceService = new PriceService(this.connection, 'mainnet-beta');
      const { solAmount: feeInSol, solPrice: solPriceUsd } = await priceService.calculateSolFee(claimFeeUsd);
      const feeInLamports = Math.floor(feeInSol * LAMPORTS_PER_SOL);
      
      console.log(`[CLAIM] Fee: $${claimFeeUsd} USD = ${feeInSol.toFixed(4)} SOL (SOL price: $${solPriceUsd.toFixed(2)})`);

      const tokenMint = new PublicKey(config.customTokenMint!);
      const userPublicKey = new PublicKey(userWallet);
      // Fee goes to treasury wallet (same wallet that holds tokens)
      const feeWalletPubkey = treasuryKeypair.publicKey;

      // Check user has enough SOL for fee
      const userBalance = await this.connection.getBalance(userPublicKey);
      const requiredBalance = feeInLamports + 5000; // Fee + transaction cost
      
      if (userBalance < requiredBalance) {
        return res.status(400).json({ 
          error: `Insufficient SOL balance. Required: ${(requiredBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL, Available: ${(userBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL` 
        });
      }

      console.log(`Creating claim fee transaction: ${feeInSol} SOL (${feeInLamports} lamports) from ${userWallet} to ${feeWalletPubkey.toBase58()}`);

      // Step 1: Create fee payment transaction
      const feeTransaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: userPublicKey,
          toPubkey: feeWalletPubkey,
          lamports: feeInLamports,
        })
      );

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      feeTransaction.recentBlockhash = blockhash;
      feeTransaction.feePayer = userPublicKey;

      // Serialize transaction for frontend to sign
      const serializedFeeTx = feeTransaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).toString('base64');

      // Step 2: Prepare token transfer (treasury will sign and send after fee is paid)
      const treasuryTokenAccount = await getAssociatedTokenAddress(
        tokenMint,
        treasuryKeypair.publicKey
      );

      const userTokenAccount = await getAssociatedTokenAddress(
        tokenMint,
        userPublicKey
      );

      // Check if treasury has enough tokens
      try {
        const treasuryTokenAccountInfo = await getAccount(this.connection, treasuryTokenAccount);
        const treasuryBalance = Number(treasuryTokenAccountInfo.amount);
        
        if (treasuryBalance < claimableAmount) {
          return res.status(400).json({ 
            error: `Insufficient tokens in treasury wallet. Available: ${treasuryBalance}, Required: ${claimableAmount}` 
          });
        }
      } catch (err) {
        return res.status(500).json({ 
          error: 'Treasury token account not found or error checking balance' 
        });
      }

      // Return transaction for user to sign
      res.json({
        success: true,
        step: 'fee_payment_required',
        feeTransaction: serializedFeeTx,
        feeDetails: {
          amountUsd: claimFeeUsd,
          amountSol: feeInSol,
          amountLamports: feeInLamports,
          feeWallet: feeWalletPubkey.toBase58(),
        },
        claimDetails: {
          amountClaimable: claimableAmount,
          tokenMint: tokenMint.toBase58(),
          recipientWallet: userWallet,
          treasuryTokenAccount: treasuryTokenAccount.toBase58(),
          userTokenAccount: userTokenAccount.toBase58(),
        },
        instructions: 'Sign and send the feeTransaction, then call /user/vesting/claim/complete with the fee transaction signature',
      });
    } catch (error) {
      console.error('Failed to process claim:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/user/vesting/claim/complete
   * Complete claim after fee payment
   */
  async completeClaimWithFee(req: Request, res: Response) {
    try {
      const { userWallet, feeSignature, poolId } = req.body;

      console.log('[COMPLETE-CLAIM] Request body:', { userWallet, feeSignature, poolId });

      if (!userWallet || !feeSignature) {
        return res.status(400).json({ error: 'userWallet and feeSignature are required' });
      }

      // Verify fee payment transaction
      const feeTransaction = await this.connection.getTransaction(feeSignature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!feeTransaction || feeTransaction.meta?.err) {
        return res.status(400).json({ error: 'Fee payment transaction not found or failed' });
      }

      console.log('[COMPLETE-CLAIM] Fee transaction verified');

      // Check if this fee signature has already been used (prevent duplicate claims)
      const { data: existingClaim } = await this.dbService.supabase
        .from('claims')
        .select('id')
        .eq('transaction_signature', feeSignature)
        .single();

      if (existingClaim) {
        console.error('[COMPLETE-CLAIM] Fee signature already used:', feeSignature);
        return res.status(400).json({ error: 'This fee payment has already been used for a claim' });
      }

      console.log('[COMPLETE-CLAIM] Fee signature is unique, proceeding...');

      // Get vesting info
      let vesting = null;

      if (poolId) {
        console.log('[COMPLETE-CLAIM] Looking up vesting for pool:', poolId);
        vesting = await this.dbService.getVestingForPool(userWallet, poolId);

        if (!vesting) {
          console.error('[COMPLETE-CLAIM] No vesting found for pool:', poolId);
          return res.status(404).json({ error: 'No vesting found for this wallet in the specified pool' });
        }
      } else {
        console.log('[COMPLETE-CLAIM] Looking up most recent vesting (no poolId provided)');
        vesting = await this.dbService.getVesting(userWallet);

        if (!vesting) {
          console.error('[COMPLETE-CLAIM] No vesting found for wallet');
          return res.status(404).json({ error: 'No vesting found for this wallet' });
        }
      }

      console.log('[COMPLETE-CLAIM] Vesting found:', vesting.id);

      const { data: stream } = await this.dbService.supabase
        .from('vesting_streams')
        .select('*')
        .eq('id', vesting.vesting_stream_id)
        .single();

      if (!stream) {
        return res.status(404).json({ error: 'Vesting stream not found' });
      }

      // Calculate claimable amount (SAME LOGIC AS SUMMARY ENDPOINT)
      const totalAllocation = vesting.token_amount;
      const now = Math.floor(Date.now() / 1000);
      const startTime = stream.start_time ? Math.floor(new Date(stream.start_time).getTime() / 1000) : now;
      const endTime = stream.end_time ? Math.floor(new Date(stream.end_time).getTime() / 1000) : now + (stream.vesting_duration_days * 24 * 60 * 60);
      const cliffTime = startTime + (stream.cliff_duration_days * 24 * 60 * 60);

      // Calculate vested amount
      let vestedAmount = 0;
      let vestedPercentage = 0;

      // If pool is deployed to Streamflow, get on-chain vested amount
      if (stream.streamflow_stream_id) {
        try {
          const streamflowVested = await this.streamflowService.getVestedAmount(stream.streamflow_stream_id);
          const poolTotal = stream.total_pool_amount;
          vestedPercentage = streamflowVested / poolTotal;
          vestedAmount = totalAllocation * vestedPercentage;
          console.log(`[COMPLETE] Streamflow vested: ${streamflowVested} / ${poolTotal} = ${vestedPercentage * 100}%`);
          console.log(`[COMPLETE] User vested amount: ${vestedAmount} tokens`);
        } catch (err) {
          console.error('Failed to get Streamflow vested amount, falling back to DB calculation:', err);
          // Fall back to DB calculation
          vestedPercentage = this.calculateVestedPercentage(now, startTime, endTime, cliffTime);
          vestedAmount = totalAllocation * vestedPercentage;
        }
      } else {
        // No Streamflow - use DB calculation
        vestedPercentage = this.calculateVestedPercentage(now, startTime, endTime, cliffTime);
        vestedAmount = totalAllocation * vestedPercentage;
      }

      // Get previous claims
      const claimHistory = await this.dbService.getClaimHistory(userWallet);
      const TOKEN_DECIMALS = 9;
      const TOKEN_DIVISOR = Math.pow(10, TOKEN_DECIMALS);
      const totalClaimed = claimHistory.reduce((sum, claim) => sum + Number(claim.amount_claimed), 0) / TOKEN_DIVISOR;

      const unlockedBalance = Math.max(0, vestedAmount - totalClaimed);
      const claimableAmount = Math.floor(unlockedBalance);

      console.log(`[COMPLETE] Total allocation: ${totalAllocation}`);
      console.log(`[COMPLETE] Vested amount: ${vestedAmount}`);
      console.log(`[COMPLETE] Total claimed: ${totalClaimed}`);
      console.log(`[COMPLETE] Claimable: ${claimableAmount}`);

      if (claimableAmount <= 0) {
        return res.status(400).json({ error: 'No tokens available to claim' });
      }

      // Parse treasury keypair
      let treasuryKeypair: Keypair;
      try {
        if (config.treasuryPrivateKey.startsWith('[')) {
          // JSON array format
          const secretKey = Uint8Array.from(JSON.parse(config.treasuryPrivateKey));
          treasuryKeypair = Keypair.fromSecretKey(secretKey);
        } else {
          // Try base58 first, then base64
          try {
            const bs58 = await import('bs58');
            const decoded = bs58.default.decode(config.treasuryPrivateKey);
            treasuryKeypair = Keypair.fromSecretKey(decoded);
          } catch {
            // Fallback to base64
            const decoded = Buffer.from(config.treasuryPrivateKey, 'base64');
            treasuryKeypair = Keypair.fromSecretKey(decoded);
          }
        }
      } catch (err) {
        console.error('Treasury key parse error:', err);
        return res.status(500).json({ error: 'Invalid treasury key configuration' });
      }

      // Transfer tokens directly from treasury to user
      console.log('[COMPLETE] Transferring tokens from treasury to user...');
      
      const tokenMint = new PublicKey(config.customTokenMint!);
      const userPublicKey = new PublicKey(userWallet);

      const treasuryTokenAccount = await getAssociatedTokenAddress(
        tokenMint,
        treasuryKeypair.publicKey
      );

      const userTokenAccount = await getAssociatedTokenAddress(
        tokenMint,
        userPublicKey
      );

      // Check if user's token account exists, create if not
      let userTokenAccountExists = false;
      try {
        await getAccount(this.connection, userTokenAccount);
        userTokenAccountExists = true;
        console.log('[COMPLETE] User token account exists');
      } catch (err) {
        console.log('[COMPLETE] User token account does not exist, will create it');
      }

      // Convert claimableAmount to base units (multiply by 1e9)
      const amountInBaseUnits = BigInt(Math.floor(claimableAmount * Math.pow(10, TOKEN_DECIMALS)));

      console.log(`[COMPLETE] Transferring ${claimableAmount} tokens (${amountInBaseUnits} base units)`);

      const tokenTransferTx = new Transaction();
      
      // Add create account instruction if needed
      if (!userTokenAccountExists) {
        console.log('[COMPLETE] Adding create token account instruction');
        tokenTransferTx.add(
          createAssociatedTokenAccountInstruction(
            treasuryKeypair.publicKey, // payer
            userTokenAccount,
            userPublicKey,
            tokenMint
          )
        );
      }
      
      // Add transfer instruction
      tokenTransferTx.add(
        createTransferInstruction(
          treasuryTokenAccount,
          userTokenAccount,
          treasuryKeypair.publicKey,
          amountInBaseUnits
        )
      );

      // Send transaction with retry logic
      let tokenSignature: string | null = null;
      const maxRetries = 3;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[COMPLETE] Sending transaction (attempt ${attempt}/${maxRetries})...`);
          
          tokenSignature = await this.connection.sendTransaction(tokenTransferTx, [treasuryKeypair], {
            skipPreflight: false,
            maxRetries: 3,
          });
          
          console.log(`[COMPLETE] Transaction sent: ${tokenSignature}, confirming...`);
          
          // Wait for confirmation with timeout
          const confirmation = await Promise.race([
            this.connection.confirmTransaction(tokenSignature, 'confirmed'),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Transaction confirmation timeout')), 60000)
            )
          ]);
          
          console.log('[COMPLETE] Transfer successful! Signature:', tokenSignature);
          break; // Success, exit retry loop
          
        } catch (err) {
          lastError = err instanceof Error ? err : new Error('Unknown transaction error');
          console.error(`[COMPLETE] Transaction attempt ${attempt} failed:`, lastError.message);
          
          if (attempt === maxRetries) {
            throw new Error(`Transaction failed after ${maxRetries} attempts: ${lastError.message}`);
          }
          
          // Wait before retry (exponential backoff)
          const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.log(`[COMPLETE] Retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          // Get fresh blockhash for retry
          const { blockhash: newBlockhash } = await this.connection.getLatestBlockhash();
          tokenTransferTx.recentBlockhash = newBlockhash;
        }
      }

      if (!tokenSignature) {
        throw new Error('Failed to send transaction');
      }

      // Get fee amount from transaction
      const dbConfig = await this.dbService.getConfig();
      const claimFeeUsd = dbConfig?.claim_fee_usd || 10.0;
      
      // Get real-time SOL price
      const { PriceService } = await import('../services/priceService');
      const priceService = new PriceService(this.connection, 'mainnet-beta');
      const { solAmount: feeInSol } = await priceService.calculateSolFee(claimFeeUsd);

      // Record claim in database (store in base units for consistency)
      // Store fee signature to prevent duplicate claims
      await this.dbService.createClaim({
        user_wallet: userWallet,
        vesting_id: vesting.id,
        amount_claimed: Number(amountInBaseUnits), // Store in base units
        fee_paid: feeInSol,
        transaction_signature: feeSignature, // Store fee signature for duplicate prevention
      });

      res.json({
        success: true,
        data: {
          amountClaimed: claimableAmount, // Already in tokens
          feePaid: feeInSol,
          feeTransactionSignature: feeSignature,
          tokenTransactionSignature: tokenSignature,
        },
      });
    } catch (error) {
      console.error('Failed to complete claim:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Helper: Calculate vested percentage based on time
   */
  private calculateVestedPercentage(now: number, startTime: number, endTime: number, cliffTime: number): number {
    if (now < cliffTime) {
      return 0;
    } else if (now >= endTime) {
      return 1;
    } else {
      const timeElapsed = now - cliffTime;
      const totalVestingTime = endTime - cliffTime;
      return timeElapsed / totalVestingTime;
    }
  }
}
