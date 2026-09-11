# CLAUDE.md — Backend

Guidance for Claude Code (or any engineer) working in `backend/`.

## Project

**Event Ticket Booking POC — API.** Users browse events, hold a seat, and pay; organisers
manage their own events. The point of this project is **not** the CRUD around events — it's
correctly handling concurrency on seat holds and reconciling payment confirmations that can
arrive late, twice, or never.

If a change doesn't touch one of those three things (concurrent holds, hold expiry, payment
reconciliation), it's probably not the hard part of this codebase — but don't let that be an
excuse for sloppy auth or validation elsewhere either.

## Stack

| Layer            | Choice                 |
| ---------------- | ---------------------- |
| Framework        | Express (Node.js)      |
| Database         | PostgreSQL             |
| ORM              | Prisma                 |
| Background jobs  | BullMQ (Redis-backed)  |
| Payments         | Stripe (test mode)     |
| Logging          | pino (structured JSON) |
| Containerization | Docker Compose         |

Redis is a new dependency implied by BullMQ — add it to `docker-compose.yml` alongside Postgres.

## Non-negotiable business rules

These are what this POC is graded on. Any implementation choice that violates one of these is
wrong, regardless of how clean the code looks otherwise.

1. **Exactly one hold per seat.** Two concurrent requests for the same seat → exactly one
   succeeds, the other gets a clean "unavailable" response. This must be enforced at the
   database level (atomic conditional update or `SELECT ... FOR UPDATE` inside a transaction),
   never with an application-level lock, mutex, or "check then write" from Node — that race
   loses under real concurrency.
2. **Holds expire on their own.** No manual cleanup. Use BullMQ delayed jobs for expiry, but
   also treat `holds.expiresAt` as the source of truth on read (a job can be delayed or dropped;
   the timestamp can't lie). Availability queries and payment reconciliation should always
   re-check `expiresAt`, not just trust hold status.
3. **No partial bookings.** A `booking` row is only ever created after Stripe confirms payment.
   If payment fails, is abandoned, or the hold expires first, there is no booking row and no
   seat left in limbo — it just becomes available again.
4. **Idempotent payment confirmation.** Every Stripe webhook event carries an event `id` and the
   `PaymentIntent` id. Store both in `payment_attempts` with a unique constraint. A replayed
   webhook must be a no-op (detected via unique constraint conflict or an explicit
   `processedEventIds` check), never a second booking or a second finalisation.
5. **Late confirmation handling.** If a Stripe confirmation arrives after the hold expired,
   decide explicitly (and log clearly) whether to: honour it if the seat is still free, or
   reject/flag it for refund if the seat was re-held/booked by someone else. Don't let this
   fall through silently.
6. **Authorization is per-record, not just per-route.** Every hold, payment, and booking is
   scoped to an authenticated user. Users can only read/act on their own bookings. Organisers
   can only see bookings for events they created. This must hold even when someone requests
   another user's record directly by ID — write a test for it, don't rely on the frontend hiding
   the link.
7. **No unbounded scans.** Availability and booking listings must not load every seat/booking
   into memory to compute a count or a filtered list. Use aggregate queries
   (`COUNT`/`GROUP BY`) or pagination as the event's seat count grows.

## Data model (starting point — adjust as needed, but keep the shape)

```
events            id, name, date, venue, organiserId
seats             id, eventId, label, status (available | held | booked)
holds             id, seatId, userId, status, expiresAt, createdAt
payment_attempts  id, holdId, stripePaymentIntentId (unique), stripeEventId (unique), status
bookings          id, holdId, userId, ticketRef (unique), createdAt
```

- `seats.status` transitions: `available → held → booked`, or `held → available` (expiry /
  failed payment).
- A `booking` always references the `hold` it was created from, so you can trace the full
  lifecycle of a seat from selection to ticket.
- `payment_attempts` is the idempotency ledger — every webhook write goes through it first.

## Concurrency implementation notes

Prefer one of these two patterns for seat holds — pick one and be consistent:

- **Optimistic / conditional update**: `UPDATE seats SET status = 'held' WHERE id = $1 AND
status = 'available'`, then check `rowCount === 1`. Simple, no explicit locking, works well
  under Postgres's default isolation.
- **Pessimistic / row lock**: wrap in `prisma.$transaction`, `SELECT ... FOR UPDATE` the seat
  row, check status, then update.

Either is acceptable — the conditional update is usually simpler to reason about and test.
Whichever you pick, **the concurrency test must fire real concurrent requests** (e.g.
`Promise.all([...])` hitting the same endpoint), not two sequential calls.

## Background jobs (BullMQ)

- `holdExpiry` queue: on hold creation, enqueue a delayed job (`delay: HOLD_TTL_MS`). Job
  handler re-checks the hold's actual `expiresAt` and status before releasing the seat (don't
  blindly trust the job firing on time).
