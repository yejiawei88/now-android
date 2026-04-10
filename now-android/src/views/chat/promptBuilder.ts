import type { MessageContent } from './types';

export type ApiMessage = {
  role: string;
  content: string | MessageContent[];
};

export function buildPromptWithQuote(
  prompt: string,
  contextQuote: string | null | undefined
): string {
  const quote = (contextQuote || '').trim();
  if (!quote) return prompt;
  return `Context: "${quote}"\n\nQuestion: ${prompt}`;
}

export function applyPromptToLastUserMessage(
  apiMessages: ApiMessage[],
  finalPrompt: string,
  originalText: string
): ApiMessage[] {
  if (finalPrompt === originalText || apiMessages.length === 0) return apiMessages;

  const cloned = apiMessages.map((m) => ({
    ...m,
    content: Array.isArray(m.content) ? [...m.content] : m.content,
  }));

  const lastMsg = cloned[cloned.length - 1];
  if (!lastMsg) return cloned;

  if (typeof lastMsg.content === 'string') {
    lastMsg.content = finalPrompt;
    return cloned;
  }

  const textPart = lastMsg.content.find((p) => p.type === 'text');
  if (textPart) {
    textPart.text = finalPrompt;
  } else {
    lastMsg.content.unshift({ type: 'text', text: finalPrompt });
  }

  return cloned;
}
