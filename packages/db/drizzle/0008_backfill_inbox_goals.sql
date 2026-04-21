-- Backfill: every existing user needs an Inbox. Idempotent — safe to re-run
-- because the WHERE NOT EXISTS skips users who already have one, and the
-- partial unique index from 0007 would reject duplicates anyway.

INSERT INTO "goals" (user_id, title, is_inbox)
SELECT u.id, 'Inbox', true
FROM "user" u
WHERE NOT EXISTS (
  SELECT 1 FROM "goals" g
  WHERE g.user_id = u.id AND g.is_inbox = true
);
