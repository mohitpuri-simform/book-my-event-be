import Stripe from "stripe";
import type { Withdrawal } from "../../generated/prisma/client";
import { env } from "../config/env";
import { MESSAGES } from "../constants/messages.constants";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { stripe } from "../lib/stripe";
import { syncAccountStatus } from "./stripeConnect.service";
import { ApiError } from "../utils/ApiError";

interface ConfirmedBookingForWallet {
  id: string;
  eventId: string;
  priceCents: number;
  event: { organiserId: string };
}

async function loadConfirmedBookingsForPaymentIntent(
  paymentIntentId: string,
): Promise<ConfirmedBookingForWallet[]> {
  return prisma.booking.findMany({
    where: {
      hold: { paymentAttempt: { stripePaymentIntentId: paymentIntentId, status: "CONFIRMED" } },
    },
    select: { id: true, eventId: true, priceCents: true, event: { select: { organiserId: true } } },
    orderBy: { id: "asc" },
  });
}

/**
 * Allocates ledger entries for every CONFIRMED booking on this PaymentIntent.
 * The platform fee is always an independent, clean 5%-of-gross per booking.
 * The one real Stripe fee (when known) is allocated pro-rata across every
 * booking on the PaymentIntent — which may span multiple organisers' events
 * — by `priceCents / totalAmount`, with the LAST booking (sorted by id)
 * absorbing the rounding remainder so per-booking shares always sum exactly
 * to the true total fee. When the fee isn't known yet, entries are written
 * as PENDING_FEE (stripeFeeCents/netCents null) and get backfilled later by
 * handleChargeUpdated. Upserts (not creates) so re-running this for the
 * same PaymentIntent — e.g. a later charge.updated backfill — is safe.
 */
async function allocateLedgerEntries(
  paymentIntentId: string,
  chargeId: string | null,
  stripeFeeCents: number | null,
): Promise<void> {
  const bookings = await loadConfirmedBookingsForPaymentIntent(paymentIntentId);

  if (bookings.length === 0) {
    logger.warn(
      { paymentIntentId },
      "no confirmed bookings found for payment intent — skipping wallet credit",
    );
    return;
  }

  const totalAmount = bookings.reduce((sum, b) => sum + b.priceCents, 0);
  const platformFeeBps = env.STRIPE_CONNECT_PLATFORM_FEE_BPS;

  let allocatedFee = 0;

  const entries = bookings.map((booking, index) => {
    const grossCents = booking.priceCents;
    const platformFeeCents = Math.round((grossCents * platformFeeBps) / 10000);

    let stripeFeeShare: number | null = null;
    let netCents: number | null = null;
    let status: "PENDING_FEE" | "CREDITED" = "PENDING_FEE";

    if (stripeFeeCents !== null) {
      const isLast = index === bookings.length - 1;
      stripeFeeShare = isLast
        ? stripeFeeCents - allocatedFee
        : Math.floor((stripeFeeCents * grossCents) / totalAmount);

      if (!isLast) {
        allocatedFee += stripeFeeShare;
      }

      netCents = grossCents - platformFeeCents - stripeFeeShare;
      status = "CREDITED";
    }

    return {
      organiserId: booking.event.organiserId,
      bookingId: booking.id,
      eventId: booking.eventId,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: chargeId,
      grossCents,
      platformFeeCents,
      stripeFeeCents: stripeFeeShare,
      netCents,
      status,
    };
  });

  await prisma.$transaction(
    entries.map((entry) =>
      prisma.walletLedgerEntry.upsert({
        where: { bookingId: entry.bookingId },
        create: entry,
        update: {
          stripeChargeId: entry.stripeChargeId,
          stripeFeeCents: entry.stripeFeeCents,
          netCents: entry.netCents,
          status: entry.status,
        },
      }),
    ),
  );

  logger.info(
    {
      paymentIntentId,
      bookingCount: bookings.length,
      totalAmount,
      stripeFeeCents,
      status: stripeFeeCents !== null ? "CREDITED" : "PENDING_FEE",
    },
    "wallet ledger entries allocated",
  );
}

