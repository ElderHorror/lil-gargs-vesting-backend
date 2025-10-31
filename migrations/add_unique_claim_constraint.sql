-- Drop old UNIQUE constraint on just transaction_signature (if it exists)
-- This allows multiple claims with the same transaction signature (one per user)
ALTER TABLE claim_history
DROP CONSTRAINT IF EXISTS claim_history_transaction_signature_key;

-- Add new UNIQUE constraint on (user_wallet, transaction_signature)
-- This ensures that each wallet can only have one claim per transaction
-- but multiple wallets can share the same transaction signature
ALTER TABLE claim_history
ADD CONSTRAINT unique_claim_per_wallet_signature 
UNIQUE (user_wallet, transaction_signature);

-- Note: If you get an error about duplicate values, you may need to:
-- 1. Identify duplicate claims: SELECT user_wallet, transaction_signature, COUNT(*) FROM claim_history GROUP BY user_wallet, transaction_signature HAVING COUNT(*) > 1;
-- 2. Delete duplicates manually or with a script
-- 3. Then run this migration
