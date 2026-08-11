import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { searchWeb, buildConsumerQuery } from '@/lib/search';
import { searchReddit } from '@/lib/platforms/reddit';
import { searchTwitter, X_COST_PER_READ, getXMaxResults } from '@/lib/platforms/twitter';
import { searchBluesky } from '@/lib/platforms/bluesky';
import { getXDailyBudget } from '@/lib/budget';
import { clusterPosts, flagDuplicateIssues, PostItem } from '@/lib/ai';

const MAX_SUB_TARGETS = 25;
const MAX_DELAY_SECONDS = 120;
const DEFAULT_DELAY_SECONDS = 30;

// ---------------------------------------------------------------------------
// Query expansion — replicated from /api/scan (route files can't share helpers
// without extracting them, and this route must stay self-contained).
// ---------------------------------------------------------------------------
interface TypeBias {
  byFocus: Record<string, string[]>;
  default: string[];
}

const TYPE_BIAS_TERMS: Record<string, TypeBias> = {
  'Brand/Company': {
    byFocus: {
      security: ['hack', 'breach', 'data leak', 'vulnerability'],
      bugs: ['bug', 'error', 'outage', 'not working'],
      complaint: ['complaint', 'support', 'defect', 'refund', 'customer service'],
      pricing: ['price', 'pricing', 'cost', 'subscription fee'],
    },
    default: ['complaint', 'support', 'defect', 'refund'],
  },
  'Product': {
    byFocus: {
      security: ['hack', 'breach', 'vulnerability', 'data leak'],
      bugs: ['bug', 'crash', 'error', 'not working', 'glitch'],
      complaint: ['complaint', 'defect', 'refund', 'warranty'],
      pricing: ['price', 'pricing', 'cost', 'value for money'],
      quality: ['quality', 'build quality', 'durability', 'defective'],
    },
    default: ['review', 'complaint', 'defect', 'bug'],
  },
  'Crypto Project': {
    byFocus: {
      security: ['hack', 'exploit', 'vulnerability', 'audit', 'phishing', 'wallet drain'],
      bugs: ['bug', 'crash', 'sync issue', 'failed transaction', 'not working'],
      complaint: ['complaint', 'support', 'scam', 'rug pull', 'refund'],
      pricing: ['price', 'token price', 'market cap', 'whale'],
    },
    default: ['hack', 'scam', 'rug pull', 'vulnerability'],
  },
  'Wallet': {
    byFocus: {
      bugs: ['bug', 'crash', 'sync issue', 'failed transaction', 'not working'],
      security: ['hack', 'phishing', 'wallet drain', 'private key', 'exploit'],
      complaint: ['complaint', 'support', 'lost funds', 'refund'],
    },
    default: ['bug', 'crash', 'sync issue', 'failed transaction', 'not working'],
  },
  'Blockchain': {
    byFocus: {
      security: ['hack', 'exploit', 'vulnerability', '51% attack', 'audit'],
      bugs: ['bug', 'downtime', 'network issue', 'congestion', 'not working'],
      complaint: ['complaint', 'support', 'downtime', 'scam'],
      pricing: ['price', 'gas fee', 'transaction fee', 'market'],
    },
    default: ['downtime', 'security', 'exploit', 'congestion'],
  },
  'Exchange': {
    byFocus: {
      security: ['hack', 'breach', 'withdrawal freeze', 'exploit'],
      bugs: ['bug', 'crash', 'withdrawal issue', 'order issue', 'not working'],
      complaint: ['complaint', 'support', 'frozen funds', 'withdrawal', 'scam'],
      pricing: ['fee', 'spread', 'price', 'fees'],
    },
    default: ['withdrawal', 'support', 'complaint', 'hack'],
  },
  'Website/Platform': {
    byFocus: {
      security: ['hack', 'breach', 'data leak', 'phishing'],
      bugs: ['bug', 'downtime', 'error', 'not working', 'crash'],
      complaint: ['complaint', 'support', 'account banned', 'refund'],
      pricing: ['price', 'pricing', 'subscription', 'cost'],
    },
    default: ['downtime', 'bug', 'complaint', 'review'],
  },
  'Person': {
    byFocus: {
      reputation: ['scandal', 'controversy', 'lawsuit', 'reputation'],
      complaint: ['complaint', 'lawsuit', 'accusation', 'criticism'],
      credibility: ['credibility', 'fraud', 'scam', 'lie'],
    },
    default: ['scandal', 'controversy', 'complaint', 'lawsuit'],
  },
  'Organization': {
    byFocus: {
      security: ['breach', 'data leak', 'hack', 'vulnerability'],
      complaint: ['complaint', 'lawsuit', 'misconduct', 'scandal'],
      reputation: ['reputation', 'controversy', 'scandal', 'news'],
    },
    default: ['complaint', 'scandal', 'lawsuit', 'controversy'],
  },
  'Market/Industry': {
    byFocus: {
      security: ['hack', 'breach', 'vulnerability', 'regulation'],
      bugs: ['bug', 'outage', 'disruption', 'not working'],
      complaint: ['complaint', 'regulatory action', 'lawsuit', 'fraud'],
      pricing: ['price', 'pricing', 'inflation', 'cost'],
      development: ['development', 'growth', 'trend', 'news'],
      sentiment: ['sentiment', 'confidence', 'outlook', 'mood'],
    },
    default: ['price', 'development', 'sentiment', 'trend', 'news'],
  },
  'Location': {
    byFocus: {
      safety: ['crime', 'safety', 'incident', 'danger'],
      complaint: ['complaint', 'problem', 'scam', 'tourist trap'],
      development: ['development', 'infrastructure', 'project', 'investment'],
    },
    default: ['development', 'news', 'safety', 'investment'],
  },
  'Other': {
    byFocus: {
      security: ['hack', 'breach', 'vulnerability'],
      bugs: ['bug', 'error', 'not working'],
      complaint: ['complaint', 'problem', 'issue', 'support'],
    },
    default: ['problem', 'complaint', 'issue'],
  },
};

