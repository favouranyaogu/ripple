import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { X_COST_PER_READ, getXMaxResults } from '@/lib/platforms/twitter';
import { getXDailyBudget, setXDailyBudget } from '@/lib/budget';

// Always read env vars / settings at request time instead of baking values in at build time.
export const dynamic = 'force-dynamic';
// Usage/budget must reflect the DB and env as they are now (in some Next
// versions force-dynamic alone isn't enough).
export const fetchCache = 'force-no-store';

const MIN_BUDGET = 0.01;
const MAX_BUDGET = 1000;

async function buildUsagePayload() {
  const budget = await getXDailyBudget();
  const projectedCostPerScan = getXMaxResults() * X_COST_PER_READ;

  // Last 7 days including today, zero-filled so the chart is always complete.
  const rows = await sql`
    SELECT d::date AS date, COALESCE(x.reads_count, 0) AS reads_count, COALESCE(x.estimated_cost, 0) AS estimated_cost
    FROM generate_series(CURRENT_DATE - 6, CURRENT_DATE, '1 day'::interval) AS d
    LEFT JOIN x_usage x ON x.date = d::date
    ORDER BY d ASC
  `;

  const history = rows.map((r) => {
    const dateStr =
      typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10);
    return {
      date: dateStr,
      reads: Number(r.reads_count),
      cost: Number(r.estimated_cost),
    };
  });

  const spentToday = history.length > 0 ? history[history.length - 1].cost : 0;

  return {
    spentToday,
    budget,
    remaining: budget - spentToday,
    projectedCostPerScan,
    history,
  };
}

/**
 * GET /api/x-usage
 * Returns today's X API spend, the effective daily budget (in-app override or
 * X_DAILY_BUDGET env), the remaining amount, the projected cost of one scan,
 * and the last 7 days of usage history.
 */
export async function GET() {
  return NextResponse.json(await buildUsagePayload(), {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}

/**
 * PATCH /api/x-usage
 * Body: { budget: number }
 * Persists a new daily budget override (in USD) and returns the updated usage
 * payload. The scan route reads this same override when enforcing the cap.
 */
export async function PATCH(request: NextRequest) {
  let body: { budget?: unknown };
  try {
    body = (await request.json()) as { budget?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawBudget = Number(body.budget);
  if (!Number.isFinite(rawBudget) || rawBudget < MIN_BUDGET || rawBudget > MAX_BUDGET) {
    return NextResponse.json(
      { error: `budget must be a number between ${MIN_BUDGET} and ${MAX_BUDGET}` },
      { status: 400 }
    );
  }

  await setXDailyBudget(rawBudget);

  return NextResponse.json(await buildUsagePayload());
}