- `reconciliation` queue (stretch goal, §8 of spec): repeatable job scanning for holds in
  `payment_attempted` / ambiguous state older than some threshold, resolving them safely
  (release seat or finalize booking based on actual Stripe state).

## Stripe integration

- Use Stripe test mode and the Stripe CLI (`stripe listen`, `stripe trigger
payment_intent.succeeded`) to simulate webhooks locally.
- Webhook endpoint must verify the Stripe signature before processing anything, and must consume
  the **raw** request body (don't let a global JSON body-parser touch the webhook route first).
- Test duplicate delivery by triggering the same event twice (or replaying a captured payload)
  and asserting only one booking exists.
- Test late delivery by manually delaying the webhook call past the hold's `expiresAt` in a test
  and asserting correct fallback behaviour per rule #5 above.

## Logging (pino)

Every hold creation, hold expiry, payment webhook received, and booking finalisation should log
a structured entry including `holdId`, `seatId`, `userId`, and `stripePaymentIntentId` where
applicable. This is the trace a support agent would use to answer "I paid and got nothing" — if
you can't reconstruct that story from the logs alone, add more logging.

## API surface (suggested — adjust freely, requirements are the spec, not the routes)

```
GET    /events                        list events (paginated/filterable)
GET    /events/:id/seats              current availability (reflects holds, not just bookings)
POST   /events/:id/seats/:seatId/hold create a hold (auth required)
POST   /holds/:id/checkout            kick off Stripe PaymentIntent for a hold
POST   /webhooks/stripe               Stripe webhook receiver
GET    /me/bookings                   current user's own bookings
GET    /organiser/events/:id/bookings organiser's bookings for their own event only
```

## Testing priorities (in order)

1. Concurrent hold test — two simultaneous requests for the same seat, assert exactly one 201
   and one 409/conflict.
2. Duplicate webhook test — same payment confirmation delivered twice, assert one booking.
3. Authorization/IDOR tests — user A cannot read/act on user B's booking by ID; organiser A
   cannot see organiser B's event bookings.
4. Input validation tests — nonexistent seat, past event, missing auth, all rejected before
   business logic runs.
5. Hold expiry test — hold created, TTL elapses (or job runs), seat becomes available again with
   no intervention.
6. Late confirmation test — payment confirmed after hold expiry, system behaves per the
   documented rule (#5 above), not silently.

## Local development

- `docker compose up` must bring up the full stack (Express API, Postgres, Redis) with no manual
  setup beyond a documented `.env`.
- `.env.example` should list every required variable (DB connection string, Redis URL, Stripe
  keys, JWT secret, hold TTL).
- Prisma migrations run automatically on container start, or are documented as a one-line
  command if not.

## Things to avoid

- No application-level locks/mutexes for seat holds — they don't survive multiple server
  instances and don't reflect how this would run in production.
- No trusting BullMQ job timing as the sole expiry mechanism — always double-check `expiresAt`
  on read paths too.
- No global "isAdmin" shortcut for organiser checks — always scope by `organiserId ===
event.organiserId` on the specific record.
- No loading full seat/booking arrays into Node to compute counts — push that to SQL.
- No skipping Stripe signature verification, even in dev shortcuts that might get left in.
