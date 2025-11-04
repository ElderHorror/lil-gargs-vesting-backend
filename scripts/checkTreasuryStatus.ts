import 'dotenv/config';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import bs58 from 'bs58';
import { createClient } from '@supabase/supabase-js';

// Minimal local config reader (avoid importing app config to keep script standalone)
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const RPC_ENDPOINT = requireEnv('RPC_ENDPOINT');
  const CUSTOM_TOKEN_MINT = requireEnv('CUSTOM_TOKEN_MINT');
  const TREASURY_PRIVATE_KEY = requireEnv('TREASURY_PRIVATE_KEY');
  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1) Derive treasury public key from private key (supports base58 or JSON array)
  let treasuryPublicKey: PublicKey;
  try {
    if (TREASURY_PRIVATE_KEY.startsWith('[')) {
      const secretKey = Uint8Array.from(JSON.parse(TREASURY_PRIVATE_KEY));
      const kp = Keypair.fromSecretKey(secretKey);
      treasuryPublicKey = kp.publicKey;
    } else {
      const decoded = bs58.decode(TREASURY_PRIVATE_KEY);
      const kp = Keypair.fromSecretKey(decoded);
      treasuryPublicKey = kp.publicKey;
    }
  } catch (e: any) {
    console.error('✖ Failed to parse TREASURY_PRIVATE_KEY:', e?.message || e);
    process.exit(1);
  }

  const tokenMint = new PublicKey(CUSTOM_TOKEN_MINT);

  // 2) Compute ATA and try to get balance with diagnostics
  const ata = await getAssociatedTokenAddress(tokenMint, treasuryPublicKey);
  let treasuryBalance = 0;
  let rpcOk = true;
  try {
    const accountInfo = await getAccount(connection, ata);
    treasuryBalance = Number(accountInfo.amount) / 1e9; // assuming 9 decimals
  } catch (e: any) {
    rpcOk = !String(e?.message || '').includes('Unauthorized');
    if (String(e?.message || '').includes('Unauthorized')) {
      console.error('✖ RPC Unauthorized (401). Check your RPC key / IP allowlist.');
    } else if (String(e?.message || '').includes('failed to get info about account')) {
      console.warn('! Token account not found yet (ATA may not exist).');
    } else {
      console.warn('! RPC error while fetching token account:', e?.message || e);
    }
  }

  // 3) Query allocations and claims similar to TreasuryController
  let totalAllocated = 0;
  let totalClaimed = 0;
  try {
    const { data: vestings, error: vErr } = await supabase
      .from('vestings')
      .select('token_amount')
      .eq('is_active', true)
      .eq('is_cancelled', false);
    if (vErr) throw vErr;
    totalAllocated = vestings?.reduce((s: number, v: any) => s + (v?.token_amount || 0), 0) || 0;
  } catch (e: any) {
    console.warn('! Failed to load vestings:', e?.message || e);
  }

  try {
    const { data: claims, error: cErr } = await supabase
      .from('claim_history')
      .select('amount_claimed');
    if (cErr) throw cErr;
    totalClaimed = claims?.reduce((s: number, c: any) => s + Number(c?.amount_claimed || 0), 0) || 0;
  } catch (e: any) {
    console.warn('! Failed to load claims:', e?.message || e);
  }

  const remainingNeeded = totalAllocated - totalClaimed;
  const buffer = treasuryBalance - remainingNeeded;
  const bufferPct = remainingNeeded > 0 ? (buffer / remainingNeeded) * 100 : 0;
  let health: 'healthy' | 'warning' | 'critical';
  if (buffer >= remainingNeeded * 0.2) health = 'healthy';
  else if (buffer >= 0) health = 'warning';
  else health = 'critical';

  // 4) Print summary
  const summary = {
    rpc: {
      endpoint: RPC_ENDPOINT,
      ok: rpcOk,
    },
    treasury: {
      address: treasuryPublicKey.toBase58(),
      tokenMint: tokenMint.toBase58(),
      ata: ata.toBase58(),
      balance: treasuryBalance,
    },
    allocations: {
      totalAllocated,
      totalClaimed,
      remainingNeeded,
    },
    status: {
      health,
      buffer,
      bufferPercentage: Math.round(bufferPct),
      sufficientFunds: buffer >= 0,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
