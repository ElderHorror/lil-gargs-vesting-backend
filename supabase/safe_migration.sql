-- ============================================================================
-- SAFE NON-DESTRUCTIVE MIGRATION
-- ============================================================================
-- This adds missing columns to existing tables without dropping data
-- Run this if you already have tables created
-- ============================================================================

-- Add missing columns to config table
ALTER TABLE config ADD COLUMN IF NOT EXISTS claim_fee_usd NUMERIC DEFAULT 10.00;
ALTER TABLE config ADD COLUMN IF NOT EXISTS vesting_mode TEXT DEFAULT 'snapshot';
ALTER TABLE config ADD COLUMN IF NOT EXISTS snapshot_date TIMESTAMPTZ;
ALTER TABLE config ADD COLUMN IF NOT EXISTS allow_mode_switch BOOLEAN DEFAULT true;
ALTER TABLE config ADD COLUMN IF NOT EXISTS grace_period_days INT DEFAULT 30;
ALTER TABLE config ADD COLUMN IF NOT EXISTS require_nft_on_claim BOOLEAN DEFAULT true;

-- Add missing columns to vesting_streams table
ALTER TABLE vesting_streams ADD COLUMN IF NOT EXISTS streamflow_stream_id TEXT;
ALTER TABLE vesting_streams ADD COLUMN IF NOT EXISTS vesting_mode TEXT DEFAULT 'snapshot';
ALTER TABLE vesting_streams ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE vesting_streams ADD COLUMN IF NOT EXISTS require_nft_on_claim BOOLEAN DEFAULT true;

-- Add unique constraint to streamflow_stream_id if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'vesting_streams_streamflow_stream_id_key'
  ) THEN
    ALTER TABLE vesting_streams ADD CONSTRAINT vesting_streams_streamflow_stream_id_key UNIQUE (streamflow_stream_id);
  END IF;
END $$;

-- Add missing columns to vestings table
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS share_percentage NUMERIC;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS vesting_mode TEXT DEFAULT 'snapshot';
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS snapshot_locked BOOLEAN DEFAULT false;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS claim_verification_enabled BOOLEAN DEFAULT true;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS grace_period_end TIMESTAMPTZ;
ALTER TABLE vestings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Add missing indexes
CREATE INDEX IF NOT EXISTS idx_vesting_streams_streamflow_id ON vesting_streams(streamflow_stream_id);
CREATE INDEX IF NOT EXISTS idx_vestings_is_cancelled ON vestings(is_cancelled);
CREATE INDEX IF NOT EXISTS idx_claim_history_vesting_id ON claim_history(vesting_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_wallet ON admin_logs(admin_wallet);

-- Add missing column to sync_logs if table exists
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_logs') THEN
    ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS wallets_updated INT NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Update existing config row with new defaults if values are NULL
UPDATE config SET 
  claim_fee_usd = 10.00 WHERE claim_fee_usd IS NULL;
UPDATE config SET 
  vesting_mode = 'snapshot' WHERE vesting_mode IS NULL;
UPDATE config SET 
  allow_mode_switch = true WHERE allow_mode_switch IS NULL;
UPDATE config SET 
  grace_period_days = 30 WHERE grace_period_days IS NULL;
UPDATE config SET 
  require_nft_on_claim = true WHERE require_nft_on_claim IS NULL;

-- Add constraints if they don't exist
DO $$ 
BEGIN
  -- Add valid_mode constraint to config
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_mode' AND conrelid = 'config'::regclass
  ) THEN
    ALTER TABLE config ADD CONSTRAINT valid_mode CHECK (vesting_mode IN ('snapshot', 'dynamic'));
  END IF;

  -- Add valid_vesting_mode constraint to vesting_streams
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_vesting_mode' AND conrelid = 'vesting_streams'::regclass
  ) THEN
    ALTER TABLE vesting_streams ADD CONSTRAINT valid_vesting_mode CHECK (vesting_mode IN ('snapshot', 'dynamic'));
  END IF;
END $$;

-- Success message
DO $$ 
BEGIN
  RAISE NOTICE 'Migration completed successfully! All missing columns and constraints added.';
END $$;
