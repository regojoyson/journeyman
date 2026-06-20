export type Frequency = "hourly" | "daily" | "weekly" | "monthly";

export interface ScheduleState {
  frequency: Frequency;
  /** "HH:MM" in 24-hour format. Unused for "hourly". */
  time: string;
  /** Day-of-week indices (0=Sun…6=Sat). Used for "weekly". */
  days: number[];
  /** Day-of-month (1–27 exact; 28 = last day). Used for "monthly". */
  dom: number;
}

export const DEFAULT_SCHEDULE: ScheduleState = {
  frequency: "daily",
  time: "09:00",
  days: [],
  dom: 1,
};

export function toCron(s: ScheduleState): string {
  const [hStr, mStr] = s.time.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  switch (s.frequency) {
    case "hourly":
      return "0 * * * *";
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly":
      return `${m} ${h} * * ${s.days.length === 0 ? "*" : s.days.join(",")}`;
    case "monthly":
      return `${m} ${h} ${s.dom} * *`;
  }
}

export function fromCron(cron: string): ScheduleState | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts;
  if (month !== "*") return null;

  // Hourly: "0 * * * *"
  if (minute === "0" && hour === "*" && dom === "*" && dow === "*") {
    return { frequency: "hourly", time: "00:00", days: [], dom: 1 };
  }

  // Minute and hour must be plain integers for all other frequencies.
  const m = parseInt(minute, 10);
  const h = parseInt(hour, 10);
  if (isNaN(m) || isNaN(h) || m < 0 || m > 59 || h < 0 || h > 23) return null;
  if (String(m) !== minute || String(h) !== hour) return null; // reject */n, ranges
  const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

  // Daily: "m h * * *"
  if (dom === "*" && dow === "*") {
    return { frequency: "daily", time, days: [], dom: 1 };
  }

  // Weekly: "m h * * dow[,dow…]" — reject ranges and wildcards in dow
  if (dom === "*" && dow !== "*") {
    if (dow.includes("-") || dow.includes("/")) return null;
    const days = dow.split(",").map(Number);
    if (days.some((d) => isNaN(d) || d < 0 || d > 6)) return null;
    return { frequency: "weekly", time, days: days.sort((a, b) => a - b), dom: 1 };
  }

  // Monthly: "m h dom * *" — single integer dom only
  if (dom !== "*" && dow === "*") {
    if (dom.includes("-") || dom.includes("/") || dom.includes(",")) return null;
    const d = parseInt(dom, 10);
    if (isNaN(d) || d < 1 || d > 28) return null;
    return { frequency: "monthly", time, days: [], dom: d };
  }

  return null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ordinalSuffix(n: number): string {
  if (n === 28) return "last day";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function summarizeCron(state: ScheduleState, timezone: string): string {
  const tzLabel = timezone ? ` · ${timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone}` : "";
  switch (state.frequency) {
    case "hourly":
      return `Every hour${tzLabel}`;
    case "daily":
      return `Every day at ${state.time}${tzLabel}`;
    case "weekly": {
      const dayStr =
        state.days.length === 0 ? "every day" : state.days.map((d) => DAY_NAMES[d]).join(", ");
      return `Every week on ${dayStr} at ${state.time}${tzLabel}`;
    }
    case "monthly":
      return `Every month on the ${ordinalSuffix(state.dom)} at ${state.time}${tzLabel}`;
  }
}
