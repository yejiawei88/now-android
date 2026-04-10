import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import { createPortal } from 'react-dom';
import { TranslationSettings, ClipboardItem } from '../types';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TagItem } from './TagItem';
import { translations } from '../i18n';
import { STYLES } from '../constants';
import { logger } from '../utils';
import { BackendService } from '../backend';
import { parseBilingualTag, useBilingualTagTranslation } from '../hooks/useBilingualTagTranslation';

import { useDroppable } from '@dnd-kit/core';

interface SortableTagProps {
    id: string;
    tag: string;
    onRemove?: (tag: string) => void;
    isNew?: boolean;
    bilingualTag?: { zh: string; en: string } | null;
    onBilingualSegmentClick?: (segment: 'left' | 'right', text: string, e: React.MouseEvent) => void;
}

const toOriginalFirstBilingualTag = (rawTag: string, pair: { zh: string; en: string } | null) => {
    if (!pair) return null;
    const raw = (rawTag || '').trim();
    const hasZhOnly = /[\u4e00-\u9fff]/.test(raw) && !/[A-Za-z]/.test(raw);
    const hasEnOnly = /[A-Za-z]/.test(raw) && !/[\u4e00-\u9fff]/.test(raw);

    if (hasZhOnly) return { left: pair.zh, right: pair.en };
    if (hasEnOnly) return { left: pair.en, right: pair.zh };

    const enIdx = raw.toLowerCase().indexOf(pair.en.toLowerCase());
    const zhIdx = raw.indexOf(pair.zh);
    if (enIdx >= 0 && zhIdx >= 0) {
        return enIdx <= zhIdx
            ? { left: pair.en, right: pair.zh }
            : { left: pair.zh, right: pair.en };
    }

    return { left: pair.zh, right: pair.en };
};

const parseTags = (input: string): string[] => {
    // 1. Protect Hex Colors (e.g. #FFFFFF, #abc)
    // Use a temporary placeholder that won't conflict with regex splitters
    const protectedInput = input.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, '___COLOR_HASH___$1');

    // 2. Normalize Chinese punctuation / colon to comma separators.
    // Keep ratio-like values such as 16:9 / 16：9 intact.
    const normalized = (() => {
        const text = protectedInput.replace(/(\d)\s*：\s*(\d)/g, '$1:$2');
        const chars = Array.from(text);
        const out: string[] = [];
        const hardSeparators = new Set([',', '，', '、', '；', ';', '。']);

        const findPrevNonSpace = (index: number): string => {
            for (let i = index - 1; i >= 0; i -= 1) {
                const ch = chars[i];
                if (!/\s/.test(ch)) return ch;
            }
            return '';
        };
        const findNextNonSpace = (index: number): string => {
            for (let i = index + 1; i < chars.length; i += 1) {
                const ch = chars[i];
                if (!/\s/.test(ch)) return ch;
            }
            return '';
        };

        for (let i = 0; i < chars.length; i += 1) {
            const ch = chars[i];

            if (hardSeparators.has(ch)) {
                out.push(',');
                continue;
            }

            if (ch === ':' || ch === '：') {
                const prev = findPrevNonSpace(i);
                const next = findNextNonSpace(i);
                const isRatio = /\d/.test(prev) && /\d/.test(next);
                out.push(isRatio ? ':' : ',');
                continue;
            }

            out.push(ch);
        }

        return out.join('');
    })();

    // 3. Standard Split Logic
    return normalized
        .replace(/[\n\r]|(?:[-*•]\s+)/g, ',') // Convert newlines/lists to commas
        .split(',') // Split by unified separators
        .map(t => t.trim().replace(/___COLOR_HASH___/g, '#')) // Restore # and trim
        .filter(t => t.length > 0);
};

const cleanAiTag = (raw: string): string => {
    return raw
        .replace(/^\s*[\[\(\{]+/, '')
        .replace(/[\]\)\}]+\s*$/, '')
        .replace(/^\s*["']+/, '')
        .replace(/["']+\s*$/, '')
        .replace(/^\s*(?:[-*•]|\d+[.)、])\s+/, '')
        .replace(/[，。;；]+$/g, '')
        .trim();
};

const GENERIC_TAGS_ZH = new Set([
    '特效', '效果', '视觉效果', '素材', '设计', '风格', '艺术', '创意', '高级感', '质感', '镜头感'
]);

const GENERIC_TAGS_EN = new Set([
    'effect', 'effects', 'visual effect', 'visual effects', 'style', 'design', 'creative', 'material'
]);

const getDominantTagLang = (tags: string[]): 'zh' | 'en' | 'other' => {
    let zh = 0;
    let en = 0;
    for (const tag of tags) {
        const lang = detectTagLang(tag);
        if (lang === 'zh') zh += 1;
        if (lang === 'en') en += 1;
    }
    if (zh > en) return 'zh';
    if (en > zh) return 'en';
    return 'other';
};

const uniqueChineseChars = (value: string): Set<string> => {
    const matches = value.match(/[\u4e00-\u9fff]/g) || [];
    return new Set(matches);
};

const englishTokens = (value: string): string[] => {
    return value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
};

const countTokenOverlap = (a: string[], b: string[]): number => {
    if (a.length === 0 || b.length === 0) return 0;
    const setB = new Set(b);
    let count = 0;
    for (const token of a) {
        if (setB.has(token)) count += 1;
    }
    return count;
};

const relevanceScore = (
    candidateRaw: string,
    seedTags: string[],
    dominantLang: 'zh' | 'en' | 'other',
    titleTag?: string
): number => {
    const candidate = candidateRaw.trim();
    if (!candidate) return -999;

    let score = 0;
    const candidateLower = candidate.toLowerCase();
    const lang = detectTagLang(candidate);

    if (dominantLang !== 'other' && lang === dominantLang) score += 1.2;
    if (dominantLang !== 'other' && lang !== dominantLang && lang !== 'other') score -= 0.8;

    if (lang === 'zh' && GENERIC_TAGS_ZH.has(candidate)) score -= 2.2;
    if (lang === 'en' && GENERIC_TAGS_EN.has(candidateLower)) score -= 2.2;

    const candZh = uniqueChineseChars(candidate);
    const candEn = englishTokens(candidate);
    const normalizedTitle = (titleTag || '').trim();
    const titleLower = normalizedTitle.toLowerCase();
    const titleZh = uniqueChineseChars(normalizedTitle);
    const titleEn = englishTokens(normalizedTitle);

    if (normalizedTitle) {
        if (candidateLower.includes(titleLower) || titleLower.includes(candidateLower)) {
            score += 3.8;
        }

        let hasTitleOverlap = false;

        if (candZh.size > 0 && titleZh.size > 0) {
            let overlap = 0;
            for (const ch of candZh) {
                if (titleZh.has(ch)) overlap += 1;
            }
            if (overlap >= 2) {
                score += 2.2;
                hasTitleOverlap = true;
            } else if (overlap === 1) {
                score += 0.9;
                hasTitleOverlap = true;
            }
        }

        const titleOverlap = countTokenOverlap(candEn, titleEn);
        if (titleOverlap >= 2) {
            score += 2.4;
            hasTitleOverlap = true;
        } else if (titleOverlap === 1) {
            score += 1.1;
            hasTitleOverlap = true;
        }

        if (!hasTitleOverlap) score -= 1.4;
    }

    for (const seedRaw of seedTags) {
        const seed = seedRaw.trim();
        if (!seed) continue;
        const seedLower = seed.toLowerCase();

        if (candidateLower === seedLower) {
            score -= 5;
            continue;
        }

        if (candidateLower.includes(seedLower) || seedLower.includes(candidateLower)) {
            score += 2.8;
        }

        const seedZh = uniqueChineseChars(seed);
        if (candZh.size > 0 && seedZh.size > 0) {
            let overlap = 0;
            for (const ch of candZh) {
                if (seedZh.has(ch)) overlap += 1;
            }
            if (overlap >= 2) score += 1.6;
            else if (overlap === 1) score += 0.6;
        }

        const seedEn = englishTokens(seed);
        const enOverlap = countTokenOverlap(candEn, seedEn);
        if (enOverlap >= 2) score += 1.8;
        else if (enOverlap === 1) score += 0.8;
    }

    return score;
};

const rankRelatedTags = (candidateTags: string[], seedTags: string[], titleTag?: string): string[] => {
    const dominantLang = getDominantTagLang(seedTags);
    const scored = candidateTags.map((tag, index) => ({
        tag,
        index,
        score: relevanceScore(tag, seedTags, dominantLang, titleTag)
    }));

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
    });

    const filtered = scored
        .filter((item) => item.score >= 1.2)
        .map((item) => item.tag);
    if (filtered.length > 0) return filtered;
    return scored.map((item) => item.tag);
};

const detectTagLang = (value: string): 'zh' | 'en' | 'other' => {
    const hasZh = /[\u4e00-\u9fff]/.test(value);
    const hasEn = /[A-Za-z]/.test(value);
    if (hasZh && !hasEn) return 'zh';
    if (hasEn && !hasZh) return 'en';
    return 'other';
};

const splitPipeTag = (value: string): { left: string; right: string } | null => {
    const idx = value.indexOf(' | ');
    if (idx < 0) return null;
    const left = value.slice(0, idx).trim();
    const right = value.slice(idx + 3).trim();
    if (!left || !right) return null;
    return { left, right };
};

const getTagSourceText = (rawTag: string): string => {
    const value = (rawTag || '').trim();
    if (!value) return '';
    const pipe = splitPipeTag(value);
    return pipe ? pipe.left : value;
};

const normalizeTagEditorInput = (value: string): string => {
    if (!value) return '';
    return value
        .split(/\r?\n/)
        .map((line) => line
            .replace(/，/g, ',')
            .replace(/,\s*,+/g, ',')
            .replace(/\s{2,}/g, ' ')
        )
        .join('\n');
};

const SortableTag = ({ id, tag, onRemove, isNew, bilingualTag, onBilingualSegmentClick }: SortableTagProps) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });

    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform),
        transition: isDragging ? 'none' : transition,
        opacity: isDragging ? 0 : 1,
    };

    return (
        <TagItem
            ref={setNodeRef}
            style={style}
            tag={tag}
            compact
            bilingualTag={toOriginalFirstBilingualTag(tag, bilingualTag)}
            onBilingualSegmentClick={onBilingualSegmentClick}
            onRemove={onRemove}
            attributes={attributes}
            listeners={listeners}
            className={isNew ? "bg-black border border-white/20" : "bg-gradient-to-br from-[#121214] to-[#09090B]"}
        />
    );
};



