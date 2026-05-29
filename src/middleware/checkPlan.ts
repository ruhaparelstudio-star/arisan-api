import { createMiddleware } from 'hono/factory';

export const checkPlan = createMiddleware(async (c, next) => {
  // Phase Final: akan diisi logic gating free vs premium
  // Phase Awal: semua fitur bebas, middleware ini tidak melakukan apa-apa
  await next();
});
