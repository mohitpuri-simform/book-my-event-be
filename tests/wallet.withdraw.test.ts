import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma";
import { disconnectAll, resetState } from "./helpers/db";
import { createBookingFor, createEventWithSeat, createTestUser } from "./helpers/factories";

vi.mock("../src/lib/stripe", () => ({
  stripe: {
    transfers: { create: vi.fn() },
  },
}));

const { stripe } = await import("../src/lib/stripe");
const { withdrawAvailableBalance } = await import("../src/services/wallet.service");
const transferCreate = vi.mocked(stripe.transfers.create);

// Real Stripe SDK error instances, so the tests exercise the same
// `instanceof` + HTTP status classification the service uses.
type StripeRaw = NonNullable<ConstructorParameters<typeof Stripe.errors.StripeError>[0]>;

function stripeError(ErrorClass: new (raw: StripeRaw) => Error, statusCode?: number): Error {
  return new ErrorClass({ message: "stripe error", type: "api_error", statusCode });
}
const errors = Stripe.errors;

/** An ACTIVE organiser with one CREDITED, unwithdrawn ledger entry worth `netCents`. */
async function setupOrganiserWithBalance(netCents = 2375) {
  const { organiser, event, seat } = await createEventWithSeat(2500);
  const buyer = await createTestUser();
  const booking = await createBookingFor(buyer.id, seat, event.id);

  await prisma.organiserStripeAccount.create({
    data: { organiserId: organiser.id, stripeAccountId: "acct_test", status: "ACTIVE" },
  });
  await prisma.walletLedgerEntry.create({
    data: {
      organiserId: organiser.id,
      bookingId: booking.id,
      eventId: event.id,
      stripePaymentIntentId: "pi_test",
      grossCents: 2500,
      platformFeeCents: 125,
      stripeFeeCents: 0,
      netCents,
      status: "CREDITED",
    },
  });
  return organiser;
}

beforeEach(async () => {
  await resetState();
  vi.clearAllMocks();
});

afterAll(async () => {
  await disconnectAll();
});

describe("organiser withdrawal idempotency", () => {
  it("sends the transfer with an idempotency key derived from the withdrawal id", async () => {
    const organiser = await setupOrganiserWithBalance();
    transferCreate.mockResolvedValue({ id: "tr_1" } as never);

    const withdrawal = await withdrawAvailableBalance(organiser.id);

    expect(withdrawal.status).toBe("COMPLETED");
    expect(transferCreate).toHaveBeenCalledTimes(1);
    expect(transferCreate.mock.calls[0]![1]).toMatchObject({
      idempotencyKey: `withdrawal-${withdrawal.id}`,
    });
  });

  it("an unknown outcome (timeout) keeps the withdrawal PENDING and does not release the money", async () => {
    const organiser = await setupOrganiserWithBalance();
    transferCreate.mockRejectedValue(stripeError(errors.StripeConnectionError));

    await expect(withdrawAvailableBalance(organiser.id)).rejects.toMatchObject({ statusCode: 502 });

    const [withdrawal] = await prisma.withdrawal.findMany();
    expect(withdrawal!.status).toBe("PENDING");
    const claimed = await prisma.walletLedgerEntry.count({
      where: { withdrawalId: withdrawal!.id },
    });
    expect(claimed).toBe(1);
  });

  it("retrying after a timeout resumes the SAME withdrawal with the SAME key — one withdrawal, one transfer id", async () => {
    const organiser = await setupOrganiserWithBalance();
    transferCreate.mockRejectedValueOnce(stripeError(errors.StripeConnectionError));
    await expect(withdrawAvailableBalance(organiser.id)).rejects.toBeDefined();
    const firstKey = (transferCreate.mock.calls[0]![1] as { idempotencyKey: string })
      .idempotencyKey;

    transferCreate.mockResolvedValueOnce({ id: "tr_1" } as never);
    const resumed = await withdrawAvailableBalance(organiser.id);

    expect(resumed.status).toBe("COMPLETED");
    expect(resumed.stripeTransferId).toBe("tr_1");
    expect((transferCreate.mock.calls[1]![1] as { idempotencyKey: string }).idempotencyKey).toBe(
      firstKey,
    );
    expect(await prisma.withdrawal.count()).toBe(1);
  });

  it("a definitive Stripe rejection marks it FAILED and frees the balance for a new withdrawal", async () => {
    const organiser = await setupOrganiserWithBalance();
    transferCreate.mockRejectedValueOnce(stripeError(errors.StripeInvalidRequestError, 400));

    await expect(withdrawAvailableBalance(organiser.id)).rejects.toMatchObject({ statusCode: 502 });

    const [failed] = await prisma.withdrawal.findMany();
    expect(failed!.status).toBe("FAILED");
    expect(await prisma.walletLedgerEntry.count({ where: { withdrawalId: null } })).toBe(1);

    transferCreate.mockResolvedValueOnce({ id: "tr_2" } as never);
    const retry = await withdrawAvailableBalance(organiser.id);
    expect(retry.status).toBe("COMPLETED");
    expect(retry.id).not.toBe(failed!.id);
  });

  describe("classifying a failed transfer from the Stripe error", () => {
    async function failWith(error: Error) {
      const organiser = await setupOrganiserWithBalance();
      transferCreate.mockRejectedValueOnce(error);
      const result = await withdrawAvailableBalance(organiser.id).catch((e: unknown) => e);
      const [withdrawal] = await prisma.withdrawal.findMany();
      return { result, status: withdrawal!.status };
    }

    it.each([
      ["a 402 card error", () => stripeError(errors.StripeCardError, 402), "FAILED", 502],
      ["a 429 rate limit", () => stripeError(errors.StripeRateLimitError, 429), "FAILED", 502],
      [
        "a 403 permission error",
        () => stripeError(errors.StripePermissionError, 403),
        "FAILED",
        502,
      ],
      ["a 500 API error", () => stripeError(errors.StripeAPIError, 500), "PENDING", 502],
      ["a connection error", () => stripeError(errors.StripeConnectionError), "PENDING", 502],
      ["a non-Stripe error", () => new Error("boom"), "PENDING", 502],
      [
        "an idempotency conflict",
        () => stripeError(errors.StripeIdempotencyError, 409),
        "PENDING",
        409,
      ],
    ])("%s → %s", async (_name, make, expectedStatus, expectedHttp) => {
      const { result, status } = await failWith(make());

      expect(status).toBe(expectedStatus);
      expect(result).toMatchObject({ statusCode: expectedHttp });
    });
  });
});
