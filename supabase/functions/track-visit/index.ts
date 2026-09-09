import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// track-visit — anonymous page-visit tracking.
//
// A fire-and-forget beacon from every page load. Writes as service role into
// `sessions` (one row per browser, geolocated once) and `page_views` (one per
// load). The raw IP is never stored — only a salted hash, used transiently to
// geolocate and to rate-limit. Bot user-agents are dropped and never recorded.

const RL_MAX    = 60;         // max beacons per window, per IP
const RL_WINDOW = 60;         // 1 minute, in seconds

const ALLOWED_ORIGINS = new Set([
  'https://victim2victor.github.io',
  'https://victim2victor.co.za',
  'https://www.victim2victor.co.za',
]);
// Environment tag: 0 = staging, 1 = production.
const ENV_BY_ORIGIN: Record<string, 0 | 1> = {
  'https://victim2victor.co.za':     1,
  'https://www.victim2victor.co.za': 1,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Crawlers, headless browsers, scrapers, link-preview unfurlers, monitors.
const BOT_UA_RE = /bot|crawler|spider|scraper|headless|phantom|selenium|puppeteer|playwright|curl|wget|python-requests|go-http|java\/|apache-httpclient|scrapy|libwww|httpclient|okhttp|axios\/|node-fetch|lighthouse|facebookexternalhit|twitterbot|linkedinbot|whatsapp|slackbot|discordbot|telegrambot|applebot|duckduckbot|bingpreview|ia_archiver/i;
const BOT_ASORG_RE = /google|amazon|microsoft|digitalocean|linode|akamai|cloudflare|fastly|ovh|hetzner|vultr|leaseweb|datacenter|hosting|server|cdn|aws|azure|gcp/i;

function corsHeaders(origin: string): Record<string, string> {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://victim2victor.co.za';
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function ok(origin: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: true, ...extra }), {
    status: 200,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

async function hashValue(value: string): Promise<string> {
  const salt = Deno.env.get('IP_HASH_SALT') ?? '';
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${value}`));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Atomic fixed-window rate limit via the rate_limit_hit SQL function. Returns
// null on limiter error so callers fail open (metrics are never worth blocking
// a real page load over a transient DB problem).
// deno-lint-ignore no-explicit-any
async function rateLimit(sb: any, key: string): Promise<{ allowed: boolean; retryAfter: number } | null> {
  const { data, error } = await sb.rpc('rate_limit_hit', {
    p_key: key, p_limit: RL_MAX, p_window_seconds: RL_WINDOW,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { allowed: row.allowed, retryAfter: row.retry_after } : null;
}

interface Geo {
  country: string | null; continent: string | null; city: string | null;
  latitude: number | null; longitude: number | null; timezone: string | null; asorg: string | null;
}
const EMPTY_GEO: Geo = { country: null, continent: null, city: null, latitude: null, longitude: null, timezone: null, asorg: null };

async function fetchGeo(ip: string): Promise<Geo> {
  if (ip === 'unknown') return EMPTY_GEO;
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { 'User-Agent': 'victim2victor.co.za/analytics' },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return EMPTY_GEO;
    const d = await res.json();
    if (d.error) return EMPTY_GEO;
    return {
      country:   typeof d.country_code   === 'string' ? d.country_code   : null,
      continent: typeof d.continent_code === 'string' ? d.continent_code : null,
      city:      typeof d.city           === 'string' ? d.city           : null,
      latitude:  typeof d.latitude       === 'number' ? d.latitude       : null,
      longitude: typeof d.longitude      === 'number' ? d.longitude      : null,
      timezone:  typeof d.timezone       === 'string' ? d.timezone       : null,
      asorg:     typeof d.org            === 'string' ? d.org            : null,
    };
  } catch {
    return EMPTY_GEO;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin') ?? '';

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST')    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders(origin) });

  let body: { token?: unknown; page?: unknown; referrer?: unknown; env?: unknown } = {};
  try { body = await req.json(); } catch { return new Response('Bad Request', { status: 400, headers: corsHeaders(origin) }); }

  if (typeof body.token !== 'string' || !UUID_RE.test(body.token)) {
    return new Response('Bad Request', { status: 400, headers: corsHeaders(origin) });
  }
  const token = body.token;
  const page      = typeof body.page     === 'string' ? body.page.slice(0, 500)      : '/';
  const referrer  = typeof body.referrer === 'string' ? body.referrer.slice(0, 1000) : null;
  const userAgent = req.headers.get('user-agent')?.slice(0, 500) ?? null;

  // Bot UA → drop silently (200, nothing recorded, no signal it was filtered).
  if (userAgent && BOT_UA_RE.test(userAgent)) return ok(origin, { bot: true });

  const env: 0 | 1 = ENV_BY_ORIGIN[origin]
    ?? (body.env === 0 || body.env === 1 ? body.env : 1);

  const rawIp  = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipHash = await hashValue(rawIp);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Rate limit by hashed IP (shared rate_limit_hit function; same as submit-form).
  const rl = await rateLimit(sb, `visit:${ipHash}`);
  if (rl && !rl.allowed) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { ...corsHeaders(origin), 'Retry-After': String(rl.retryAfter) },
    });
  }

  // Session: geolocate once on first sight; otherwise just bump last_seen.
  // Resolve the surrogate id either way — page_views references it.
  const { data: existing } = await sb
    .from('sessions').select('id').eq('token', token).maybeSingle();

  let sessionId: number;
  if (!existing) {
    const geo = await fetchGeo(rawIp);
    // asorg bot signal only when the UA is missing/short (real users on cloud VPNs have a UA).
    if (geo.asorg && (!userAgent || userAgent.length < 20) && BOT_ASORG_RE.test(geo.asorg)) {
      return ok(origin, { bot: true });
    }
    const { data: created, error } = await sb.from('sessions').insert({
      token, env, ip_hash: ipHash,
      country: geo.country, continent: geo.continent, city: geo.city,
      latitude: geo.latitude, longitude: geo.longitude, timezone: geo.timezone,
      asorg: geo.asorg, user_agent: userAgent,
    }).select('id').single();
    if (error || !created) return ok(origin);   // never block the page over a metrics write
    sessionId = created.id;
  } else {
    sessionId = existing.id;
    await sb.from('sessions').update({ last_seen: new Date().toISOString() }).eq('id', sessionId);
  }

  await sb.from('page_views').insert({ session_id: sessionId, env, page, referrer });

  return ok(origin);
});
