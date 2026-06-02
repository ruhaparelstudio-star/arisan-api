import type { IncomingMessage, ServerResponse } from 'http';
import app from '../src/app';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const protocol = 'https';
  const host = req.headers.host ?? 'localhost';
  const url = `${protocol}://${host}${req.url ?? '/'}`;

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val == null) continue;
    headers.set(key, Array.isArray(val) ? val.join(', ') : val);
  }

  let body: Buffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    body = Buffer.concat(chunks);
  }

  const request = new Request(url, {
    method: req.method ?? 'GET',
    headers,
    body: body?.length ? body : undefined,
  });

  const response = await app.fetch(request);

  res.statusCode = response.status;
  response.headers.forEach((val, key) => res.setHeader(key, val));

  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}
