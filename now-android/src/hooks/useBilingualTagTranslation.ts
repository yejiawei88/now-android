import { useMemo } from 'react';
import type { TranslationSettings } from '../types';

export type BilingualTagPair = {
  zh: string;
  en: string;
};

type UseBilingualTagTranslationArgs = {
  enabled: boolean;
  tags: string[];
  libraryId: string;
  translationSettings: TranslationSettings;
};

const hasZh = (value: string) => /[\u4e00-\u9fff]/.test(value);
const hasEn = (value: string) => /[A-Za-z]/.test(value);
const normalizeTagText = (value: string): string => value.trim().replace(/\s+/g, ' ');

const classify = (value: string): 'zh' | 'en' | 'mixed' | 'other' => {
  const zh = hasZh(value);
  const en = hasEn(value);
  if (zh && !en) return 'zh';
  if (!zh && en) return 'en';
  if (zh && en) return 'mixed';
  return 'other';
};

const toPair = (left: string, right: string): BilingualTagPair | null => {
  const l = normalizeTagText(left);
  const r = normalizeTagText(right);
  if (!l || !r) return null;

  const lt = classify(l);
  const rt = classify(r);
  if (lt === 'zh' && rt === 'en') return { zh: l, en: r };
  if (lt === 'en' && rt === 'zh') return { zh: r, en: l };
  return null;
};

const parseByPipe = (text: string): BilingualTagPair | null => {
  const pipeIndex = text.indexOf('|');
  if (pipeIndex <= 0 || pipeIndex >= text.length - 1) return null;
  const left = text.slice(0, pipeIndex).trim();
  const right = text.slice(pipeIndex + 1).trim();
  if (!left || !right) return null;
  return toPair(left, right);
};

export const parseBilingualTag = (rawTag: string): BilingualTagPair | null => {
  const text = normalizeTagText(rawTag);
  if (!text) return null;

  // Priority path: persisted bilingual format "original | translation"
  const pipePair = parseByPipe(text);
  if (pipePair) return pipePair;

  // Compatibility: forest/森林, forest 森林, 森林(forest)
  const bracketMatch = text.match(/^(.*?)\s*[\(（]\s*([^()（）]+)\s*[\)）]\s*$/);
  if (bracketMatch) {
    const pair = toPair(bracketMatch[1], bracketMatch[2]);
    if (pair) return pair;
  }

  const separators = [/\s*\/\s*/, /\s*¦\s*/, /\s*\|\s*/];
  for (const separator of separators) {
    const split = text.split(separator);
    if (split.length === 2) {
      const pair = toPair(split[0], split[1]);
      if (pair) return pair;
    }
  }

  const ws = text.split(/\s+/);
  if (ws.length === 2) {
    const pair = toPair(ws[0], ws[1]);
    if (pair) return pair;
  }

  const firstZhIdx = text.search(/[\u4e00-\u9fff]/);
  const firstEnIdx = text.search(/[A-Za-z]/);
  if (firstZhIdx >= 0 && firstEnIdx >= 0) {
    if (firstZhIdx < firstEnIdx) {
      const pair = toPair(text.slice(0, firstEnIdx), text.slice(firstEnIdx));
      if (pair) return pair;
    } else if (firstEnIdx < firstZhIdx) {
      const pair = toPair(text.slice(0, firstZhIdx), text.slice(firstZhIdx));
      if (pair) return pair;
    }
  }

  return null;
};

export const useBilingualTagTranslation = ({
  enabled,
  tags,
  libraryId,
  translationSettings
}: UseBilingualTagTranslationArgs): Record<string, BilingualTagPair> => {
  // Keep the full signature for compatibility with existing call sites.
  void libraryId;
  void translationSettings;

  return useMemo(() => {
    if (!enabled || !Array.isArray(tags) || tags.length === 0) return {};

    const nextPairs: Record<string, BilingualTagPair> = {};
    for (const raw of tags) {
      const normalized = normalizeTagText(raw || '');
      if (!normalized) continue;
      const parsed = parseBilingualTag(normalized);
      if (parsed) nextPairs[normalized] = parsed;
    }
    return nextPairs;
  }, [enabled, tags]);
};

