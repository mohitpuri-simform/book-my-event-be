export function formatDurationHuman(seconds: number): string {
  const roundedSeconds = Math.max(1, Math.ceil(seconds));

  if (roundedSeconds < 60) {
    return `${roundedSeconds} second${roundedSeconds === 1 ? "" : "s"}`;
  }

  const minutes = Math.ceil(roundedSeconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
