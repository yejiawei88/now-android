import { describe, expect, it } from 'vitest';
import { normalizeMarkdownForRender } from './markdownNormalize';

describe('normalizeMarkdownForRender', () => {
  it('normalizes spaced paired markdown markers', () => {
    const input = 'This is ** bold text ** and ~~ strike ~~';
    const output = normalizeMarkdownForRender(input);
    expect(output).toBe('This is **bold text** and ~~strike~~');
  });

  it('does not alter fenced code blocks', () => {
    const input = '```md\n** bold text **\n```';
    const output = normalizeMarkdownForRender(input);
    expect(output).toBe(input);
  });

  it('does not alter inline code segments', () => {
    const input = 'Use `** bold text **` in docs';
    const output = normalizeMarkdownForRender(input);
    expect(output).toBe(input);
  });
});
