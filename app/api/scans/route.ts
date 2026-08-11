import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scans
 * Returns the most recent scans with their per-platform skip reasons, so the
 * monitor page can render a scan history timeline.
 */
export async function GET() {
  const rows = await sql`
    SELECT id, topic, type, focus, platforms, skipped_platforms, result_count, new_issue_count, created_at
    FROM scans
    ORDER BY created_at DESC
    LIMIT 10
  `;

  const scans = rows.map((r) => ({
    id: String(r.id),
    topic: r.topic,
    type: r.type ?? null,
    focus: r.focus ?? null,
    platforms: r.platforms ?? [],
    skipped: r.skipped_platforms ?? [],
    resultCount: Number(r.result_count),
    newIssueCount: Number(r.new_issue_count),
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
  }));

  return NextResponse.json({ scans });
}
