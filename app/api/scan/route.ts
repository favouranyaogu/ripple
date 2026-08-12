import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { searchWeb, buildConsumerQuery } from '@/lib/search';
import { searchReddit } from '@/lib/platforms/reddit';
import { searchTwitter, X_COST_PER_READ, getXMaxResults } from '@/lib/platforms/twitter';
import { searchBluesky } from '@/lib/platforms/bluesky';
import { getXDailyBudget } from '@/lib/budget';
import { timeRangeToWindow, canonicalTimeRange } from '@/lib/time';
import { clusterPosts, flagDuplicateIssues, PostSource } from '@/lib/ai';

let lastScanTime = 0;
const COOLDOWN_MS = 15000;

interface NewIssueResult {
  id: number;
  name: string;
  sentiment: { positive: number; negative: number; uncertain: number };
  postUrls: PostSource[];
}

interface PossibleDuplicate {
  newIssueName: string;
  existingIssueId: string;
  existingIssueName: string;
  reason: string;
}

interface ScanRequest {
  sessionId?: string;
  topic: string;
  type?: string;
  focus?: string;
  platforms: string[];
  // "guided" (default) expands the query with type/focus bias terms;
  // "free" sends the topic verbatim to every platform as a raw query.
  mode?: string;
  timeRange?: string;
  // Custom date range (YYYY-MM-DD) when timeRange === "custom".
  startDate?: string;
  endDate?: string;
}

interface TypeBias {
  // focus keyword (lowercased substring) → extra bias terms
  byFocus: Record<string, string[]>;
  // terms used when focus is empty or doesn't match any keyword
  default: string[];
}

/**
 * Query-expansion map keyed by Monitor Type. Each Type maps focus keywords to
 * bias terms that broaden the web search. These terms only bias the search
 * query — they are never used as issue categories. Clustering runs freely on
 * whatever results come back.
 */
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

/**
 * Builds the expanded search query from topic + optional type/focus.
 * - Auto Detect (or no type): plain topic + focus terms.
 * - Type set: append type bias terms (focus-matched, or the type's default).
 * - No focus: broad scan on topic plus type bias terms only.
 */
