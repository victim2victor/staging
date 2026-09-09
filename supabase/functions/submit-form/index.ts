import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// submit-form — the single write path for both contact forms.
//
// The tables are not writable with the publishable key (RLS on, no policies),
// so every submission comes through here and is inserted as service role.
// Routing it through a function is what makes rate limiting possible: the
// browser has no way to POST straight to PostgREST and skip the limiter.
//
// Spam protection is three layers: a hidden honeypot field (bots fill it),
// per-field validation, and a fixed-window rate limit keyed by BOTH the
// caller's IP (salted hash) and their session token.

const RL_MAX     = 5;          // max submissions per window, per key
const RL_WINDOW  = 600;        // 10 minutes, in seconds

// Browser origins allowed to call this function. Staging and production share
// one project; origin also resolves the environment where the hostnames differ.
const ALLOWED_ORIGINS = new Set([
  'https://victim2victor.github.io',   // staging + prod Pages (path-scoped)
  'https://victim2victor.co.za',
  'https://www.victim2victor.co.za',
]);
// Environment tag: 0 = staging, 1 = production.
const ENV_BY_ORIGIN: Record<string, 0 | 1> = {
  'https://victim2victor.co.za':     1,
  'https://www.victim2victor.co.za': 1,
};

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-form field specs. Keys are the table columns; the whole form maps to one
// row. `email: true` also format-checks. Anything not listed here is ignored.
type Spec = { max: number; email?: boolean };
const FORMS: Record<string, Record<string, Spec>> = {
  enquiries: {
    email:   { max: 254, email: true },
    subject: { max: 200 },
    message: { max: 5000 },
  },
  workshop_registrations: {
    workshop: { max: 200 },
    name:     { max: 120 },
    people:   { max: 60 },
    email:    { max: 254, email: true },
    phone:    { max: 60 },
  },
};

function corsHeaders(origin: string): Record<string, string> {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://victim2victor.co.za';
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), ...extra, 'Content-Type': 'application/json' },
  });
}

async function hashValue(value: string): Promise<string> {
  const salt = Deno.env.get('IP_HASH_SALT') ?? '';
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${value}`));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Atomic fixed-window rate limit via the rate_limit_hit SQL function. Returns
// null on limiter error so callers fail open (a limiter outage never blocks a
// genuine request).
// deno-lint-ignore no-explicit-any
async function rateLimit(sb: any, key: string): Promise<{ allowed: boolean; retryAfter: number } | null> {
  const { data, error } = await sb.rpc('rate_limit_hit', {
    p_key: key, p_limit: RL_MAX, p_window_seconds: RL_WINDOW,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { allowed: row.allowed, retryAfter: row.retry_after } : null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin') ?? '';

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST')    return json({ error: 'Method Not Allowed' }, 405, origin);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: 'Bad Request' }, 400, origin); }

  // Honeypot: a hidden field no human fills. If present, silently accept
  // (bots get a success, nothing is stored).
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    return json({ ok: true }, 200, origin);
  }

  // Which form / table.
  const form = typeof body.form === 'string' ? body.form : '';
  const spec = FORMS[form];
  if (!spec) return json({ error: 'Unknown form.' }, 422, origin);

  // Validate + build the row from the form's allowed fields only.
  const row: Record<string, string | number> = {};
  for (const [field, rule] of Object.entries(spec)) {
    const raw = body[field];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value)                       return json({ error: `Please complete every field.` }, 422, origin);
    if (rule.email && !EMAIL_RE.test(value)) return json({ error: 'A valid email address is required.' }, 422, origin);
    row[field] = value.slice(0, rule.max);
  }

  // Environment: trust the origin where it resolves one; else the build stamp.
  const env: 0 | 1 = ENV_BY_ORIGIN[origin]
    ?? (body.env === 0 || body.env === 1 ? body.env : 1);
  row.env = env;

  // Session token — REQUIRED: every interaction row references a session (the
  // function resolves it below), and it is also a rate-limit key.
  const token =
    typeof body.token === 'string' && UUID_RE.test(body.token) ? body.token : null;
  if (!token) return json({ error: 'Bad Request' }, 400, origin);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Rate limit by IP hash AND session token — either over its window trips 429.
  const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipHash = await hashValue(rawIp);
  const keys = [`submit:${ipHash}`, `submit:sess:${token}`];

  for (const key of keys) {
    const rl = await rateLimit(sb, key);
    if (rl && !rl.allowed) {
      return json({ error: 'Too many submissions — please try again later.' }, 429, origin,
        { 'Retry-After': String(rl.retryAfter) });
    }
  }

  // Resolve (or create) this browser's session so the row can reference it —
  // a page-load beacon has usually created it already; a form-first visitor
  // gets a minimal session here (geo stays null; track-visit only geolocates
  // on its own first sight).
  let { data: sess } = await sb.from('sessions').select('id').eq('token', token).maybeSingle();
  if (!sess) {
    const created = await sb.from('sessions').insert({ token, env, ip_hash: ipHash }).select('id').single();
    sess = created.data;
  }
  if (!sess) return json({ error: 'Could not save your message. Please try again.' }, 500, origin);
  row.session_id = sess.id;

  const { error } = await sb.from(form).insert(row);
  if (error) return json({ error: 'Could not save your message. Please try again.' }, 500, origin);

  return json({ ok: true }, 200, origin);
});
