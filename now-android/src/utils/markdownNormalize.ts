function normalizeInlineMarkdown(segment: string): string {
  // Common model output issue: spaces next to paired markers break emphasis parsing.
  return segment
    .replace(/(\*\*|__|~~)[ \t\u3000]+([^\n]+?)[ \t\u3000]+\1/g, '$1$2$1')
    .replace(/(\*\*|__|~~)[ \t\u3000]+([^\n]+?)\1/g, '$1$2$1')
    .replace(/(\*\*|__|~~)([^\n]+?)[ \t\u3000]+\1/g, '$1$2$1');
}

export function normalizeMarkdownForRender(input: string): string {
  if (!input) return input;

  // Do not alter fenced code blocks or inline code.
  const fenceAware = input.split(/(```[\s\S]*?```)/g);
  const normalized = fenceAware.map((chunk) => {
    if (chunk.startsWith('```') && chunk.endsWith('```')) return chunk;
    const inlineAware = chunk.split(/(`[^`\n]+`)/g);
    return inlineAware
      .map((part) =>
        part.startsWith('`') && part.endsWith('`')
          ? part
          : normalizeInlineMarkdown(part)
      )
      .join('');
  });

  return normalized.join('');
}