function extractChargeFee(charge: Stripe.Charge): number | null {
  const balanceTransaction = charge.balance_transaction;
  if (!balanceTransaction || typeof balanceTransaction === "string") {
    return null;
  }
  return balanceTransaction.fee;
}

/**
 * Called once per PaymentIntent from handlePaymentIntentSucceeded, AFTER
 * the existing per-hold finalizeAttempt loop finishes — so it only ever
 * sees bookings that actually got created. A single cart/PaymentIntent can
 * span seats from multiple events/organisers, so this always re-derives
 * every organiser touched by this PaymentIntent rather than assuming one.
 */
export async function creditWalletForPaymentIntent(paymentIntentId: string): Promise<void> {
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
  } catch (error) {
    logger.error(
      { err: error, paymentIntentId },
      "failed to retrieve payment intent while crediting wallet",
    );
    return;
  }

  const charge =
    intent.latest_charge && typeof intent.latest_charge !== "string" ? intent.latest_charge : null;
  const stripeFeeCents = charge ? extractChargeFee(charge) : null;

  await allocateLedgerEntries(paymentIntentId, charge?.id ?? null, stripeFeeCents);
}

/**
 * Backfills PENDING_FEE entries to CREDITED once the real per-charge fee
 * resolves. Ordinary v1 `charge.updated` webhook case on the existing
 * endpoint/secret — no new plumbing needed.
 */
export async function handleChargeUpdated(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;

  if (!paymentIntentId) {
    return;
  }

  const pendingCount = await prisma.walletLedgerEntry.count({
    where: { stripePaymentIntentId: paymentIntentId, status: "PENDING_FEE" },
  });

  if (pendingCount === 0) {
    return;
  }

  if (!charge.balance_transaction) {
    logger.info(
      { paymentIntentId, chargeId: charge.id },
      "charge.updated received but balance_transaction not yet resolved",
    );
    return;
  }

  let stripeFeeCents: number;
  if (typeof charge.balance_transaction === "string") {
    try {
      const balanceTransaction = await stripe.balanceTransactions.retrieve(
        charge.balance_transaction,
      );
      stripeFeeCents = balanceTransaction.fee;
    } catch (error) {
      logger.error(
        { err: error, paymentIntentId, chargeId: charge.id },
        "failed to retrieve balance transaction for charge.updated backfill",
      );
      return;
    }
  } else {
    stripeFeeCents = charge.balance_transaction.fee;
  }

  await allocateLedgerEntries(paymentIntentId, charge.id, stripeFeeCents);
}

export interface WalletSummary {
  stripeAccountStatus: "NOT_CONNECTED" | "ONBOARDING_INCOMPLETE" | "RESTRICTED" | "ACTIVE";
  grossEarnedCents: number;
  platformFeeCents: number;
  stripeFeeCents: number;
  withdrawnCents: number;
  availableCents: number;
}

/**
 * Safety net for entries stuck in PENDING_FEE: if the `charge.updated` webhook
 * never arrived (not forwarded locally, or dropped), ask Stripe for the fee
 * directly. Entries whose fee still isn't available simply stay pending.
 * Best-effort — a Stripe hiccup must never break the wallet screen.
 */
async function resolvePendingFees(organiserId: string): Promise<void> {
  try {
    const pending = await prisma.walletLedgerEntry.findMany({
      where: { organiserId, status: "PENDING_FEE" },
      select: { stripePaymentIntentId: true },
      distinct: ["stripePaymentIntentId"],
      take: 10,
    });

    for (const { stripePaymentIntentId } of pending) {
      await creditWalletForPaymentIntent(stripePaymentIntentId);
    }
  } catch (error) {
    logger.warn({ err: error, organiserId }, "failed to resolve pending wallet fees");
  }
}

