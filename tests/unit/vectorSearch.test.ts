import { describe, expect, it } from 'vitest';
import { cosineSimilarity, topKBySimilarity } from '../../src/memory/vectorSearch';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('handles null/undefined/mismatched-length inputs safely', () => {
    expect(cosineSimilarity(null, [1, 2])).toBe(0);
    expect(cosineSimilarity(undefined, undefined)).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('handles zero vectors without dividing by zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('topKBySimilarity', () => {
  const query = [1, 0];
  const candidates = [
    { id: 'a', embedding: [1, 0] }, // similarity 1
    { id: 'b', embedding: [0, 1] }, // similarity 0 (excluded, not > 0)
    { id: 'c', embedding: [0.9, 0.1] }, // similarity ~0.994
    { id: 'd', embedding: null }, // no embedding
  ];

  it('ranks by similarity descending and respects the limit', () => {
    const top = topKBySimilarity(query, candidates, 2);
    expect(top.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('excludes non-positive similarity and missing embeddings', () => {
    const top = topKBySimilarity(query, candidates, 10);
    expect(top.map((c) => c.id)).not.toContain('b');
    expect(top.map((c) => c.id)).not.toContain('d');
  });
});
