import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSortable, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, DragStartEvent, DragMoveEvent, DragEndEvent, DragOverlay, defaultDropAnimationSideEffects, pointerWithin } from '@dnd-kit/core';
import { snapCenterToCursor } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { TagItem } from '../TagItem';
import Icon from '../Icon';
import { STYLES } from '../../constants';
import { translations } from '../../i18n';
import { ClipboardItem, TranslationSettings } from '../../types';
import { useEditFieldFocus } from '../../hooks/useEditFieldFocus';
import { parseBilingualTag, useBilingualTagTranslation } from '../../hooks/useBilingualTagTranslation';
import { normalizeTags } from '../../hooks/clipboardDataHelpers';
import { useLongPress } from '../../hooks/useLongPress';

type TagKeyboardClipboard = {
    sourceItemId: string;
    tags: string[];
    mode: 'copy' | 'cut';
};

let activeDocumentCardId: string | null = null;
let tagKeyboardClipboard: TagKeyboardClipboard | null = null;
const FOLDER_TAG_PREFIX = '\uD83D\uDCC1';
type TagDropHintMode = 'before' | 'after' | 'inside';

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

export const SortableTagItem = ({
    tag,
    tagIdx,
    tagIndex,
    item,
    visibleTagCount,
    isAnyDragActive,
    pasteTagsWithComma,
    tagBgClass,
    handleCopy,
    onOpenEditor,
    setEditingTag,
    onContextMenu,
    clickTimeoutRef,
    onEnterFolder,
    onMoveTagToFolder,
    isBoxSelected,
    onToggleSelectTag,
    isCut,
    dropHintMode,
    bilingualTag
}: any) => {
    if (!tag || typeof tag !== 'string') {
        return null; // Guard against undefined/malformed tags
    }

    const actualTagIndex: number = (tagIndex ?? tagIdx);

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: tag,
        animateLayoutChanges: () => false, 
    });

    const isFolder = tag.startsWith(FOLDER_TAG_PREFIX);

    const style = {
        transform: isDragging ? CSS.Translate.toString(transform) : undefined,
        transition: isDragging ? 'none' : transition,
        opacity: isDragging ? 0.22 : 1,
    };
    const isDocumentCard = item.type === 'DOCUMENT';
    const canOpenSingleDocument = isDocumentCard && visibleTagCount === 1 && tagIdx === 0 && !isFolder;
    let iconName = undefined;
    
    if (isFolder) {
        iconName = 'folder_filled';
    } else if (isDocumentCard && tagIdx > 0) {
        iconName = 'description';
    }

    const displayTag = isFolder ? tag.replace(FOLDER_TAG_PREFIX, '').trim() : tag;
    const finalBilingualTag = bilingualTag || null;
    const [isClickFeedbackActive, setIsClickFeedbackActive] = useState(false);
    const clickFeedbackTimerRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (clickFeedbackTimerRef.current) {
                window.clearTimeout(clickFeedbackTimerRef.current);
                clickFeedbackTimerRef.current = null;
            }
        };
    }, []);

    const triggerClickFeedback = () => {
        if (clickFeedbackTimerRef.current) {
            window.clearTimeout(clickFeedbackTimerRef.current);
            clickFeedbackTimerRef.current = null;
        }
        setIsClickFeedbackActive(true);
        clickFeedbackTimerRef.current = window.setTimeout(() => {
            setIsClickFeedbackActive(false);
            clickFeedbackTimerRef.current = null;
        }, 180);
    };

    const isInsideTarget = dropHintMode === 'inside';
    const isBeforeTarget = dropHintMode === 'before';
    const isAfterTarget = dropHintMode === 'after';
    const bilingualClass = finalBilingualTag ? '!px-1.5 !py-1 bg-transparent border border-white/[0.04] shadow-none' : '';
    const dropFeedbackClass = isInsideTarget
        ? 'bg-[#0A84FF]/22 ring-2 ring-[#0A84FF]/65 text-white !opacity-100 z-50'
        : '';

    // 长按视觉反馈状态
    const [isLongPressActive, setIsLongPressActive] = useState(false);

    // 长按处理
    const longPress = useLongPress({
        threshold: 500,
        onLongPress: (e) => {
            // 获取触发位置
            const touch = 'touches' in e ? e.touches[0] : null;
            const clientX = touch ? touch.clientX : (e as React.MouseEvent).clientX;
            const clientY = touch ? touch.clientY : (e as React.MouseEvent).clientY;
            
            // 创建模拟的鼠标事件
            const syntheticEvent = {
                ...e,
                clientX,
                clientY,
                preventDefault: () => {},
                stopPropagation: () => {},
            } as React.MouseEvent;
            
            onContextMenu(syntheticEvent, item, tag, actualTagIndex);
            setIsLongPressActive(false);
        },
        onPress: () => {
            setIsLongPressActive(false);
        },
        onCancel: () => {
            setIsLongPressActive(false);
        },
    });

    return (
        <div className="relative" data-tag-item="true" data-tag-drop-id={tag}>
            {isBeforeTarget && (
                <div className="pointer-events-none absolute -left-1 top-[7px] bottom-[7px] w-[2px] rounded-full bg-[#0A84FF] shadow-[0_0_0_1px_rgba(10,132,255,0.18),0_0_14px_rgba(10,132,255,0.45)]" />
            )}
            {isAfterTarget && (
                <div className="pointer-events-none absolute -right-1 top-[7px] bottom-[7px] w-[2px] rounded-full bg-[#0A84FF] shadow-[0_0_0_1px_rgba(10,132,255,0.18),0_0_14px_rgba(10,132,255,0.45)]" />
            )}
            <TagItem
                ref={setNodeRef}
                style={style}
                tag={displayTag}
                bilingualTag={toOriginalFirstBilingualTag(displayTag, finalBilingualTag)}
                iconName={iconName}
                onBilingualSegmentClick={(_, clickedText, e) => {
                    e.stopPropagation();
                    triggerClickFeedback();
                    if (e.ctrlKey || e.metaKey) {
                        onToggleSelectTag?.(actualTagIndex, tag);
                        if (clickTimeoutRef.current) {
                            clearTimeout(clickTimeoutRef.current);
                            clickTimeoutRef.current = null;
                        }
                        return;
                    }
                    if (clickTimeoutRef.current) {
                        clearTimeout(clickTimeoutRef.current);
                        clickTimeoutRef.current = null;
                    }
                    const isColor = /^#?([0-9A-F]{3}|[0-9A-F]{4}|[0-9A-F]{6}|[0-9A-F]{8})$/i.test(clickedText) || /^rgba?\(.+\)$/i.test(clickedText) || /^hsla?\(.+\)$/i.test(clickedText);
                    handleCopy(isColor || !pasteTagsWithComma ? clickedText : `${clickedText},`, item, false, true);
                }}
                className={`${tagBgClass} ${bilingualClass} ${dropFeedbackClass} ${isBoxSelected ? 'ring-2 ring-white/30 bg-white/10 text-white' : ''} ${isCut ? 'opacity-30' : ''} ${isClickFeedbackActive ? 'brightness-125 ring-1 ring-white/25 bg-white/12 text-white shadow-md shadow-black/20' : ''}`}
                attributes={tagIdx === 0 ? undefined : attributes}
                listeners={tagIdx === 0 ? undefined : listeners}
                onContextMenu={(e) => onContextMenu(e, item, tag, actualTagIndex)}
                {...longPress.touchHandlers}
                {...longPress.mouseHandlers}
                onTouchStart={(e: React.TouchEvent<HTMLDivElement>) => {
                    setIsLongPressActive(true);
                    longPress.touchHandlers.onTouchStart(e);
                }}
                style={{
                    ...style,
                    ...(isLongPressActive ? { transform: `${style.transform || ''} scale(0.95)` } : {}),
                }}
                onClick={(e: any) => {
                    e.stopPropagation();
                    triggerClickFeedback();
                    if (e.ctrlKey || e.metaKey) {
                        onToggleSelectTag?.(actualTagIndex, tag);
                        if (clickTimeoutRef.current) {
                            clearTimeout(clickTimeoutRef.current);
                            clickTimeoutRef.current = null;
                        }
                        return;
                    }
                    if (clickTimeoutRef.current) {
                        clearTimeout(clickTimeoutRef.current);
                        clickTimeoutRef.current = null;
                        return;
                    }

                    if (isFolder && tagIdx !== 0 && !isAnyDragActive) {
                        onEnterFolder(tag, displayTag);
                        return;
                    }

                    if ((isDocumentCard && tagIdx !== 0 && !isFolder) || canOpenSingleDocument) {
                        clickTimeoutRef.current = window.setTimeout(() => {
                            if (!isAnyDragActive) onOpenEditor(item, actualTagIndex);
                            clickTimeoutRef.current = null;
                        }, 250);
                    } else if (item.type !== 'DOCUMENT') {
                        clickTimeoutRef.current = window.setTimeout(() => {
                            const isColor = /^#?([0-9A-F]{3}|[0-9A-F]{4}|[0-9A-F]{6}|[0-9A-F]{8})$/i.test(tag) || /^rgba?\(.+\)$/i.test(tag) || /^hsla?\(.+\)$/i.test(tag);
                            handleCopy(isColor || !pasteTagsWithComma ? tag : `${tag},`, item, false, true);
                            clickTimeoutRef.current = null;
                        }, 250);
                    } else {
                        clickTimeoutRef.current = null;
                    }
                }}
                onDoubleClick={(e: any) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (clickTimeoutRef.current) {
                        clearTimeout(clickTimeoutRef.current);
                        clickTimeoutRef.current = null;
                    }
                    setEditingTag({ itemId: item.id, tagIndex: actualTagIndex, value: tag, startTime: Date.now(), source: 'tag' });
                }}
                isAnyDragActive={isAnyDragActive}
                isActive={tagIdx === 0}
                clickable={true}
            />
        </div>
    );
};

