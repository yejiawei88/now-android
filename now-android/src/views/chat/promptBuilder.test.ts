import { describe, expect, it } from 'vitest';
import { applyPromptToLastUserMessage, buildPromptWithQuote } from './promptBuilder';

describe('buildPromptWithQuote', () => {
  it('returns original prompt when quote is empty', () => {
    expect(buildPromptWithQuote('hello', null)).toBe('hello');
    expect(buildPromptWithQuote('hello', '')).toBe('hello');
    expect(buildPromptWithQuote('hello', '   ')).toBe('hello');
  });

  it('wraps prompt with context and question when quote exists', () => {
    const result = buildPromptWithQuote('How to fix this?', 'selected text');
    expect(result).toBe('Context: "selected text"\n\nQuestion: How to fix this?');
  });
});

describe('applyPromptToLastUserMessage', () => {
  it('replaces last plain-text message when final prompt differs', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'raw input' },
    ];

    const result = applyPromptToLastUserMessage(messages, 'computed prompt', 'raw input');

    expect(result[result.length - 1].content).toBe('computed prompt');
    expect(messages[messages.length - 1].content).toBe('raw input');
  });

  it('replaces text part in multimodal content', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: 'raw input' },
          { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,abc' } },
        ],
      },
    ];

    const result = applyPromptToLastUserMessage(messages, 'computed prompt', 'raw input');
    const content = result[0].content;

    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content[0]).toEqual({ type: 'text', text: 'computed prompt' });
    }
  });

  it('prepends text part when multimodal content has no text segment', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'image_url' as const, image_url: { url: 'data:image/png;base64,abc' } }],
      },
    ];

    const result = applyPromptToLastUserMessage(messages, 'computed prompt', 'raw input');
    const content = result[0].content;

    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content[0]).toEqual({ type: 'text', text: 'computed prompt' });
      expect(content[1].type).toBe('image_url');
    }
  });

  it('returns original reference when prompt is unchanged', () => {
    const messages = [{ role: 'user', content: 'raw input' }];
    const result = applyPromptToLastUserMessage(messages, 'raw input', 'raw input');
    expect(result).toBe(messages);
  });
});
