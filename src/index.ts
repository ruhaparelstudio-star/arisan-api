import { serve } from '@hono/node-server';
import { logger } from './utils/logger';
import app from './app';

const port = parseInt(process.env.PORT ?? '3001');
serve({ fetch: app.fetch, port }, () => {
  logger.info(`arisan-api running on :${port}`, { env: process.env.NODE_ENV });
});

export default app;
