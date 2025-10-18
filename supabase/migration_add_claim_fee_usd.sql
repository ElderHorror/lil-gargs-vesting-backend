-- Migration: Add claim_fee_usd column to config table
-- This allows admin to set claim fee in USD (default $10)

ALTER TABLE config ADD COLUMN IF NOT EXISTS claim_fee_usd NUMERIC DEFAULT 10.00;

-- Update existing row if it exists
UPDATE config SET claim_fee_usd = 10.00 WHERE id = 1 AND claim_fee_usd IS NULL;
