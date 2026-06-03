import { zValidator } from '@hono/zod-validator';
import type { ZodSchema } from 'zod';

type Target = 'json' | 'query' | 'param' | 'form' | 'header';

export function zv<T extends ZodSchema>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? 'Validasi gagal';
      return c.json({ error: msg }, 400);
    }
  });
}
