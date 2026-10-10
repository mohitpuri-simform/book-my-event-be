import { randomUUID } from "node:crypto";
import { EventStatus, type Hold } from "../../generated/prisma/client";
import { env } from "../config/env";
import { MESSAGES } from "../constants/messages.constants";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { deleteIfHoldMatches, isRedisDown, redis } from "../lib/redis";
import { parseSeatHoldValue, seatHoldKey, type SeatHoldValue } from "../lib/seatHold";
import { cancelHoldExpiry, scheduleHoldExpiry } from "../queues/holdExpiry.queue";
import { ApiError } from "../utils/ApiError";
import { hasEventEnded } from "../utils/eventTime";

export interface HoldView {
  holdId: string;
  seatId: string;
  eventId: string;
  sectionId: string;
  row: number;
  col: number;
  priceCents: number;
  expiresAt: Date;
  remainingTtlSeconds: number;
}

export interface AcquireHoldResult {
  holdId: string;
  seatId: string;
  expiresAt: Date;
  remainingTtlSeconds: number;
  idempotent: boolean;
}

function failClosedIfRedisDown(seatId: string, userId: string): void {
  if (isRedisDown()) {
    logger.error({ seatId, userId }, "hold request rejected: redis unavailable");
    throw new ApiError(503, MESSAGES.server.serviceUnavailable);
  }
}

/**
 * Acquires an exclusive, time-limited hold on a seat. Redis's `SET NX EX` is
 * the single atomic operation that decides which of two concurrent
 * requests for the same seat wins — see §2.1 of the seat-holding spec.
 * Postgres is only ever written to *after* that decision is made.
 */
export async function holdSeat(userId: string, seatId: string): Promise<AcquireHoldResult> {
  failClosedIfRedisDown(seatId, userId);

  const seat = await prisma.seat.findUnique({
    where: { id: seatId },
    include: { section: { select: { event: { select: { status: true, endDate: true } } } } },
  });
  // A seat on an unpublished event doesn't exist as far as buyers are concerned.
  if (!seat || seat.section.event.status !== EventStatus.PUBLISHED) {
    throw new ApiError(404, MESSAGES.seats.notFound);
  }
  if (hasEventEnded(seat.section.event)) {
    throw new ApiError(409, MESSAGES.events.hasEnded);
  }
  if (seat.status === "BOOKED") {
    throw new ApiError(409, MESSAGES.holds.seatUnavailable);
  }

  const key = seatHoldKey(seatId);
  const holdId = randomUUID();
  const value: SeatHoldValue = { userId, holdId };

  let setResult: "OK" | null;
  try {
    setResult = await redis.set(key, JSON.stringify(value), "EX", env.HOLD_TTL_SECONDS, "NX");
  } catch (error) {
    logger.error({ err: error, seatId, userId }, "redis error while acquiring hold");
    throw new ApiError(503, MESSAGES.server.serviceUnavailable);
  }

  if (setResult === "OK") {
    const expiresAt = new Date(Date.now() + env.HOLD_TTL_SECONDS * 1000);

    const hold = await prisma.$transaction(async (tx) => {
      const created = await tx.hold.create({
        data: { id: holdId, seatId, userId, status: "ACTIVE", expiresAt },
      });
      await tx.seat.updateMany({
        where: { id: seatId, status: { not: "BOOKED" } },
        data: { status: "HELD" },
      });
      return created;
    });

    await scheduleHoldExpiry({ holdId: hold.id, seatId });
    logger.info({ holdId: hold.id, seatId, userId }, "hold created");

    return {
      holdId: hold.id,
      seatId,
      expiresAt: hold.expiresAt,
      remainingTtlSeconds: env.HOLD_TTL_SECONDS,
      idempotent: false,
    };
  }

  // Someone already holds this seat. If it's the same user re-selecting
  // (double-click, refresh mid-checkout), this is a success, not a
  // conflict — return their existing hold's remaining TTL. See §2.5.
  const existing = parseSeatHoldValue(await redis.get(key));

  if (existing && existing.userId === userId) {
    const ttl = await redis.ttl(key);
    const remainingTtlSeconds = ttl > 0 ? ttl : env.HOLD_TTL_SECONDS;
    const existingHold = await prisma.hold.findUnique({ where: { id: existing.holdId } });

    logger.info({ holdId: existing.holdId, seatId, userId }, "idempotent re-hold");

    return {
      holdId: existing.holdId,
      seatId,
      expiresAt: existingHold?.expiresAt ?? new Date(Date.now() + remainingTtlSeconds * 1000),
      remainingTtlSeconds,
      idempotent: true,
    };
  }

  throw new ApiError(409, MESSAGES.holds.seatUnavailable);
}

/**
 * Releases a hold immediately (Redis key deleted, not left to expire) and
 * flips the seat back to available. Idempotent: releasing an
 * already-released/expired/confirmed hold is a no-op, not an error.
 */
export async function releaseHold(
  userId: string,
  holdId: string,
  nextStatus: "RELEASED" | "EXPIRED" = "RELEASED",
): Promise<void> {
  const hold = await prisma.hold.findUnique({ where: { id: holdId } });
  if (!hold || hold.userId !== userId) {
    throw new ApiError(404, MESSAGES.holds.notFound);
  }

  if (hold.status !== "ACTIVE") {
    return;
  }

  await releaseHoldRecord(hold, nextStatus);
  await cancelHoldExpiry(holdId);
}

