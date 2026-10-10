-- Organisers now publish events explicitly. New events default to DRAFT.
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED');

ALTER TABLE "events" ADD COLUMN "status" "EventStatus" NOT NULL DEFAULT 'DRAFT';

-- Every event that exists before this migration was already public, so keep
-- it visible rather than silently hiding live events.
UPDATE "events" SET "status" = 'PUBLISHED';

CREATE INDEX "events_status_date_idx" ON "events"("status", "date");
