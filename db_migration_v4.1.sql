-- ============================================================
-- Migration v4.1 - Rank System + Withdrawal Fee for all users
-- ============================================================

-- 1. Add rank column to users (member, agent, gold_agent, partner)
ALTER TABLE users ADD COLUMN IF NOT EXISTS rank TEXT DEFAULT 'member';

-- 2. Sync existing agents: if is_agent=true, set rank='agent'
UPDATE users SET rank = 'agent' WHERE is_agent = TRUE AND rank = 'member';

-- 3. Ensure first_deposit_at is set for users who already have deposits
-- (use created_at as fallback so withdrawal fees apply correctly)
UPDATE users 
SET first_deposit_at = created_at 
WHERE first_deposit_at IS NULL 
  AND balance > 0;

-- 4. Index for rank
CREATE INDEX IF NOT EXISTS idx_users_rank ON users(rank);

-- Done
