-- Broaden idx_tasks_ready to cover both 'pending' and 'ready' statuses so
-- findReadyForUser still hits a partial index now that it matches either.

DROP INDEX IF EXISTS idx_tasks_ready;

CREATE INDEX idx_tasks_ready
  ON tasks (user_id)
  WHERE blocker_count = 0 AND status IN ('pending', 'ready');
