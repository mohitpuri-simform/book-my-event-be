/**
 * An event is over once its `endDate` (the "Expires at" the organiser sets) has
 * passed. Ended events stay visible and editable, but can no longer be sold.
 */
export function hasEventEnded(event: { endDate: Date }, now: Date = new Date()): boolean {
  return event.endDate <= now;
}
