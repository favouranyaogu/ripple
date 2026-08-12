import type { SearchWindow } from '@/lib/time';

export interface PlatformSearchResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Maps a day count to Reddit's `t` (time filter) param.
 */
function redditTimeParam(days: number): string {
  if (days <= 1) return 'day';
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  return 'all';
}

/**
 * Searches Reddit via the official API (OAuth2 client-credentials flow).
 * Requires REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET env vars.
 * `window` (optional) limits results via `t` — Reddit only accepts preset
 * windows, so custom ranges use the day count (rounded to the nearest preset).
 * Returns the same shape as searchWeb: { results: [{ title, url, content }] }.
 */
export async function searchReddit(query: string, window?: SearchWindow): Promise<{ results: PlatformSearchResult[] }> {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are not configured');
  }

  // 1. Exchange client credentials for an OAuth2 access token
  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'ripple-monitor/1.0',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`Reddit token request failed: HTTP ${tokenRes.status}`);
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    throw new Error('Reddit token response missing access_token');
  }

  // 2. Search submissions using the oauth.reddit.com endpoint
  const searchParams = new URLSearchParams({
    q: query,
    limit: '10',
    sort: 'relevance',
    type: 'link',
  });
  if (window?.days && window.days > 0) searchParams.set('t', redditTimeParam(window.days));
  const searchRes = await fetch(
    `https://oauth.reddit.com/search?${searchParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'ripple-monitor/1.0',
      },
    }
  );
  if (!searchRes.ok) {
    throw new Error(`Reddit search failed: HTTP ${searchRes.status}`);
  }

  const data = (await searchRes.json()) as {
    data?: {
      children?: {
        data?: { title?: string; permalink?: string; selftext?: string; url?: string };
      }[];
    };
  };

  const results: PlatformSearchResult[] = (data.data?.children || [])
    .map((child) => {
      const post = child.data || {};
      const raw = post.selftext || post.title || '';
      const content = raw.length > 200 ? raw.slice(0, 200).trimEnd() + '…' : raw;
      return {
        title: post.title || '',
        url: post.permalink ? `https://www.reddit.com${post.permalink}` : post.url || '',
        content,
      };
    })
    .filter((r) => r.url);

  return { results };
}
