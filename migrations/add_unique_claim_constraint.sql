-- Drop old UNIQUE constraints (if they exist)
-- This allows multiple claims with the same transaction signature (one per user per pool)
ALTER TABLE claim_history
DROP CONSTRAINT IF EXISTS claim_history_transaction_signature_key;

ALTER TABLE claim_history
DROP CONSTRAINT IF EXISTS unique_claim_per_signature;

ALTER TABLE claim_history
DROP CONSTRAINT IF EXISTS unique_claim_per_wallet_signature;

-- Add new UNIQUE constraint on (user_wallet, vesting_id, transaction_signature)
-- This ensures that each wallet can only have one claim per pool per transaction
-- This allows the same transaction to have multiple claims (one per pool)
ALTER TABLE claim_history
ADD CONSTRAINT unique_claim_per_wallet_pool_signature 
UNIQUE (user_wallet, vesting_id, transaction_signature);

-- Note: If you get an error about duplicate values, you may need to:
-- 1. Identify duplicate claims: SELECT user_wallet, transaction_signature, COUNT(*) FROM claim_history GROUP BY user_wallet, transaction_signature HAVING COUNT(*) > 1;
-- 2. Delete duplicates manually or with a script
-- 3. Then run this migration
