/**
 * Human-friendly duration formatter for UI display.
 *
 *   < 60s        → "12.3s" / "0.5s"
 *   60s..1h      → "2m 5s" / "59m 1s"
 *   1h..24h      → "1h 5m" / "23h 59m"
 *   >= 24h       → "2d 3h"
 *
 * Returns "—" for null/undefined and "0s" for non-positive values.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms <= 0) return "0s";

  const totalSeconds = ms / 1000;

  if (totalSeconds < 60) {
    return totalSeconds < 10
      ? `${totalSeconds.toFixed(1)}s`
      : `${Math.round(totalSeconds)}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    const s = Math.round(totalSeconds - totalMinutes * 60);
    return s === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${s}s`;
  }

  const totalHours = Math.floor(totalMinutes / 60);

  if (totalHours < 24) {
    const m = totalMinutes - totalHours * 60;
    return m === 0 ? `${totalHours}h` : `${totalHours}h ${m}m`;
  }

  const totalDays = Math.floor(totalHours / 24);
  const h = totalHours - totalDays * 24;
  return h === 0 ? `${totalDays}d` : `${totalDays}d ${h}h`;
}
