-- Migration: Add Dynamic Configuration Support
-- Run this AFTER the base schema.sql

-- Step 1: Create vesting_streams table
CREATE TABLE IF NOT EXISTS vesting_streams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- NFT Requirements (array of collections with thresholds)
  nft_requirements JSONB NOT NULL,
  
  -- Tier allocations (percentage of pool per tier)
  tier_allocations JSONB NOT NULL,
  
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

-- Step 2: Add new columns to vestings table
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS vesting_stream_id UUID REFERENCES vesting_streams(id) ON DELETE CASCADE;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS tier INT;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS vesting_mode TEXT DEFAULT 'snapshot';
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS snapshot_locked BOOLEAN DEFAULT false;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS claim_verification_enabled BOOLEAN DEFAULT true;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS grace_period_end TIMESTAMPTZ;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Step 3: Drop old unique constraint and add new one
ALTER TABLE vestings DROP CONSTRAINT IF EXISTS vestings_user_wallet_key;
ALTER TABLE vestings ADD CONSTRAINT unique_user_per_stream UNIQUE(vesting_stream_id, user_wallet);

-- Step 4: Add new indexes
CREATE INDEX IF NOT EXISTS idx_vesting_streams_is_active ON vesting_streams(is_active);
CREATE INDEX IF NOT EXISTS idx_vesting_streams_vesting_mode ON vesting_streams(vesting_mode);
CREATE INDEX IF NOT EXISTS idx_vestings_stream_id ON vestings(vesting_stream_id);
CREATE INDEX IF NOT EXISTS idx_vestings_tier ON vestings(tier);

-- Step 5: Remove nft_collection_address from config (now in vesting_streams)
ALTER TABLE config DROP COLUMN IF EXISTS nft_collection_address;

-- Step 6: Add mode configuration to config table
ALTER TABLE config ADD COLUMN IF NOT EXISTS vesting_mode TEXT DEFAULT 'snapshot';
ALTER TABLE config ADD COLUMN IF NOT EXISTS snapshot_date TIMESTAMPTZ;
ALTER TABLE config ADD COLUMN IF NOT EXISTS allow_mode_switch BOOLEAN DEFAULT true;
ALTER TABLE config ADD COLUMN IF NOT EXISTS grace_period_days INT DEFAULT 30;
ALTER TABLE config ADD COLUMN IF NOT EXISTS require_nft_on_claim BOOLEAN DEFAULT true;

-- Step 7: Enable RLS on vesting_streams
ALTER TABLE vesting_streams ENABLE ROW LEVEL SECURITY;

-- Step 8: Add RLS policies for vesting_streams
CREATE POLICY "Vesting streams viewable by all"
ON vesting_streams FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Service role can manage vesting streams"
ON vesting_streams FOR ALL
TO service_role
USING (true);

-- Step 9: Add updated_at trigger for vesting_streams
DROP TRIGGER IF EXISTS update_vesting_streams_updated_at ON vesting_streams;
CREATE TRIGGER update_vesting_streams_updated_at
  BEFORE UPDATE ON vesting_streams
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Step 10: Add comments
COMMENT ON TABLE vesting_streams IS 'Vesting stream configurations (admin creates multiple streams)';
COMMENT ON COLUMN vesting_streams.nft_requirements IS 'Array of NFT collection requirements: [{"collection": "addr", "min_nfts": 20, "tier": 20}]';
COMMENT ON COLUMN vesting_streams.tier_allocations IS 'Tier allocation config: {"20": {"pool_percent": 5, "pool_amount": 50000000}}';
