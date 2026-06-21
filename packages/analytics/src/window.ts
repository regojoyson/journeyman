import type { AnalyticsWindow } from "@journeyman/core";

const HOURS: Record<AnalyticsWindow, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

/** Lower time bound for a window, relative to `now`. */
export function windowSince(window: AnalyticsWindow, now: Date): Date {
  return new Date(now.getTime() - HOURS[window] * 60 * 60 * 1000);
}

/** Parse a query string into a valid window, defaulting to "7d". */
export function parseWindow(raw: unknown): AnalyticsWindow {
  return raw === "24h" || raw === "30d" ? raw : "7d";
}
