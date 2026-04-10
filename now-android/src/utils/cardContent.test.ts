import { describe, expect, it } from 'vitest';
import { parseCardContent } from './cardContent';

describe('parseCardContent', () => {
  it('parses a prefix-only content card and preserves an empty body', () => {
    expect(parseCardContent('内容:')).toEqual({
      prefix: '内容',
      separator: ': ',
      body: '',
    });
  });

  it('does not parse aspect ratios as content prefixes', () => {
    expect(parseCardContent('9:16')).toBeNull();
  });
});
