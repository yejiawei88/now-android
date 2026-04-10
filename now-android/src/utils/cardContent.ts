export type ParsedCardContent = {
  prefix: string;
  separator: string;
  body: string;
};

const LEGACY_DELIMITER_RE = /\t+\s*,\s*\t+/g;
const BROKEN_QUOTE_BEFORE_COLON_RE = /[\u201D\uFF02"']\s*([:\uFF1A])/g;
const COMMON_MOJIBAKE_MAP: Array<[string, string]> = [
  ['\u9350\u546d\ue190', '\u5185\u5bb9'],
  ['\u93cd\u56e9\ue137', '\u6807\u7b7e'],
  ['\u93c8\ue044\u61e1\u935a\u003f', '\u672a\u547d\u540d'],
  ['\u5bb8\u63d2\u756c\u93b4\u003f', '\u5df2\u5b8c\u6210'],
];
const LIKELY_MOJIBAKE_RE = /(?:ll[\u4e00-\u9fff]{1,4}|绾[\u4e00-\u9fff]{2,8}|震苤|(?:鍝|媧|瑙|嗛|塊|茬|宸)[\u4e00-\u9fff]{1,6})/;

export const repairCommonMojibake = (input: string): string =>
  COMMON_MOJIBAKE_MAP.reduce(
    (text, [broken, fixed]) => text.replaceAll(broken, fixed),
    input || ''
  );

export const isLikelyMojibakeText = (input: string): boolean =>
  Boolean(input && LIKELY_MOJIBAKE_RE.test(input));

export const repairDisplayText = (input: string): string =>
  repairCommonMojibake(input || '');

export const normalizeLegacyCardText = (input: string): string =>
  repairDisplayText(input || '')
    .replace(LEGACY_DELIMITER_RE, '\uFF0C')
    .replace(BROKEN_QUOTE_BEFORE_COLON_RE, '$1')
    .replace(/\u00a0/g, ' ');

export const parseCardContent = (input: string): ParsedCardContent | null => {
  const normalized = normalizeLegacyCardText(input).trim();
  if (!normalized) return null;

  // Preserve ratio-like values (e.g. 9:16 / 1:1), including optional trailing separators.
  if (/^\d+(?:\.\d+)?\s*[:\uFF1A]\s*\d+(?:\.\d+)?(?:\s*[,\uFF0C\u3001\uFF1B])?$/.test(normalized)) {
    return null;
  }

  const commaMatch = normalized.match(/^([^\n,\uFF0C]{1,24}?)\s*([,\uFF0C])\s*([\s\S]*)$/);
  const colonMatch = normalized.match(/^([^\n:\uFF1A]{1,40}?)\s*([:\uFF1A])\s*([\s\S]*)$/);
  const firstCommaIdx = normalized.search(/[,\uFF0C]/);
  const firstColonIdx = normalized.search(/[:\uFF1A]/);

  if (
    commaMatch &&
    firstCommaIdx >= 0 &&
    (firstColonIdx < 0 || firstCommaIdx < firstColonIdx)
  ) {
    return {
      prefix: commaMatch[1].trim(),
      separator: `${commaMatch[2]} `,
      body: commaMatch[3].trim(),
    };
  }

  if (colonMatch) {
    return {
      prefix: colonMatch[1].trim(),
      separator: `${colonMatch[2]} `,
      body: colonMatch[3].trim(),
    };
  }

  if (commaMatch) {
    return {
      prefix: commaMatch[1].trim(),
      separator: `${commaMatch[2]} `,
      body: commaMatch[3].trim(),
    };
  }

  return null;
};

export const extractCardPasteContent = (input: string): string => {
  const normalized = normalizeLegacyCardText(input).trim();
  const parsed = parseCardContent(normalized);
  return parsed ? parsed.body : normalized;
};
