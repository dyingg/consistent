-- Inbox goal protection: singleton per user + non-deletable while user exists.

-- At most one Inbox per user. Partial unique index only applies to rows where
-- is_inbox is true, so non-inbox goals remain unconstrained.
CREATE UNIQUE INDEX "idx_goals_one_inbox_per_user"
  ON "goals" ("user_id")
  WHERE is_inbox = true;
--> statement-breakpoint

-- Reject direct deletes of an Inbox row while its owning user still exists.
-- The EXISTS guard lets the ON DELETE CASCADE from "user" proceed — when a
-- user is deleted, the user row is already gone by the time the cascade
-- fires this trigger, so the Inbox is allowed to go with them.
CREATE OR REPLACE FUNCTION prevent_inbox_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_inbox = true
     AND EXISTS (SELECT 1 FROM "user" WHERE id = OLD.user_id) THEN
    RAISE EXCEPTION 'Cannot delete the Inbox goal'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER prevent_inbox_delete_trigger
  BEFORE DELETE ON "goals"
  FOR EACH ROW EXECUTE FUNCTION prevent_inbox_delete();
