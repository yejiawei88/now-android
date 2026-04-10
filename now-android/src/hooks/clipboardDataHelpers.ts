import { ClipboardItem } from '../types';
import { repairDisplayText } from '../utils/cardContent';

const FOLDER_TAG_PREFIX = '\uD83D\uDCC1';
const STATUS_TAG_PREFIX = '__status_';
const PARENT_TAG_PREFIX = '__p:';

export const normalizeTags = (raw: unknown): string[] => {
    if (Array.isArray(raw)) {
        return raw
            .filter((tag): tag is string => typeof tag === 'string')
            .map((tag) => repairDisplayText(tag).trim())
            .filter(Boolean);
    }

    if (typeof raw === 'string') {
        const normalized = raw.trim();
        if (!normalized) return [];

        if (normalized.startsWith('[')) {
            try {
                const parsed = JSON.parse(normalized);
                if (Array.isArray(parsed)) {
                    return parsed
                        .filter((tag): tag is string => typeof tag === 'string')
                        .map((tag) => repairDisplayText(tag).trim())
                        .filter(Boolean);
                }
                if (typeof parsed === 'string') return [repairDisplayText(parsed).trim()].filter(Boolean);
            } catch {
                // Fall through to legacy formats.
            }
        }

        if (normalized.includes(',')) {
            return normalized
                .split(',')
                .map((tag) => repairDisplayText(tag).trim())
                .filter(Boolean);
        }

        return [repairDisplayText(normalized).trim()].filter(Boolean);
    }

    return [];
};

export const normalizeItem = (raw: ClipboardItem & { tags?: unknown }): ClipboardItem => ({
    ...raw,
    category: typeof raw.category === 'string' ? repairDisplayText(raw.category).trim() : raw.category,
    title: typeof raw.title === 'string' ? repairDisplayText(raw.title) : undefined,
    body: typeof raw.body === 'string' ? repairDisplayText(raw.body) : undefined,
    tags: normalizeTags(raw.tags),
});

export const getVisibleTags = (rawTags: ClipboardItem['tags']) =>
    normalizeTags(rawTags).filter((tag) => !tag.startsWith(STATUS_TAG_PREFIX) && !tag.startsWith(PARENT_TAG_PREFIX));

export const getParentId = (item: ClipboardItem) =>
    normalizeTags(item.tags).find((tag) => tag.startsWith(PARENT_TAG_PREFIX))?.slice(PARENT_TAG_PREFIX.length) || null;

export const getDocumentContentMap = (rawContent: string): Record<string, string> => {
    try {
        const parsed = JSON.parse(rawContent);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return Object.entries(parsed).reduce<Record<string, string>>((acc, [key, value]) => {
                acc[key] = typeof value === 'string' ? value : String(value ?? '');
                return acc;
            }, {});
        }
    } catch {
        // Fall back to raw content below.
    }

    return {};
};

export const getDocumentEntryPayload = (item: ClipboardItem, tagName: string) => {
    const contentMap = getDocumentContentMap(item.content);
    const visibleTags = getVisibleTags(item.tags);
    const fallbackRawContent =
        Object.keys(contentMap).length === 0 &&
        ((visibleTags.length === 1 && visibleTags[0] === tagName) ||
            (visibleTags.length === 2 && visibleTags[1] === tagName))
            ? (item.content === '{}' ? '' : item.content)
            : '';

    return {
        content: contentMap[tagName] ?? fallbackRawContent,
        status: contentMap[`${STATUS_TAG_PREFIX}${tagName}`],
        contentMap,
    };
};

export const hasLoadedDocumentContent = (item?: ClipboardItem | null) =>
    item?.type !== 'DOCUMENT' || item?.documentContentLoaded !== false;

export const getWritableDocumentContentMap = (item: ClipboardItem): Record<string, string> => {
    const parsed = getDocumentContentMap(item.content);
    if (Object.keys(parsed).length > 0) {
        return { ...parsed };
    }

    const visibleTags = getVisibleTags(item.tags);
    if (visibleTags.length === 1) {
        const onlyTag = visibleTags[0];
        return {
            [onlyTag]: item.content === '{}' ? '' : item.content,
        };
    }

    return {};
};

export const getFolderDisplayName = (rawTag: string, language: 'zh' | 'en' | undefined) => {
    const cleaned = rawTag.replace(FOLDER_TAG_PREFIX, '').trim();
    if (cleaned) {
        return cleaned;
    }

    return language === 'en' ? 'New Folder' : '新文件夹';
};

export const generateItemId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};
