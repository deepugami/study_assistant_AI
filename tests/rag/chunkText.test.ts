import { describe, it, expect } from 'vitest';
import { chunkText } from '@/server/rag';

describe('chunkText', () => {
  it('splits text into overlapping word windows', () => {
    const words = 'one two three four five six seven eight nine ten eleven twelve';
    const chunks = chunkText(words, 5, 2);
    // chunkSize=5, overlap=2 => windows: [0..5), [3..8), [6..11), [9..12)
    expect(chunks).toEqual([
      'one two three four five',
      'four five six seven eight',
      'seven eight nine ten eleven',
      'ten eleven twelve',
    ]);
  });

  it('returns entire text when smaller than chunk size', () => {
    const text = 'alpha beta gamma';
    const chunks = chunkText(text, 10, 2);
    expect(chunks).toEqual(['alpha beta gamma']);
  });
});
