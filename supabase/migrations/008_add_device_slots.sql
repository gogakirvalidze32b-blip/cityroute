-- Add device_slots column to profiles table
-- Allows Premium accounts to use up to 2 devices

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS device_slots int NOT NULL DEFAULT 1
CHECK (device_slots >= 1 AND device_slots <= 2);

-- Update existing profiles to have default 1 device slot
UPDATE public.profiles
SET device_slots = 1
WHERE device_slots IS NULL;

COMMENT ON COLUMN public.profiles.device_slots IS 'Number of devices allowed for this account (1-2 for Premium)';
