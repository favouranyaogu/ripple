import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';
// Per-scan results must reflect the DB as it is now (in some Next versions
// force-dynamic alone isn't enough).
export const fetchCache = 'force-no-store';

/**
 * GET /api/scans/:id
 * Returns one scan's full persisted results (clustered issues with their posts),
 * so past scans can be re-opened and reviewed from the history timeline.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  const scanRows = await sql`
    SELECT id, session_id, topic, type, focus, platforms, skipped_platforms, result_count, new_issue_count, created_at
    FROM scans
    WHERE id = ${id}
  `;

  if (scanRows.length === 0) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
  }

  const r = scanRows[0];
  const sessionId = String(r.session_id);

  const issueRows = await sql`
    SELECT id::text AS id, name, sentiment_positive, sentiment_negative, sentiment_uncertain, first_seen
    FROM issues
    WHERE session_id = ${sessionId}
    ORDER BY first_seen ASC
  `;

  const issues = await (async () => {
    if (issueRows.length === 0) return [];
    const issueIds = issueRows.map((i) => i.id);
    const postRows = await sql`
      SELECT issue_id, url, content
      FROM posts
      WHERE issue_id = ANY(${issueIds}::uuid[])
      ORDER BY created_at ASC
    `;
    return issueRows.map((i) => ({
      name: i.name,
      sentiment: {
        positive: Number(i.sentiment_positive),
        negative: Number(i.sentiment_negative),
        uncertain: Number(i.sentiment_uncertain),
      },
      firstSeen:
        i.first_seen != null
          ? typeof i.first_seen === 'string'
            ? i.first_seen
            : new Date(i.first_seen).toISOString()
          : undefined,
      postUrls: postRows
        .filter((p) => String(p.issue_id) === i.id)
        .map((p) => ({ url: p.url, excerpt: p.content ?? '' })),
    }));
  })();

  return NextResponse.json(
    {
      scan: {
        id: String(r.id),
        topic: r.topic,
        type: r.type ?? null,
        focus: r.focus ?? null,
        platforms: r.platforms ?? [],
        skipped: r.skipped_platforms ?? [],
        resultCount: Number(r.result_count),
        newIssueCount: Number(r.new_issue_count),
        createdAt:
          typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
      },
      issues,
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  );
}
