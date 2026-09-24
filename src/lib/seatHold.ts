export interface SeatHoldValue {
  userId: string;
  holdId: string;
}

export function seatHoldKey(seatId: string): string {
  return `seat:${seatId}`;
}

export function parseSeatHoldValue(raw: string | null): SeatHoldValue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SeatHoldValue>;
    if (typeof parsed.userId !== "string" || typeof parsed.holdId !== "string") {
      return null;
    }
    return { userId: parsed.userId, holdId: parsed.holdId };
  } catch {
    return null;
  }
}
