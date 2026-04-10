import type { Message } from './types';

export function getMessageText(
  msg: Message,
  imagePlaceholder: string
): string {
  if (typeof msg.content === 'string') return msg.content;
  const textPart = msg.content.find((p) => p.type === 'text');
  return textPart?.text || imagePlaceholder;
}

