import { NextResponse } from 'next/server';

// Always read env vars at request time instead of baking values in at build time.
export const dynamic = 'force-dynamic';
// Env-driven status must never be cached (in some Next versions force-dynamic
// alone isn't enough).
export const fetchCache = 'force-no-store';

export async function GET() {
  return NextResponse.json(
    {
      reddit: Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET),
      redditPending: Boolean(process.env.REDDIT_API_REQUESTED),
      twitter: Boolean(process.env.TWITTER_BEARER_TOKEN),
      bluesky: Boolean(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD),
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  );
}
