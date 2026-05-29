type Meta = Record<string, unknown>;

const log = (level: string, msg: string, meta?: Meta) =>
  process.stdout.write(
    JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() }) + '\n'
  );

export const logger = {
  info: (msg: string, meta?: Meta) => log('info', msg, meta),
  warn: (msg: string, meta?: Meta) => log('warn', msg, meta),
  error: (msg: string, meta?: Meta) =>
    process.stderr.write(
      JSON.stringify({ level: 'error', msg, ...meta, ts: new Date().toISOString() }) + '\n'
    ),
};
