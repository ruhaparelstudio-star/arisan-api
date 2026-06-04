import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase before importing undian service
vi.mock('../db/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));
vi.mock('./streamio', () => ({ sendSystemMessage: vi.fn() }));
vi.mock('./notifications', () => ({ insertNotification: vi.fn() }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { supabase } from '../db/supabase';
import { undianFixed, undianRandom, saveWinner } from '../services/undian';

const mockFrom = (data: unknown, error: unknown = null) => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  vi.mocked(supabase.from).mockReturnValue(chain as any);
  return chain;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('undianFixed', () => {
  it('returns null if no member has that urutan', async () => {
    mockFrom(null);
    const result = await undianFixed('group-1', 1);
    expect(result).toBeNull();
  });

  it('returns user_id and name when member found', async () => {
    mockFrom({ user_id: 'user-abc', users: { name: 'Budi' } });
    const result = await undianFixed('group-1', 2);
    expect(result).toEqual({ user_id: 'user-abc', name: 'Budi' });
  });

  it('handles array users shape', async () => {
    mockFrom({ user_id: 'user-xyz', users: [{ name: 'Ani' }] });
    const result = await undianFixed('group-1', 1);
    expect(result?.name).toBe('Ani');
  });
});

describe('undianRandom', () => {
  it('returns null when RPC errors and no members', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'RPC error' } } as any);
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as any);
    const result = await undianRandom('group-1');
    expect(result).toBeNull();
  });

  it('returns winner_id from RPC when successful', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: 'winner-id', error: null } as any);
    const result = await undianRandom('group-1');
    expect(result).toBe('winner-id');
  });

  it('falls back to random member when RPC returns null', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as any);
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [{ user_id: 'user-a' }, { user_id: 'user-b' }], error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as any);
    const result = await undianRandom('group-1');
    expect(['user-a', 'user-b']).toContain(result);
  });
});

describe('saveWinner', () => {
  it('logs error on DB failure', async () => {
    const chain = {
      insert: vi.fn().mockResolvedValue({ error: { code: '99999', message: 'DB error' } }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as any);
    const { logger } = await import('../utils/logger');
    await saveWinner('g1', 'p1', 'u1');
    expect(logger.error).toHaveBeenCalledWith('saveWinner failed', expect.objectContaining({ groupId: 'g1' }));
  });

  it('silently ignores unique_violation (23505) — idempotent', async () => {
    const chain = {
      insert: vi.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate' } }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as any);
    const { logger } = await import('../utils/logger');
    await saveWinner('g1', 'p1', 'u1');
    expect(logger.warn).toHaveBeenCalledWith(
      'saveWinner: duplicate blocked by DB constraint (idempotent)',
      expect.any(Object)
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('completes without error on success', async () => {
    const chain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain as any);
    await expect(saveWinner('g1', 'p1', 'u1')).resolves.toBeUndefined();
  });
});