const TrashDropZone = ({ language }: { language?: 'zh' | 'en' }) => {
    const { setNodeRef, isOver } = useDroppable({
        id: 'trash-zone',
    });

    return (
        <div
            ref={setNodeRef}
            className={`w-full h-full rounded-xl border-2 border-dashed flex items-center justify-center animate-in fade-in slide-in-from-right-4 duration-200
            ${isOver
                    ? 'bg-white/10 border-white/40 text-white'
                    : 'bg-[#09090B] border-white/10 text-white/40'
                }`}
        >
            <Icon name="delete_sweep" className="!text-[24px] pointer-events-none" size={24} />
        </div>
    );
};

interface ClipboardItemModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialData: {
        content: string;
        tags: string[];
        name?: string;
        tab?: 'CONTENT' | 'TAGS' | 'DOCUMENT';
    } | null;
    translationSettings: TranslationSettings;
    activeLibraryId: string;
    activeLibraryName?: string;
    activeGroupName?: string;
    bilingualTagsEnabled?: boolean;
    onUpdateBilingualTagsEnabled?: (next: boolean) => void;
    onOpenSettings?: () => void;
    onSave: (items: { content: string, tags: string[], type: 'TEXT' | 'LINK' | 'CODE' | 'TAGS' | 'IMAGE' | 'DOCUMENT', title?: string, body?: string, name?: string, editingItemId?: string }[]) => void;
    initialConfig?: {
        mode: 'CONTENT' | 'TAGS' | 'DOCUMENT';
        isBatch: boolean;
        batchType?: 'CONTENT' | 'TAGS';
    } | null;
    editingItemId?: string | null;
    language?: 'zh' | 'en';
    isFullScreen?: boolean;
}

interface TagEditorSnapshot {
    title: string;
    content: string;
    tags: string;
}

