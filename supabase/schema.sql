-- Supabase Database Schema for Vesting System

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS config (
  id INT PRIMARY KEY DEFAULT 1,
  admin_wallet TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  fee_wallet TEXT,
  claim_fee_sol NUMERIC DEFAULT 0.01,
  claim_fee_usd NUMERIC DEFAULT 10.00,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Vesting streams configuration (admin creates multiple streams)
CREATE TABLE IF NOT EXISTS vesting_streams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- NFT Requirements (array of collections with thresholds)
  nft_requirements JSONB NOT NULL,
  -- Example: [
  --   { "collection": "addr1", "min_nfts": 20, "tier": 20 },
  --   { "collection": "addr2", "min_nfts": 10, "tier": 20 }
  -- ]
  
  -- Tier allocations (percentage of pool per tier)
  tier_allocations JSONB NOT NULL,
  -- Example: {
  --   "20": { "pool_percent": 5, "pool_amount": 50000000 },
  --   "25": { "pool_percent": 10, "pool_amount": 100000000 },
  --   ...
  -- }
  
  -- Vesting parameters
  total_pool_amount NUMERIC NOT NULL,
  vesting_duration_days INT NOT NULL,
  cliff_duration_days INT NOT NULL,
  grace_period_days INT NOT NULL DEFAULT 30,
  
  -- Mode and status
  vesting_mode TEXT DEFAULT 'snapshot',
  is_active BOOLEAN DEFAULT true,
  require_nft_on_claim BOOLEAN DEFAULT true,
  
  -- Timestamps
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  snapshot_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT positive_amounts CHECK (
    total_pool_amount > 0 AND
    vesting_duration_days > 0 AND
    cliff_duration_days >= 0 AND
    grace_period_days >= 0
  )
);

-- Vestings table (individual user vestings)
CREATE TABLE IF NOT EXISTS vestings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vesting_stream_id UUID REFERENCES vesting_streams(id) ON DELETE CASCADE,
  user_wallet TEXT NOT NULL,
  nft_count INT NOT NULL DEFAULT 0,
  tier INT NOT NULL,
  streamflow_stream_id TEXT,
  token_amount NUMERIC NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  is_cancelled BOOLEAN DEFAULT FALSE,
  last_verified TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  vesting_mode TEXT DEFAULT 'snapshot',
  snapshot_locked BOOLEAN DEFAULT false,
  claim_verification_enabled BOOLEAN DEFAULT true,
  grace_period_end TIMESTAMPTZ,
  cancellation_reason TEXT,
  CONSTRAINT positive_amount CHECK (token_amount > 0),
  CONSTRAINT positive_nft_count CHECK (nft_count >= 0),
  CONSTRAINT unique_user_per_stream UNIQUE(vesting_stream_id, user_wallet)
);

-- Claim history table
CREATE TABLE IF NOT EXISTS claim_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_wallet TEXT NOT NULL,
  vesting_id UUID REFERENCES vestings(id),
  amount_claimed NUMERIC NOT NULL,
  fee_paid NUMERIC NOT NULL,
  transaction_signature TEXT NOT NULL UNIQUE,
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT positive_claim_amount CHECK (amount_claimed > 0),
  CONSTRAINT positive_fee CHECK (fee_paid >= 0)
);

-- Admin logs table
CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action TEXT NOT NULL,
  admin_wallet TEXT NOT NULL,
  target_wallet TEXT,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_vesting_streams_is_active ON vesting_streams(is_active);
CREATE INDEX IF NOT EXISTS idx_vesting_streams_vesting_mode ON vesting_streams(vesting_mode);
CREATE INDEX IF NOT EXISTS idx_vestings_stream_id ON vestings(vesting_stream_id);
CREATE INDEX IF NOT EXISTS idx_vestings_user_wallet ON vestings(user_wallet);
CREATE INDEX IF NOT EXISTS idx_vestings_is_active ON vestings(is_active);
CREATE INDEX IF NOT EXISTS idx_vestings_tier ON vestings(tier);
CREATE INDEX IF NOT EXISTS idx_claim_history_user_wallet ON claim_history(user_wallet);
CREATE INDEX IF NOT EXISTS idx_claim_history_claimed_at ON claim_history(claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at DESC);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to config table
CREATE TRIGGER update_config_updated_at
BEFORE UPDATE ON config
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies

