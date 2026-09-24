-- Split "venue" into venueStreet/venueCity/venueState, and add "endDate".
ALTER TABLE "events" ADD COLUMN "venueStreet" TEXT;
ALTER TABLE "events" ADD COLUMN "venueCity" TEXT;
ALTER TABLE "events" ADD COLUMN "venueState" TEXT;
ALTER TABLE "events" ADD COLUMN "endDate" TIMESTAMP(3);

-- Backfill existing rows so the NOT NULL constraints below can be applied.
UPDATE "events" SET
  "venueStreet" = "venue",
  "venueCity" = '',
  "venueState" = '',
  "endDate" = "date"
WHERE "venueStreet" IS NULL;

ALTER TABLE "events" ALTER COLUMN "venueStreet" SET NOT NULL;
ALTER TABLE "events" ALTER COLUMN "venueCity" SET NOT NULL;
ALTER TABLE "events" ALTER COLUMN "venueState" SET NOT NULL;
ALTER TABLE "events" ALTER COLUMN "endDate" SET NOT NULL;

ALTER TABLE "events" DROP COLUMN "venue";
