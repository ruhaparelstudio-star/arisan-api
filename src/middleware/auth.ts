import { createMiddleware } from 'hono/factory';

export const jwtAuth = createMiddleware(async (c, next) => {
  // TODO BE-1: implementasi JWT verify
  // Sementara: lanjut saja (untuk testing health endpoint)
  await next();
});
