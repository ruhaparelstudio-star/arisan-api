import { describe, it, expect, vi } from 'vitest';

// Mock supabase before any import to avoid env var requirement
vi.mock('../db/supabase', () => ({ supabase: { from: vi.fn() } }));

import { generateOTP } from '../services/otp';

describe('generateOTP', () => {
  it('generates a 6-digit string', () => {
    const otp = generateOTP();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('generates numbers in range 100000-999999', () => {
    for (let i = 0; i < 50; i++) {
      const n = parseInt(generateOTP(), 10);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });

  it('generates different codes across runs', () => {
    const codes = new Set(Array.from({ length: 20 }, generateOTP));
    expect(codes.size).toBeGreaterThan(1);
  });
});
