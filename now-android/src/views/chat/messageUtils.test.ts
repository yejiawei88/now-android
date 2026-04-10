import { describe, expect, it } from 'vitest';
import { getMessageText } from './messageUtils';
import type { Message } from './types';

describe('getMessageText', () => {
  it('returns plain string content directly', () => {
    const msg: Message = { role: 'user', content: 'hello world' };
    expect(getMessageText(msg, '[image]')).toBe('hello world');
  });

  it('returns text part from multimodal content', () => {
    const msg: Message = {
      role: 'assistant',
      content: [
        { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
        { type: 'text', text: 'answer' },
      ],
    };
    expect(getMessageText(msg, '[image]')).toBe('answer');
  });

  it('falls back to placeholder when no text part exists', () => {
    const msg: Message = {
      role: 'assistant',
      content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }],
    };
    expect(getMessageText(msg, '[image]')).toBe('[image]');
  });
});