-- Enable RLS
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE vestings ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;

-- Config policies (read-only for authenticated users)
CREATE POLICY "Config is viewable by authenticated users"
ON config FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Config is editable by service role only"
ON config FOR ALL
TO service_role
USING (true);

-- Vestings policies
CREATE POLICY "Users can view their own vesting"
ON vestings FOR SELECT
TO authenticated
USING (user_wallet = current_setting('request.jwt.claims', true)::json->>'wallet');

CREATE POLICY "Service role can manage all vestings"
ON vestings FOR ALL
TO service_role
USING (true);

-- Claim history policies
CREATE POLICY "Users can view their own claim history"
ON claim_history FOR SELECT
TO authenticated
USING (user_wallet = current_setting('request.jwt.claims', true)::json->>'wallet');

CREATE POLICY "Service role can manage all claim history"
ON claim_history FOR ALL
TO service_role
USING (true);

-- Admin logs policies (service role only)
CREATE POLICY "Admin logs viewable by service role only"
ON admin_logs FOR SELECT
TO service_role
USING (true);

CREATE POLICY "Admin logs insertable by service role only"
ON admin_logs FOR INSERT
TO service_role
WITH CHECK (true);

-- Helper functions

-- Get user's vesting info
CREATE OR REPLACE FUNCTION get_user_vesting(wallet_address TEXT)
RETURNS TABLE (
  vesting_id UUID,
  user_wallet TEXT,
  nft_count INT,
  streamflow_stream_id TEXT,
  token_amount NUMERIC,
  is_active BOOLEAN,
  is_cancelled BOOLEAN,
  total_claimed NUMERIC,
  last_claim_date TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.user_wallet,
    v.nft_count,
    v.streamflow_stream_id,
    v.token_amount,
    v.is_active,
    v.is_cancelled,
    COALESCE(SUM(ch.amount_claimed), 0) as total_claimed,
    MAX(ch.claimed_at) as last_claim_date
  FROM vestings v
  LEFT JOIN claim_history ch ON v.id = ch.vesting_id
  WHERE v.user_wallet = wallet_address
  GROUP BY v.id;
END;
$$ LANGUAGE plpgsql;

-- Get active vestings count
CREATE OR REPLACE FUNCTION get_active_vestings_count()
RETURNS INT AS $$
BEGIN
  RETURN (SELECT COUNT(*) FROM vestings WHERE is_active = TRUE AND is_cancelled = FALSE);
END;
$$ LANGUAGE plpgsql;

-- Get total tokens vested
CREATE OR REPLACE FUNCTION get_total_tokens_vested()
RETURNS NUMERIC AS $$
BEGIN
  RETURN (SELECT COALESCE(SUM(token_amount), 0) FROM vestings WHERE is_cancelled = FALSE);
END;
$$ LANGUAGE plpgsql;

-- Get total tokens claimed
CREATE OR REPLACE FUNCTION get_total_tokens_claimed()
RETURNS NUMERIC AS $$
BEGIN
  RETURN (SELECT COALESCE(SUM(amount_claimed), 0) FROM claim_history);
END;
$$ LANGUAGE plpgsql;

-- Eligibility check history table
CREATE TABLE IF NOT EXISTS eligibility_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet TEXT NOT NULL,
  nft_count INT NOT NULL,
  eligible BOOLEAN NOT NULL,
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT positive_nft_count_check CHECK (nft_count >= 0)
);

-- Sync logs table
CREATE TABLE IF NOT EXISTS sync_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_type TEXT NOT NULL, -- 'eligibility_sync', 'manual_sync'
  wallets_checked INT NOT NULL DEFAULT 0,
  streams_created INT NOT NULL DEFAULT 0,
  streams_cancelled INT NOT NULL DEFAULT 0,
  errors INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  details JSONB,
  CONSTRAINT positive_counts CHECK (
    wallets_checked >= 0 AND 
    streams_created >= 0 AND 
    streams_cancelled >= 0 AND 
    errors >= 0
  )
);

