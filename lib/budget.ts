import { sql } from '@/lib/db';

export const X_DEFAULT_DAILY_BUDGET = 3.0;
const SETTINGS_KEY = 'x_daily_budget';

/**
 * Resolves the effective X daily budget: an in-app override stored in the
 * `settings` table wins, otherwise the X_DAILY_BUDGET env var, otherwise the
 * default of $3.00. Falls back gracefully if the settings table doesn't exist.
 */
export async function getXDailyBudget(): Promise<number> {
  try {
    const rows = await sql`SELECT value FROM settings WHERE key = ${SETTINGS_KEY}`;
    if (rows.length > 0) {
      const v = Number(rows[0].value);
      if (Number.isFinite(v) && v > 0) return v;
    }
  } catch (err) {
    console.warn('settings table unavailable, falling back to env budget:', err);
  }

  const raw = Number(process.env.X_DAILY_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : X_DEFAULT_DAILY_BUDGET;
}

/** Persists an in-app budget override. Returns the stored value. */
export async function setXDailyBudget(budget: number): Promise<number> {
  const value = Math.round(budget * 100) / 100;
  await sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES (${SETTINGS_KEY}, ${String(value)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return value;
}