export async function getWalletSummary(organiserId: string): Promise<WalletSummary> {
  let account = await prisma.organiserStripeAccount.findUnique({ where: { organiserId } });

  // Don't rely solely on the `account.updated` webhook: when the organiser returns
  // from Stripe onboarding, pull the live account so the status is current.
  if (account && account.status !== "ACTIVE") {
    try {
      await syncAccountStatus(await stripe.accounts.retrieve(account.stripeAccountId));
      account = await prisma.organiserStripeAccount.findUnique({ where: { organiserId } });
    } catch (error) {
      logger.warn({ err: error, organiserId }, "failed to refresh stripe account status");
    }
  }

  await resolvePendingFees(organiserId);

  const [aggregates, withdrawnAggregate, availableAggregate] = await Promise.all([
    prisma.walletLedgerEntry.aggregate({
      where: { organiserId, status: { in: ["CREDITED", "PENDING_FEE"] } },
      _sum: { grossCents: true, platformFeeCents: true, stripeFeeCents: true },
    }),
    prisma.withdrawal.aggregate({
      where: { organiserId, status: "COMPLETED" },
      _sum: { amountCents: true },
    }),
    prisma.walletLedgerEntry.aggregate({
      where: { organiserId, status: "CREDITED", withdrawalId: null },
      _sum: { netCents: true },
    }),
  ]);

  return {
    stripeAccountStatus: account?.status ?? "NOT_CONNECTED",
    grossEarnedCents: aggregates._sum.grossCents ?? 0,
    platformFeeCents: aggregates._sum.platformFeeCents ?? 0,
    stripeFeeCents: aggregates._sum.stripeFeeCents ?? 0,
    withdrawnCents: withdrawnAggregate._sum.amountCents ?? 0,
    availableCents: availableAggregate._sum.netCents ?? 0,
  };
}

type TransferErrorKind = "in-progress" | "rejected" | "unknown";

/**
 * Decides what a failed transfer call tells us, from Stripe's own error classes
 * and HTTP status (stable, documented semantics) rather than a hand-kept list of
 * error names:
 *  - idempotency error  → the same withdrawal's transfer is being processed
 *  - Stripe 4xx         → the request was rejected, the transfer did NOT happen
 *  - anything else      → a timeout, dropped connection, 5xx or non-Stripe error:
 *                         the outcome is unknown and must never be treated as
 *                         "failed", because the money may already have moved
 */
function classifyTransferError(error: unknown): TransferErrorKind {
  if (error instanceof Stripe.errors.StripeIdempotencyError) return "in-progress";
  if (
    error instanceof Stripe.errors.StripeError &&
    error.statusCode !== undefined &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return "rejected";
  }
  return "unknown";
}

/**
 * Sends the Stripe transfer for a claimed (PENDING) withdrawal and records the
 * outcome. The idempotency key is derived from the withdrawal id, so calling
 * this again for the same withdrawal — the SDK's own network retries, or a
 * resume after a timeout/crash — returns the ORIGINAL transfer instead of
 * creating a second one.
 *  - success            → COMPLETED
 *  - definitive failure → FAILED, ledger rows released for a fresh withdrawal
 *  - unknown outcome    → stays PENDING with its rows claimed; the next
 *                         withdraw attempt resumes it with the same key
 */
