import { sql } from '@/lib/db';
import { daysAgoISO, type SearchWindow } from '@/lib/time';

export interface PlatformSearchResult {
  title: string;
  url: string;
  content: string;
}

/** Estimated cost per resource returned by the X API, used for budget accounting. */
export const X_COST_PER_READ = 0.005;

// X API v2 "recent search" only accepts max_results between 10 and 100.
const X_MIN_RESULTS = 10;
const X_MAX_RESULTS = 100;
const X_DEFAULT_MAX_RESULTS = 20;

/**
 * Resolves the per-scan result cap from X_MAX_RESULTS_PER_SCAN (default 20),
 * clamped to the API's valid [10, 100] range so it is never unbounded.
 */
export function getXMaxResults(): number {
  const raw = Number(process.env.X_MAX_RESULTS_PER_SCAN);
  if (!Number.isFinite(raw)) return X_DEFAULT_MAX_RESULTS;
  return Math.min(X_MAX_RESULTS, Math.max(X_MIN_RESULTS, Math.floor(raw)));
}

/**
 * Searches Twitter/X via API v2 "recent search".
 * Requires a TWITTER_BEARER_TOKEN env var (app-only bearer token).
 * `window` (optional) limits results via `start_time`/`end_time`. Recent search
 * only indexes the last 7 days, so the start is clamped to at most 7 days back
 * — a longer window simply returns what the API can see.
 * Returns the same shape as searchWeb: { results: [{ title, url, content }] }.
 */
export async function searchTwitter(query: string, window?: SearchWindow): Promise<{ results: PlatformSearchResult[] }> {
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) {
    throw new Error('TWITTER_BEARER_TOKEN is not configured');
  }

  const params = new URLSearchParams({
    query,
    'max_results': String(getXMaxResults()),
    'tweet.fields': 'text,created_at',
    'expansions': 'author_id',
    'user.fields': 'username',
  });
  if (window) {
    if (window.since) {
      // X rejects start_time older than 7 days — clamp to what it can serve.
      const sinceMs = Date.parse(window.since);
      const sevenDaysAgo = Date.now() - 7 * 86_400_000;
      params.set('start_time', Number.isFinite(sinceMs) && sinceMs < sevenDaysAgo
        ? new Date(sevenDaysAgo).toISOString()
        : window.since);
    } else if (window.days && window.days > 0) {
      params.set('start_time', daysAgoISO(Math.min(window.days, 7)));
    }
    if (window.until) params.set('end_time', window.until);
  }

  const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params.toString()}`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  if (!res.ok) {
    throw new Error(`Twitter search failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    data?: { id: string; author_id?: string; text?: string }[];
    includes?: { users?: { id: string; username?: string }[] };
  };

  const usernamesById = new Map<string, string>(
    (data.includes?.users || []).map((u) => [u.id, u.username || ''])
  );

  const results: PlatformSearchResult[] = (data.data || []).map((tweet) => {
    const username = tweet.author_id ? usernamesById.get(tweet.author_id) || '' : '';
    const raw = tweet.text || '';
    const content = raw.length > 200 ? raw.slice(0, 200).trimEnd() + '…' : raw;
    return {
      title: username ? `@${username}` : 'Twitter post',
      url: `https://twitter.com/i/web/status/${tweet.id}`,
      content,
    };
  });

  // After each successful API call, log the number of resources returned into
  // x_usage for today (incrementing reads_count and estimated_cost). A failure
  // to log usage must not fail the search itself.
  try {
    await sql`
      INSERT INTO x_usage (date, reads_count, estimated_cost)
      VALUES (CURRENT_DATE, ${results.length}, ${results.length * X_COST_PER_READ})
      ON CONFLICT (date) DO UPDATE SET
        reads_count = x_usage.reads_count + EXCLUDED.reads_count,
        estimated_cost = x_usage.estimated_cost + EXCLUDED.estimated_cost
    `;
  } catch (err) {
    console.error('Failed to log X usage into x_usage:', err);
  }

  return { results };
}
