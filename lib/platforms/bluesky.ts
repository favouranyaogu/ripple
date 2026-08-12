import { daysAgoISO, type SearchWindow } from '@/lib/time';

export interface PlatformSearchResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Searches Bluesky via the AT Protocol (bsky.social).
 * Requires BLUESKY_HANDLE and BLUESKY_APP_PASSWORD env vars.
 * `window` (optional) limits results via `since` (exact ISO start, or the last
 * N days) and `until` (exact ISO end, for custom ranges).
 * Returns the same shape as searchWeb: { results: [{ title, url, content }] }.
 */
export async function searchBluesky(query: string, window?: SearchWindow): Promise<{ results: PlatformSearchResult[] }> {
  const handle = process.env.BLUESKY_HANDLE;
  const appPassword = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !appPassword) {
    throw new Error('BLUESKY_HANDLE and BLUESKY_APP_PASSWORD are not configured');
  }

  // 1. Create an AT Protocol session to obtain an access JWT
  const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });
  if (!sessionRes.ok) {
    throw new Error(`Bluesky session failed: HTTP ${sessionRes.status}`);
  }
  const session = (await sessionRes.json()) as { accessJwt?: string };
  const accessJwt = session.accessJwt;
  if (!accessJwt) {
    throw new Error('Bluesky session response missing accessJwt');
  }

  // 2. Search posts with the session token
  const searchParams = new URLSearchParams({ q: query, limit: '10' });
  if (window) {
    if (window.since) searchParams.set('since', window.since);
    else if (window.days && window.days > 0) searchParams.set('since', daysAgoISO(window.days));
    if (window.until) searchParams.set('until', window.until);
  }
  const searchRes = await fetch(
    `https://bsky.social/xrpc/app.bsky.feed.searchPosts?${searchParams.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessJwt}` },
    }
  );
  if (!searchRes.ok) {
    throw new Error(`Bluesky search failed: HTTP ${searchRes.status}`);
  }

  const data = (await searchRes.json()) as {
    posts?: {
      uri?: string;
      author?: { handle?: string };
      record?: { text?: string };
    }[];
  };

  const results: PlatformSearchResult[] = (data.posts || [])
    .map((post) => {
      const uri = post.uri || '';
      const handle = post.author?.handle || '';
      const rkey = uri.split('/').pop() || '';
      const raw = post.record?.text || '';
      const content = raw.length > 200 ? raw.slice(0, 200).trimEnd() + '…' : raw;
      return {
        title: handle ? `@${handle}` : 'Bluesky post',
        url: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : '',
        content,
      };
    })
    .filter((r) => r.url);

  return { results };
}
