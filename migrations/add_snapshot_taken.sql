-- Add snapshot_taken column to vesting_streams table
-- This tracks whether a snapshot has been taken for snapshot-mode pools

ALTER TABLE vesting_streams 
ADD COLUMN IF NOT EXISTS snapshot_taken BOOLEAN DEFAULT FALSE;

-- Set existing snapshot pools to true (assume already snapshotted)
UPDATE vesting_streams 
SET snapshot_taken = TRUE 
WHERE vesting_mode = 'snapshot';

-- Add comment
COMMENT ON COLUMN vesting_streams.snapshot_taken IS 'Whether snapshot has been taken at start_time (for snapshot-mode pools)';
