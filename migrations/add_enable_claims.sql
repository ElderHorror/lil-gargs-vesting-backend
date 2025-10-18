-- Add enable_claims and cooldown_days columns to config table
-- Run this in your Supabase SQL editor

ALTER TABLE public.config 
ADD COLUMN IF NOT EXISTS enable_claims boolean DEFAULT true;

ALTER TABLE public.config 
ADD COLUMN IF NOT EXISTS cooldown_days integer DEFAULT 1;

-- Add comment for documentation
COMMENT ON COLUMN public.config.enable_claims IS 'Global toggle to enable/disable all claiming functionality';
COMMENT ON COLUMN public.config.cooldown_days IS 'Number of days users must wait between claims';
