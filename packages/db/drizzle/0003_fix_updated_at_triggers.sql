-- Fix: drop set_updated_at triggers from tables that don't have updated_at column
-- Only tasks has updated_at; goals and scheduled_blocks do not.

DROP TRIGGER IF EXISTS trg_goals_updated_at ON goals;
DROP TRIGGER IF EXISTS trg_scheduled_blocks_updated_at ON scheduled_blocks;
