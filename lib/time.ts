/**
 * Time-range helpers shared by the scan routes and platform libraries.
 *
 * Every platform supports native time windows, so a scan can limit results to
 * a recent period (e.g. "last 7 days") instead of whatever the API defaults to.
 *
 * Two kinds of window are supported:
 *   - Presets ("24h", "7d", "30d", "all"): expressed as a number of days back
 *     from now.
 *   - Custom ranges: exact start/end dates (YYYY-MM-DD), passed to platforms
 *     that accept ISO timestamps (Bluesky, X) and converted to a day count for
 *     the ones that only take "last N days" (Tavily, Reddit).
 */
export const TIME_RANGE_OPTIONS = [
  { id: "all", label: "All time", short: "All", days: 0 },
  { id: "24h", label: "Last 24 hours", short: "24h", days: 1 },
  { id: "7d", label: "Last 7 days", short: "7d", days: 7 },
  { id: "30d", label: "Last 30 days", short: "30d", days: 30 },
  { id: "custom", label: "Custom range", short: "Custom", days: 0 },
] as const;

export type TimeRangeId = (typeof TIME_RANGE_OPTIONS)[number]["id"];

export const CUSTOM_RANGE_ID = "custom";

/** Max days for platforms that only support "last N days" (Tavily caps at 30). */
export const MAX_DAYS_TODAY = 365;

/**
 * The window a platform should search within. `days` is used by every platform
 * (as "last N days"); `since`/`until` are exact ISO timestamps for custom
 * ranges and are honored by platforms that accept them (Bluesky, X).
 */
export interface SearchWindow {
  days?: number;
  since?: string;
  until?: string;
}

const DAY_MS = 86_400_000;

/** ISO 8601 timestamp `days` days ago, as accepted by Bluesky/X/Reddit APIs. */
export function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** Today's date as YYYY-MM-DD (local time), for defaulting custom ranges. */
export function todayDateStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateToISO(dateStr: string, endOfDay: boolean): string {
  return new Date(`${dateStr}T${endOfDay ? "23:59:59" : "00:00:00"}`).toISOString();
}

/**
 * Resolves a scan request's time parameters into a platform SearchWindow.
 *   - `timeRange` is a preset id ("24h", "7d", "30d") or "custom".
 *   - For custom ranges, `startDate`/`endDate` are YYYY-MM-DD; endDate
 *     defaults to today when omitted.
 * Returns undefined for "all" (or unknown/empty input) so callers can skip the
 * platform's time parameter entirely.
 */
export function timeRangeToWindow(
  timeRange?: string | null,
  startDate?: string | null,
  endDate?: string | null
): SearchWindow | undefined {
  if (!timeRange) return undefined;
  if (timeRange === CUSTOM_RANGE_ID) {
    if (!startDate) return undefined;
    const end = endDate || todayDateStr();
    const startMs = Date.parse(`${startDate}T00:00:00`);
    const endMs = Date.parse(`${end}T00:00:00`);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return undefined;
    const days = Math.max(1, Math.round((endMs - startMs) / DAY_MS) + 1);
    return {
      days: Math.min(days, MAX_DAYS_TODAY),
      since: dateToISO(startDate, false),
      until: dateToISO(end, true),
    };
  }
  const opt = TIME_RANGE_OPTIONS.find((o) => o.id === timeRange);
  return opt && opt.days > 0 ? { days: opt.days } : undefined;
}

/**
 * Canonical string stored on a scan record so a scan can be re-run with the
 * exact same window later. Presets store their id; custom ranges store
 * "custom:YYYY-MM-DD:YYYY-MM-DD" (end date may be empty when it defaults to
 * today). Returns null when no window applies.
 */
export function canonicalTimeRange(
  timeRange?: string | null,
  startDate?: string | null,
  endDate?: string | null
): string | null {
  if (!timeRange) return null;
  if (timeRange === CUSTOM_RANGE_ID) {
    if (!startDate) return null;
    return `custom:${startDate}:${endDate || ""}`;
  }
  return TIME_RANGE_OPTIONS.some((o) => o.id === timeRange) ? timeRange : null;
}

/** Inverse of canonicalTimeRange — splits a stored value back into UI state. */
export function parseTimeRange(
  canonical: string | null
): { timeRange: TimeRangeId; startDate?: string; endDate?: string } {
  if (canonical && canonical.startsWith("custom:")) {
    const [, start, end] = canonical.split(":");
    return { timeRange: CUSTOM_RANGE_ID, startDate: start || undefined, endDate: end || undefined };
  }
  const id = TIME_RANGE_OPTIONS.some((o) => o.id === canonical) ? canonical : "all";
  return { timeRange: id as TimeRangeId };
}
