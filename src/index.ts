import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { healthRoute } from './routes/health';
import { authRoute } from './routes/auth';
import { usersRoute } from './routes/users';
import { groupsRoute } from './routes/groups';
import { paymentsRoute } from './routes/payments';
import { undianRoute } from './routes/undian';
import { swapsRoute } from './routes/swaps';
import { cronRoute } from './routes/cron';
import { adminRoute } from './routes/admin';
import { logger } from './utils/logger';

const app = new Hono();

app.route('/health', healthRoute);
app.route('/api/auth', authRoute);
app.route('/api/users', usersRoute);
app.route('/api/groups', groupsRoute);
app.route('/api/payments', paymentsRoute);
app.route('/api/groups', undianRoute);
app.route('/api/swaps', swapsRoute);
app.route('/api/cron', cronRoute);
app.route('/admin', adminRoute);

const port = parseInt(process.env.PORT ?? '3001');
serve({ fetch: app.fetch, port }, () => {
  logger.info(`arisan-api running on :${port}`, { env: process.env.NODE_ENV });
});

export default app;
