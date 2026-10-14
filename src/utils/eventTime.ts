const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Events are scheduled by calendar day in a fixed timezone (IST, UTC+05:30), and
 * stored as that day's date at 00:00 UTC. This is the date of "today in IST" in
 * the same form, so it compares directly with a stored `date`/`endDate`.
 * An event is only expired from the day *after* its `endDate`.
 */
export function expiryCutoff(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/**
 * An event is over once the day after its `endDate` has begun. Ended events stay
 * visible and editable, but can no longer be sold.
 */
export function hasEventEnded(event: { endDate: Date }, now: Date = new Date()): boolean {
  return event.endDate < expiryCutoff(now);
}
