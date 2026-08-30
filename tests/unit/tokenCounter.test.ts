import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../../src/utils/tokenCounter';

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('scales roughly with word count', () => {
    const short = estimateTokens('hello world');
    const long = estimateTokens('hello world '.repeat(20));
    expect(long).toBeGreaterThan(short * 10);
  });

  it('never returns less than 1 for non-empty input', () => {
    expect(estimateTokens('a')).toBeGreaterThanOrEqual(1);
  });
});
