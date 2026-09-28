-- CreateEnum
CREATE TYPE "OrganiserStripeAccountStatus" AS ENUM ('NOT_CONNECTED', 'ONBOARDING_INCOMPLETE', 'RESTRICTED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "WalletLedgerEntryStatus" AS ENUM ('PENDING_FEE', 'CREDITED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "organiser_stripe_accounts" (
    "id" TEXT NOT NULL,
    "organiserId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "status" "OrganiserStripeAccountStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "transfersCapability" TEXT,
    "requirementsDue" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organiser_stripe_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_ledger_entries" (
    "id" TEXT NOT NULL,
    "organiserId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "grossCents" INTEGER NOT NULL,
    "platformFeeCents" INTEGER NOT NULL,
    "stripeFeeCents" INTEGER,
    "netCents" INTEGER,
    "status" "WalletLedgerEntryStatus" NOT NULL DEFAULT 'PENDING_FEE',
    "withdrawalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "organiserId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "stripeTransferId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organiser_stripe_accounts_organiserId_key" ON "organiser_stripe_accounts"("organiserId");

-- CreateIndex
CREATE UNIQUE INDEX "organiser_stripe_accounts_stripeAccountId_key" ON "organiser_stripe_accounts"("stripeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_ledger_entries_bookingId_key" ON "wallet_ledger_entries"("bookingId");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_organiserId_status_idx" ON "wallet_ledger_entries"("organiserId", "status");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_stripePaymentIntentId_idx" ON "wallet_ledger_entries"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_stripeTransferId_key" ON "withdrawals"("stripeTransferId");

-- CreateIndex
CREATE INDEX "withdrawals_organiserId_idx" ON "withdrawals"("organiserId");

-- AddForeignKey
ALTER TABLE "organiser_stripe_accounts" ADD CONSTRAINT "organiser_stripe_accounts_organiserId_fkey" FOREIGN KEY ("organiserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_organiserId_fkey" FOREIGN KEY ("organiserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "withdrawals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_organiserId_fkey" FOREIGN KEY ("organiserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