function buildExpandedQuery(topic: string, type?: string, focus?: string): string {
  const parts: string[] = [topic.trim()];
  const normalizedType = type?.trim();
  // Focus may be a comma-separated list (e.g. "bugs, complaints") — each term
  // contributes its own bias terms and is added to the query literally.
  const focusTerms = (focus ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const focusLower = focusTerms.join(' ').toLowerCase();

  if (normalizedType && normalizedType !== 'Auto Detect') {
    const bias = TYPE_BIAS_TERMS[normalizedType];
    if (bias) {
      const matchedKeys = focusLower
        ? Object.keys(bias.byFocus).filter(key => focusLower.includes(key))
        : [];
      const terms = matchedKeys.length > 0
        ? Array.from(new Set(matchedKeys.flatMap(key => bias.byFocus[key])))
        : bias.default;
      parts.push(...terms);
    }
  }

  parts.push(...focusTerms);

  return parts.join(' ');
}

export async function POST(request: NextRequest) {
  try {
    const now = Date.now();
    if (now - lastScanTime < COOLDOWN_MS) {
      return NextResponse.json(
        { error: "Please wait a moment before running another scan/query." },
        { status: 429 }
      );
    }
    lastScanTime = now;

    let body: ScanRequest;
    try {
      body = await request.json() as ScanRequest;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { topic, type, focus, platforms, mode, timeRange, startDate, endDate } = body;
    let sessionId = body.sessionId;

    if (!topic || !Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json(
        { error: 'topic and platforms parameters are required' },
        { status: 400 }
      );
    }

    // Free search sends the topic verbatim to every platform — no type/focus
    // bias terms, no "reviews OR complaints…" modifiers. Gemini still clusters
    // whatever themes emerge. In this mode type/focus are ignored entirely.
    const isFree = mode === 'free';
    const effectiveType = isFree ? undefined : type;
    const effectiveFocus = isFree ? undefined : focus;
    // Time window (e.g. "7d" or a custom start/end) — resolved once and passed
    // to each platform so every channel respects the same period. The canonical
    // string is stored on the scan so it can be re-run with the exact window.
    const window = timeRangeToWindow(timeRange, startDate, endDate);
    const storedTimeRange = canonicalTimeRange(timeRange, startDate, endDate);

    // 1. Create or verify session
    if (!sessionId) {
      const sessionResult = await sql`
        INSERT INTO sessions (topic, community, project, type, focus, platforms)
        VALUES (${topic}, '', '', ${effectiveType ?? null}, ${effectiveFocus ?? null}, ${platforms})
        RETURNING id
      `;
      sessionId = String(sessionResult[0].id);
    }

    // 2. Search across selected platforms. A platform is skipped (and noted in
    //    the response) when its required env keys are missing, instead of
    //    failing the whole scan. Results from all available platforms are merged.
    const expandedQuery = isFree
      ? topic.trim()
      : buildExpandedQuery(topic, effectiveType, effectiveFocus);
    const searchQuery = isFree ? topic.trim() : buildConsumerQuery(expandedQuery);

    const skippedPlatforms: (string | { platform: string; reason: string })[] = [];
    const availablePlatforms: string[] = [];

    for (const platform of platforms) {
      switch (platform) {
        case 'web':
          availablePlatforms.push('web');
          break;
        case 'reddit':
          if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
            availablePlatforms.push('reddit');
          } else {
            skippedPlatforms.push('reddit');
          }
          break;
        case 'twitter':
          if (process.env.TWITTER_BEARER_TOKEN) {
            // Before calling the X API, check today's cumulative spend against
            // X_DAILY_BUDGET. If today's spend plus this scan's projected cost
            // (max_results * 0.005) would exceed the budget, skip X the same
            // way a missing API key would, with a "daily budget reached" reason.
            const dailyBudget = await getXDailyBudget();
            const todayRows = await sql`
              SELECT COALESCE(SUM(estimated_cost), 0) AS spent
              FROM x_usage
              WHERE date = CURRENT_DATE
            `;
            const spentToday = Number(todayRows[0]?.spent ?? 0);
            const projectedCost = getXMaxResults() * X_COST_PER_READ;
            if (spentToday + projectedCost > dailyBudget) {
              skippedPlatforms.push({ platform: 'twitter', reason: 'daily budget reached' });
              break;
            }
            availablePlatforms.push('twitter');
          } else {
            skippedPlatforms.push('twitter');
          }
          break;
        case 'bluesky':
          if (process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD) {
            availablePlatforms.push('bluesky');
          } else {
            skippedPlatforms.push('bluesky');
          }
          break;
        default:
          skippedPlatforms.push(platform);
      }
    }

    const searchPromises: Promise<{ results: { title: string; url: string; content: string }[] }>[] = [];
    if (availablePlatforms.includes('web')) searchPromises.push(searchWeb(searchQuery, window));
    if (availablePlatforms.includes('reddit')) searchPromises.push(searchReddit(searchQuery, window));
    if (availablePlatforms.includes('twitter')) searchPromises.push(searchTwitter(searchQuery, window));
    // Bluesky's full-text search ANDs every term, so the long Tavily-style query
    // (with "OR" modifiers, "forum", "reddit"...) returns zero posts. Give it
    // just the topic — Gemini clusters/filters the results anyway.
    if (availablePlatforms.includes('bluesky')) searchPromises.push(searchBluesky(topic.trim(), window));

    const searchResults = (await Promise.all(searchPromises)).flatMap(r => r.results);

    // No results from any available platform (e.g. every selected platform was
    // skipped for missing keys): return cleanly instead of running AI on nothing.
    // The scan is still recorded in history exactly once (a failure to record
    // must never fail the scan itself).
    if (searchResults.length === 0) {
      try {
        await sql`
          INSERT INTO scans (session_id, topic, type, focus, platforms, available_platforms, skipped_platforms, result_count, new_issue_count, time_range)
          VALUES (${sessionId}, ${topic}, ${effectiveType ?? null}, ${effectiveFocus ?? null}, ${platforms}, ${availablePlatforms}, ${JSON.stringify(skippedPlatforms)}::jsonb, 0, 0, ${storedTimeRange})
        `;
      } catch (err) {
        console.error('Failed to record scan history:', err);
      }
      return NextResponse.json({
        sessionId,
        newIssues: [],
        possibleDuplicates: [],
        skippedPlatforms,
      });
    }

    // Map search results to Post format
    const searchPosts = searchResults.map(r => {
      const url = r.url;
      let platform = 'web';
      if (url.includes('reddit.com')) platform = 'reddit';
      else if (url.includes('x.com') || url.includes('twitter.com')) platform = 'x';
      else if (url.includes('youtube.com')) platform = 'youtube';
      else if (url.includes('github.com')) platform = 'github';
      else if (url.includes('bsky.app')) platform = 'bluesky';

      return {
        content: `${r.title}\n${r.content}`,
        platform,
        url,
      };
    });

    // 3. Cluster posts into emergent issues using Gemini.
    //    Type/Focus only biased the search query - they are deliberately NOT
    //    passed into clustering, so clustering runs freely on what comes back.
    //    If the AI service is unreachable, degrade gracefully: return the raw
    //    search results with aiUnavailable=true instead of failing the scan.
    let clusterIssues: Awaited<ReturnType<typeof clusterPosts>>['issues'] = [];
    let aiUnavailable = false;
    try {
      const clusterResult = await clusterPosts(searchPosts, {
        topic,
        community: '',
        project: '',
      });
      clusterIssues = clusterResult.issues;
    } catch (err) {
      console.error('[/api/scan] AI clustering unavailable — returning raw results:', err);
      aiUnavailable = true;
    }

    // 4. Retrieve existing open issues
    const existingIssues = (await sql`
      SELECT id::text as id, name FROM issues
      WHERE session_id = ${sessionId} AND expires_at > NOW()
    `) as { id: string; name: string }[];

    // 5. Flag duplicates using Gemini (skipped when AI is unavailable)
    const newIssueNames = clusterIssues.map(i => ({ name: i.name }));
    const duplicates: { newIssueName: string; existingIssueId: string; existingIssueName: string; reason: string }[] =
      aiUnavailable || newIssueNames.length === 0
        ? []
        : ((await flagDuplicateIssues(existingIssues, newIssueNames)).duplicates || []);

    const newIssues: NewIssueResult[] = [];
    const possibleDuplicates: PossibleDuplicate[] = [];

    // 6. Process each clustered issue
    for (const issue of clusterIssues) {
      const duplicateMatch = duplicates.find(
        d => d.newIssueName.toLowerCase() === issue.name.toLowerCase()
      );

      if (duplicateMatch) {
        possibleDuplicates.push({
          newIssueName: issue.name,
          existingIssueId: duplicateMatch.existingIssueId,
          existingIssueName: duplicateMatch.existingIssueName,
          reason: duplicateMatch.reason,
        });
      } else {
        // Insert new issue
        const issueResult = await sql`
          INSERT INTO issues (session_id, name, sentiment_positive, sentiment_negative, sentiment_uncertain, first_seen, expires_at)
           VALUES (${sessionId}, ${issue.name}, ${issue.sentiment.positive}, ${issue.sentiment.negative}, ${issue.sentiment.uncertain}, NOW(), NOW() + INTERVAL '48 hours')
          RETURNING id
        `;
        const issueId = issueResult[0].id;

        // Insert posts associated with this issue
        for (const postSource of issue.postUrls) {
          const matchedPost = searchPosts.find(p => p.url === postSource.url);
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

    try {
      await sql`
        INSERT INTO scans (session_id, topic, type, focus, platforms, available_platforms, skipped_platforms, result_count, new_issue_count, time_range)
        VALUES (${sessionId}, ${topic}, ${effectiveType ?? null}, ${effectiveFocus ?? null}, ${platforms}, ${availablePlatforms}, ${JSON.stringify(skippedPlatforms)}::jsonb, ${searchResults.length}, ${newIssues.length}, ${storedTimeRange})
      `;
    } catch (err) {
      console.error('Failed to record scan history:', err);
    }

    return NextResponse.json({
      sessionId,
      newIssues,
      possibleDuplicates,
      skippedPlatforms,
      // Present only when the AI clustering step failed (Gemini unreachable):
      // the raw search results so the scan still delivers something useful.
      ...(aiUnavailable ? { aiUnavailable: true as const, rawResults: searchResults } : {}),
    });
  } catch (error) {
    console.error('Error in /api/scan:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