-- Indexes for new tables
CREATE INDEX IF NOT EXISTS idx_eligibility_checks_wallet ON eligibility_checks(wallet);
CREATE INDEX IF NOT EXISTS idx_eligibility_checks_checked_at ON eligibility_checks(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_eligibility_checks_eligible ON eligibility_checks(eligible);
CREATE INDEX IF NOT EXISTS idx_sync_logs_sync_type ON sync_logs(sync_type);
CREATE INDEX IF NOT EXISTS idx_sync_logs_started_at ON sync_logs(started_at DESC);

-- Enable RLS for new tables
ALTER TABLE eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Eligibility checks policies (service role only)
CREATE POLICY "Eligibility checks viewable by service role only"
ON eligibility_checks FOR SELECT
TO service_role
USING (true);

CREATE POLICY "Eligibility checks insertable by service role only"
ON eligibility_checks FOR INSERT
TO service_role
WITH CHECK (true);

-- Sync logs policies (service role only)
CREATE POLICY "Sync logs viewable by service role only"
ON sync_logs FOR SELECT
TO service_role
USING (true);

CREATE POLICY "Sync logs insertable by service role only"
ON sync_logs FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Sync logs updatable by service role only"
ON sync_logs FOR UPDATE
TO service_role
USING (true);

-- Helper function to get latest eligibility check for a wallet
CREATE OR REPLACE FUNCTION get_latest_eligibility(wallet_address TEXT)
RETURNS TABLE (
  wallet TEXT,
  nft_count INT,
  eligible BOOLEAN,
  checked_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ec.wallet,
    ec.nft_count,
    ec.eligible,
    ec.checked_at
  FROM eligibility_checks ec
  WHERE ec.wallet = wallet_address
  ORDER BY ec.checked_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Add mode configuration to config table
ALTER TABLE config ADD COLUMN IF NOT EXISTS vesting_mode TEXT DEFAULT 'snapshot';
ALTER TABLE config ADD COLUMN IF NOT EXISTS snapshot_date TIMESTAMPTZ;
ALTER TABLE config ADD COLUMN IF NOT EXISTS allow_mode_switch BOOLEAN DEFAULT true;
ALTER TABLE config ADD COLUMN IF NOT EXISTS grace_period_days INT DEFAULT 30;
ALTER TABLE config ADD COLUMN IF NOT EXISTS require_nft_on_claim BOOLEAN DEFAULT true;

-- Add mode tracking to vestings table
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS vesting_mode TEXT DEFAULT 'snapshot';
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS snapshot_locked BOOLEAN DEFAULT false;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS claim_verification_enabled BOOLEAN DEFAULT true;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS grace_period_end TIMESTAMPTZ;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Claim attempts tracking
CREATE TABLE IF NOT EXISTS claim_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_wallet TEXT NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW(),
  nft_count INT NOT NULL,
  required_nft_count INT NOT NULL,
  success BOOLEAN NOT NULL,
  reason TEXT,
  amount_attempted NUMERIC,
  CONSTRAINT positive_nft_counts CHECK (nft_count >= 0 AND required_nft_count >= 0)
);

-- Indexes for claim_attempts
CREATE INDEX IF NOT EXISTS idx_claim_attempts_wallet ON claim_attempts(user_wallet);
CREATE INDEX IF NOT EXISTS idx_claim_attempts_attempted_at ON claim_attempts(attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_claim_attempts_success ON claim_attempts(success);

-- Enable RLS for claim_attempts
ALTER TABLE claim_attempts ENABLE ROW LEVEL SECURITY;

-- Claim attempts policies (service role only)
CREATE POLICY "Claim attempts viewable by service role only"
ON claim_attempts FOR SELECT
TO service_role
USING (true);

CREATE POLICY "Claim attempts insertable by service role only"
ON claim_attempts FOR INSERT
TO service_role
WITH CHECK (true);

-- Comments
COMMENT ON TABLE config IS 'Global configuration for the vesting system (single row)';
COMMENT ON TABLE vestings IS 'Individual vesting streams for each eligible user';
COMMENT ON TABLE claim_history IS 'History of all token claims';
COMMENT ON TABLE admin_logs IS 'Audit log of all admin actions';
COMMENT ON TABLE eligibility_checks IS 'History of NFT eligibility checks for wallets';
COMMENT ON TABLE sync_logs IS 'Logs of automated eligibility sync operations';
COMMENT ON TABLE claim_attempts IS 'History of claim attempts with NFT verification results';
