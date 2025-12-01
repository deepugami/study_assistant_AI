import { describe, it, expect } from 'vitest';
import { topKSimilar } from '@/server/rag';

describe('topKSimilar (cosine similarity ordering)', () => {
  it('ranks candidates by cosine similarity to the query', () => {
    const query = [1, 0];
    const candidates = [
      { id: 'a', text: 'A', embedding: [1, 0] }, // cos=1
      { id: 'b', text: 'B', embedding: [0.7, 0.7] }, // ~0.7 / ~0.9899 => ~0.707
      { id: 'c', text: 'C', embedding: [0, 1] }, // 0
    ];
    const out = topKSimilar(query, candidates, 3);
    expect(out.map(o => o.id)).toEqual(['a', 'b', 'c']);
    expect(out[0].score).toBeGreaterThan(out[1].score);
    expect(out[1].score).toBeGreaterThan(out[2].score);
  });
});
