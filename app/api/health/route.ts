import { NextResponse } from "next/server";
import https from "https";

export const dynamic = "force-dynamic";
// Health checks and env-driven status must never be cached (in some Next
// versions force-dynamic alone isn't enough).
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

interface ProbeResult {
  ok: boolean;
  detail: string;
}

function probe(host: string, timeoutMs = 6000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const req = https.request({ host, path: "/", method: "HEAD", timeout: timeoutMs }, (res) => {
      // Any HTTP response — even a 4xx/5xx — means the TLS connection
      // succeeded, so the service is reachable from this network.
      const status = res.statusCode ?? 0;
      res.destroy();
      resolve({ ok: true, detail: `reachable (HTTP ${status})` });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, detail: "timed out" });
    });
    req.on("error", (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ECONNRESET") resolve({ ok: false, detail: "connection reset (blocked?)" });
      else if (code === "ENOTFOUND" || code === "EAI_AGAIN") resolve({ ok: false, detail: "DNS failure" });
      else if (code === "ETIMEDOUT") resolve({ ok: false, detail: "timed out" });
      else resolve({ ok: false, detail: code || e.message });
    });
    req.end();
  });
}

interface ServiceDef {
  id: string;
  name: string;
  host: string;
  configured: boolean;
  // Set when the user has an access request in flight (e.g. Reddit's API
  // approval gate) but doesn't have working credentials yet.
  requested?: boolean;
}

function envPresent(...names: string[]): boolean {
  return names.every((n) => !!process.env[n]);
}

const SERVICES: ServiceDef[] = [
  {
    id: "gemini",
    name: "Gemini AI",
    host: "generativelanguage.googleapis.com",
    configured: envPresent("GEMINI_API_KEY"),
  },
  {
    id: "tavily",
    name: "Tavily search",
    host: "api.tavily.com",
    configured: envPresent("TAVILY_API_KEY"),
  },
  {
    id: "twitter",
    name: "X API",
    host: "api.x.com",
    configured: envPresent("TWITTER_BEARER_TOKEN"),
  },
  {
    id: "reddit",
    name: "Reddit",
    host: "www.reddit.com",
    configured: envPresent("REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"),
    requested: envPresent("REDDIT_API_REQUESTED"),
  },
  {
    id: "bluesky",
    name: "Bluesky",
    host: "public.api.bsky.app",
    configured: envPresent("BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"),
  },
];

/**
 * Lightweight service health check. Each configured service is probed with a
 * cheap TLS-level connection (no API quota consumed). Missing API keys report
 * as "unconfigured" rather than down.
 */
export async function GET() {
  const services = await Promise.all(
    SERVICES.map(async (s) => {
      if (!s.configured) {
        if (s.requested) {
          return {
            id: s.id,
            name: s.name,
            status: "pending",
            detail: "API access request submitted — awaiting approval",
          };
        }
        return { id: s.id, name: s.name, status: "unconfigured", detail: "no API key configured" };
      }
      const r = await probe(s.host);
      return {
        id: s.id,
        name: s.name,
        status: r.ok ? "ok" : "down",
        detail: r.detail,
      };
    })
  );

  return NextResponse.json(
    {
      services,
      checkedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  );
}
