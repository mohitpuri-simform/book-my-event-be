-- DropIndex
DROP INDEX "sections_eventId_idx";

-- AlterTable
ALTER TABLE "sections" ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "sections_eventId_displayOrder_idx" ON "sections"("eventId", "displayOrder");
