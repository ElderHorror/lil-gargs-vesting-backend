-- Fallback: Remove UNIQUE constraints if they're causing issues
-- This allows duplicate claims
-- But we still have protection from:
-- 1. Rate limiter (max 1 claim per wallet per 10 seconds)
-- 2. Deduplication middleware (catches duplicate requests)

ALTER TABLE claim_history
DROP CONSTRAINT IF EXISTS unique_claim_per_wallet_pool_signature;

ALTER TABLE claim_history
DROP CONSTRAINT IF EXISTS unique_claim_per_wallet_signature;

ALTER TABLE claim_history
DROP CONSTRAINT IF EXISTS unique_claim_per_signature;

ALTER TABLE claim_history
DROP CONSTRAINT IF EXISTS claim_history_transaction_signature_key;

-- Verify the table structure
SELECT constraint_name 
FROM information_schema.table_constraints 
WHERE table_name = 'claim_history' AND constraint_type = 'UNIQUE';
