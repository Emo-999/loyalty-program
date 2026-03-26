import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import type { Env } from './types';
import webhookRouter from './routes/webhook';
import adminRouter from './routes/admin';
import setupRouter from './routes/setup';
import { dashboardHtml } from './ui/dashboard';

const app = new Hono<{ Bindings: Env }>();

// ============================================================
// Public webhook endpoint (no auth — validated by secret header)
// ============================================================
app.route('/webhook', webhookRouter);

// ============================================================
// Admin dashboard (basic auth)
// ============================================================
app.use('/admin/*', async (c, next) => {
  const auth = basicAuth({
    username: c.env.ADMIN_USERNAME,
    password: c.env.ADMIN_PASSWORD,
  });
  return auth(c, next);
});

app.use('/api/admin/*', async (c, next) => {
  const auth = basicAuth({
    username: c.env.ADMIN_USERNAME,
    password: c.env.ADMIN_PASSWORD,
  });
  return auth(c, next);
});

app.use('/api/setup/*', async (c, next) => {
  const auth = basicAuth({
    username: c.env.ADMIN_USERNAME,
    password: c.env.ADMIN_PASSWORD,
  });
  return auth(c, next);
});

app.use('/api/setup', async (c, next) => {
  const auth = basicAuth({
    username: c.env.ADMIN_USERNAME,
    password: c.env.ADMIN_PASSWORD,
  });
  return auth(c, next);
});

// Serve dashboard HTML
app.get('/admin', (c) => c.html(dashboardHtml));
app.get('/admin/', (c) => c.html(dashboardHtml));

// Admin API routes
app.route('/api/admin', adminRouter);

// Setup routes
app.route('/api/setup', setupRouter);

// ============================================================
// Health check
// ============================================================
app.get('/', (c) =>
  c.json({
    service: 'Loyalty Program',
    status: 'ok',
    admin: '/admin',
    webhook: '/webhook/cloudcart',
  }),
);

export default app;
