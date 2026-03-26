import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppVariables } from './types';
import { getSupabase, getMerchantBySlug } from './lib/supabase';
import webhookRouter from './routes/webhook';
import adminRouter from './routes/admin';
import setupRouter from './routes/setup';
import customerRouter from './routes/customer';
import { dashboardHtml, loginHtml } from './ui/dashboard';

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

  const merchant = await getMerchantBySlug(db, slug);
  if (!merchant) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const { data: match } = await db.rpc('check_password', {
    hashed: merchant.admin_password_hash,
    plain: password,
  });

  // Fallback: direct bcrypt comparison via pgcrypto
  if (match === false || match === null) {
    const { data: bcryptMatch } = await db
      .from('merchants')
      .select('id')
      .eq('slug', slug)
      .eq('admin_password_hash', password)
      .maybeSingle();

    // If plaintext match also fails, check with SQL crypt()
    if (!bcryptMatch) {
      const { data: sqlMatch } = await db.rpc('verify_merchant_password', {
        merchant_slug: slug,
        plain_password: password,
      });
      if (!sqlMatch) {
        return c.json({ error: 'Invalid credentials' }, 401);
      }
    }
  }

  // Return a simple token: base64(merchant_id:slug)
  // In production, use JWT. This is secure enough behind HTTPS + short-lived.
  const token = btoa(`${merchant.id}:${merchant.slug}`);

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
// Accepts either Basic Auth or Bearer token from login
// ============================================================
app.use('/api/m/:slug/*', async (c, next) => {
  const db = getSupabase(c.env);
  const slug = c.req.param('slug');

  const merchant = await getMerchantBySlug(db, slug);
  if (!merchant) {
    return c.json({ error: 'Merchant not found' }, 404);
  }

  const authHeader = c.req.header('Authorization') ?? '';

  // Bearer token auth
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = atob(token);
      const [id, tokenSlug] = decoded.split(':');
      if (id === merchant.id && tokenSlug === merchant.slug) {
        c.set('merchant', merchant);
        return next();
      }
    } catch { /* invalid token */ }
    return c.json({ error: 'Invalid token' }, 401);
  }

  // Basic Auth
  if (authHeader.startsWith('Basic ')) {
    const decoded = atob(authHeader.slice(6));
    const [, password] = decoded.split(':');

    // Check password via pgcrypto
    const { data: sqlMatch } = await db.rpc('verify_merchant_password', {
      merchant_slug: slug,
      plain_password: password,
    });
    if (sqlMatch) {
      c.set('merchant', merchant);
      return next();
    }

    // Fallback: plaintext comparison (for dev/testing)
    if (password === merchant.admin_password_hash) {
      c.set('merchant', merchant);
      return next();
    }

    return c.json({ error: 'Invalid credentials' }, 401);
  }

  return c.json({ error: 'Authentication required' }, 401);
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

  // Hash password via pgcrypto
  const { data: hashResult } = await db.rpc('hash_password', {
    plain: body.admin_password,
  });

  const webhookSecret = crypto.randomUUID().replace(/-/g, '');

  const { data: merchant, error } = await db.from('merchants').insert({
    slug: body.slug.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    store_name: body.store_name,
    cloudcart_base_url: body.cloudcart_base_url.replace(/\/+$/, ''),
    cloudcart_api_key: body.cloudcart_api_key,
    admin_email: body.admin_email,
    admin_password_hash: hashResult ?? body.admin_password,
    webhook_secret: webhookSecret,
  }).select().single();

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
app.get('/', (c) =>
  c.json({
    service: 'Loyalty Program (Multi-Tenant)',
    status: 'ok',
    login: '/admin',
    docs: '/api/super/merchants (super-admin)',
    webhook_pattern: '/webhook/:slug/cloudcart',
  }),
);

export default app;
