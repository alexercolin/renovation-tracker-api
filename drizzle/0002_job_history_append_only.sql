CREATE OR REPLACE FUNCTION job_history_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'job_history is append-only: rows cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.changes IS DISTINCT FROM OLD.changes
     OR NEW.target_seq IS DISTINCT FROM OLD.target_seq
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
    RAISE EXCEPTION 'job_history is append-only: only superseded_at may be set, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER job_history_append_only
BEFORE UPDATE OR DELETE ON job_history
FOR EACH ROW EXECUTE FUNCTION job_history_append_only();
