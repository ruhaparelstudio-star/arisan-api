import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('./groups', () => ({ logActivity: vi.fn() }));
vi.mock('./notifications', () => ({ sendWA: vi.fn(), insertNotification: vi.fn() }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { supabase } from '../db/supabase';
import { getUserSwapCount, createSwapRequest } from '../services/swaps';

// Build a thenable chain where the whole chain resolves to `result`
function countChain(count: number | null) {
  const result = { count, data: null, error: null };
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  chain.eq.mockReturnValue(chain);
  return chain;
}

function singleChain(data: unknown, error: unknown = null) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  return chain;
}

beforeEach(() => vi.clearAllMocks());

describe('getUserSwapCount', () => {
  it('returns count from DB', async () => {
    vi.mocked(supabase.from).mockReturnValue(countChain(2) as any);
    const count = await getUserSwapCount('user-1', 'group-1');
    expect(count).toBe(2);
  });

  it('returns 0 when DB returns null count', async () => {
    vi.mocked(supabase.from).mockReturnValue(countChain(null) as any);
    const count = await getUserSwapCount('user-1', 'group-1');
    expect(count).toBe(0);
  });
});

describe('createSwapRequest', () => {
  it('rejects when requester has 2 approved swaps', async () => {
    // First two from() calls are getUserSwapCount — return count=2 for requester
    vi.mocked(supabase.from)
      .mockReturnValueOnce(countChain(2) as any) // requester count
      .mockReturnValue(countChain(0) as any);    // target count (never reached)
    const result = await createSwapRequest('requester', 'target', 'group');
    expect(result.error).toMatch(/maksimal.*2x|jatah/i);
    expect(result.swap).toBeUndefined();
  });

  it('rejects when target has 2 approved swaps', async () => {
    vi.mocked(supabase.from)
      .mockReturnValueOnce(countChain(0) as any)  // requester count = 0
      .mockReturnValueOnce(countChain(2) as any); // target count = 2
    const result = await createSwapRequest('requester', 'target', 'group');
    expect(result.error).toMatch(/batas tukar giliran/i);
    expect(result.swap).toBeUndefined();
  });

  it('rejects if requester already has pending swap', async () => {
    vi.mocked(supabase.from)
      .mockReturnValueOnce(countChain(0) as any)              // requester count
      .mockReturnValueOnce(countChain(0) as any)              // target count
      .mockReturnValue(singleChain({ id: 'swap-1' }) as any); // pending exists
    const result = await createSwapRequest('requester', 'target', 'group');
    expect(result.error).toMatch(/belum selesai/i);
  });

  it('rejects if requester is not a group member', async () => {
    vi.mocked(supabase.from)
      .mockReturnValueOnce(countChain(0) as any)    // requester count
      .mockReturnValueOnce(countChain(0) as any)    // target count
      .mockReturnValueOnce(singleChain(null) as any) // no pending swap
      .mockReturnValue(singleChain(null) as any);    // requester member = null
    const result = await createSwapRequest('requester', 'target', 'group');
    expect(result.error).toMatch(/bukan anggota/i);
  });
});
