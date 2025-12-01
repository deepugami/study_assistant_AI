import { describe, it, expect, vi } from 'vitest';

// Mock session to avoid next/headers dependency in tests
vi.mock('@/server/session', () => ({
  getSession: async () => ({ userId: 'test-user', currentDocIds: [] })
}));

// getDb is imported by the module but not used for invalid input; provide a noop to be safe
vi.mock('@/server/db', () => ({ getDb: () => ({}) }));

// AI not needed for invalid input path; mock to avoid accidental calls
vi.mock('@/server/ai', () => ({
  generateJSON: vi.fn(),
}));

describe('POST /api/test input validation', async () => {
  const mod = await import('@/app/api/test/route');
  const handler = mod.POST as (req: Request) => Promise<Response>;

  it('returns 400 for invalid body (duration too small, numQuestions too small)', async () => {
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'mcq', durationSec: 30, numQuestions: 2 }),
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j).toHaveProperty('error', 'Invalid input');
  });
});