export const TagCard = React.memo(({
    item,
    index,
    draggingIndex,
    isSelected,
    isEditingItem,
    editingTag,
    setEditingTag,
    pasteTagsWithComma,
    bilingualTagsEnabled,
    translationSettings,
    activeLibraryId,
    handleCopy,
    onUpdateTags,
    onAddTag,
    onDeleteCard,
    onEditCard,
    handleManualDragEnter,
    handleItemMouseDown,
    handleItemMouseUpOrLeave,
    language,
    commitEditTag,
    isAnyDragActive,
    onOpenEditor,
    onContextMenu,
    onTagContextMenu,
    onEnterFolder,
    onMoveTagToFolder,
    onCombineDocumentTagsIntoFolder,
    onPasteDocumentTags,
    onRemoveSelectedTags,
    onSelect,
    dragHandleProps,
    preservePositionWhileDragging = false,
}: {
    item: ClipboardItem,
    index: number,
    draggingIndex: number | null,
    isSelected: boolean,
    isEditingItem: boolean,
    editingTag: any,
    setEditingTag: any,
    pasteTagsWithComma: boolean,
    bilingualTagsEnabled: boolean,
    translationSettings: TranslationSettings,
    activeLibraryId: string,
    handleCopy: any,
    onUpdateTags: any,
    onAddTag: any,
    onDeleteCard: any,
    onEditCard: any,
    handleManualDragEnter: any,
    handleItemMouseDown: any,
    handleItemMouseUpOrLeave: any,
    language: any,
    commitEditTag: any,
    isAnyDragActive: any,
    onOpenEditor: any,
    onContextMenu: (e: React.MouseEvent, item: ClipboardItem) => void,
    onTagContextMenu: (e: React.MouseEvent, item: ClipboardItem, tag: string, tagIdx: number, selectedTags?: string[]) => void,
    onEnterFolder: (tag: string, name: string, item: ClipboardItem) => void,
    onMoveTagToFolder?: (tag: string, targetFolder: string, sourceItem: ClipboardItem) => void,
    onCombineDocumentTagsIntoFolder?: (sourceTag: string, targetTag: string, parentItem: ClipboardItem) => void,
    onPasteDocumentTags: (
        sourceItemId: string,
        targetItemId: string,
        sourceTags: string[],
        mode: 'copy' | 'cut'
    ) => Promise<{ moved: number }>,
    onRemoveSelectedTags?: (tags: string[]) => Promise<{ removed: number }>,
    onSelect: (itemId: string, event?: React.MouseEvent) => void,
    dragHandleProps?: {
        attributes: any;
        listeners: any;
        setActivatorNodeRef: (element: HTMLElement | null) => void;
    },
    preservePositionWhileDragging?: boolean,
    draggingTagInfo?: { itemId: string, tagIndex: number } | null
}) => {
    const t = translations[language || 'zh'];
    const clickTimeoutRef = useRef<number | null>(null);
    const tags = normalizeTags(item.tags);
    const parentItemId = (Array.isArray(tags) ? tags : [])
        .find((entry) => typeof entry === 'string' && entry.startsWith('__p:'))
        ?.split(':')[1] || null;
    const visibleTagEntries = (Array.isArray(tags) ? tags : [])
        .map((t: any, tagIndex: number) => ({ tag: t, index: tagIndex }))
        .filter((entry) => typeof entry.tag === 'string')
        .filter((entry) => !entry.tag.startsWith('__status_') && !entry.tag.startsWith('__p:'));
    const visibleTagCount = visibleTagEntries.length;
    const plainVisibleTags = visibleTagEntries
        .map((entry) => entry.tag.startsWith(FOLDER_TAG_PREFIX) ? entry.tag.replace(FOLDER_TAG_PREFIX, '').trim() : entry.tag)
        .filter(Boolean);
    const bilingualTagPairs = useBilingualTagTranslation({
        enabled: bilingualTagsEnabled && isSelected,
        tags: plainVisibleTags,
        libraryId: activeLibraryId,
        translationSettings
    });

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 12, // More distance for tags to prevent accidental drag
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const [activeTagId, setActiveTagId] = useState<string | null>(null);
    const [tagDropHint, setTagDropHint] = useState<{ overId: string; mode: TagDropHintMode } | null>(null);
    const [cutTags, setCutTags] = useState<string[]>([]);
    const [cutSourceItemId, setCutSourceItemId] = useState<string | null>(null);
    const tagEditInputRef = useRef<HTMLInputElement>(null);
    const isDraggedCard = draggingIndex === index;
    const editingTagKey = isEditingItem && editingTag?.itemId === item.id
        ? `${item.id}:${editingTag.tagIndex}`
        : null;

    // 长按按钮状态
    const longPressTimerRef = useRef<number | null>(null);
    const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
    const [longPressButton, setLongPressButton] = useState<'delete' | 'edit' | null>(null);
    const LONG_PRESS_THRESHOLD = 500; // 500ms
    const [showContextMenu, setShowContextMenu] = useState(false);
    const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);

    useEditFieldFocus(tagEditInputRef, {
        enabled: Boolean(editingTagKey),
        moveCaretToEnd: true,
        triggerKey: editingTagKey
    });

    // 长按按钮处理
    const clearLongPress = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        longPressStartRef.current = null;
        setLongPressButton(null);
    };

    const handleLongPressStart = (buttonType: 'delete' | 'edit', e: React.TouchEvent | React.MouseEvent) => {
        clearLongPress();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        longPressStartRef.current = { x: clientX, y: clientY };
        setLongPressButton(buttonType);

        longPressTimerRef.current = window.setTimeout(() => {
            // 长按触发操作
            if (buttonType === 'delete') {
                const selectedTags = item.type === 'DOCUMENT' ? getBoxSelectedTags() : [];
                if (selectedTags.length > 0) {
                    void (async () => {
                        await onRemoveSelectedTags?.(selectedTags);
                        setSelectedTagKeys(new Set());
                    })();
                    return;
                }
                // onDeleteCard(item.id, null);
                // 打开上下文菜单
                openContextMenu(e);
            } else if (buttonType === 'edit') {
                openContextMenu(e);
            }
            clearLongPress();
        }, LONG_PRESS_THRESHOLD);
    };

    const handleLongPressMove = (e: React.TouchEvent) => {
        if (!longPressStartRef.current) return;
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - longPressStartRef.current.x);
        const dy = Math.abs(touch.clientY - longPressStartRef.current.y);
        // 如果移动超过10px，取消长按
        if (dx > 10 || dy > 10) {
            clearLongPress();
        }
    };

    // 组件卸载时清理
    useEffect(() => {
        return () => clearLongPress();
    }, []);

    // 打开上下文菜单（显示在卡片右上角）
    const openContextMenu = (e: React.TouchEvent | React.MouseEvent) => {
        // 获取卡片位置，菜单显示在卡片右上角
        const cardRect = cardRef.current?.getBoundingClientRect();
        if (cardRect) {
            setContextMenuPos({ x: cardRect.right - 10, y: cardRect.top + 10 });
        } else {
            const clientX = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
            const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;
            setContextMenuPos({ x: clientX, y: clientY });
        }
        setShowContextMenu(true);
        clearLongPress();
    };

    // 关闭上下文菜单
    const closeContextMenu = () => {
        setShowContextMenu(false);
    };

    // 点击菜单外部关闭
    useEffect(() => {
        if (!showContextMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                closeContextMenu();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showContextMenu]);

    useEffect(() => {
        const update = () => {
            if (tagKeyboardClipboard && tagKeyboardClipboard.mode === 'cut') {
                setCutTags(tagKeyboardClipboard.tags || []);
                setCutSourceItemId(tagKeyboardClipboard.sourceItemId || null);
            } else {
                setCutTags([]);
                setCutSourceItemId(null);
            }
        };
        window.addEventListener('tag-clipboard-changed', update);
        update();
        return () => window.removeEventListener('tag-clipboard-changed', update);
    }, []);

    const tagAreaRef = useRef<HTMLDivElement | null>(null);
    const tagElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
    const [selectionCurrent, setSelectionCurrent] = useState<{ x: number; y: number } | null>(null);
    const [selectedTagKeys, setSelectedTagKeys] = useState<Set<string>>(new Set());
    const canBoxSelectTags = item.type === 'DOCUMENT' || item.type === 'TAGS';
    const isBoxSelecting = canBoxSelectTags && !!selectionStart && !!selectionCurrent;
    const clearSelectionBox = () => {
        setSelectionStart(null);
        setSelectionCurrent(null);
    };

    const shouldIgnoreSelectionTarget = (target: EventTarget | null) => {
        if (!(target instanceof Element)) return false;
        return Boolean(
            target.closest('button, input, textarea, [contenteditable="true"], [role="textbox"], .cm-editor, .cm-content')
        );
    };

    const getSelectionRect = () => {
        if (!selectionStart || !selectionCurrent) return null;
        return {
            left: Math.min(selectionStart.x, selectionCurrent.x),
            top: Math.min(selectionStart.y, selectionCurrent.y),
            right: Math.max(selectionStart.x, selectionCurrent.x),
            bottom: Math.max(selectionStart.y, selectionCurrent.y),
        };
    };

    const updateBoxSelectedTags = (currentPoint: { x: number; y: number }) => {
        const area = tagAreaRef.current;
        if (!area || !selectionStart) return;
        const rect = {
            left: Math.min(selectionStart.x, currentPoint.x),
            top: Math.min(selectionStart.y, currentPoint.y),
            right: Math.max(selectionStart.x, currentPoint.x),
            bottom: Math.max(selectionStart.y, currentPoint.y),
        };

        const next = new Set<string>();
        visibleTagEntries.forEach((entry, idx) => {
            const visibleIdx = idx;
            const canSelect = canBoxSelectTags && visibleIdx > 0;
            if (!canSelect) return;

            const tag = entry.tag;
            const key = `${entry.index}-${tag}`;
            const el = tagElementRefs.current[key];
            if (!el) return;

            const r = el.getBoundingClientRect();
            const areaRect = area.getBoundingClientRect();
            const rel = {
                left: r.left - areaRect.left,
                right: r.right - areaRect.left,
                top: r.top - areaRect.top,
                bottom: r.bottom - areaRect.top,
            };

            const intersects = !(rel.right < rect.left || rel.left > rect.right || rel.bottom < rect.top || rel.top > rect.bottom);
            if (intersects) next.add(key);
        });

        setSelectedTagKeys(next);
    };

    const getBoxSelectedTags = () => {
        if (!canBoxSelectTags) return [];
        const selectedEntries = visibleTagEntries
            .filter((entry, idx) => {
                const visibleIdx = idx;
                if (visibleIdx <= 0) return false;
                const tag = entry.tag;
                return selectedTagKeys.has(`${entry.index}-${tag}`);
            })
            .map((entry) => entry.tag)
            .filter((tag): tag is string => typeof tag === 'string');
        return selectedEntries;
    };

    useEffect(() => {
        if (!isBoxSelecting) return;

        const handleMouseUp = () => {
            clearSelectionBox();
        };

        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, [isBoxSelecting]);

    useEffect(() => {
        if (selectedTagKeys.size === 0) return;

        const handleGlobalMouseDown = (e: MouseEvent) => {
            const area = tagAreaRef.current;
            if (!area) return;
            const target = e.target as Node | null;
            if (target && area.contains(target)) return;
            setSelectedTagKeys(new Set());
            clearSelectionBox();
        };

        window.addEventListener('mousedown', handleGlobalMouseDown, true);
        return () => window.removeEventListener('mousedown', handleGlobalMouseDown, true);
    }, [selectedTagKeys]);

    useEffect(() => {
        if (item.type !== 'DOCUMENT' && item.type !== 'TAGS') return;

        const handleKeydown = (e: KeyboardEvent) => {
            if (isAnyDragActive) return;
            if (document.querySelector('[data-clipboard-item-modal="true"]')) return;
            if (activeDocumentCardId !== item.id) return;
            if (shouldIgnoreSelectionTarget(document.activeElement)) return;

            const key = e.key.toLowerCase();
            if ((key === 'delete' || key === 'backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const selectedTags = getBoxSelectedTags();
                if (selectedTags.length === 0) return;
                e.preventDefault();
                e.stopPropagation();
                (e as any).stopImmediatePropagation?.();
                void (async () => {
                    await onRemoveSelectedTags?.(selectedTags);
                    setSelectedTagKeys(new Set());
                })();
                return;
            }

            if (!(e.ctrlKey || e.metaKey)) return;
            if (key === 'c' || key === 'x') {
                const selectedTags = getBoxSelectedTags();
                if (selectedTags.length === 0) return;
                e.preventDefault();
                e.stopPropagation();
                (e as any).stopImmediatePropagation?.();
                tagKeyboardClipboard = {
                    sourceItemId: item.id,
                    tags: selectedTags,
                    mode: key === 'x' ? 'cut' : 'copy',
                };
                window.dispatchEvent(new CustomEvent('tag-clipboard-changed'));
                return;
            }

            if (key === 'v' && tagKeyboardClipboard) {
                e.preventDefault();
                e.stopPropagation();
                (e as any).stopImmediatePropagation?.();
                void (async () => {
                    const result = await onPasteDocumentTags(
                        tagKeyboardClipboard!.sourceItemId,
                        item.id,
                        tagKeyboardClipboard!.tags,
                        tagKeyboardClipboard!.mode
                    );
                    if (tagKeyboardClipboard?.mode === 'cut' && result.moved > 0) {
                        tagKeyboardClipboard = null;
                        window.dispatchEvent(new CustomEvent('tag-clipboard-changed'));
                    }
                })();
            }
        };

        window.addEventListener('keydown', handleKeydown, true);
        return () => window.removeEventListener('keydown', handleKeydown, true);
    }, [isAnyDragActive, item.id, item.type, onPasteDocumentTags, onRemoveSelectedTags, selectedTagKeys, visibleTagEntries]);

    const handleDragStart = (event: DragStartEvent) => {
        if (isBoxSelecting) return;
        setActiveTagId(event.active.id as string);
        setTagDropHint(null);
    };

    const resolveTagDropHint = (
        activeId: string,
        overId: string,
        translatedRect: { left: number; width: number } | null | undefined
    ): { overId: string; mode: TagDropHintMode } | null => {
        if (!overId || activeId === overId) return null;

        const activeVisibleIndex = visibleTagEntries.findIndex((entry) => entry.tag === activeId);
        const overVisibleIndex = visibleTagEntries.findIndex((entry) => entry.tag === overId);
        if (activeVisibleIndex <= 0 || overVisibleIndex === -1) return null;

        const escapedOverId = window.CSS?.escape?.(overId) ?? overId.replace(/"/g, '\\"');
        const targetEl = document.querySelector<HTMLElement>(`[data-tag-drop-id="${escapedOverId}"]`);
        if (!targetEl) return null;

        const rect = targetEl.getBoundingClientRect();
        const pointerX = translatedRect ? translatedRect.left + translatedRect.width / 2 : rect.left + rect.width / 2;
        const relativeX = Math.min(Math.max(pointerX - rect.left, 0), rect.width);
        const edgeZone = Math.max(12, Math.min(22, rect.width * 0.22));
        const isFolder = overId.startsWith(FOLDER_TAG_PREFIX);
        const canDropInside =
            overVisibleIndex > 0 &&
            (isFolder || (item.type === 'DOCUMENT' && !activeId.startsWith(FOLDER_TAG_PREFIX) && !overId.startsWith(FOLDER_TAG_PREFIX)));

        if (relativeX <= edgeZone) return { overId, mode: 'before' };
        if (relativeX >= rect.width - edgeZone) return { overId, mode: 'after' };
        if (canDropInside) return { overId, mode: 'inside' };

        return relativeX < rect.width / 2
            ? { overId, mode: 'before' }
            : { overId, mode: 'after' };
    };

    const handleDragMove = (event: DragMoveEvent) => {
        if (isBoxSelecting) return;
        const { active, over } = event;
        if (!over) {
            setTagDropHint(null);
            return;
        }

        setTagDropHint(resolveTagDropHint(
            active.id as string,
            over.id as string,
            event.active.rect.current.translated
        ));
    };

    const getReorderIndex = (oldIndex: number, overIndex: number, mode: TagDropHintMode | null) => {
        if (mode === 'before') return oldIndex < overIndex ? overIndex - 1 : overIndex;
        if (mode === 'after') return oldIndex < overIndex ? overIndex : overIndex + 1;
        return overIndex;
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        if (isBoxSelecting) return;
        const { active, over } = event;
        setActiveTagId(null);
        const dropHint = tagDropHint;
        setTagDropHint(null);

        if (!over) return;

        const activeId = active.id as string;
        const overId = over.id as string;

        if (activeId !== overId) {
            // Check if dropping INTO a folder tag (folders starts with 📂)
            if (dropHint?.overId === overId && dropHint.mode === 'inside' && overId.startsWith(FOLDER_TAG_PREFIX)) {
                onMoveTagToFolder?.(activeId, overId, item);
                return;
            }

            const activeVisibleIndex = visibleTagEntries.findIndex((entry) => entry.tag === activeId);
            const overVisibleIndex = visibleTagEntries.findIndex((entry) => entry.tag === overId);

            // First tag is pinned: dropping onto it should never reorder.
            // For nested cards, treat this as "move out of current folder to parent card".
            if (activeVisibleIndex > 0 && overVisibleIndex === 0) {
                if (parentItemId) {
                    await onPasteDocumentTags(item.id, parentItemId, [activeId], 'cut');
                }
                return;
            }

            const shouldCreateFolder =
                dropHint?.overId === overId &&
                dropHint.mode === 'inside' &&
                item.type === 'DOCUMENT' &&
                activeVisibleIndex > 0 &&
                overVisibleIndex > 0 &&
                !activeId.startsWith(FOLDER_TAG_PREFIX) &&
                !overId.startsWith(FOLDER_TAG_PREFIX);

            if (shouldCreateFolder) {
                void onCombineDocumentTagsIntoFolder?.(activeId, overId, item);
                return;
            }

            const oldIndex = tags.indexOf(activeId);
            const newIndex = tags.indexOf(overId);
            if (oldIndex <= 0 || newIndex === -1) return;
            const targetIndex = getReorderIndex(oldIndex, newIndex, dropHint?.overId === overId ? dropHint.mode : null);
            if (targetIndex <= 0) return;
            const newTags = arrayMove(tags, oldIndex, targetIndex);
            onUpdateTags(newTags);
        }
    };

    const handleTagItemContextMenu = (
        e: React.MouseEvent,
        contextItem: ClipboardItem,
        tag: string,
        actualTagIndex: number
    ) => {
        const tagKey = `${actualTagIndex}-${tag}`;
        const selectedTags = selectedTagKeys.has(tagKey) ? getBoxSelectedTags() : [];
        onTagContextMenu(e, contextItem, tag, actualTagIndex, selectedTags);
    };

    const handleToggleSelectTag = (actualTagIndex: number, tag: string) => {
        if (!canBoxSelectTags || actualTagIndex <= 0) return;
        activeDocumentCardId = item.id;
        setSelectedTagKeys((prev) => {
            const next = new Set(prev);
            const tagKey = `${actualTagIndex}-${tag}`;
            if (next.has(tagKey)) {
                next.delete(tagKey);
            } else {
                next.add(tagKey);
            }
            return next;
        });
    };

    const dropAnimationConfig = {
        sideEffects: defaultDropAnimationSideEffects({
            styles: {
                active: {
                    opacity: '0.4',
                },
            },
        }),
        duration: 0, // No drop animation
    };

    return (
        <div
            ref={cardRef}
            data-clipboard-card="true"
            className={`${STYLES.CARD_CONTAINER} ${isAnyDragActive ? STYLES.CARD_ACTIVE : STYLES.CARD_INACTIVE} ${isSelected ? 'bg-[#18181B]' : ''} ${isDraggedCard && preservePositionWhileDragging ? 'ring-1 ring-sky-400/35 bg-[#17171A]' : ''} ${isDraggedCard && !preservePositionWhileDragging ? 'opacity-0 scale-[0.98]' : (isAnyDragActive ? 'cursor-grabbing' : 'cursor-default')
                }`}
            onContextMenu={(e) => onContextMenu(e, item)}
            onMouseDownCapture={(e) => {
                if (e.button !== 0) return;
                if (item.type === 'DOCUMENT' || item.type === 'TAGS') {
                    activeDocumentCardId = item.id;
                }
                const target = e.target as HTMLElement;
                const isTagItem = !!target.closest('[data-tag-item="true"]');
                const isAdditiveTagSelection = canBoxSelectTags && isTagItem && (e.ctrlKey || e.metaKey);
                if (isAdditiveTagSelection) {
                    return;
                }
                if (selectedTagKeys.size > 0) {
                    clearSelectionBox();
                    setSelectedTagKeys(new Set());
                }
                
            }}
        >
            {dragHandleProps && (
                <button
                    ref={dragHandleProps.setActivatorNodeRef as any}
                    {...dragHandleProps.listeners}
                    {...dragHandleProps.attributes}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="absolute left-1.5 top-1/2 -translate-y-1/2 w-[12px] h-[20px] opacity-0 group-hover/card:opacity-40 hover:opacity-40 cursor-grab active:cursor-grabbing z-20 transition-opacity flex items-center justify-center"
                    title={language === 'en' ? 'Drag to reorder' : '拖动排序'}
                    aria-label="Drag card"
                    type="button"
                >
                    <span className="grid grid-cols-2 gap-[2px]">
                        {Array.from({ length: 6 }).map((_, idx) => (
                            <span
                                key={idx}
                                className="w-[3px] h-[3px] rounded-full bg-white/30"
                            />
                        ))}
                    </span>
                </button>
            )}
            <div
                ref={tagAreaRef}
                className="relative flex flex-wrap gap-2.5 mr-10 overflow-y-auto overflow-x-hidden no-scrollbar py-3 mb-2 items-center content-start justify-start max-h-[104px] min-h-[52px] overscroll-contain touch-pan-y"
                onMouseDown={(e) => {
                    // 长按打开菜单
                    const timer = window.setTimeout(() => {
                        openContextMenu(e);
                    }, LONG_PRESS_THRESHOLD);
                    const clearTimer = () => {
                        clearTimeout(timer);
                        document.removeEventListener('mouseup', clearTimer);
                    };
                    document.addEventListener('mouseup', clearTimer);
                    
                    if (!canBoxSelectTags) return;
                    if (e.button !== 0) return;
                    activeDocumentCardId = item.id;
                    if (selectedTagKeys.size > 0) {
                        clearSelectionBox();
                        setSelectedTagKeys(new Set());
                    }
                    const target = e.target as HTMLElement;
                    if (shouldIgnoreSelectionTarget(target)) return;
                    if (target.closest('[data-tag-item=\"true\"]')) return;

                    const area = tagAreaRef.current;
                    if (!area) return;
                    const rect = area.getBoundingClientRect();
                    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                    setSelectionStart(point);
                    setSelectionCurrent(point);
                    setSelectedTagKeys(new Set());
                    e.preventDefault();
                    e.stopPropagation();
                }}
                onMouseMove={(e) => {
                    if (!selectionStart || !canBoxSelectTags) return;
                    const area = tagAreaRef.current;
                    if (!area) return;
                    const rect = area.getBoundingClientRect();
                    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                    setSelectionCurrent(point);
                    updateBoxSelectedTags(point);
                    e.preventDefault();
                    e.stopPropagation();
                }}
                onMouseUp={() => {
                    if (!canBoxSelectTags) return;
                    clearSelectionBox();
                }}
                onMouseLeave={() => {
                    if (!canBoxSelectTags) return;
                    clearSelectionBox();
                }}
                onWheel={(e) => {
                    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
                    if (delta !== 0) {
                        e.currentTarget.scrollTop += delta;
                        e.preventDefault();
                    }
                }}
            >
                <DndContext
                    id={`tag-context-${item.id}`}
                    sensors={sensors}
                    collisionDetection={pointerWithin}
                    onDragStart={handleDragStart}
                    onDragMove={handleDragMove}
                    onDragEnd={handleDragEnd}
                    modifiers={[snapCenterToCursor]}
                >
                    <div className="flex flex-wrap gap-2.5 items-center">
                        {(() => {
                            const firstEntry = visibleTagEntries[0];
                            const otherEntries = visibleTagEntries.slice(1);
                            const otherTags = otherEntries.map(e => e.tag);

                            return (
                                <>
                                    {/* First Tag: Pinned and non-sortable */}
                                    {firstEntry?.tag && (() => {
                                        const isEditing = isEditingItem && editingTag?.tagIndex === firstEntry.index;
                                        const tagBgClass = 'bg-gradient-to-br from-white/[0.08] to-white/[0.02] text-white/90 border border-white/[0.06] tracking-wider hover:from-white/[0.12] hover:to-white/[0.05] hover:text-white shadow-sm shadow-black/40';
                                        
                                        if (isEditing) {
                                            const val = editingTag?.value || '';
                                            const isFolder = val.startsWith('\uD83D\uDCC1');
                                            const displayValue = isFolder ? val.replace('\uD83D\uDCC1', '').trim() : val;
                                            return (
                                                <div
                                                    key="edit-0"
                                                    data-editable-surface="true"
                                                    className="relative shrink-0 flex items-center px-4 py-2.5 rounded-[16px] bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/[0.06] shadow-sm shadow-black/40"
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <input
                                                        ref={tagEditInputRef}
                                                        autoFocus
                                                        value={displayValue}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => {
                                                            setEditingTag(prev => prev ? { ...prev, value: isFolder ? `\uD83D\uDCC1 ${e.target.value}` : e.target.value } : null);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') commitEditTag(isFolder ? `\uD83D\uDCC1 ${e.currentTarget.value}` : e.currentTarget.value);
                                                            if (e.key === 'Escape') setEditingTag(null);
                                                        }}
                                                        onBlur={(e) => commitEditTag(isFolder ? `\uD83D\uDCC1 ${e.target.value}` : e.target.value)}
                                                        className="bg-transparent border-none outline-none text-white/90 text-[14px] w-24 font-semibold tracking-wider"
                                                    />
                                                </div>
                                            );
                                        }

                                        return (
                                            <SortableTagItem
                                                key={`tag-0-${item.id}`}
                                                tag={firstEntry.tag}
                                                tagIdx={0}
                                                tagIndex={firstEntry.index}
                                                item={item}
                                                visibleTagCount={visibleTagCount}
                                                isAnyDragActive={isAnyDragActive}
                                                pasteTagsWithComma={pasteTagsWithComma}
                                                tagBgClass={tagBgClass}
                                                handleCopy={handleCopy}
                                                onOpenEditor={onOpenEditor}
                                                setEditingTag={setEditingTag}
                                                onContextMenu={handleTagItemContextMenu}
                                                clickTimeoutRef={clickTimeoutRef}
                                                onEnterFolder={(tagStr: string, name: string) => onEnterFolder(tagStr, name, item)}
                                                onMoveTagToFolder={onMoveTagToFolder}
                                                isBoxSelected={false}
                                                onToggleSelectTag={handleToggleSelectTag}
                                                isCut={cutSourceItemId === item.id && cutTags.includes(firstEntry.tag)}
                                                dropHintMode={tagDropHint?.overId === firstEntry.tag ? tagDropHint.mode : null}
                                                bilingualTag={bilingualTagsEnabled ? (() => {
                                                    const key = firstEntry.tag.startsWith(FOLDER_TAG_PREFIX) ? firstEntry.tag.replace(FOLDER_TAG_PREFIX, '').trim() : firstEntry.tag;
                                                    return bilingualTagPairs[key] || parseBilingualTag(key);
                                                })() : null}
                                            />
                                        );
                                    })()}

                                    {/* Other Tags: Sortable */}
                                    <SortableContext
                                        items={otherTags}
                                        strategy={rectSortingStrategy}
                                    >
                                        {otherEntries.map((entry: { tag: string, index: number }, idx: number) => {
                                            const visibleIdx = idx + 1;
                                            const actualIdx = entry.index;
                                            const tag = entry.tag;
                                            const isEditing = isEditingItem && editingTag?.tagIndex === actualIdx;
                                            const tagBgClass = 'bg-gradient-to-br from-[#212127]/92 to-[#16161C]/88 text-white/72 border border-white/[0.05] tracking-wide hover:from-[#2B2B33]/94 hover:to-[#1D1D26]/90 hover:text-white/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_4px_14px_rgba(0,0,0,0.24)]';

                                            if (isEditing) {
                                                const val = editingTag?.value || '';
                                                const isFolder = val.startsWith('\uD83D\uDCC1');
                                                const displayValue = isFolder ? val.replace('\uD83D\uDCC1', '').trim() : val;
                                                const isDocumentCard = item.type === 'DOCUMENT';
                                                let editIconName = undefined;
                                                if (isFolder) editIconName = 'folder_filled';
                                                else if (isDocumentCard && visibleIdx > 0) editIconName = 'description';

                                                return (
                                                    <div
                                                        key={`edit-${actualIdx}`}
                                                        data-editable-surface="true"
                                                        className="relative shrink-0 flex items-center px-4 py-2.5 rounded-[16px] bg-white/10"
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {editIconName && <Icon name={editIconName} size={14} className="text-white/40 mr-2" />}
                                                        <input
                                                            ref={tagEditInputRef}
                                                            autoFocus
                                                            value={displayValue}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onChange={(e) => {
                                                                setEditingTag(prev => prev ? { ...prev, value: isFolder ? `\uD83D\uDCC1 ${e.target.value}` : e.target.value } : null);
                                                            }}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') commitEditTag(isFolder ? `\uD83D\uDCC1 ${e.currentTarget.value}` : e.currentTarget.value);
                                                                if (e.key === 'Escape') setEditingTag(null);
                                                            }}
                                                            onBlur={(e) => commitEditTag(isFolder ? `\uD83D\uDCC1 ${e.target.value}` : e.target.value)}
                                                            className="bg-transparent border-none outline-none text-white text-[14px] w-24 font-medium"
                                                        />
                                                    </div>
                                                );
                                            }

                                            return (
                                                <div
                                                    key={`${tag}-${actualIdx}-${item.id}`}
                                                    ref={(el) => {
                                                        const selectKey = `${actualIdx}-${tag}`;
                                                        tagElementRefs.current[selectKey] = el;
                                                    }}
                                                >
                                                    <SortableTagItem
                                                        tag={tag}
                                                        tagIdx={visibleIdx}
                                                        tagIndex={actualIdx}
                                                        item={item}
                                                        visibleTagCount={visibleTagCount}
                                                        isAnyDragActive={isAnyDragActive}
                                                        pasteTagsWithComma={pasteTagsWithComma}
                                                        tagBgClass={tagBgClass}
                                                        handleCopy={handleCopy}
                                                        onOpenEditor={onOpenEditor}
                                                        setEditingTag={setEditingTag}
                                                        onContextMenu={handleTagItemContextMenu}
                                                        clickTimeoutRef={clickTimeoutRef}
                                                        onEnterFolder={(tagStr: string, name: string) => onEnterFolder(tagStr, name, item)}
                                                        onMoveTagToFolder={onMoveTagToFolder}
                                                        isBoxSelected={selectedTagKeys.has(`${actualIdx}-${tag}`)}
                                                        onToggleSelectTag={handleToggleSelectTag}
                                                        isCut={cutSourceItemId === item.id && cutTags.includes(tag)}
                                                        dropHintMode={tagDropHint?.overId === tag ? tagDropHint.mode : null}
                                                        bilingualTag={bilingualTagsEnabled ? (() => {
                                                            const key = tag.startsWith(FOLDER_TAG_PREFIX) ? tag.replace(FOLDER_TAG_PREFIX, '').trim() : tag;
                                                            return bilingualTagPairs[key] || parseBilingualTag(key);
                                                        })() : null}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </SortableContext>
                                    {item.type === 'TAGS' && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onAddTag(item.id);
                                            }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            className="shrink-0 inline-flex items-center justify-center w-[46px] h-[46px] rounded-[16px] bg-gradient-to-br from-[#18181D]/90 to-[#111116]/86 text-white/24 border border-white/[0.035] hover:from-[#23232A]/92 hover:to-[#18181F]/88 hover:text-white/56 transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_4px_14px_rgba(0,0,0,0.22)]"
                                            title={t.add}
                                            aria-label={t.add}
                                        >
                                            <Icon name="add" size={18} />
                                        </button>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                    {(() => {
                        const rect = getSelectionRect();
                        if (!rect || !canBoxSelectTags) return null;
                        return (
                            <div
                                className="absolute pointer-events-none z-20 border border-white/30 bg-white/10 rounded-md"
                                style={{
                                    left: rect.left,
                                    top: rect.top,
                                    width: Math.max(1, rect.right - rect.left),
                                    height: Math.max(1, rect.bottom - rect.top),
                                }}
                            />
                        );
                    })()}
                    <DragOverlay dropAnimation={dropAnimationConfig}>
                        {activeTagId ? (
                            <div style={{
                                transformOrigin: 'center',
                                scale: '1.05',
                                transition: 'none',
                            }}>
                                {(() => {
                                    const isFolder = activeTagId.startsWith('\uD83D\uDCC1');
                                    const tagIdx = tags.indexOf(activeTagId);
                                    const isDocumentCard = item.type === 'DOCUMENT';
                                    let iconName = undefined;
                                    
                                    if (isFolder) {
                                        iconName = 'folder_filled';
                                    } else if (isDocumentCard && tagIdx > 0) {
                                        iconName = 'description';
                                    }
                                    const displayTag = isFolder ? activeTagId.replace('\uD83D\uDCC1', '').trim() : activeTagId;
                                    const overlayBilingualTag = bilingualTagsEnabled ? (bilingualTagPairs[displayTag] || parseBilingualTag(displayTag)) : null;

                                    return (
                                        <TagItem
                                            tag={displayTag}
                                            bilingualTag={toOriginalFirstBilingualTag(displayTag, overlayBilingualTag)}
                                            iconName={iconName}
                                            className={tagIdx === 0
                                                ? 'bg-gradient-to-br from-white/[0.12] to-white/[0.04] text-white/90 border border-white/[0.08] tracking-wider shadow-xl'
                                                : 'bg-gradient-to-br from-[#2B2B33]/94 to-[#1D1D26]/90 text-white/78 border border-white/[0.06] tracking-wide shadow-lg'}
                                            style={{
                                                boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                                                cursor: 'grabbing',
                                                transition: 'none',
                                            }}
                                            isActive={tagIdx === 0}
                                        />
                                    );
                                })()}
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>

            </div>

            {/* 长按弹出上下文菜单 */}
            {showContextMenu && (
                <div
                    ref={contextMenuRef}
                    className="fixed z-50 bg-[#2A2A32] rounded-xl shadow-2xl border border-white/10 py-1 min-w-[160px]"
                    style={{
                        left: Math.min(contextMenuPos.x, window.innerWidth - 180),
                        top: Math.min(contextMenuPos.y, window.innerHeight - 180),
                    }}
                >
                    {item.type !== 'DOCUMENT' && (
                        <button
                            onClick={() => {
                                onEditCard(item, null);
                                closeContextMenu();
                            }}
                            className="w-full px-4 py-3 text-left text-white/90 hover:bg-white/10 flex items-center gap-3 transition-colors"
                        >
                            <Icon name="edit" size={18} />
                            <span>{t.edit || '编辑'}</span>
                        </button>
                    )}
                    <button
                        onClick={() => {
                            const selectedTags = item.type === 'DOCUMENT' ? getBoxSelectedTags() : [];
                            if (selectedTags.length > 0) {
                                void (async () => {
                                    await onRemoveSelectedTags?.(selectedTags);
                                    setSelectedTagKeys(new Set());
                                })();
                                closeContextMenu();
                                return;
                            }
                            onDeleteCard(item.id, null);
                            closeContextMenu();
                        }}
                        className="w-full px-4 py-3 text-left text-red-400 hover:bg-white/10 flex items-center gap-3 transition-colors"
                    >
                        <Icon name="delete" size={18} />
                        <span>{t.delete}</span>
                    </button>
                </div>
            )}
        </div>
    );
});