const ClipboardItemModal: React.FC<ClipboardItemModalProps> = ({
    isOpen,
    onClose,
    initialData,
    initialConfig,
    translationSettings,
    activeLibraryId,
    activeLibraryName = '',
    activeGroupName = '',
    bilingualTagsEnabled = false,
    onUpdateBilingualTagsEnabled,
    onOpenSettings,
    onSave,
    editingItemId = null,
    language,
    isFullScreen = false
}) => {
    const t = translations[language || 'zh'];
    const [modalTitle, setModalTitle] = useState('');
    const [modalContent, setModalContent] = useState('');
    const [modalName, setModalName] = useState('');
    const [modalTags, setModalTags] = useState('');
    const [modalTagTitle, setModalTagTitle] = useState('');
    const [modalTagContent, setModalTagContent] = useState('');
    const [isBatchMode, setIsBatchMode] = useState(false);
    const [activeModalTab, setActiveModalTab] = useState<'CONTENT' | 'TAGS' | 'DOCUMENT'>('CONTENT');
    const [batchModeType, setBatchModeType] = useState<'CONTENT' | 'TAGS'>('CONTENT');
    const [aiPrompt, setAiPrompt] = useState('');
    const [showAiPromptModal, setShowAiPromptModal] = useState(false);
    const [isLoadingAi, setIsLoadingAi] = useState(false);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const [showBilingualConfigModal, setShowBilingualConfigModal] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [bilingualToggleAnimating, setBilingualToggleAnimating] = useState(false);
    const [tagCloudAnimating, setTagCloudAnimating] = useState(false);
    const [isTogglingBilingual, setIsTogglingBilingual] = useState(false);
    const toggleAnimTimerRef = useRef<number | null>(null);
    const bilingualToggleBusyRef = useRef(false);
    const bilingualToggleGuardUntilRef = useRef(0);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const currentTags = React.useMemo(() => {
        return parseTags(modalTags);
    }, [modalTags]);

    const composeTagString = React.useCallback((title: string, content: string) => {
        const titlePart = title.trim();
        const contentTags = parseTags(content).map((tag) => tag.trim()).filter(Boolean);
        const merged = [...(titlePart ? [titlePart] : []), ...contentTags];
        if (!bilingualTagsEnabled) return merged.join(', ');

        const existingBySource = new Map<string, string>();
        for (const raw of parseTags(modalTags)) {
            const trimmed = raw.trim();
            if (!trimmed) continue;
            const source = getTagSourceText(trimmed);
            if (source && !existingBySource.has(source)) {
                existingBySource.set(source, trimmed);
            }
        }

        return merged.map((source) => existingBySource.get(source) || source).join(', ');
    }, [bilingualTagsEnabled, modalTags]);

    const itemsWithIds = React.useMemo(() => {
        return currentTags.map((tag, index) => ({ id: `${tag}-|-${index}`, tag }));
    }, [currentTags]);
    const modalTranslationTags = React.useMemo(() => currentTags.slice(0, 40), [currentTags]);
    const modalBilingualPairs = useBilingualTagTranslation({
        enabled: Boolean(isFullScreen && bilingualTagsEnabled && activeModalTab === 'TAGS' && !isBatchMode),
        tags: modalTranslationTags,
        libraryId: activeLibraryId,
        translationSettings
    });

    const hasConfiguredTranslationApi = React.useMemo(() => {
        const provider = translationSettings?.provider;
        if (provider === 'API') {
            return Boolean((translationSettings?.apiKey || '').trim() && (translationSettings?.endpoint || '').trim());
        }
        if (provider === 'BUILTIN') return true;
        if (provider === 'YOUDAO') {
            return Boolean((translationSettings?.youdaoAppKey || '').trim() && (translationSettings?.youdaoAppSecret || '').trim());
        }
        if (provider === 'GOOGLE') return true;
        return false;
    }, [translationSettings]);
    const hasConfiguredAiApi = React.useMemo(() => {
        return Boolean((translationSettings?.apiKey || '').trim() && (translationSettings?.endpoint || '').trim());
    }, [translationSettings]);
    const ensureAiApiConfigured = React.useCallback(() => {
        if (hasConfiguredAiApi) return true;
        setShowBilingualConfigModal(true);
        return false;
    }, [hasConfiguredAiApi]);

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleRemoveTag = (index: number) => {
        const newTags = [...currentTags];
        newTags.splice(index, 1);
        updateTagSnapshot(createSnapshotFromTags(newTags.join(', ')));
    };
    const copySegmentText = React.useCallback(async (text: string) => {
        const value = (text || '').trim();
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
        } catch (error) {
            logger.error('Copy bilingual segment failed', error);
        }
    }, []);

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        if (over.id === 'trash-zone') {
            const activeIdStr = active.id as string;
            const [_, indexStr] = activeIdStr.split('-|-');
            handleRemoveTag(parseInt(indexStr));
            return;
        }

        if (active.id !== over.id) {
            const oldIndex = itemsWithIds.findIndex(item => item.id === active.id);
            const newIndex = itemsWithIds.findIndex(item => item.id === over.id);
            const newTags = arrayMove(currentTags, oldIndex, newIndex);
            updateTagSnapshot(createSnapshotFromTags(newTags.join(', ')));
        }
    };

    const [isAiReviewing, setIsAiReviewing] = useState(false);
    const [preAiState, setPreAiState] = useState<{ content: string, tags: string } | null>(null);
    const wasOpenRef = useRef(false);
    const initializedForRef = useRef('');
    const tagUndoStackRef = useRef<TagEditorSnapshot[]>([]);
    const tagRedoStackRef = useRef<TagEditorSnapshot[]>([]);
    const tagEditorFocusRef = useRef<null | 'title' | 'content'>(null);

    const areTagSnapshotsEqual = React.useCallback((a: TagEditorSnapshot, b: TagEditorSnapshot) => {
        return a.title === b.title && a.content === b.content && a.tags === b.tags;
    }, []);

    const createSnapshotFromTags = React.useCallback((tagText: string): TagEditorSnapshot => {
        const parsed = parseTags(tagText);
        const editorParsed = bilingualTagsEnabled
            ? parsed.map((tag) => getTagSourceText(tag)).filter(Boolean)
            : parsed;
        return {
            title: editorParsed[0] || '',
            content: editorParsed.slice(1).join(', '),
            tags: parsed.join(', ')
        };
    }, [bilingualTagsEnabled]);

    const getCurrentTagSnapshot = React.useCallback((): TagEditorSnapshot => {
        return {
            title: modalTagTitle,
            content: modalTagContent,
            tags: modalTags
        };
    }, [modalTagTitle, modalTagContent, modalTags]);

    const applyTagSnapshot = React.useCallback((snapshot: TagEditorSnapshot) => {
        setModalTagTitle(snapshot.title);
        setModalTagContent(snapshot.content);
        setModalTags(snapshot.tags);
    }, []);

    const updateTagSnapshot = React.useCallback((snapshot: TagEditorSnapshot, options?: { skipHistory?: boolean }) => {
        const current = getCurrentTagSnapshot();
        if (areTagSnapshotsEqual(current, snapshot)) return;

        if (!options?.skipHistory) {
            const stack = tagUndoStackRef.current;
            if (stack.length === 0 || !areTagSnapshotsEqual(stack[stack.length - 1], current)) {
                stack.push(current);
                if (stack.length > 100) stack.shift();
            }
            tagRedoStackRef.current = [];
        }

        applyTagSnapshot(snapshot);
    }, [applyTagSnapshot, areTagSnapshotsEqual, getCurrentTagSnapshot]);

    const undoTagSnapshot = React.useCallback(() => {
        if (!isOpen || activeModalTab !== 'TAGS' || isBatchMode) return;
        const stack = tagUndoStackRef.current;
        if (stack.length === 0) return;

        const current = getCurrentTagSnapshot();
        let previous = stack.pop();
        while (previous && areTagSnapshotsEqual(previous, current) && stack.length > 0) {
            previous = stack.pop();
        }
        if (!previous || areTagSnapshotsEqual(previous, current)) return;

        const redo = tagRedoStackRef.current;
        if (redo.length === 0 || !areTagSnapshotsEqual(redo[redo.length - 1], current)) {
            redo.push(current);
            if (redo.length > 100) redo.shift();
        }
        updateTagSnapshot(previous, { skipHistory: true });
    }, [activeModalTab, areTagSnapshotsEqual, getCurrentTagSnapshot, isBatchMode, isOpen, updateTagSnapshot]);

    const handleSplitTags = React.useCallback(() => {
        const splitTags = parseTags(modalTags).join(', ');
        updateTagSnapshot(createSnapshotFromTags(splitTags));
    }, [createSnapshotFromTags, modalTags, updateTagSnapshot]);

    const requestTagTranslation = React.useCallback(async (sourceText: string): Promise<string | null> => {
        const sourceType = detectTagLang(sourceText);
        if (sourceType === 'other') return null;
        const targetLanguage = sourceType === 'zh' ? 'English' : 'Chinese';
        const prompt = `Translate this ${sourceType === 'zh' ? 'Chinese' : 'English'} tag to ${targetLanguage}. Return only the translated tag text, no explanation.\nTag: ${sourceText}`;
        const backend = BackendService.getInstance();
        const result = await backend.chat(
            translationSettings,
            [{ role: 'user', content: prompt }],
            { isTranslation: true }
        );
        const cleaned = (result || '').trim();
        if (!cleaned || cleaned.startsWith('Error:')) return null;
        if (cleaned.toLowerCase().includes('api key') || cleaned.toLowerCase().includes('error')) return null;
        return cleaned;
    }, [translationSettings]);

    const buildPipeBilingualTags = React.useCallback(async (tags: string[]): Promise<string[]> => {
        const pairs = await Promise.all(tags.map(async (raw) => {
            const tag = raw.trim();
            if (!tag) return null;
            const existingPipe = splitPipeTag(tag);
            if (existingPipe) return `${existingPipe.left} | ${existingPipe.right}`;
            const parsed = parseBilingualTag(tag);
            if (parsed) {
                const enIdx = tag.toLowerCase().indexOf(parsed.en.toLowerCase());
                const zhIdx = tag.indexOf(parsed.zh);
                if (enIdx >= 0 && zhIdx >= 0 && enIdx < zhIdx) return `${parsed.en} | ${parsed.zh}`;
                return `${parsed.zh} | ${parsed.en}`;
            }
            const translated = await requestTagTranslation(tag);
            if (!translated || translated === tag) return tag;
            return `${tag} | ${translated}`;
        }));
        return pairs.filter((value): value is string => Boolean(value));
    }, [requestTagTranslation]);

    const stripPipeBilingualTags = React.useCallback((tags: string[]): string[] => {
        return tags
            .map((raw) => {
                const pipe = splitPipeTag(raw.trim());
                if (!pipe) return raw.trim();
                return pipe.left;
            })
            .filter(Boolean);
    }, []);

    const handleToggleBilingual = React.useCallback(async () => {
        const now = Date.now();
        if (isLoadingAi || isTogglingBilingual || bilingualToggleBusyRef.current || now < bilingualToggleGuardUntilRef.current) return;
        bilingualToggleBusyRef.current = true;
        bilingualToggleGuardUntilRef.current = now + 320;
        setIsTogglingBilingual(true);
        if (toggleAnimTimerRef.current) window.clearTimeout(toggleAnimTimerRef.current);
        setBilingualToggleAnimating(true);
        setTagCloudAnimating(true);
        toggleAnimTimerRef.current = window.setTimeout(() => {
            setBilingualToggleAnimating(false);
            setTagCloudAnimating(false);
            toggleAnimTimerRef.current = null;
        }, 280);
        try {
            if (!bilingualTagsEnabled && !hasConfiguredTranslationApi) {
                setShowBilingualConfigModal(true);
                return;
            }
            const rawTags = parseTags(modalTags);
            if (!bilingualTagsEnabled) {
                setIsLoadingAi(true);
                try {
                    const bilingualTags = await buildPipeBilingualTags(rawTags);
                    if (bilingualTags.length > 0) {
                        updateTagSnapshot(createSnapshotFromTags(bilingualTags.join(', ')));
                    }
                    onUpdateBilingualTagsEnabled?.(true);
                } finally {
                    setIsLoadingAi(false);
                }
                return;
            }
            const stripped = stripPipeBilingualTags(rawTags);
            updateTagSnapshot(createSnapshotFromTags(stripped.join(', ')));
            onUpdateBilingualTagsEnabled?.(false);
        } finally {
            setIsTogglingBilingual(false);
            bilingualToggleBusyRef.current = false;
        }
    }, [
        bilingualTagsEnabled,
        buildPipeBilingualTags,
        createSnapshotFromTags,
        hasConfiguredTranslationApi,
        isLoadingAi,
        isTogglingBilingual,
        modalTags,
        onUpdateBilingualTagsEnabled,
        stripPipeBilingualTags,
        updateTagSnapshot
    ]);

    useEffect(() => {
        return () => {
            if (toggleAnimTimerRef.current) {
                window.clearTimeout(toggleAnimTimerRef.current);
                toggleAnimTimerRef.current = null;
            }
        };
    }, []);

    const handleAiGenerate = async () => {
        if (!modalTags.trim()) return;
        if (!ensureAiApiConfigured()) return;

        // Backup state before generation
        setPreAiState({ content: modalContent, tags: modalTags });
        setIsAiReviewing(true);
        setIsLoadingAi(true);

        try {
            const backend = BackendService.getInstance();
            const aiSettings = { ...translationSettings, provider: 'API' as const };
            const seedTags = parseTags(modalTags).map(cleanAiTag).filter(Boolean);
            const titleTag = (seedTags[0] || modalTagTitle || '').trim();
            const libraryName = (activeLibraryName || '').trim();
            const groupName = (activeGroupName || '').trim();

            const userInstruction = aiPrompt?.trim()
                ? `\n\n额外要求：\n${aiPrompt.trim()}\n`
                : '';

            const enhancedPrompt =
                `下面是一组已有关键词（逗号分隔）：\n` +
                `${modalTags}\n\n` +
                `可用上下文（若相关再使用）：\n` +
                `${libraryName ? `- 库名：${libraryName}\n` : ''}` +
                `${groupName ? `- 组名：${groupName}\n` : ''}` +
                `${titleTag ? `- 第一标签（标题）：${titleTag}\n` : ''}` +
                `\n` +
                `请先判断上下文与关键词是否同一主题：\n` +
                `- 如果“库名/组名/第一标签”与当前关键词明显相关，则参考这些上下文生成\n` +
                `- 如果相关性弱或无关，忽略上下文，只基于当前关键词生成\n` +
                `\n` +
                `输出要求：\n` +
                `- 只输出新增词汇，用逗号分隔\n` +
                `- 不要重复已有词汇\n` +
                `- 与输入保持同一层级（尽量具体，不要过于宽泛）\n` +
                `- 词汇风格/语言与输入保持一致\n` +
                `- 不要输出“特效/效果/素材/创意/设计/风格”等泛词，除非输入里已出现\n` +
                `- 不要输出任何其它内容\n` +
                userInstruction;

            const res = await backend.chat(
                aiSettings,
                [
                    {
                        role: 'system',
                        content:
                            'You are a keyword expansion assistant. Output only new tags, comma separated, with no explanation.',
                    },
                    {
                        role: 'user',
                        content: enhancedPrompt,
                    },
                ],
                { isTranslation: false }
            );

            if (!res || res.startsWith('Error:')) {
                logger.error('AI Generation Failed', res);
                setIsAiReviewing(false);
                return;
            }

            const existing = new Set(seedTags.map(t => t.toLowerCase()));
            const candidates = parseTags(res).map(cleanAiTag).filter(Boolean);
            const newTags = candidates.filter(t => !existing.has(t.toLowerCase()));
            const rankedTags = rankRelatedTags(newTags, seedTags, titleTag);
            const finalNewTags = rankedTags.slice(0, 18);

            if (finalNewTags.length > 0) {
                const addedTagsString = finalNewTags.join(', ');
                const trimmed = modalTags.trim();
                const nextTags = (() => {
                    if (!trimmed) return addedTagsString;
                    const lastChar = trimmed.slice(-1);
                    if (lastChar === ',' || lastChar === '，') {
                        return trimmed + ' ' + addedTagsString;
                    }
                    return trimmed + ', ' + addedTagsString;
                })();
                if (bilingualTagsEnabled) {
                    const bilingualTags = await buildPipeBilingualTags(parseTags(nextTags));
                    updateTagSnapshot(createSnapshotFromTags(bilingualTags.join(', ')));
                } else {
                    updateTagSnapshot(createSnapshotFromTags(nextTags));
                }
            }
        } catch (error) {
            logger.error("AI Generation Failed", error);
            setIsAiReviewing(false); // Reset on error
        } finally {
            setIsLoadingAi(false);
        }
    };

    // 优化提示词功能（CO-STAR 框架）
    const handleOptimizePrompt = async () => {
        if (!modalContent.trim()) return;
        if (!ensureAiApiConfigured()) return;

        setPreAiState({ content: modalContent, tags: modalTags });
        setIsAiReviewing(true);
        setIsLoadingAi(true);

        try {
            const backend = BackendService.getInstance();
            const aiSettings = { ...translationSettings, provider: 'API' as const };

            const res = await backend.chat(
                aiSettings,
                [
                    {
                        role: 'system',
                        content:
                            'You are a prompt optimization assistant. Return only the optimized prompt text with no explanation.',
                    },
                    {
                        role: 'user',
                        content:
                            `请在不改变意图的前提下优化下面的提示词，使其更清晰、可执行、可控：\n\n${modalContent}`,
                    },
                ],
                { isTranslation: false }
            );

            if (!res || res.startsWith('Error:')) {
                logger.error('AI Optimize Prompt Failed', res);
                setIsAiReviewing(false);
                return;
            }

            const optimized = res.trim();
            if (optimized) setModalContent(optimized);
        } catch (error) {
            logger.error("AI Optimize Prompt Failed", error);
            setIsAiReviewing(false);
        } finally {
            setIsLoadingAi(false);
        }
    };

    const handleAiGenerateBatch = async () => {
        if (!modalContent.trim()) return;
        if (!ensureAiApiConfigured()) return;

        setPreAiState({ content: modalContent, tags: modalTags });
        setIsAiReviewing(true);
        setIsLoadingAi(true);

        try {
            const backend = BackendService.getInstance();
            const aiSettings = { ...translationSettings, provider: 'API' as const };

            // Determine effective batch type
            // If in batch mode, use the selected batch type.
            // If in single mode, use activeModalTab (which aligns with CONTENT/TAGS).
            const effectiveType = isBatchMode ? batchModeType : activeModalTab;

            const userInstruction = aiPrompt?.trim()
                ? `\n\n额外要求：\n${aiPrompt.trim()}\n`
                : '';

            const prompt =
                effectiveType === 'TAGS'
                    ? (`下面是批量标签输入（空行分隔卡片，行内用逗号分隔标签）：\n` +
                        `${modalContent}\n\n` +
                        `请基于这些内容，为每个卡片生成更多相关标签，要求：\n` +
                        `- 仅输出新增内容\n` +
                        `- 保持同样的分隔规则：用空行分隔卡片，行内用逗号分隔标签\n` +
                        `- 不要重复原有标签\n` +
                        `- 不要输出解释\n` +
                        userInstruction)
                    : (`下面是批量内容输入（空行分隔卡片）：\n` +
                        `${modalContent}\n\n` +
                        `请基于这些内容生成更多同主题的条目，要求：\n` +
                        `- 仅输出新增条目\n` +
                        `- 用空行分隔每条\n` +
                        `- 不要输出解释\n` +
                        userInstruction);

            const res = await backend.chat(
                aiSettings,
                [
                    {
                        role: 'system',
                        content:
                            'You are a batch content expansion assistant. Return only additional content, no explanation.',
                    },
                    { role: 'user', content: prompt },
                ],
                { isTranslation: false }
            );

            if (!res || res.startsWith('Error:')) {
                logger.error('AI Batch Generation Failed', res);
                setIsAiReviewing(false);
                return;
            }

            const newContent = res.trim();
            if (newContent) {
                setModalContent(prev => {
                    const trimmed = prev.trim();
                    if (!trimmed) return newContent;
                    return trimmed + '\n\n' + newContent;
                });
            }
        } catch (error) {
            logger.error("AI Batch Generation Failed", error);
            setIsAiReviewing(false);
        } finally {
            setIsLoadingAi(false);
        }
    };

    const confirmAiResult = () => {
        setIsAiReviewing(false);
        setPreAiState(null);
        tagUndoStackRef.current = [];
        tagRedoStackRef.current = [];
    };

    const cancelAiResult = React.useCallback(() => {
        try {
            BackendService.getInstance().stopGeneration();
        } catch (e) {
            logger.error('Stop generation error', e);
        }
        if (preAiState) {
            setModalContent(preAiState.content);
            updateTagSnapshot(createSnapshotFromTags(preAiState.tags), { skipHistory: true });
        }
        setIsAiReviewing(false);
        setPreAiState(null);
    }, [createSnapshotFromTags, preAiState, updateTagSnapshot]);

    const stopAiAndResetUi = React.useCallback(() => {
        try {
            BackendService.getInstance().stopGeneration();
        } catch (e) {
            logger.error('Stop generation on close error', e);
        }
        setIsLoadingAi(false);
        setIsAiReviewing(false);
        setPreAiState(null);
        setShowAiPromptModal(false);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            stopAiAndResetUi();
            wasOpenRef.current = false;
            initializedForRef.current = '';
            tagUndoStackRef.current = [];
            tagRedoStackRef.current = [];
            return;
        }

        const openingNow = !wasOpenRef.current;
        const initKey = initialData
            ? `edit:${editingItemId || 'unknown'}`
            : `create:${initialConfig?.mode || 'CONTENT'}:${initialConfig?.isBatch ? '1' : '0'}:${initialConfig?.batchType || 'CONTENT'}`;
        const shouldInitialize = openingNow || initializedForRef.current !== initKey;

        wasOpenRef.current = true;
        if (!shouldInitialize) return;
        initializedForRef.current = initKey;

        setIsAiReviewing(false);
        setPreAiState(null);

        if (initialData) {
            setModalTitle(initialData.name || '');
            setModalContent(initialData.content);
            setModalName(''); // Deprecated
            const nextTags = initialData.tags.join(', ');
            setModalTags(nextTags);
            const parsedInitial = parseTags(nextTags);
            const editorInitial = bilingualTagsEnabled
                ? parsedInitial.map((tag) => getTagSourceText(tag)).filter(Boolean)
                : parsedInitial;
            setModalTagTitle(editorInitial[0] || '');
            setModalTagContent(editorInitial.slice(1).join(', '));
            setIsBatchMode(false);
            setBatchModeType('CONTENT');
            setActiveModalTab(initialData.tab || 'CONTENT');
        } else {
            setModalTitle('');
            setModalContent('');
            setModalName('');
            setModalTags('');
            setModalTagTitle('');
            setModalTagContent('');

            if (initialConfig) {
                setIsBatchMode(initialConfig.isBatch);
                setActiveModalTab(initialConfig.mode);
                setBatchModeType(initialConfig.batchType || 'CONTENT');

                if ((initialConfig.mode === 'TAGS' || initialConfig.mode === 'DOCUMENT') && !initialConfig.isBatch) {
                    const defaultTags = initialConfig.mode === 'DOCUMENT'
                        ? (language === 'en' ? 'Document Card' : '文档卡片')
                        : (language === 'en' ? 'Title1, Tag1' : '标题1, 标签1');
                    setModalTags(defaultTags);
                    const parsedDefault = parseTags(defaultTags);
                    const editorDefault = bilingualTagsEnabled
                        ? parsedDefault.map((tag) => getTagSourceText(tag)).filter(Boolean)
                        : parsedDefault;
                    setModalTagTitle(editorDefault[0] || '');
                    setModalTagContent(editorDefault.slice(1).join(', '));
                }

                if (initialConfig.isBatch) {
                    setModalContent('');
                }
            } else {
                setIsBatchMode(false);
                setBatchModeType('CONTENT');
                setActiveModalTab('CONTENT');
            }
        }
        setShowDiscardConfirm(false);
    }, [bilingualTagsEnabled, editingItemId, initialConfig, initialData, isOpen, language, stopAiAndResetUi]);

    useEffect(() => {
        if (activeModalTab !== 'TAGS') return;
        if (tagEditorFocusRef.current) return;
        const parsed = parseTags(modalTags);
        const editorParsed = bilingualTagsEnabled
            ? parsed.map((tag) => getTagSourceText(tag)).filter(Boolean)
            : parsed;
        const nextTitle = editorParsed[0] || '';
        const nextContent = editorParsed.slice(1).join(', ');
        if (nextTitle !== modalTagTitle) setModalTagTitle(nextTitle);
        if (nextContent !== modalTagContent) setModalTagContent(nextContent);
    }, [activeModalTab, bilingualTagsEnabled, modalTags, modalTagTitle, modalTagContent]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
            if (e.key.toLowerCase() !== 'z') return;
            if (activeModalTab !== 'TAGS' || isBatchMode) return;
            if (showAiPromptModal) return;
            e.preventDefault();
            e.stopPropagation();
            undoTagSnapshot();
        };

        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [activeModalTab, isBatchMode, isOpen, showAiPromptModal, undoTagSnapshot]);

    if (!isOpen) return null;

    const removeMd = (text: string) => {
        return text
            // Remove headers
            .replace(/^#{1,6}\s+/gm, '')
            // Remove bold/italic
            .replace(/(\*\*|__)(.*?)\1/g, '$2')
            .replace(/(\*|_)(.*?)\1/g, '$2')
            // Remove links [text](url) -> text
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
            // Remove images ![alt](url) -> alt
            .replace(/!\[([^\]]+)\]\([^\)]+\)/g, '$1')
            // Remove code blocks (keep content)
            .replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, ''))
            .replace(/`([^`]+)`/g, '$1')
            // Remove blockquotes
            .replace(/^>\s+/gm, '')
            // Remove lists (markers only)
            .replace(/^[\*\-\+]\s+/gm, '')
            .replace(/^\d+\.\s+/gm, '')
            // Remove horizonal rules
            .replace(/^(-{3,}|_{3,}|\*{3,})$/gm, '');
    };

    const handlePaste = (target: 'CONTENT' | 'TAGS') => (e: React.ClipboardEvent) => {
        // Prevent default paste
        e.preventDefault();

        // Get text from clipboard
        const text = e.clipboardData.getData('text');

        // Clean markdown
        let cleaned = removeMd(text);

        if (target === 'TAGS') {
            // Flatten newlines to commas for tag input
            cleaned = cleaned.replace(/[\r\n]+/g, ', ').replace(/\s+,/g, ',');
        }

        // Insert cleaned text at cursor position (triggers onChange automatically)
        document.execCommand('insertText', false, cleaned);
    };

    const ensureUniqueTags = (tags: string[]): string[] => {
        const seen = new Set<string>();
        return tags.map(tag => {
            let unique = tag.trim() || '未命名';
            let counter = 2;
            const base = unique;
            while (seen.has(unique)) {
                unique = `${base} ${counter++}`;
            }
            seen.add(unique);
            return unique;
        });
    };

    const handleSave = () => {
        const canSave = activeModalTab === 'TAGS' ? modalTags.trim() : modalContent.trim();
        if (!canSave) return;

        const parsedTags = ensureUniqueTags(parseTags(modalTags));

        if (activeModalTab === 'TAGS') {
            const parsedTagList = ensureUniqueTags(parseTags(composeTagString(modalTagTitle, modalTagContent)));
            onSave([{
                content: parsedTagList.join(', '),
                type: 'TAGS',
                tags: parsedTagList,
                editingItemId: editingItemId || undefined
            }]);
            return;
        }

        if (isBatchMode) {
            if (batchModeType === 'CONTENT') {
                const blocks = modalContent.split(/\n\s*\n/);
                const items = blocks
                    .map(block => block.trim())
                    .filter(block => block.length > 0)
                    .map(content => {
                        const type: 'TEXT' | 'LINK' | 'CODE' = content.startsWith('http') ? 'LINK' : (content.includes('{') || content.includes('function') ? 'CODE' : 'TEXT');

                        // Extract Title logic for batch mode too?
                        // User request implies "Add Content Block" mode, which usually refers to single add, but maybe batch too.
                        // Let's apply basic extraction for consistency in batch mode if it looks like a titled block.
                        let finalContent = content;
                        let itemTags = [...parsedTags];

                        const headerMatch = finalContent.match(/^([#]+\s*|\d+\.\s*|[-]\s*)([^\n]+)([\s\S]*)$/);
                        if (headerMatch) {
                            const title = headerMatch[2].trim();
                            if (title && !itemTags.includes(title)) {
                                itemTags.unshift(title);
                            }
                            // For headers, we might want to keep the header in content or strip it?
                            // Usually with headers, it's formatting. But identifying as "Tag" (Black Box) is the request.
                            // If we extract to tag, we usually strip to avoid duplication. 
                            // However, stripping markdown headers changes semantics. 
                            // But for "Prefix identification" like "Name: Content", we definitely strip.
                            // The user examples: "#Title", "1. Title", "- Title". 
                            // Let's strip the prefix line for these specific structure matches to behave like "Title".
                            // Group 3 is the rest.
                            const body = headerMatch[3].trim();
                            finalContent = body ? `${title}: ${body}` : title;
                        } else {
                            // Separator match
                            const separatorMatch = finalContent.match(/^([^:\n\uFF1A]{1,20})([:\uFF1A])\s*([\s\S]*)$/);
                            if (separatorMatch) {
                                const title = separatorMatch[1].trim();
                                if (title && !itemTags.includes(title)) {
                                    itemTags.unshift(title);
                                }
                            }
                        }

                        return {
                            content: finalContent,
                            tags: ensureUniqueTags(itemTags),
                            type,
                            title: itemTags[0] || undefined,
                            body: finalContent
                        };
                    });
                onSave(items);
            } else {
                // Batch Tag Mode:
                // Rule: Empty line (double newlines) separates Tag Items (Cards).
                // Rule: Single newline or comma separates Tags within the SAME Item.
                // Examples:
                // "A\nB" -> One Item with tags [A, B]
                // "A\n\nB" -> Item Item [A], Item [B]

                const blocks = modalContent
                    .split(/\n\s*\n/)
                    .map(block => block.trim())
                    .filter(block => block.length > 0);

                const items = blocks.map(block => {
                    const tags = ensureUniqueTags(parseTags(block));

                    return {
                        content: tags.join(', '),
                        tags: tags,
                        type: 'TAGS' as const
                    };
                });
                onSave(items);
            }
        } else {
            const manualTitle = modalTitle.trim();
            let finalContent = modalContent.trim();
            const localTags = [...parsedTags];
            let structuredTitle: string | undefined = manualTitle || undefined;

            // Smart Extraction Logic
            // 1. Markdown Headers / Lists: # Title, ## Title, - Title, 1. Title
            const headerMatch = finalContent.match(/^([#]+\s*|\d+\.\s*|[-]\s*)([^\n]+)([\s\S]*)$/);

            if (headerMatch) {
                const title = headerMatch[2].trim();
                // If the Title is reasonably short (it's a tag, not a paragraph)
                if (title && title.length < 50) {
                    if (!localTags.includes(title)) {
                        localTags.unshift(title); // Add as first tag (Black background)
                    }
                    structuredTitle = title;
                }
                const body = headerMatch[3].trim();
                finalContent = body ? `${title}: ${body}` : title;
            } else {
                // 2. Custom Separators: Title, Content | Title: Content | Title. Content | Title、Content
                const separatorMatch = finalContent.match(/^([^:\n\uFF1A]{1,30})([:\uFF1A])\s*([\s\S]*)$/);
                if (separatorMatch) {
                    const title = separatorMatch[1].trim();
                    if (title && !localTags.includes(title)) {
                        localTags.unshift(title);
                    }
                    if (title) structuredTitle = title;
                }
            }

            if (!finalContent && localTags.length > 0) {
            } else if (!finalContent) {
                finalContent = modalContent.trim();
            }

            const type = activeModalTab === 'DOCUMENT' ? 'DOCUMENT' : (finalContent.trim().startsWith('http') ? 'LINK' : (finalContent.includes('{') || finalContent.includes('function') ? 'CODE' : 'TEXT'));

            const finalTags = ensureUniqueTags(localTags);
            const finalBody = finalContent;
            if (manualTitle) {
                finalContent = finalBody ? `${manualTitle}: ${finalBody}` : manualTitle;
                structuredTitle = manualTitle;
            }

            onSave([{
                content: finalContent,
                type,
                tags: finalTags,
                title: structuredTitle,
                body: finalBody,
                name: '', // Name field is now implicit in tags/content
                editingItemId: editingItemId || undefined
            }]);
        }
    };

    const handleBackdropClick = () => {
        stopAiAndResetUi();
        const isModified = initialData
            ? (modalTitle !== (initialData.name || '') ||
                modalContent !== initialData.content ||
                modalName !== (initialData.name || '') ||
                modalTags !== initialData.tags.join(', '))
            : (modalTitle.trim() !== '' || modalContent.trim() !== '' || modalName.trim() !== '' || modalTags.trim() !== '');

        if (isModified) {
            handleSave();
        }
        setShowDiscardConfirm(false);
        onClose();
    };

    const handleDiscard = () => {
        stopAiAndResetUi();
        setShowDiscardConfirm(false);
        onClose();
    };

    return (
        <div
            data-clipboard-item-modal="true"
            className={isFullScreen ? "fixed inset-0 z-[100] bg-[#070708] flex flex-col overflow-hidden animate-in fade-in duration-300" : STYLES.MODAL_OVERLAY}
            onClick={handleBackdropClick}
        >
            {isFullScreen && (
                <div
                    className="fixed top-0 left-0 right-0 h-5 z-[105] drag-region"
                    data-tauri-drag-region
                    onClick={(e) => e.stopPropagation()}
                />
            )}
            <div
                className={isFullScreen 
                    ? "flex-1 flex flex-col w-full max-w-[1000px] mx-auto overflow-hidden px-6 pt-24 pb-5 z-10"
                    : `${STYLES.MODAL_CONTAINER} p-8 rounded-[32px] w-[650px] min-h-[600px] max-h-[90vh] flex flex-col gap-5 no-drag resize-y overflow-hidden`}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') handleBackdropClick();
                }}
            >
                {/* Full Screen Back Button */}
                {isFullScreen && (
                    <div className="absolute top-6 left-6 z-[110]">
                        <button 
                            onClick={handleBackdropClick}
                            className="p-3 rounded-2xl appearance-none !bg-transparent hover:!bg-transparent active:!bg-transparent text-white/50 hover:text-white transition-all active:scale-95 flex items-center gap-2 group border border-transparent shadow-none"
                        >
                            <Icon name="arrow_back" className="!text-[20px] transition-transform group-hover:-translate-x-1" size={20} />
                            <span className="text-[14px] font-bold">{t.back}</span>
                        </button>
                    </div>
                )}

                {/* Full Screen Top-right Actions */}
                {isFullScreen && (initialData || initialConfig) && (
                    <div className="absolute top-6 right-6 z-[110] flex items-center gap-1 p-1 bg-white/[0.04] backdrop-blur-md rounded-xl border border-white/5 flex-nowrap overflow-visible no-drag">
                        {isLoadingAi ? (
                            <div className="flex items-center gap-1">
                                <span className="flex items-center gap-1.5 px-3 h-[28px] rounded-lg bg-white/5 text-white/50 text-[12px] font-medium">
                                    <Icon name="progress_activity" className="!text-[14px] animate-spin" size={14} />
                                    <span>{language === 'en' ? 'Generating...' : '生成中...'}</span>
                                </span>
                                <button
                                    onClick={cancelAiResult}
                                    className="flex items-center justify-center w-[28px] h-[28px] rounded-lg text-white/60 hover:bg-white/5 hover:text-white transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
                                >
                                    <Icon name="close" className="!text-[16px]" size={16} />
                                </button>
                            </div>
                        ) : isAiReviewing ? (
                            <>
                                <button
                                    onClick={cancelAiResult}
                                    className="flex items-center justify-center w-[28px] h-[28px] rounded-lg text-white/60 hover:bg-white/5 hover:text-white transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
                                >
                                    <Icon name="close" className="!text-[16px]" size={16} />
                                </button>
                                <button
                                    onClick={confirmAiResult}
                                    className="flex items-center justify-center w-[28px] h-[28px] rounded-lg bg-white/10 text-white hover:bg-white/20 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
                                >
                                    <Icon name="check" className="!text-[16px]" size={16} />
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={handleToggleBilingual}
                                    disabled={isLoadingAi || isTogglingBilingual}
                                    className={`order-[-1] min-w-[104px] shrink-0 px-2.5 h-[28px] rounded-lg text-[12px] font-medium transition-all duration-300 hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-1 ${(isLoadingAi || isTogglingBilingual) ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'} ${bilingualTagsEnabled ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white hover:bg-white/5'} ${bilingualToggleAnimating ? 'ring-1 ring-white/30 shadow-[0_0_0_3px_rgba(255,255,255,0.08)]' : ''}`}
                                    title={t.clip_bilingual_tags}
                                >
                                    <Icon name="translate" className="!text-[13px]" size={13} />
                                    <span className="whitespace-nowrap leading-none">{language === 'en' ? 'Bilingual' : '中英对照'}</span>
                                </button>

                                <button
                                    onClick={() => {
                                        if (!ensureAiApiConfigured()) return;
                                        setShowAiPromptModal(true);
                                    }}
                                    className="px-2.5 h-[28px] rounded-lg text-white/50 hover:text-white hover:bg-white/5 text-[12px] font-medium transition-all hover:scale-[1.02] active:scale-95 flex items-center cursor-pointer"
                                >
                                    {t.modal_custom_btn}
                                </button>

                                {activeModalTab === 'TAGS' && !isBatchMode && (
                                    <button
                                        onClick={handleSplitTags}
                                        title={t.modal_split_title}
                                        disabled={isLoadingAi || !modalTags.trim()}
                                        className={`group relative overflow-hidden flex items-center gap-1.5 px-2.5 h-[28px] rounded-lg text-white/50 font-bold transition-all ${isLoadingAi || !modalTags.trim() ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/5 hover:text-white hover:scale-[1.02] active:scale-95 cursor-pointer'}`}
                                    >
                                        <Icon name="unfold_more" className="!text-[14px] relative z-10" size={14} />
                                        <span className="relative z-10 text-[12px]">{t.modal_split_btn}</span>
                                    </button>
                                )}

                                {activeModalTab === 'CONTENT' && !isBatchMode && (
                                    <button
                                        onClick={handleOptimizePrompt}
                                        disabled={isLoadingAi || !modalContent.trim()}
                                        className={`group relative overflow-hidden flex items-center gap-1.5 px-2.5 h-[28px] rounded-lg text-white/50 font-bold transition-all ${isLoadingAi || !modalContent.trim() ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/5 hover:text-white hover:scale-[1.02] active:scale-95 cursor-pointer'}`}
                                    >
                                        <Icon
                                            name={isLoadingAi ? 'progress_activity' : 'magic_button'}
                                            className={`!text-[14px] ${isLoadingAi ? 'animate-spin' : ''} relative z-10`}
                                            size={14}
                                        />
                                        <span className="relative z-10 text-[12px]">{t.modal_optimize_prompt}</span>
                                    </button>
                                )}

                                <button
                                    onClick={() => {
                                        const shouldUseBatchLogic = isBatchMode || activeModalTab === 'CONTENT';
                                        if (shouldUseBatchLogic) handleAiGenerateBatch();
                                        else handleAiGenerate();
                                    }}
                                    disabled={isLoadingAi || ((isBatchMode || activeModalTab === 'CONTENT') ? !modalContent.trim() : !modalTags.trim())}
                                    className={`group relative overflow-hidden flex items-center gap-1.5 px-2.5 h-[28px] rounded-lg text-white/50 font-bold transition-all ${isLoadingAi || ((isBatchMode || activeModalTab === 'CONTENT') ? !modalContent.trim() : !modalTags.trim()) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/5 hover:text-white hover:scale-[1.02] active:scale-95 cursor-pointer'}`}
                                >
                                    {!isLoadingAi && ((isBatchMode || activeModalTab === 'CONTENT') ? modalContent.trim() : modalTags.trim()) && (
                                        <div className="absolute inset-0 translate-x-[-100%] group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
                                    )}
                                    <Icon
                                        name={isLoadingAi ? 'progress_activity' : 'auto_awesome'}
                                        className={`!text-[14px] ${isLoadingAi ? 'animate-spin' : ''} relative z-10`}
                                        size={14}
                                    />
                                    <span className="relative z-10 text-[12px]">{t.modal_generate_more}</span>
                                </button>
                            </>
                        )}
                    </div>
                )}
                {initialData || initialConfig ? (
                    (isFullScreen && !isBatchMode) ? null : (
                        <div className="flex items-center justify-between mb-1 px-1 flex-nowrap overflow-hidden">
                            {isBatchMode ? (
                                <div className="text-[16px] font-bold flex items-center gap-2 text-white/50 shrink-0 mr-4 min-w-0">
                                    <Icon name="checklist" className="!text-[20px]" size={20} />
                                    <span className="truncate max-w-[200px]">{t.modal_batch_add}</span>
                                </div>
                            ) : (
                                <div />
                            )}
                            {!isFullScreen && (
                                <div className="flex items-center gap-2 flex-nowrap overflow-hidden">
                                {isLoadingAi ? (
                                    <div className="flex items-center gap-1">
                                        <span className="flex items-center gap-1.5 px-3 h-[28px] rounded-md bg-white/5 text-white/50 text-[12px] font-medium">
                                            <Icon name="progress_activity" className="!text-[14px] animate-spin" size={14} />
                                            <span>{language === 'en' ? 'Generating...' : '生成中...'}</span>
                                        </span>
                                        <button
                                            onClick={cancelAiResult}
                                            className="flex items-center justify-center w-[28px] h-[28px] rounded-md bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-all active:scale-95 cursor-pointer"
                                        >
                                            <Icon name="close" className="!text-[16px]" size={16} />
                                        </button>
                                    </div>
                                ) : isAiReviewing ? (
                                    <>
                                        <button
                                            onClick={cancelAiResult}
                                            className="flex items-center justify-center w-[28px] h-[28px] rounded-md bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-all active:scale-95 cursor-pointer"
                                        >
                                            <Icon name="close" className="!text-[16px]" size={16} />
                                        </button>
                                        <button
                                            onClick={confirmAiResult}
                                            className="flex items-center justify-center w-[28px] h-[28px] rounded-md bg-white/10 text-white hover:bg-white/20 transition-all active:scale-95 cursor-pointer"
                                        >
                                            <Icon name="check" className="!text-[16px]" size={16} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => {
                                                if (!ensureAiApiConfigured()) return;
                                                setShowAiPromptModal(true);
                                            }}
                                            className="px-2 h-[28px] rounded-md bg-white/5 text-white/50 hover:text-white hover:bg-white/10 text-[12px] font-medium transition-all flex items-center"
                                        >
                                            {t.modal_custom_btn}
                                        </button>

                                        {activeModalTab === 'TAGS' && !isBatchMode && (
                                            <button
                                                onClick={handleSplitTags}
                                                title={t.modal_split_title}
                                                disabled={isLoadingAi || !modalTags.trim()}
                                                className={`group relative overflow-hidden flex items-center gap-1.5 px-3 h-[28px] rounded-lg bg-white/5 text-white/50 font-bold transition-all ${isLoadingAi || !modalTags.trim() ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/10 hover:text-white active:scale-95 cursor-pointer'}`}
                                            >
                                                <Icon name="unfold_more" className="!text-[14px] relative z-10" size={14} />
                                                <span className="relative z-10 text-[12px]">{t.modal_split_btn}</span>
                                            </button>
                                        )}

                                        {/* 优化提示词按钮 - 仅在内容卡片模式下显示 */}
                                        {activeModalTab === 'CONTENT' && !isBatchMode && (
                                            <button
                                                onClick={handleOptimizePrompt}
                                                disabled={isLoadingAi || !modalContent.trim()}
                                                className={`group relative overflow-hidden flex items-center gap-1.5 px-3 h-[28px] rounded-lg bg-white/5 text-white/50 font-bold transition-all ${isLoadingAi || !modalContent.trim() ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/10 hover:text-white active:scale-95 cursor-pointer'}`}
                                            >
                                                <Icon
                                                    name={isLoadingAi ? 'progress_activity' : 'magic_button'}
                                                    className={`!text-[14px] ${isLoadingAi ? 'animate-spin' : ''} relative z-10`}
                                                    size={14}
                                                />
                                                <span className="relative z-10 text-[12px]">{t.modal_optimize_prompt}</span>
                                            </button>
                                        )}

                                        <button
                                            onClick={() => {
                                                const shouldUseBatchLogic = isBatchMode || activeModalTab === 'CONTENT';
                                                if (shouldUseBatchLogic) handleAiGenerateBatch();
                                                else handleAiGenerate();
                                            }}
                                            disabled={isLoadingAi || ((isBatchMode || activeModalTab === 'CONTENT') ? !modalContent.trim() : !modalTags.trim())}
                                            className={`group relative overflow-hidden flex items-center gap-1.5 px-3 h-[28px] rounded-lg bg-white/5 text-white/50 font-bold transition-all ${isLoadingAi || ((isBatchMode || activeModalTab === 'CONTENT') ? !modalContent.trim() : !modalTags.trim()) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/10 hover:text-white active:scale-95 cursor-pointer'}`}
                                        >
                                            {!isLoadingAi && ((isBatchMode || activeModalTab === 'CONTENT') ? modalContent.trim() : modalTags.trim()) && (
                                                <div className="absolute inset-0 translate-x-[-100%] group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
                                            )}
                                            <Icon
                                                name={isLoadingAi ? 'progress_activity' : 'auto_awesome'}
                                                className={`!text-[14px] ${isLoadingAi ? 'animate-spin' : ''} relative z-10`}
                                                size={14}
                                            />
                                            <span className="relative z-10 text-[12px]">{t.modal_generate_more}</span>
                                        </button>
                                    </>
                                )}
                                </div>
                            )}
                        </div>
                    )
                ) : (
                    <div className="flex bg-white/5 p-1 rounded-xl mb-0">
                        <button
                            onClick={() => {
                                setIsBatchMode(false);
                                setActiveModalTab('CONTENT');
                            }}
                            className={`flex-1 text-[12px] py-1.5 rounded-lg transition-colors font-medium flex items-center justify-center gap-1.5 overflow-hidden ${(!isBatchMode && activeModalTab === 'CONTENT') ? 'bg-[#161618] text-white border border-white/10 shadow-sm' : 'hover:bg-white/10 text-white/80 hover:text-white'}`}
                        >
                            <Icon name="add_circle" className="!text-[16px] shrink-0" size={16} />
                            <span className="truncate">{t.modal_add_content}</span>
                        </button>
                        <button
                            onClick={() => {
                                setActiveModalTab('TAGS');
                                setIsBatchMode(false);
                            }}
                            className={`flex-1 text-[12px] py-1.5 rounded-lg transition-colors font-medium flex justify-center items-center gap-1.5 overflow-hidden ${activeModalTab === 'TAGS' ? 'bg-[#161618] text-white border border-white/10 shadow-sm' : 'hover:bg-white/10 text-white/80 hover:text-white'}`}
                        >
                            <Icon name="label" className="!text-[16px] shrink-0" size={16} />
                            <span className="truncate">{t.modal_add_tags}</span>
                        </button>
                        <button
                            onClick={() => {
                                setIsBatchMode(true);
                                setActiveModalTab('CONTENT');
                            }}
                            className={`flex-1 text-[12px] py-1.5 rounded-lg transition-colors font-medium flex justify-center items-center gap-1.5 overflow-hidden ${isBatchMode ? 'bg-[#161618] text-white border border-white/10 shadow-sm' : 'hover:bg-white/10 text-white/80 hover:text-white'}`}
                        >
                            <Icon name="checklist" className="!text-[16px] shrink-0" size={16} />
                            <span className="truncate">{t.modal_batch_add}</span>
                        </button>
                    </div>
                )}

                <div className="flex-1 flex flex-col mb-0 mt-0 min-h-0 relative">
                    {isBatchMode && (
                        <div className="flex justify-end mb-3">
                            <div className="w-full grid grid-cols-2 gap-2 bg-white/5 p-1 rounded-xl border border-white/5">
                                <button
                                    onClick={() => {
                                        setBatchModeType('CONTENT');
                                        setModalContent('');
                                    }}
                                    className={`py-2 rounded-lg text-[13px] transition-all font-bold flex items-center justify-center gap-2 ${batchModeType === 'CONTENT' ? 'bg-[#161618] text-white border border-white/10 shadow-lg' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
                                >
                                    <Icon name="article" className="!text-[18px]" size={18} />
                                    {t.modal_batch_content_type}
                                </button>
                                <button
                                    onClick={() => {
                                        setBatchModeType('TAGS');
                                        setModalContent('');
                                    }}
                                    className={`py-2 rounded-lg text-[13px] transition-all font-bold flex items-center justify-center gap-2 ${batchModeType === 'TAGS' ? 'bg-[#161618] text-white border border-white/10 shadow-lg' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
                                >
                                    <Icon name="label" className="!text-[18px]" size={18} />
                                    {t.modal_batch_tags_type}
                                </button>
                            </div>
                        </div>
                    )}
                    {activeModalTab === 'CONTENT' ? (
                        <div className="flex-1 flex flex-col gap-2 min-h-0">
                            {!isBatchMode && (
                                <input
                                    value={modalTitle}
                                    onChange={(e) => setModalTitle(e.target.value)}
                                    placeholder={t.modal_title_placeholder}
                                    className="w-full h-11 bg-gradient-to-br from-[#121214] to-[#121214] rounded-[24px] px-4 text-white text-[15px] focus:outline-none focus-visible:ring-0 placeholder:text-white/20 transition-none"
                                />
                            )}
                            <div className="flex-1 flex flex-col min-h-0 relative group">
                                <textarea
                                    autoFocus
                                    value={modalContent}
                                    onChange={(e) => setModalContent(e.target.value)}
                                    onPaste={handlePaste('CONTENT')}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                            handleSave();
                                            onClose();
                                        }
                                    }}
                                    placeholder={
                                        isBatchMode
                                            ? (batchModeType === 'CONTENT' ? t.modal_batch_placeholder_example : t.modal_batch_tags_placeholder_example)
                                            : t.modal_input_placeholder
                                    }
                                    className={`${STYLES.MODAL_TEXTAREA} flex-1 min-h-[280px] overflow-y-auto ${isFullScreen ? 'text-[16px] !px-6 !pt-4 focus-visible:ring-0 leading-relaxed' : ''}`}

                                />
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col gap-4 p-1 min-h-0">
	                            <div className="flex-1 flex flex-col gap-2 min-h-[100px] relative group">
	                                <input
	                                    value={modalTagTitle}
                                        onFocus={() => { tagEditorFocusRef.current = 'title'; }}
                                        onBlur={() => { tagEditorFocusRef.current = null; }}
	                                    onChange={(e) => {
	                                        const nextTitle = bilingualTagsEnabled ? normalizeTagEditorInput(e.target.value) : e.target.value;
	                                        updateTagSnapshot({
                                                title: nextTitle,
                                                content: modalTagContent,
                                                tags: composeTagString(nextTitle, modalTagContent)
                                            });
	                                    }}
	                                    placeholder={t.modal_title_placeholder}
	                                    className="w-full h-11 bg-gradient-to-br from-[#121214] to-[#121214] rounded-[24px] px-4 text-white text-[15px] focus:outline-none focus-visible:ring-0 placeholder:text-white/20 transition-none"
	                                />
	                                <textarea
	                                    autoFocus
	                                    value={modalTagContent}
                                        onFocus={() => { tagEditorFocusRef.current = 'content'; }}
                                        onBlur={() => { tagEditorFocusRef.current = null; }}
	                                    onChange={(e) => {
	                                        const nextContent = bilingualTagsEnabled ? normalizeTagEditorInput(e.target.value) : e.target.value;
	                                        updateTagSnapshot({
                                                title: modalTagTitle,
                                                content: nextContent,
                                                tags: composeTagString(modalTagTitle, nextContent)
                                            });
	                                    }}
	                                    onPaste={handlePaste('TAGS')}
	                                    onKeyDown={(e) => {
	                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
	                                            handleSave();
	                                            onClose();
	                                        }
	                                    }}
	                                    placeholder={language === 'en' ? 'Enter tags (comma separated)' : '输入标签内容（用逗号分隔）'}
	                                    className={`${STYLES.MODAL_TEXTAREA} flex-1 min-h-[160px] ${isFullScreen ? 'text-[16px] !px-6 !pt-4 focus-visible:ring-0 leading-relaxed' : ''}`}

	                                />
	                            </div>

                            {modalTags.trim() && (
                                <div className="flex-1 flex flex-col gap-2 min-h-0 mt-2">

                                    <div className="flex flex-col flex-1 min-h-0 relative">
                                        <DndContext
                                            sensors={sensors}
                                            collisionDetection={closestCenter}
                                            onDragStart={handleDragStart}
                                            onDragEnd={handleDragEnd}
                                        >
                                            <div className={`flex flex-wrap items-start content-start gap-2 px-1.5 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar pb-3 transition-all duration-300 ${activeId ? 'pr-[68px]' : 'pr-1.5'} ${tagCloudAnimating ? 'animate-in fade-in duration-200' : ''}`}>
                                                <SortableContext
                                                    items={itemsWithIds.map(i => i.id)}
                                                    strategy={rectSortingStrategy}
                                                >
                                                    {itemsWithIds.map((item) => {
                                                        const isNew = isAiReviewing && preAiState?.tags
                                                            ? !parseTags(preAiState.tags).includes(item.tag)
                                                            : false;

                                                        return (
                                                            <SortableTag
                                                                key={item.id}
                                                                id={item.id}
                                                                tag={item.tag}
                                                                bilingualTag={
                                                                    (isFullScreen && bilingualTagsEnabled && activeModalTab === 'TAGS' && !isBatchMode)
                                                                        ? (modalBilingualPairs[item.tag] || parseBilingualTag(item.tag))
                                                                        : parseBilingualTag(item.tag)
                                                                }
                                                                onBilingualSegmentClick={async (_, text, e) => {
                                                                    e.stopPropagation();
                                                                    await copySegmentText(text);
                                                                }}
                                                                isNew={isNew}
                                                            />
                                                        );
                                                    })}
                                                </SortableContext>
                                            </div>

                                            {createPortal(
                                                <DragOverlay dropAnimation={null}>
                                                    {activeId ? (
                                                        (() => {
                                                            const overlayTag = itemsWithIds.find(i => i.id === activeId)?.tag || '';
                                                                const overlayBilingualTag =
                                                                (isFullScreen && bilingualTagsEnabled && activeModalTab === 'TAGS' && !isBatchMode)
                                                                    ? (modalBilingualPairs[overlayTag] || parseBilingualTag(overlayTag))
                                                                    : parseBilingualTag(overlayTag);
                                                            return (
                                                                <TagItem
                                                                    tag={overlayTag}
                                                                    compact
                                                                    bilingualTag={toOriginalFirstBilingualTag(overlayTag, overlayBilingualTag)}
                                                                    isOverlay
                                                                    className="max-w-[300px]"
                                                                />
                                                            );
                                                        })()
                                                    ) : null}
                                                </DragOverlay>,
                                                document.body
                                            )}

                                            {activeId && (
                                                <div className="absolute top-0 right-0 bottom-0 w-16 z-[100] pl-2 pb-4">
                                                    <TrashDropZone language={language} />
                                                </div>
                                            )}
                                        </DndContext>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {showDiscardConfirm && (
                    <div
                        className="absolute inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                        onClick={(e) => { e.stopPropagation(); setShowDiscardConfirm(false); }}
                    >
                        <div
                            className="bg-[#09090B] border border-white/10 rounded-2xl p-6 shadow-2xl shadow-black/50 w-[320px] flex flex-col gap-4 scale-100 animate-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2 mb-1">
                                    <Icon name="warning" className="text-white/40 rounded-full bg-white/5 p-1 text-[20px]" size={20} />
                                    <h3 className="text-white font-bold text-[16px]">{t.modal_unsaved_title}</h3>
                                </div>
                                <p className="text-white/80 text-[14px] leading-relaxed">{t.modal_unsaved_desc}</p>
                            </div>
                            <div className="flex gap-3 mt-2">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowDiscardConfirm(false); }}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 text-white/80 hover:bg-white/10 hover:text-white font-medium text-[13px] transition-colors"
                                >
                                    {t.cancel}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDiscard(); }}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 text-white hover:bg-white/20 font-bold text-[13px] transition-colors"
                                >
                                    {t.modal_abandon_edit}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {showBilingualConfigModal && (
                    <div
                        className="absolute inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                        onClick={(e) => { e.stopPropagation(); setShowBilingualConfigModal(false); }}
                    >
                        <div
                            className="bg-[#09090B] border border-white/10 rounded-2xl p-6 shadow-2xl shadow-black/50 w-[360px] flex flex-col gap-4 scale-100 animate-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2 mb-1">
                                    <Icon name="settings" className="text-white/60 rounded-full bg-white/5 p-1 text-[20px]" size={20} />
                                    <h3 className="text-white font-bold text-[16px]">
                                        {language === 'en' ? 'Configure API First' : '请先配置 API'}
                                    </h3>
                                </div>
                                <p className="text-white/75 text-[14px] leading-relaxed">
                                    {language === 'en'
                                        ? 'This action needs a valid Endpoint and API Key. Please configure them in Settings first.'
                                        : '该功能需要可用的 Endpoint 和 API Key，请先前往设置完成配置。'}
                                </p>
                            </div>
                            <div className="flex gap-3 mt-2">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowBilingualConfigModal(false); }}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 text-white/80 hover:bg-white/10 hover:text-white font-medium text-[13px] transition-colors"
                                >
                                    {t.cancel}
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowBilingualConfigModal(false);
                                        onClose();
                                        onOpenSettings?.();
                                    }}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 text-white hover:bg-white/20 font-bold text-[13px] transition-colors"
                                >
                                    {language === 'en' ? 'Open Settings' : '前往设置'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {showAiPromptModal && (
                    <div
                        className="absolute inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                        onClick={(e) => { e.stopPropagation(); setShowAiPromptModal(false); }}
                    >
                        <div
                            className="bg-[#09090B] border border-white/10 rounded-2xl p-6 shadow-2xl shadow-black/50 w-[380px] flex flex-col gap-4 scale-100 animate-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2 mb-1">
                                    <Icon name="auto_awesome" className="text-white rounded-full bg-white/10 p-1 text-[20px]" size={20} />
                                    <h3 className="text-white font-bold text-[16px]">{t.modal_ai_instruction_title}</h3>
                                </div>
                                <p className="text-white/50 text-[12px]">
                                    {isBatchMode || activeModalTab === 'CONTENT'
                                        ? (language === 'en' ? 'Provide a special instruction to refine or expand the current content.' : '提供额外指令以优化或扩展当前内容。')
                                        : (language === 'en' ? 'Provide a special instruction to generate specific types of tags.' : '提供额外指令以生成特定类型的标签。')}
                                </p>
                            </div>

                            <textarea
                                autoFocus
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                placeholder={t.modal_ai_prompt_placeholder}
                                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-[14px] min-h-[100px] focus:outline-none focus-visible:border-white/30 transition-colors resize-none caret-white selection:bg-white/20"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                        const shouldUseBatchLogic = isBatchMode || activeModalTab === 'CONTENT';
                                        if (shouldUseBatchLogic) handleAiGenerateBatch();
                                        else handleAiGenerate();
                                        setShowAiPromptModal(false);
                                    }
                                }}
                            />

                            <div className="flex gap-3 mt-2">
                                <button
                                    onClick={(e) => { e.stopPropagation(); setShowAiPromptModal(false); }}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 text-white/80 hover:bg-white/10 hover:text-white font-medium text-[13px] transition-colors"
                                >
                                    {t.cancel}
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const shouldUseBatchLogic = isBatchMode || activeModalTab === 'CONTENT';
                                        if (shouldUseBatchLogic) handleAiGenerateBatch();
                                        else handleAiGenerate();
                                        setShowAiPromptModal(false);
                                    }}
                                    disabled={!aiPrompt.trim() || isLoadingAi}
                                    className={`flex-1 px-4 py-2.5 rounded-xl font-bold text-[13px] transition-colors ${!aiPrompt.trim() || isLoadingAi ? 'bg-white/5 text-white/20 cursor-not-allowed' : 'bg-[#1C1C1E] text-white hover:bg-[#3A3A3C] border border-white/10 shadow-lg'}`}
                                >
                                    {t.modal_ai_instruction_confirm}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ClipboardItemModal;


