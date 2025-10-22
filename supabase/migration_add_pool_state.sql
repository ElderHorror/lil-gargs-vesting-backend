-- Migration: Add Pool State Support
-- Run this AFTER the base schema.sql

-- Step 1: Add state column to vesting_streams table
ALTER TABLE vesting_streams ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'active';

-- Step 2: Add constraint to ensure valid states
ALTER TABLE vesting_streams ADD CONSTRAINT valid_state CHECK (state IN ('active', 'paused', 'cancelled'));

-- Step 3: Create index for better performance
CREATE INDEX IF NOT EXISTS idx_vesting_streams_state ON vesting_streams(state);

-- Step 4: Add comments
COMMENT ON COLUMN vesting_streams.state IS 'Current state of the vesting pool: active, paused, or cancelled';
