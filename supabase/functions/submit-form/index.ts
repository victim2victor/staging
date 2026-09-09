import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// submit-form — the single write path for both contact forms.
//
// The tables are not writable with the publishable key (RLS on, no policies),
// so every submission comes through here and is inserted as service role.
// Routing it through a function is what makes rate limiting possible: the
// browser has no way to POST straight to PostgREST and skip the limiter.
//
// Spam protection is three layers: a hidden honeypot field (bots fill it),
// per-field validation, and a sliding-window rate limit keyed by BOTH the
// caller's IP (salted hash) and their session token.

const RL_MAX     = 5;          // max submissions per window, per key
const RL_WINDOW  = 600_000;    // 10 minutes, in ms

// Browser origins allowed to call this function. Staging and production share
// one project; origin also resolves the environment where the hostnames differ.
const ALLOWED_ORIGINS = new Set([
  'https://victim2victor.github.io',   // staging + prod Pages (path-scoped)
  'https://victim2victor.co.za',
  'https://www.victim2victor.co.za',
]);
const ENV_BY_ORIGIN: Record<string, 'staging' | 'production'> = {
  'https://victim2victor.co.za':     'production',
  'https://www.victim2victor.co.za': 'production',
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

function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

async function hashValue(value: string): Promise<string> {
  const salt = Deno.env.get('IP_HASH_SALT') ?? '';
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${value}`));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// deno-lint-ignore no-explicit-any
async function overLimit(sb: any, bucket: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - RL_WINDOW).toISOString();
  const { count } = await sb
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('bucket', bucket)
    .gte('created_at', windowStart);
  return (count ?? 0) >= RL_MAX;
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
  const row: Record<string, string> = {};
  for (const [field, rule] of Object.entries(spec)) {
    const raw = body[field];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value)                       return json({ error: `Please complete every field.` }, 422, origin);
    if (rule.email && !EMAIL_RE.test(value)) return json({ error: 'A valid email address is required.' }, 422, origin);
    row[field] = value.slice(0, rule.max);
  }

  // Environment: trust the origin where it resolves one; else the build stamp.
  row.environment = ENV_BY_ORIGIN[origin]
    ?? (body.environment === 'staging' || body.environment === 'production' ? body.environment : 'production');

  // Session token (soft link + rate-limit key).
  const sessionToken =
    typeof body.session_token === 'string' && UUID_RE.test(body.session_token) ? body.session_token : null;
  if (sessionToken) row.session_token = sessionToken;

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Rate limit by IP hash AND session token — either over its window trips 429.
  const rawIp    = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipBucket = `ip:${await hashValue(rawIp)}`;
  const buckets  = [ipBucket, ...(sessionToken ? [`sess:${sessionToken}`] : [])];

  for (const bucket of buckets) {
    if (await overLimit(sb, bucket)) {
      return json({ error: 'Too many submissions — please try again later.' }, 429, origin);
    }
  }
  await sb.from('rate_limits').insert(buckets.map(bucket => ({ bucket })));

  const { error } = await sb.from(form).insert(row);
  if (error) return json({ error: 'Could not save your message. Please try again.' }, 500, origin);

  return json({ ok: true }, 200, origin);
});
