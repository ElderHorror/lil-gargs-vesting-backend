-- Migrate from days to seconds for precise timing
-- This allows cliffs/vesting at any time, not just midnight

-- Add new columns in seconds
ALTER TABLE vesting_streams 
ADD COLUMN IF NOT EXISTS cliff_duration_seconds BIGINT,
ADD COLUMN IF NOT EXISTS vesting_duration_seconds BIGINT;

-- Migrate existing data (days -> seconds)
UPDATE vesting_streams 
SET 
  cliff_duration_seconds = cliff_duration_days * 86400,
  vesting_duration_seconds = vesting_duration_days * 86400
WHERE cliff_duration_seconds IS NULL;

-- Make new columns NOT NULL with defaults
ALTER TABLE vesting_streams 
ALTER COLUMN cliff_duration_seconds SET DEFAULT 0,
ALTER COLUMN vesting_duration_seconds SET DEFAULT 2592000; -- 30 days default

ALTER TABLE vesting_streams 
ALTER COLUMN cliff_duration_seconds SET NOT NULL,
ALTER COLUMN vesting_duration_seconds SET NOT NULL;

-- Keep old columns for backward compatibility (can drop later)
COMMENT ON COLUMN vesting_streams.cliff_duration_days IS 'DEPRECATED: Use cliff_duration_seconds instead';
COMMENT ON COLUMN vesting_streams.vesting_duration_days IS 'DEPRECATED: Use vesting_duration_seconds instead';

COMMENT ON COLUMN vesting_streams.cliff_duration_seconds IS 'Cliff duration in seconds. Allows precise timing (e.g., 5 minutes = 300 seconds)';
COMMENT ON COLUMN vesting_streams.vesting_duration_seconds IS 'Vesting duration in seconds. Allows precise timing';

-- Example usage:
-- cliff_duration_seconds = 300 -> 5 minute cliff
-- cliff_duration_seconds = 604800 -> 7 day cliff
-- vesting_duration_seconds = 2592000 -> 30 day vesting