/**
 * Shared release path for the expiry worker, explicit user release, and
 * payment-failure handling. Deletes the Redis key (only if it still points
 * at this exact hold — a CAS delete guards against a race where the key
 * already expired naturally and was re-acquired by someone else), then
 * lazily reconciles the Postgres `Hold`/`Seat` rows. Both the hold and
 * seat updates are conditional (`status: "ACTIVE"` / `"HELD"`) so this is
 * safe to call more than once for the same hold.
 */
export async function releaseHoldRecord(
  hold: Pick<Hold, "id" | "seatId" | "userId">,
  nextStatus: "RELEASED" | "EXPIRED",
): Promise<void> {
  await deleteIfHoldMatches(seatHoldKey(hold.seatId), hold.id).catch((error: unknown) => {
    logger.error(
      { err: error, holdId: hold.id, seatId: hold.seatId },
      "failed to clear redis hold key",
    );
  });

  await prisma.$transaction([
    prisma.hold.updateMany({
      where: { id: hold.id, status: "ACTIVE" },
      data: { status: nextStatus },
    }),
    prisma.seat.updateMany({
      where: { id: hold.seatId, status: "HELD" },
      data: { status: "AVAILABLE" },
    }),
  ]);

  logger.info(
    { holdId: hold.id, seatId: hold.seatId, userId: hold.userId, status: nextStatus },
    "hold released",
  );
}

/** Called by the BullMQ delayed job — re-checks state before acting (rule #2). */
export async function processHoldExpiryJob(holdId: string): Promise<void> {
  const hold = await prisma.hold.findUnique({ where: { id: holdId } });
  if (!hold) return;
  if (hold.status !== "ACTIVE") return;
  if (hold.expiresAt.getTime() > Date.now()) return;

  await releaseHoldRecord(hold, "EXPIRED");
}

interface HoldWithSeat extends Hold {
  seat: {
    id: string;
    row: number;
    col: number;
    priceCents: number;
    sectionId: string;
    section: { eventId: string };
  };
}

/**
 * Lists the user's currently-active holds ("cart"). Redis is re-checked for
 * every hold — a Postgres row saying `ACTIVE` is informational only. Any
 * hold whose Redis key is already gone is lazily reconciled to `EXPIRED`
 * here rather than waiting for its BullMQ job to run (rule #4.2, no sweep
 * job needed for correctness).
 */
export async function listMyHolds(
  userId: string,
): Promise<{ holds: HoldView[]; effectiveExpiresAt: Date | null }> {
  const candidates = (await prisma.hold.findMany({
    where: { userId, status: "ACTIVE" },
    include: { seat: { include: { section: { select: { eventId: true } } } } },
    orderBy: { createdAt: "asc" },
  })) as HoldWithSeat[];

  const holds: HoldView[] = [];

  for (const hold of candidates) {
    const raw = await redis.get(seatHoldKey(hold.seatId));
    const value = parseSeatHoldValue(raw);

    if (!value || value.holdId !== hold.id) {
      await releaseHoldRecord(hold, "EXPIRED").catch((error: unknown) => {
        logger.error({ err: error, holdId: hold.id }, "failed to lazily expire stale hold");
      });
      continue;
    }

    const ttl = await redis.ttl(seatHoldKey(hold.seatId));
    const remainingTtlSeconds = ttl > 0 ? ttl : 0;

    holds.push({
      holdId: hold.id,
      seatId: hold.seatId,
      eventId: hold.seat.section.eventId,
      sectionId: hold.seat.sectionId,
      row: hold.seat.row,
      col: hold.seat.col,
      priceCents: hold.seat.priceCents,
      expiresAt: hold.expiresAt,
      remainingTtlSeconds,
    });
  }

  const effectiveExpiresAt =
    holds.length > 0
      ? holds.reduce((min, h) => (h.expiresAt < min ? h.expiresAt : min), holds[0]!.expiresAt)
      : null;

  return { holds, effectiveExpiresAt };
}

export interface ValidatedHold {
  holdId: string;
  seatId: string;
  eventId: string;
  priceCents: number;
}

/**
 * Re-validates a set of holds before checkout proceeds (§2.3): every seat
 * must exist in Postgres, belong to this user, and its Redis key must
 * still exist with a matching `holdId`. Used both when entering checkout
 * and when a user resumes it after navigating away.
 */
export async function validateHoldsForCheckout(
  userId: string,
  holdIds: string[],
): Promise<{ valid: true; holds: ValidatedHold[] } | { valid: false; invalidHoldIds: string[] }> {
  const rows = (await prisma.hold.findMany({
    where: { id: { in: holdIds } },
    include: { seat: { include: { section: { select: { eventId: true } } } } },
  })) as HoldWithSeat[];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const invalidHoldIds: string[] = [];
  const valid: ValidatedHold[] = [];

  for (const holdId of holdIds) {
    const hold = byId.get(holdId);
    if (!hold || hold.userId !== userId || hold.status !== "ACTIVE") {
      invalidHoldIds.push(holdId);
      continue;
    }

    const value = parseSeatHoldValue(await redis.get(seatHoldKey(hold.seatId)));
    if (!value || value.holdId !== hold.id) {
      invalidHoldIds.push(holdId);
      await releaseHoldRecord(hold, "EXPIRED").catch(() => undefined);
      continue;
    }

    valid.push({
      holdId: hold.id,
      seatId: hold.seatId,
      eventId: hold.seat.section.eventId,
      priceCents: hold.seat.priceCents,
    });
  }

  if (invalidHoldIds.length > 0) {
    return { valid: false, invalidHoldIds };
  }

  return { valid: true, holds: valid };
}