function buildExpandedQuery(topic: string, type?: string, focus?: string): string {
  const parts: string[] = [topic.trim()];
  const normalizedType = type?.trim();
  const focusLower = (focus ?? '').toLowerCase().trim();

  if (normalizedType && normalizedType !== 'Auto Detect') {
    const bias = TYPE_BIAS_TERMS[normalizedType];
    if (bias) {
      const matchedKeys = Object.keys(bias.byFocus).filter((key) =>
        focusLower ? focusLower.includes(key) : false
      );
      const terms =
        matchedKeys.length > 0 ? matchedKeys.flatMap((key) => bias.byFocus[key]) : bias.default;
      parts.push(...terms);
    }
  }

  if (focus?.trim()) {
    parts.push(focus.trim());
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Per-platform availability (mirrors /api/scan's key checks).
// ---------------------------------------------------------------------------
function resolvePlatforms(platforms: string[]): {
  available: string[];
  skipped: (string | { platform: string; reason: string })[];
} {
  const available: string[] = [];
  const skipped: (string | { platform: string; reason: string })[] = [];

  for (const platform of platforms) {
    switch (platform) {
      case 'web':
        available.push('web');
        break;
      case 'reddit':
        if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
          available.push('reddit');
        } else {
          skipped.push('reddit');
        }
        break;
      case 'twitter':
        if (process.env.TWITTER_BEARER_TOKEN) {
          available.push('twitter');
        } else {
          skipped.push('twitter');
        }
        break;
      case 'bluesky':
        if (process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD) {
          available.push('bluesky');
        } else {
          skipped.push('bluesky');
        }
        break;
      default:
        skipped.push(platform);
    }
  }

  return { available, skipped };
}

async function getTodayXSpend(): Promise<number> {
  const rows = await sql`
    SELECT COALESCE(SUM(estimated_cost), 0) AS spent
    FROM x_usage
    WHERE date = CURRENT_DATE
  `;
  return Number(rows[0]?.spent ?? 0);
}

interface SingleScanResult {
  resultCount: number;
  newIssues: {
    id: number | string;
    name: string;
    sentiment: { positive: number; negative: number; uncertain: number };
    postUrls: { url: string; excerpt: string }[];
  }[];
  possibleDuplicates: {
    name: string;
    sentiment: { positive: number; negative: number; uncertain: number };
    postUrls: { url: string; excerpt: string }[];
    duplicateOf: { id: string; name: string; reason: string };
  }[];
  skippedPlatforms: (string | { platform: string; reason: string })[];
}

/**
 * Runs the same per-scan pipeline as POST /api/scan (query expansion, platform
 * searches, AI clustering, duplicate flagging, issue/post persistence, scan
 * history) but scoped to a single sub-target as the focus.
 */
async function runSingleScan(opts: {
  sessionId: string;
  topic: string;
  type?: string;
  focus: string;
  platforms: string[];
  availablePlatforms: string[];
  baseSkipped: (string | { platform: string; reason: string })[];
}): Promise<SingleScanResult> {
  const { sessionId, topic, type, focus, platforms, availablePlatforms, baseSkipped } = opts;

  const expandedQuery = buildExpandedQuery(topic, type, focus);
  const searchQuery = buildConsumerQuery(expandedQuery);

  const skippedPlatforms = [...baseSkipped];
  const searchPromises: Promise<{ results: { title: string; url: string; content: string }[] }>[] = [];
  if (availablePlatforms.includes('web')) searchPromises.push(searchWeb(searchQuery));
  if (availablePlatforms.includes('reddit')) searchPromises.push(searchReddit(searchQuery));
  if (availablePlatforms.includes('twitter')) searchPromises.push(searchTwitter(searchQuery));
  if (availablePlatforms.includes('bluesky')) searchPromises.push(searchBluesky(searchQuery));

  const searchResults = (await Promise.all(searchPromises)).flatMap((r) => r.results);

  // Map search results to Post format (same heuristics as /api/scan)
  const searchPosts: PostItem[] = searchResults.map((r) => {
    const url = r.url;
    let platform = 'web';
    if (url.includes('reddit.com')) platform = 'reddit';
    else if (url.includes('x.com') || url.includes('twitter.com')) platform = 'x';
    else if (url.includes('youtube.com')) platform = 'youtube';
    else if (url.includes('github.com')) platform = 'github';

    return {
      content: `${r.title}\n${r.content}`,
      platform,
      url,
    };
  });

  const newIssues: SingleScanResult['newIssues'] = [];
  const possibleDuplicates: SingleScanResult['possibleDuplicates'] = [];

  if (searchResults.length > 0) {
    const clusterResult = await clusterPosts(searchPosts, { topic, community: '', project: '' });

    const existingIssues = (await sql`
      SELECT id::text as id, name FROM issues
      WHERE session_id = ${sessionId} AND expires_at > NOW()
    `) as { id: string; name: string }[];

    const newIssueNames = clusterResult.issues.map((i) => ({ name: i.name }));
    const duplicates =
      newIssueNames.length > 0
        ? (await flagDuplicateIssues(existingIssues, newIssueNames)).duplicates || []
        : [];

    for (const issue of clusterResult.issues) {
      const duplicateMatch = duplicates.find(
        (d) => d.newIssueName.toLowerCase() === issue.name.toLowerCase()
      );

      if (duplicateMatch) {
        possibleDuplicates.push({
          name: issue.name,
          sentiment: issue.sentiment,
          postUrls: issue.postUrls,
          duplicateOf: {
            id: duplicateMatch.existingIssueId,
            name: duplicateMatch.existingIssueName,
            reason: duplicateMatch.reason,
          },
        });
      } else {
        const issueResult = await sql`
          INSERT INTO issues (session_id, name, sentiment_positive, sentiment_negative, sentiment_uncertain, first_seen, expires_at)
          VALUES (${sessionId}, ${issue.name}, ${issue.sentiment.positive}, ${issue.sentiment.negative}, ${issue.sentiment.uncertain}, NOW(), NOW() + INTERVAL '48 hours')
          RETURNING id
        `;
        const issueId = issueResult[0].id;

        for (const postSource of issue.postUrls) {
          const matchedPost = searchPosts.find((p) => p.url === postSource.url);
          if (matchedPost) {
            await sql`
              INSERT INTO posts (issue_id, content, platform, url, posted_at)
              VALUES (${issueId}, ${matchedPost.content}, ${matchedPost.platform}, ${matchedPost.url}, NOW())
            `;
          }
        }

        newIssues.push({
          id: issueId,
          name: issue.name,
          sentiment: issue.sentiment,
          postUrls: issue.postUrls,
        });
      }
    }
  }

  // Record the scan in history (failure to record must not fail the scan).
  try {
    await sql`
      INSERT INTO scans (session_id, topic, type, focus, platforms, available_platforms, skipped_platforms, result_count, new_issue_count)
      VALUES (${sessionId}, ${topic}, ${type ?? null}, ${focus}, ${platforms}, ${availablePlatforms}, ${JSON.stringify(skippedPlatforms)}::jsonb, ${searchResults.length}, ${newIssues.length})
    `;
  } catch (err) {
    console.error('Failed to record batch scan history:', err);
  }

  return {
    resultCount: searchResults.length,
    newIssues,
    possibleDuplicates,
    skippedPlatforms,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POST /api/batch-scan
 * Body: { topic, type?, subTargets: string[], platforms: string[], delaySeconds? }
 *
 * Streams NDJSON events, one per line:
 *   {"type":"start", ...}
 *   {"type":"progress","index":i,"total":n,"subTarget":"..."}   before each scan
 *   {"type":"result","index":i,...,"newIssues":[...],"possibleDuplicates":[...]}
 *   {"type":"skipped","index":i,"subTarget":"...","reason":"daily budget reached"}
 *   {"type":"error","index":i,"subTarget":"...","error":"..."}
 *   {"type":"done","total":n,"completed":c,"skipped":s,"failed":f}
 *
 * Respects the X daily budget across the whole batch: if the cap is hit
 * partway through, the remaining sub-targets are skipped (reported as
 * "daily budget reached") instead of being run.
 */
export async function POST(request: NextRequest) {
  let body: {
    topic?: unknown;
    type?: unknown;
    subTargets?: unknown;
    platforms?: unknown;
    delaySeconds?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const type = typeof body.type === 'string' ? body.type.trim() : undefined;
  const rawTargets = Array.isArray(body.subTargets)
    ? body.subTargets.filter((t): t is string => typeof t === 'string').map((t) => t.trim())
    : [];
  const subTargets = rawTargets.filter(Boolean).slice(0, MAX_SUB_TARGETS);
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter((p): p is string => typeof p === 'string')
    : [];
  const delaySeconds = Number(body.delaySeconds);
  const delay = Number.isFinite(delaySeconds) && delaySeconds >= 0
    ? Math.min(delaySeconds, MAX_DELAY_SECONDS)
    : DEFAULT_DELAY_SECONDS;

  if (!topic || subTargets.length === 0 || platforms.length === 0) {
    return new Response(
      JSON.stringify({ error: 'topic, subTargets, and platforms are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (subTargets.some((t) => t.length > 160)) {
    return new Response(
      JSON.stringify({ error: 'Each sub-target must be 160 characters or fewer' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          // Client disconnected — stop emitting; remaining work is best-effort.
        }
      };

      try {
        const total = subTargets.length;
        const { available, skipped: baseSkipped } = resolvePlatforms(platforms);

        send({ type: 'start', total, topic, subTargets, platforms, delaySeconds: delay });

        // One session for the whole batch so issues accumulate and dedupe.
        const sessionResult = await sql`
          INSERT INTO sessions (topic, community, project, type, focus, platforms)
          VALUES (${topic}, '', '', ${type ?? null}, null, ${platforms})
          RETURNING id
        `;
        const sessionId = String(sessionResult[0].id);

        let completed = 0;
        let skipped = 0;
        let failed = 0;

        for (let i = 0; i < total; i++) {
          const subTarget = subTargets[i];
          send({ type: 'progress', index: i, total, subTarget });

          // Enforce the X daily budget BEFORE running: if today's spend plus
          // this scan's projected cost exceeds the cap, skip this and all
          // remaining sub-targets rather than running them anyway.
          if (available.includes('twitter')) {
            const budget = await getXDailyBudget();
            const spentToday = await getTodayXSpend();
            const projectedCost = getXMaxResults() * X_COST_PER_READ;
            if (spentToday + projectedCost > budget) {
              for (let j = i; j < total; j++) {
                skipped++;
                send({
                  type: 'skipped',
                  index: j,
                  total,
                  subTarget: subTargets[j],
                  reason: 'daily budget reached',
                });
              }
              break;
            }
          }

          try {
            const result = await runSingleScan({
              sessionId,
              topic,
              type,
              focus: subTarget,
              platforms,
              availablePlatforms: available,
              baseSkipped,
            });
            completed++;
            send({
              type: 'result',
              index: i,
              total,
              subTarget,
              resultCount: result.resultCount,
              newIssueCount: result.newIssues.length,
              duplicateCount: result.possibleDuplicates.length,
              skippedPlatforms: result.skippedPlatforms,
              newIssues: result.newIssues,
              possibleDuplicates: result.possibleDuplicates,
            });
          } catch (err) {
            failed++;
            const message = err instanceof Error ? err.message : 'Scan failed';
            console.error(`[batch-scan] sub-target "${subTarget}" failed:`, err);
            send({ type: 'error', index: i, total, subTarget, error: message });
          }

          // Pause between sub-targets (never after the last one).
          if (delay > 0 && i < total - 1) {
            await sleep(delay * 1000);
          }
        }

        send({ type: 'done', total, completed, skipped, failed });
      } catch (err) {
        console.error('[batch-scan] fatal:', err);
        send({
          type: 'done',
          total: subTargets.length,
          completed: 0,
          skipped: 0,
          failed: 1,
          fatal: err instanceof Error ? err.message : 'Batch failed',
        });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed / client gone.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
