import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { healthRoute } from './routes/health';
import { logger } from './utils/logger';

const app = new Hono();

app.route('/health', healthRoute);

const port = parseInt(process.env.PORT ?? '3001');
serve({ fetch: app.fetch, port }, () => {
  logger.info(`arisan-api running on :${port}`, { env: process.env.NODE_ENV });
});

export default app;
