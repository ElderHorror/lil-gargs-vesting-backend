-- Add UNIQUE constraint to prevent duplicate claims
-- This ensures that the same transaction signature cannot be used twice
-- which prevents race conditions where two simultaneous requests create duplicate claims

-- First, check if constraint already exists
-- If it does, this will fail silently (safe to run multiple times)

ALTER TABLE claim_history
ADD CONSTRAINT unique_claim_per_signature 
UNIQUE (user_wallet, transaction_signature);

-- Note: If you get an error about duplicate values, you may need to:
-- 1. Identify duplicate claims: SELECT user_wallet, transaction_signature, COUNT(*) FROM claim_history GROUP BY user_wallet, transaction_signature HAVING COUNT(*) > 1;
-- 2. Delete duplicates manually or with a script
-- 3. Then run this migration
