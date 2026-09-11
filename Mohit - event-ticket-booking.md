# POC: Event Ticket Booking

**Track:** Commerce · **Status:** Required · **Path:** React to Full Stack — 101 (2-week solo POC)
**Stack:** Express or Next.js (engineer's choice) · PostgreSQL · Prisma

## 1. Background

Two people buy the same seat because nothing actually reserves it while the first person is
paying, and abandoned checkouts leave half-created bookings that nobody ever cleans up. By the
time someone notices, the event is oversold and support is refunding people manually.

You're building the booking system that fixes this: users browse events, pick a seat or slot,
and complete payment against a hold that only one of them can win. A payment provider is a
supplied dependency here, not something you build — treat it as a black box that eventually
tells you success or failure, sometimes late, sometimes twice.

This POC's centre of gravity is **what happens around the payment, not the payment itself** —
the seat hold, its expiry, and reconciling a booking with a payment outcome that can arrive
late, arrive twice, or never arrive at all.

## 2. Actors

| Role          | Can do                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------- |
| **User**      | Browse events, view availability, hold a seat, complete payment, view own bookings        |
| **Organiser** | Create/manage their own events and seat inventory, view all bookings for their own events |

## 3. Functional requirements

### 3.1 Event catalogue and availability

- Events have a name, date, venue, and a set of seats or slots with a status (available, held,
  booked).
- Users can see current availability before starting checkout — this must reflect held seats,
  not just booked ones.

### 3.2 Selecting and holding a seat

- A user selects a seat or slot and proceeds to checkout.
- The selected seat is held for a limited period while payment is completed; it is not
  available to anyone else during the hold.
- **Two people selecting the same seat at the same moment must not both succeed** — exactly one
  hold is created, the other request is told the seat is unavailable.

### 3.3 Hold expiry

- A hold that is not converted into a paid booking within its window expires and the seat
  becomes bookable again automatically, with no manual intervention.
- Decide how expiry is enforced — a background job, a check performed on read, or something
  else — and be ready to explain what breaks with your choice under load.

### 3.4 Payment and booking finalisation

- Payment is confirmed by the payment provider before the booking is finalised.
- **A failed or abandoned payment must leave no partial booking behind** — the seat returns to
  available (or expires normally), and there is no half-created record a user or organiser could
  stumble on.
- The provider's confirmation can arrive late relative to the hold expiring, or arrive more than
  once for the same attempt (a duplicate webhook). Your reconciliation logic has to handle both
  without double-booking or double-confirming.

### 3.5 Confirmation

- On successful payment, the booking is finalised and a confirmation with a unique ticket
  reference is issued.
- The ticket reference must be safe to show a user immediately, even if it arrived via a
  slightly delayed confirmation.

### 3.6 Visibility

- Users see only their own bookings.
- Organisers see all bookings for events they created, never another organiser's events.

## 4. Data to think through

You choose the exact schema. At minimum, your model needs to represent: events, their seats or
slots and each one's current state, a hold with its owner and expiry, a booking that is only
created once payment is confirmed, and enough of a payment-attempt record to recognise a
duplicate or late confirmation when it arrives.

The question worth sitting with before you write any code: at the moment a payment provider
confirms success, how do you decide — reliably, and exactly once — whether to finalise a
booking, treat the confirmation as a duplicate, or reject it because the hold already expired?
There's more than one legitimate way to model that decision; pick one and be ready to defend it
against the case where the confirmation is late, and the case where it arrives twice.

## 5. How it's exposed

Design the API surface — routes, methods, request/response shapes — however fits the workflow
above. There's no prescribed structure here; the requirements in §3 are the spec, not a
particular set of endpoints.

## 6. Things this POC will specifically be checked for

- Bad input — a seat that doesn't exist, an event that's already passed, a hold request with no
  authenticated user — should be rejected before it reaches your business logic.
- There's no anonymous path through this system; every hold, payment, and booking is tied to a
  real, authenticated user.
- A user can view or act on only their own bookings, and an organiser only their own events'
  bookings — including if either tries to reach someone else's record directly by its ID. Prove
  this with a test, not a UI check.
- **The seat-hold guarantee (§3.2) is the single most important, sharpest test in this POC.**
  Have a test that fires two concurrent requests for the same seat and asserts exactly one
  succeeds — not two sequential requests that happen to look fine. Pair it with a test that
  replays the same payment confirmation twice and asserts the booking is finalised only once.
- Event and booking listings need to support filtering without loading every seat or booking
  into memory — think about how availability is computed as an event's seat count grows.
- Every hold, expiry, payment outcome, and booking finalisation should leave a structured trace
  — this is what you'd hand support when a user disputes "I paid and got nothing."
- The whole thing should come up with `docker compose up` and no manual setup beyond a
  documented `.env`.

## 7. Walkthrough questions to expect

NOTE: These are indicative questions only. Expect to be asked further questions in a similar
spirit during the walkthrough.

1. Availability shown to the user — does it include held seats? What does the user see?
2. How does a hold expire — a job, a timestamp checked on read, or something else? What breaks
   with each?
3. Two people select the same seat simultaneously. Walk me through both requests and prove only
   one gets it.

## 8. If you finish early (optional)

Don't add new features — deepen what's here:

- Simulate a payment confirmation arriving after the hold has already expired and show exactly
  what your system does with it.
- Add a reconciliation job that scans for holds stuck in an ambiguous state (payment attempted,
  no confirmation yet) and resolves them safely.
- Load-test seat selection at a simulated sold-out event with hundreds of concurrent hold
  attempts on the last few seats and show the guarantee still holds.
