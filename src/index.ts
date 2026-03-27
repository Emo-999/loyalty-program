import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppVariables } from './types';
import { getSupabase, getMerchantBySlug } from './lib/supabase';
import webhookRouter from './routes/webhook';
import adminRouter from './routes/admin';
import setupRouter from './routes/setup';
import customerRouter from './routes/customer';
import { dashboardHtml, loginHtml } from './ui/dashboard';

// HMAC-SHA256 signed tokens (no external JWT library needed)
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - s.length % 4) % 4);
  return atob(padded);
}

async function signToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const json = JSON.stringify(payload);
  const encoded = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return encoded + '.' + b64url(sig);
}

async function verifyToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const key = await hmacKey(secret);
  const sigBytes = Uint8Array.from(b64urlDecode(sig), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(encoded));
  if (!valid) return null;
  const json = b64urlDecode(encoded);
  const payload = JSON.parse(json);
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use('*', cors());

// ============================================================
// Public: Webhook endpoints (auth via per-merchant secret header)
// ============================================================
app.route('/webhook', webhookRouter);

// ============================================================
// Public: Customer-facing loyalty pages + API + widget
// ============================================================
app.route('/c', customerRouter);

// ============================================================
// Login endpoint — validates merchant credentials, returns session token
// ============================================================
app.post('/api/login', async (c) => {
  const db = getSupabase(c.env);
  const { slug, password } = await c.req.json<{ slug: string; password: string }>();

  if (!slug || !password) {
    return c.json({ error: 'slug and password required' }, 400);
  }

  const { data: merchant } = await db
    .from('merchants')
    .select('id, slug, store_name, admin_password_hash')
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();

  if (!merchant) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // Try hash-based verification first
  const { data: sqlMatch } = await db.rpc('verify_merchant_password', {
    merchant_slug: slug,
    plain_password: password,
  });

  if (!sqlMatch) {
    // Fallback: check_password with the stored hash directly
    const { data: hashMatch } = await db.rpc('check_password', {
      hashed: merchant.admin_password_hash,
      plain: password,
    });

    if (!hashMatch) {
      // One-time migration: if password is stored unhashed, verify and re-hash
      if (merchant.admin_password_hash === password) {
        const { data: newHash } = await db.rpc('hash_password', { plain: password });
        if (newHash) {
          await db.from('merchants').update({ admin_password_hash: newHash }).eq('id', merchant.id);
        }
      } else {
        return c.json({ error: 'Invalid credentials' }, 401);
      }
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signToken(
    { sub: merchant.id, slug: merchant.slug, iat: now, exp: now + 86400 },
    c.env.SUPER_ADMIN_KEY,
  );

  return c.json({
    ok: true,
    token,
    merchant: {
      slug: merchant.slug,
      store_name: merchant.store_name,
    },
  });
});

// ============================================================
// Merchant auth middleware for /api/m/:slug/*
// Verifies JWT Bearer token from login
// ============================================================
app.use('/api/m/:slug/*', async (c, next) => {
  const db = getSupabase(c.env);
  const slug = c.req.param('slug');

  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const token = authHeader.slice(7);

  let merchantId: string | null = null;

  // Try signed token verification
  const payload = await verifyToken(token, c.env.SUPER_ADMIN_KEY);
  if (payload && payload.slug === slug) {
    merchantId = payload.sub as string;
  }

  // Fallback: legacy base64 tokens (remove after all sessions expire)
  if (!merchantId) {
    try {
      const decoded = atob(token);
      const [id, tokenSlug] = decoded.split(':');
      if (tokenSlug === slug) merchantId = id;
    } catch { /* not a valid token */ }
  }

  if (!merchantId) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  const merchant = await getMerchantBySlug(db, slug);
  if (!merchant || merchant.id !== merchantId) {
    return c.json({ error: 'Merchant not found' }, 404);
  }

  c.set('merchant', merchant);
  return next();
});

// Serve merchant dashboard
app.get('/admin', (c) => c.html(loginHtml));
app.get('/admin/', (c) => c.html(loginHtml));
app.get('/admin/:slug', (c) => c.html(dashboardHtml));
app.get('/admin/:slug/', (c) => c.html(dashboardHtml));

// Merchant-scoped admin API
app.route('/api/m/:slug/admin', adminRouter);
app.route('/api/m/:slug/setup', setupRouter);

// ============================================================
// Super-admin: onboard a new merchant
// ============================================================
app.post('/api/super/merchants', async (c) => {
  const superKey = c.req.header('X-Super-Admin-Key');
  if (!superKey || superKey !== c.env.SUPER_ADMIN_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const db = getSupabase(c.env);
  const body = await c.req.json<{
    slug: string;
    store_name: string;
    cloudcart_base_url: string;
    cloudcart_api_key: string;
    admin_email: string;
    admin_password: string;
  }>();

  if (!body.slug || !body.store_name || !body.cloudcart_base_url ||
      !body.cloudcart_api_key || !body.admin_email || !body.admin_password) {
    return c.json({ error: 'All fields required: slug, store_name, cloudcart_base_url, cloudcart_api_key, admin_email, admin_password' }, 400);
  }

  const { data: hashResult, error: hashErr } = await db.rpc('hash_password', {
    plain: body.admin_password,
  });

  if (hashErr || !hashResult) {
    return c.json({ error: 'Password hashing failed — check pgcrypto functions' }, 500);
  }

  const webhookSecret = crypto.randomUUID().replace(/-/g, '');

  const { data: merchant, error } = await db.from('merchants').insert({
    slug: body.slug.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    store_name: body.store_name,
    cloudcart_base_url: body.cloudcart_base_url.replace(/\/+$/, ''),
    cloudcart_api_key: body.cloudcart_api_key,
    admin_email: body.admin_email,
    admin_password_hash: hashResult,
    webhook_secret: webhookSecret,
  }).select('id, slug, store_name').single();

  if (error) return c.json({ error: error.message }, 400);

  return c.json({
    ok: true,
    merchant: {
      id: merchant.id,
      slug: merchant.slug,
      store_name: merchant.store_name,
      webhook_secret: webhookSecret,
    },
    next_steps: [
      `Dashboard: /admin/${merchant.slug}`,
      `Run setup: POST /api/m/${merchant.slug}/setup`,
      `Webhook URL: /webhook/${merchant.slug}/cloudcart`,
    ],
  }, 201);
});

// List all merchants (super-admin)
app.get('/api/super/merchants', async (c) => {
  const superKey = c.req.header('X-Super-Admin-Key');
  if (!superKey || superKey !== c.env.SUPER_ADMIN_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const db = getSupabase(c.env);
  const { data, error } = await db.from('merchants')
    .select('id, slug, store_name, admin_email, active, created_at')
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// ============================================================
// Health check
// ============================================================
app.get('/', (c) => c.redirect('/admin'));

export default app;
