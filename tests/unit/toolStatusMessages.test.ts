import { describe, expect, it } from 'vitest';
import { describeToolCall, randomThinkingPhrase } from '../../src/telegram/toolStatusMessages';

describe('describeToolCall', () => {
  it('includes the filename for file-based tools', () => {
    expect(describeToolCall('read_file', { filename: 'index.js' })).toContain('index.js');
    expect(describeToolCall('create_file', { filename: 'new.js' })).toContain('new.js');
    expect(describeToolCall('unzip_file', { filename: 'bundle.zip' })).toContain('bundle.zip');
  });

  it('falls back to a generic phrase when args are missing', () => {
    expect(describeToolCall('read_file', {})).toBe('📖 Reading the file...');
  });

  it('handles unknown tool names gracefully', () => {
    expect(describeToolCall('some_future_tool', {})).toContain('some_future_tool');
  });

  it('mentions the language for execute_code', () => {
    expect(describeToolCall('execute_code', { language: 'python' })).toContain('python');
  });
});

describe('randomThinkingPhrase', () => {
  it('always returns a non-empty string', () => {
    for (let i = 0; i < 20; i++) {
      expect(randomThinkingPhrase().length).toBeGreaterThan(0);
    }
  });
});