async function settleWithdrawal(withdrawal: Withdrawal): Promise<Withdrawal> {
  let transfer: Stripe.Transfer;
  try {
    transfer = await stripe.transfers.create(
      {
        amount: withdrawal.amountCents,
        currency: "usd",
        destination: withdrawal.stripeAccountId,
        transfer_group: withdrawal.id,
      },
      { idempotencyKey: `withdrawal-${withdrawal.id}`, maxNetworkRetries: 2 },
    );
  } catch (error) {
    const kind = classifyTransferError(error);

    if (kind === "in-progress") {
      // The same withdrawal's transfer is still being processed by another request.
      throw new ApiError(409, MESSAGES.wallet.withdrawalInProgress);
    }

    if (kind === "unknown") {
      logger.error(
        { err: error, organiserId: withdrawal.organiserId, withdrawalId: withdrawal.id },
        "withdrawal transfer outcome unknown — left PENDING, will resume with the same idempotency key",
      );
      throw new ApiError(502, MESSAGES.wallet.transferUncertain);
    }

    const failureReason = error instanceof Error ? error.message : "unknown transfer error";

    await prisma.$transaction([
      prisma.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: "FAILED", failureReason },
      }),
      prisma.walletLedgerEntry.updateMany({
        where: { withdrawalId: withdrawal.id },
        data: { withdrawalId: null },
      }),
    ]);

    logger.error(
      {
        err: error,
        organiserId: withdrawal.organiserId,
        withdrawalId: withdrawal.id,
        failureReason,
      },
      "withdrawal transfer failed — ledger rows released for retry",
    );

    throw new ApiError(502, MESSAGES.wallet.transferFailed);
  }

  // Outside the try on purpose: if this write fails, the transfer already
  // happened, so the withdrawal must stay PENDING (and resume to COMPLETED
  // via the same idempotency key) rather than be marked FAILED and released.
  const completed = await prisma.withdrawal.update({
    where: { id: withdrawal.id },
    data: { status: "COMPLETED", stripeTransferId: transfer.id },
  });

  logger.info(
    {
      organiserId: withdrawal.organiserId,
      withdrawalId: withdrawal.id,
      stripeTransferId: transfer.id,
    },
    "withdrawal completed",
  );

  return completed;
}

/**
 * Concurrency-safe manual withdrawal: inside one transaction, `SELECT ...
 * FOR UPDATE` locks the organiser's CREDITED + unassigned ledger rows, sums
 * netCents, creates the Withdrawal(PENDING) row, and atomically claims the
 * locked rows onto it (`withdrawalId` set) — the claim. Only after that
 * transaction commits does the actual Stripe transfer call happen, since a
 * manual withdrawal typically happens well after the contributing charges
 * have settled. A concurrent second withdraw request either blocks then
 * sees zero balance, or fails cleanly — it can never double-claim the same
 * rows.
 */
export async function withdrawAvailableBalance(organiserId: string): Promise<Withdrawal> {
  const account = await prisma.organiserStripeAccount.findUnique({ where: { organiserId } });
  if (!account || account.status !== "ACTIVE") {
    throw new ApiError(409, MESSAGES.wallet.accountNotActive);
  }

  // A PENDING withdrawal means an earlier attempt's outcome is unknown (timeout /
  // crash). Settle that one first — with its original idempotency key, Stripe
  // returns the original transfer if it went through — instead of claiming the
  // same money again under a new withdrawal.
  const pending = await prisma.withdrawal.findFirst({
    where: { organiserId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
  if (pending) {
    logger.warn(
      { organiserId, withdrawalId: pending.id },
      "resuming pending withdrawal before claiming a new one",
    );
    return settleWithdrawal(pending);
  }

  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; netCents: number }[]>`
      SELECT "id", "netCents"
      FROM "wallet_ledger_entries"
      WHERE "organiserId" = ${organiserId} AND "status" = 'CREDITED' AND "withdrawalId" IS NULL
      FOR UPDATE
    `;

    const amountCents = rows.reduce((sum, row) => sum + row.netCents, 0);

    if (rows.length === 0 || amountCents <= 0) {
      return null;
    }

    const withdrawal = await tx.withdrawal.create({
      data: {
        organiserId,
        stripeAccountId: account.stripeAccountId,
        amountCents,
        status: "PENDING",
      },
    });

    await tx.walletLedgerEntry.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { withdrawalId: withdrawal.id },
    });

    return withdrawal;
  });

  if (!claimed) {
    throw new ApiError(409, MESSAGES.wallet.nothingToWithdraw);
  }

  logger.info(
    { organiserId, withdrawalId: claimed.id, amountCents: claimed.amountCents },
    "withdrawal claimed — calling stripe transfer",
  );

  return settleWithdrawal(claimed);
}
