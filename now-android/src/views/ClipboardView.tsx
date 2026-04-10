import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { ViewType, TranslationSettings, ClipboardItem, AppSettings } from '../types';
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BackendService } from '../backend';
import { useDebounce } from '../hooks/useDebounce';
import { useDragAutoScroll } from '../hooks/useDragAutoScroll';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, DragMoveEvent, DragStartEvent, DragOverlay, defaultDropAnimationSideEffects, pointerWithin, useDroppable } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, rectSortingStrategy, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { snapCenterToCursor, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { TagItem } from '../components/TagItem';
import { translations } from '../i18n';
import Icon from '../components/Icon';
import { logger, parseClipboardItemInitialData } from '../utils';
import { extractCardPasteContent, normalizeLegacyCardText } from '../utils/cardContent';
import ClipboardItemModal from '../components/ClipboardItemModal';
import DecisionModal from '../components/DecisionModal';
import ClipboardHeader from '../components/ClipboardHeader';
import { STYLES, isAllLikeCategory, isHistoryLikeCategory } from '../constants';
import ContextMenu from '../components/ContextMenu';
import TagContextMenu from '../components/TagContextMenu';
import CategoryContextMenu from '../components/CategoryContextMenu';
import WorkspaceContextMenu from '../components/WorkspaceContextMenu';
import { SortableItem } from '../components/Clipboard/SortableItem';
import ClipboardCardItem from '../components/Clipboard/ClipboardCardItem';
import { normalizeItem } from '../hooks/clipboardDataHelpers';
import { useClipboardData } from '../hooks/useClipboardData';
import { ClipboardProvider } from '../context/ClipboardContext';
import { useLongPress } from '../hooks/useLongPress';

interface ClipboardViewProps {
    onNavigate: (view: ViewType) => void;
    onOpenManager: () => void;
    onUpdateCategories: (cats: string[]) => void;
    onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
    categories: string[];
    isPinned: boolean;
    pasteTagsWithComma: boolean;
    pasteContentWithTags: boolean;
    bilingualTagsEnabled: boolean;
    translationSettings: TranslationSettings;
    activeLibraryId: string;
    libraries: { id: string, name: string }[];
    onSwitchLibrary: (id: string) => void;
    onAddLibrary: (name: string) => void;
    language?: 'zh' | 'en';
    onOpenEditor: (item: ClipboardItem, tagIndex?: number) => void;
}

type ClipboardUpdatedDetail = {
    itemId?: string;
    itemIds?: string[];
    removedItemId?: string;
    removedItemIds?: string[];
    reloadAll?: boolean;
};

const VISIBLE_WINDOW_CACHE_LIMIT = 12;
const VISIBLE_WINDOW_CACHE_TTL_MS = 60 * 1000;
const VIRTUOSO_OVERSCAN = 240;


const backend = BackendService.getInstance();
type CardDropHintMode = 'merge' | 'before' | 'after';
const getActiveTabStorageKey = (libraryId: string) =>
    libraryId === 'default' ? 'clipboard_active_tab' : `clipboard_active_tab_${libraryId}`;

const ClipboardView: React.FC<ClipboardViewProps> = ({ onNavigate, onOpenManager, onUpdateCategories, onUpdateSetting, categories, isPinned, pasteTagsWithComma, pasteContentWithTags, bilingualTagsEnabled, translationSettings, activeLibraryId, libraries, onSwitchLibrary, onAddLibrary, language, onOpenEditor }) => {
    const t = translations[language || 'zh'];
    const activeLibraryName = React.useMemo(
        () => libraries.find((lib) => lib.id === activeLibraryId)?.name || '',
        [libraries, activeLibraryId]
    );
    const [activeTab, setActiveTab] = useState(categories[0] || '');
    const [editingCat, setEditingCat] = useState<{ old: string, new: string } | null>(null);

    const [modalConfig, setModalConfig] = useState<any>(null);

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [docToDelete, setDocToDelete] = useState<ClipboardItem | null>(null);
    const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);

    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, item: ClipboardItem } | null>(null);
    const [tagContextMenu, setTagContextMenu] = useState<{ x: number, y: number, item: ClipboardItem, tag: string, tagIdx: number, selectedTags: string[] } | null>(null);
    const [categoryContextMenu, setCategoryContextMenu] = useState<{ x: number, y: number, category: string } | null>(null);
    const [workspaceContextMenu, setWorkspaceContextMenu] = useState<{ x: number, y: number } | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const virtuosoRef = useRef<any>(null); // Improved drag scrolling
    const multiSelectModifierRef = useRef(false);


    const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
    const [activeCatId, setActiveCatId] = useState<string | null>(null);
    const filteredItemsRef = useRef<ClipboardItem[]>([]);
    const draggingCardIdRef = useRef<string | null>(null);
    const categoryDropHandledRef = useRef(false);

    const [lastCopiedId, setLastCopiedId] = useState<string | null>(null);
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
    const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
    const [copiedCardId, setCopiedCardId] = useState<string | null>(null);

    const [isDragging, setIsDragging] = useState(false);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [cardDropHint, setCardDropHint] = useState<{ overId: string; mode: CardDropHintMode } | null>(null);
    const preserveCardPositionWhileDragging = isDragging;

    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, 220);
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [toast, setToast] = useState<{ message: string, visible: boolean }>({ message: '', visible: false });
    const showToast = (message: string) => {
        setToast({ message, visible: true });
        setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 2000);
    };
    const searchInputRef = useRef<HTMLInputElement>(null);
    const openGlobalSearch = useCallback(() => {
        setIsSearchActive(true);
        setTimeout(() => searchInputRef.current?.focus(), 10);
    }, []);
    const [visibleItems, setVisibleItems] = useState<ClipboardItem[]>([]);
    const [hasMoreVisibleItems, setHasMoreVisibleItems] = useState(true);
    const [isLoadingVisibleItems, setIsLoadingVisibleItems] = useState(false);
    const visibleOffsetRef = useRef(0);
    const visibleQueryKeyRef = useRef('');
    const visibleItemsRef = useRef<ClipboardItem[]>([]);
    const hasMoreVisibleItemsRef = useRef(true);
    const visibleWindowCacheRef = useRef(new Map<string, {
        items: ClipboardItem[];
        hasMore: boolean;
        offset: number;
        updatedAt: number;
    }>());
    const PAGE_SIZE = 200;

    const {
        items, setItems, hydrateItemsCache, handleCompleteItem, commitEditContent, commitEditTag,
        handleAddTag, handleCreateItem, handleEnterFolder, handleMoveTagToFolder, handleCombineDocumentTagsIntoFolder,
        pasteDocumentTags, handleMergeDocumentCards, removeDocumentTagsBulk, handleSaveItems, duplicateItem, duplicateTag, removeItem, handleUndo, clearAll, handleRemoveTag,
        handleOpenLocation, handleCopyAsFile, deleteCategory, moveToGroup, renameCategory,
        editingTag, setEditingTag, editingContent, setEditingContent,
        currentParentId, setCurrentParentId, breadcrumbStack, setBreadcrumbStack, itemsRef
    } = useClipboardData(activeLibraryId, activeTab, language, { showToast, setDocToDelete, setActiveTab }, categories, onUpdateCategories);

    const normalizeQueryItem = (raw: any): ClipboardItem => normalizeItem(raw);

    const loadVisibleItems = async (reset: boolean = false) => {
        if (isLoadingVisibleItems && !reset) return;

        const normalizedSearch = debouncedSearchQuery.trim();
        const useGlobalSearchScope = isSearchActive || normalizedSearch.length > 0;
        const categoryFilter = useGlobalSearchScope
            ? null
            : activeTab && !isAllLikeCategory(activeTab) && !isHistoryLikeCategory(activeTab)
                ? activeTab
                : null;
        const parentFilter = useGlobalSearchScope ? null : currentParentId;
        const rootOnly = !useGlobalSearchScope && currentParentId === null;
        const queryKey = [
            activeLibraryId,
            categoryFilter || '__all__',
            normalizedSearch || '__nosearch__',
            parentFilter || '__root__',
            rootOnly ? 'root' : 'any',
            useGlobalSearchScope ? 'scope:global' : 'scope:local'
        ].join('|');
        const offset = reset ? 0 : visibleOffsetRef.current;

        if (reset) {
            visibleQueryKeyRef.current = queryKey;
            pruneVisibleWindowCache();
            const cachedWindow = visibleWindowCacheRef.current.get(queryKey);
            if (cachedWindow && Date.now() - cachedWindow.updatedAt <= VISIBLE_WINDOW_CACHE_TTL_MS) {
                applyVisibleWindowState(cachedWindow.items, {
                    hasMore: cachedWindow.hasMore,
                    offset: cachedWindow.offset
                });
                return;
            }

            if (cachedWindow) {
                visibleWindowCacheRef.current.delete(queryKey);
            }
        }

        setIsLoadingVisibleItems(true);

        try {
            const isKeywordSearch = normalizedSearch.length > 0;
            let nextBatch: ClipboardItem[] = [];

            if (isKeywordSearch) {
                // Search guarantee: fetch visible scope first, then match locally by tag/content/title.
                const fallbackJson = await invoke<string>('db_query_items', {
                    libraryId: activeLibraryId,
                    category: categoryFilter,
                    searchQuery: null,
                    parentId: parentFilter,
                    rootOnly,
                    limit: 5000,
                    offset: 0,
                    includeDocumentContent: false
                });

                if (visibleQueryKeyRef.current !== queryKey) return;
                const fallbackParsed = JSON.parse(fallbackJson);
                const fallbackBatch = Array.isArray(fallbackParsed) ? fallbackParsed.map(normalizeQueryItem) : [];
                const needle = normalizedSearch.toLowerCase();

                nextBatch = fallbackBatch.filter((item) => {
                    const content = (item.content || '').toLowerCase();
                    const tags = (item.tags || []).join(' ').toLowerCase();
                    const firstTag = ((item.tags && item.tags[0]) || '').toLowerCase();
                    return content.includes(needle) || tags.includes(needle) || firstTag.includes(needle);
                });
            } else {
                const queriedJson = await invoke<string>('db_query_items', {
                    libraryId: activeLibraryId,
                    category: categoryFilter,
                    searchQuery: null,
                    parentId: parentFilter,
                    rootOnly,
                    limit: PAGE_SIZE,
                    offset,
                    includeDocumentContent: false
                });

                if (visibleQueryKeyRef.current !== queryKey) return;
                const parsedQueried = JSON.parse(queriedJson);
                nextBatch = Array.isArray(parsedQueried) ? parsedQueried.map(normalizeQueryItem) : [];
            }

            hydrateItemsCache(nextBatch);

            const nextOffset = isKeywordSearch ? nextBatch.length : offset + nextBatch.length;
            const nextHasMore = isKeywordSearch ? false : nextBatch.length === PAGE_SIZE;
            const nextItems = reset
                ? nextBatch
                : (() => {
                    const seen = new Set(visibleItemsRef.current.map((item) => item.id));
                    return [...visibleItemsRef.current, ...nextBatch.filter((item) => !seen.has(item.id))];
                })();

            applyVisibleWindowState(nextItems, {
                hasMore: nextHasMore,
                offset: nextOffset
            });
            updateVisibleWindowCache(queryKey, nextItems, {
                hasMore: nextHasMore,
                offset: nextOffset
            });
        } catch (error) {
            console.error('Failed to load visible clipboard items:', error);
            if (reset) {
                applyVisibleWindowState([], { hasMore: false, offset: 0 });
            } else {
                hasMoreVisibleItemsRef.current = false;
                setHasMoreVisibleItems(false);
            }
        } finally {
            if (visibleQueryKeyRef.current === queryKey) {
                setIsLoadingVisibleItems(false);
            }
        }
    };


    const isAnyDragActive = activeCatId !== null || isDragging;

    const isEditableElement = (element: Element | null) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.isContentEditable) return true;

        return Boolean(
            element.closest('input, textarea, button, [contenteditable="true"], [role="textbox"], .cm-editor, .cm-content')
        );
    };

    const resolveCardDropHint = (
        activeId: string,
        overId: string,
        translatedRect: { top: number; height: number } | null | undefined
    ): { overId: string; mode: CardDropHintMode } | null => {
        if (!overId || activeId === overId) return null;

        const currentItems = filteredItemsRef.current;
        const activeItem = currentItems.find((item) => item.id === activeId);
        const overItem = currentItems.find((item) => item.id === overId);
        const overIndex = currentItems.findIndex((item) => item.id === overId);
        if (!activeItem || !overItem) return null;
        if (overIndex === -1) return null;

        const overElement = document.querySelector<HTMLElement>(`[data-card-drop-id="${overId}"]`);
        if (!overElement) return null;

        const overRect = overElement.getBoundingClientRect();
        const pointerY = translatedRect ? translatedRect.top + translatedRect.height / 2 : overRect.top + overRect.height / 2;
        const relativeY = Math.min(Math.max(pointerY - overRect.top, 0), overRect.height);
        const canMerge = activeItem.type === 'DOCUMENT' && overItem.type === 'DOCUMENT';
        const edgeZone = Math.max(28, Math.min(56, overRect.height * 0.24));

        if (canMerge && relativeY > edgeZone && relativeY < overRect.height - edgeZone) {
            return { overId, mode: 'merge' };
        }

        if (relativeY <= overRect.height / 2) {
            return { overId, mode: 'before' };
        }

        // Keep one visual insertion line between neighboring cards:
        // when hovering the lower half of a card, map to "before next card" when possible.
        const nextItem = currentItems[overIndex + 1];
        if (nextItem && nextItem.id !== activeId) {
            return { overId: nextItem.id, mode: 'before' };
        }

        return { overId, mode: 'after' };
    };

    const getParentId = (item: ClipboardItem) =>
        item.tags?.find((tag) => tag.startsWith('__p:'))?.split(':')[1] || null;

    const shouldItemBeVisible = (item: ClipboardItem) => {
        const normalizedSearch = debouncedSearchQuery.trim();
        if (isSearchActive || normalizedSearch) {
            return true;
        }

        const categoryFilter = activeTab && !isAllLikeCategory(activeTab) && !isHistoryLikeCategory(activeTab)
            ? activeTab
            : null;
        const itemParentId = getParentId(item);

        if (categoryFilter && item.category !== categoryFilter) {
            return false;
        }

        if (currentParentId !== null) {
            return item.id === currentParentId || itemParentId === currentParentId;
        }

        return itemParentId === null;
    };

    const sortVisibleItems = (nextItems: ClipboardItem[]) =>
        [...nextItems].sort((left, right) => {
            if (right.timestamp !== left.timestamp) {
                return right.timestamp - left.timestamp;
            }
            return left.id.localeCompare(right.id);
        });

    const applyVisibleWindowState = (nextItems: ClipboardItem[], options?: { hasMore?: boolean; offset?: number }) => {
        visibleItemsRef.current = nextItems;
        setVisibleItems(nextItems);

        if (options?.hasMore !== undefined) {
            hasMoreVisibleItemsRef.current = options.hasMore;
            setHasMoreVisibleItems(options.hasMore);
        }

        if (options?.offset !== undefined) {
            visibleOffsetRef.current = options.offset;
        }
    };

    const updateVisibleWindowCache = (
        queryKey: string,
        nextItems: ClipboardItem[],
        options?: { hasMore?: boolean; offset?: number }
    ) => {
        const cache = visibleWindowCacheRef.current;
        cache.set(queryKey, {
            items: nextItems,
            hasMore: options?.hasMore ?? hasMoreVisibleItemsRef.current,
            offset: options?.offset ?? visibleOffsetRef.current,
            updatedAt: Date.now()
        });

        if (cache.size > VISIBLE_WINDOW_CACHE_LIMIT) {
            const oldestEntry = Array.from(cache.entries()).sort((left, right) => left[1].updatedAt - right[1].updatedAt)[0];
            if (oldestEntry) {
                cache.delete(oldestEntry[0]);
            }
        }
    };

    const pruneVisibleWindowCache = () => {
        const cutoff = Date.now() - VISIBLE_WINDOW_CACHE_TTL_MS;
        const cache = visibleWindowCacheRef.current;
        for (const [queryKey, windowState] of cache.entries()) {
            if (windowState.updatedAt < cutoff) {
                cache.delete(queryKey);
            }
        }
    };

    const clearVisibleWindowCache = () => {
        visibleWindowCacheRef.current.clear();
    };

    const getReorderIndex = (oldIndex: number, overIndex: number, mode: CardDropHintMode | null) => {
        if (mode === 'before') {
            return oldIndex < overIndex ? overIndex - 1 : overIndex;
        }
        if (mode === 'after') {
            return oldIndex < overIndex ? overIndex : overIndex + 1;
        }
        return overIndex;
    };


    // Auto-focus search input when active
    useEffect(() => {
        if (isSearchActive) {
            searchInputRef.current?.focus();
        }
    }, [isSearchActive]);

    useEffect(() => {
        const handlePasteShortcut = (e: KeyboardEvent) => {
            if (e.repeat) return;
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v') return;
            if (isAddModalOpen || editingTag || editingContent) return;
            if (isEditableElement(document.activeElement)) return;

            e.preventDefault();

            void (async () => {
                if (copiedCardId && selectedCardId) {
                    const duplicatedItem = await duplicateItem(copiedCardId);
                    if (duplicatedItem) {
                        setSelectedCardId(duplicatedItem.id);
                        setSelectedCardIds(new Set([duplicatedItem.id]));
                        showToast(language === 'en' ? 'Card duplicated' : '卡片已复制一份');
                    }
                    return;
                }

                const text = await backend.readClipboard();
                if (!text || !text.trim()) return;

                try {
                    await handleSaveItems([{
                        content: text,
                        tags: [],
                        type: 'TEXT'
                    }]);
                    showToast(language === 'en' ? 'Pasted as content card' : '已粘贴为内容卡片');
                } catch (error) {
                    console.error('Failed to paste clipboard as content card:', error);
                }
            })();
        };

        window.addEventListener('keydown', handlePasteShortcut);
        return () => window.removeEventListener('keydown', handlePasteShortcut);
    }, [copiedCardId, duplicateItem, editingContent, editingTag, handleSaveItems, isAddModalOpen, language, selectedCardId]);

    useEffect(() => {
        const updateModifier = (e: KeyboardEvent) => {
            multiSelectModifierRef.current = e.ctrlKey || e.metaKey;
        };
        const resetModifier = () => {
            multiSelectModifierRef.current = false;
        };

        window.addEventListener('keydown', updateModifier);
        window.addEventListener('keyup', updateModifier);
        window.addEventListener('blur', resetModifier);

        return () => {
            window.removeEventListener('keydown', updateModifier);
            window.removeEventListener('keyup', updateModifier);
            window.removeEventListener('blur', resetModifier);
        };
    }, []);








    const handleCardDragStart = (event: DragStartEvent) => {
        const { active } = event;
        const index = filteredItems.findIndex(i => i.id === active.id);
        setDraggingIndex(index);
        setDraggingId(active.id as string);
        draggingCardIdRef.current = active.id as string;
        categoryDropHandledRef.current = false;
        setCardDropHint(null);
        setIsDragging(true);
    };

    const handleCardDragMove = (event: DragMoveEvent) => {
        const { active, over } = event;
        if (!over) {
            setCardDropHint(null);
            return;
        }

        setCardDropHint(
            resolveCardDropHint(
                active.id as string,
                over.id as string,
                event.active.rect.current.translated
            )
        );
    };

    const handleCardDragCancel = () => {
        setDraggingId(null);
        setDraggingIndex(null);
        setCardDropHint(null);
        setIsDragging(false);
        setHoveredTargetCat(null);
        draggingCardIdRef.current = null;
        categoryDropHandledRef.current = false;
    };

    const handleCardDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        const dropHint = cardDropHint;
        const hoveredCategory = hoveredTargetCat;
        const draggedCardId = (active.id as string) || draggingCardIdRef.current;
        const draggedItem = filteredItems.find((item) => item.id === draggedCardId);

        try {
            // Category tabs are in another DnD context, so card->category drop must be resolved here.
            if (!categoryDropHandledRef.current && hoveredCategory && draggedItem && draggedItem.category !== hoveredCategory) {
                await moveToGroup(draggedItem, hoveredCategory);
                categoryDropHandledRef.current = true;
                return;
            }

            if (over && active.id !== over.id) {
                const activeItem = filteredItems.find((item) => item.id === active.id);
                const overItem = filteredItems.find((item) => item.id === over.id);

                if (dropHint?.overId === over.id && dropHint.mode === 'merge' && activeItem?.type === 'DOCUMENT' && overItem?.type === 'DOCUMENT') {
                    const result = await handleMergeDocumentCards(activeItem.id, overItem.id);
                    if (result.merged) {
                        return;
                    }
                }

                const oldIndex = filteredItems.findIndex(i => i.id === active.id);
                const overIndex = filteredItems.findIndex(i => i.id === over.id);
                const newIndex = getReorderIndex(oldIndex, overIndex, dropHint?.overId === over.id ? dropHint.mode : null);
                if (oldIndex === -1 || overIndex === -1 || newIndex === oldIndex) {
                    return;
                }

                const newFilteredItems = arrayMove(filteredItems, oldIndex, newIndex);

                // Reorder timestamps to maintain DB sort order (descending by timestamp usually)
                // Existing logic uses timestamps, let's preserve that.
                const start = Math.min(oldIndex, newIndex);
                const end = Math.max(oldIndex, newIndex);
                const affectedItems = newFilteredItems.slice(start, end + 1);
                const originalTimestamps = filteredItems.slice(start, end + 1).map(i => i.timestamp).sort((a, b) => b - a);

                const updatedItemsWithTimestamps = affectedItems.map((item: any, idx) => ({
                    ...item,
                    timestamp: originalTimestamps[idx]
                }));

                setItems(prev => {
                    const next = [...prev];
                    const updatedIds = updatedItemsWithTimestamps.map(i => i.id);
                    return next.map(item => {
                        const updated = updatedItemsWithTimestamps.find(u => u.id === item.id);
                        return updated ? updated : item;
                    });
                });

                const visibleOldIndex = visibleItemsRef.current.findIndex((item) => item.id === active.id);
                const visibleOverIndex = visibleItemsRef.current.findIndex((item) => item.id === over.id);
                const visibleNewIndex = getReorderIndex(
                    visibleOldIndex,
                    visibleOverIndex,
                    dropHint?.overId === over.id ? dropHint.mode : null
                );
                if (visibleOldIndex !== -1 && visibleOverIndex !== -1 && visibleNewIndex !== visibleOldIndex) {
                    const nextVisibleItems = arrayMove(visibleItemsRef.current, visibleOldIndex, visibleNewIndex);
                    applyVisibleWindowState(nextVisibleItems);
                    updateVisibleWindowCache(visibleQueryKeyRef.current, nextVisibleItems);
                }

                const itemsToPersist = await Promise.all(updatedItemsWithTimestamps.map(async (item) => {
                    if (item.type !== 'DOCUMENT' || item.documentContentLoaded !== false) {
                        return item;
                    }

                    const fullItemJson = await invoke<string>('db_get_item', {
                        id: item.id,
                        libraryId: activeLibraryId,
                        includeDocumentContent: true
                    });
                    const fullItem = JSON.parse(fullItemJson);
                    if (!fullItem) {
                        return item;
                    }

                    return {
                        ...fullItem,
                        ...item,
                        content: fullItem.content,
                        documentContentLoaded: true
                    };
                }));

                await Promise.all(itemsToPersist.map((item) =>
                    invoke('db_upsert_item', {
                        itemJson: JSON.stringify(item),
                        libraryId: activeLibraryId
                    })
                ));
            }
        } finally {
            setDraggingId(null);
            setDraggingIndex(null);
            setCardDropHint(null);
            setIsDragging(false);
            setHoveredTargetCat(null);
            draggingCardIdRef.current = null;
            categoryDropHandledRef.current = false;
        }
    };

    const cardSensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 4, // More sensitive for cards
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );
    const finalizeDrag = (delay = 300) => {
        setIsDragging(false);
        setActiveCatId(null);
        setHoveredTargetCat(null);

        // Add stabilizing class immediately to prevent transparency flicker
        document.documentElement.classList.add('dragging-stabilizing');
        document.body.classList.add('dragging-active');

        // Remove active class
        document.documentElement.classList.remove('dragging-active');
        document.body.classList.remove('dragging-active');

        setTimeout(() => {
            document.documentElement.classList.remove('dragging-stabilizing');
            document.body.classList.remove('dragging-stabilizing');
        }, delay);
    };

    const handleCategoryDragStart = (event: DragStartEvent) => {
        document.documentElement.classList.add('dragging-active');
        document.body.classList.add('dragging-active');
        setActiveCatId(event.active.id as string);
    };

    const handleCategoryDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (active.id !== over?.id) {
            const oldIndex = categories.indexOf(active.id as string);
            const newIndex = categories.indexOf(over?.id as string);

            if (oldIndex !== -1 && newIndex !== -1) {
                const newCategories = arrayMove(categories, oldIndex, newIndex);
                onUpdateCategories(newCategories);
            }
        }
        // Delay cleanup until after reorder state is scheduled to avoid one-frame position snap.
        requestAnimationFrame(() => finalizeDrag(300));
    };

    // Restore a saved tab only when the library/category set changes, then keep the current tab if it's still valid.
    useEffect(() => {
        const savedActiveTab = localStorage.getItem(getActiveTabStorageKey(activeLibraryId));

        setActiveTab((currentTab) => {
            if (savedActiveTab && categories.includes(savedActiveTab)) {
                return savedActiveTab;
            }

            if (categories.includes(currentTab)) {
                return currentTab;
            }

            return categories[0] || '';
        });
    }, [categories, activeLibraryId]);

    useEffect(() => {
        if (!activeTab) return;
        localStorage.setItem(getActiveTabStorageKey(activeLibraryId), activeTab);
    }, [activeLibraryId, activeTab]);

    useEffect(() => {
        setCurrentParentId(null);
        setBreadcrumbStack([]);
    }, [activeTab]);

    const handleContextMenu = (e: React.MouseEvent, item: ClipboardItem) => {
        e.preventDefault();
        setSelectedCardId(item.id);
        setSelectedCardIds((prev) => {
            if (prev.has(item.id) && prev.size > 1) {
                return prev;
            }
            return new Set([item.id]);
        });
        setTagContextMenu(null);
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            item
        });
    };

    const handleTagContextMenu = (e: React.MouseEvent, item: ClipboardItem, tag: string, tagIdx: number, selectedTags: string[] = []) => {
        e.preventDefault();
        e.stopPropagation();
        setSelectedCardId(item.id);
        setSelectedCardIds(new Set([item.id]));
        setContextMenu(null);
        setTagContextMenu({
            x: e.clientX,
            y: e.clientY,
            item,
            tag,
            tagIdx,
            selectedTags
        });
    };
    const handleCategoryContextMenu = (e: React.MouseEvent, category: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu(null);
        setTagContextMenu(null);
        setCategoryContextMenu({
            x: e.clientX,
            y: e.clientY,
            category
        });
    };




    useEffect(() => {
        const handleMouseDownGlobal = (e: MouseEvent) => {
            const isEditing = !!(editingTag || editingContent);
            if (isEditing) {
                const target = e.target as Element | null;
                const clickedEditableSurface = target instanceof HTMLElement &&
                    Boolean(target.closest('[data-editable-surface="true"]'));
                if (!isEditableElement(target) && !clickedEditableSurface) {
                    commitEditTag();
                    commitEditContent();
                }
            }
        };

        const handleKeyDownGlobal = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'k')) {
                e.preventDefault();
                openGlobalSearch();
            }

            if (e.key === 'Escape') {
                if (isSearchActive) {
                    setIsSearchActive(false);
                    setSearchQuery('');
                } else {
                    setSelectedCardId(null);
                    setSelectedCardIds(new Set());
                }
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                const selection = window.getSelection()?.toString();
                if (!selection && !isEditableElement(document.activeElement)) {
                    if (selectedCardId) {
                        e.preventDefault();
                        setCopiedCardId(selectedCardId);
                        showToast(language === 'en' ? 'Card copied' : '卡片已复制');
                        return;
                    }

                    if (filteredItemsRef.current.length > 0) {
                        const firstItem = filteredItemsRef.current[0];
                        if (firstItem) handleCopy(firstItem.content, firstItem);
                    }
                }
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                const isInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
                if (!isInput) {
                    e.preventDefault();
                    handleUndo();
                }
            }
        };

        window.addEventListener('mousedown', handleMouseDownGlobal);
        window.addEventListener('keydown', handleKeyDownGlobal);

        return () => {
            window.removeEventListener('mousedown', handleMouseDownGlobal);
            window.removeEventListener('keydown', handleKeyDownGlobal);
        };
    }, [handleUndo, isSearchActive, language, openGlobalSearch, selectedCardId]); // isSearchActive needed for Escape logic

    useEffect(() => {
        const handleOpenGlobalSearch = () => {
            openGlobalSearch();
        };

        window.addEventListener('global-search-open', handleOpenGlobalSearch);
        return () => {
            window.removeEventListener('global-search-open', handleOpenGlobalSearch);
        };
    }, [openGlobalSearch]);

    const handleRenameCategory = async () => {
        if (!editingCat) {
            setEditingCat(null);
            return;
        }

        const oldCat = editingCat.old;
        const newCat = editingCat.new.trim();

        if (!newCat) {
            handleRemoveCategory(oldCat);
            return;
        }

        await renameCategory(oldCat, newCat);
        setEditingCat(null);
    };

    useEffect(() => {
        const el = scrollRef.current;
        if (el) {
            const onWheel = (e: WheelEvent) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    el.scrollLeft += e.deltaY;
                }
            };
            el.addEventListener('wheel', onWheel, { passive: false });
            return () => el.removeEventListener('wheel', onWheel);
        }
    }, []);


    const startEditItem = (item: ClipboardItem, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedCardId(item.id);
        setSelectedCardIds(new Set([item.id]));
        setEditingItemId(item.id);
        setIsAddModalOpen(true);
    };

    const handleSelectCard = (itemId: string, event?: React.MouseEvent) => {
        const isAdditive = (!!event && (event.ctrlKey || event.metaKey)) || multiSelectModifierRef.current;
        if (isAdditive) {
            setSelectedCardIds((prev) => {
                const next = new Set(prev);
                if (next.has(itemId)) {
                    next.delete(itemId);
                } else {
                    next.add(itemId);
                }
                const nextPrimary = next.has(itemId) ? itemId : (next.values().next().value ?? null);
                setSelectedCardId(nextPrimary);
                return next;
            });
            return;
        }

        setSelectedCardId(itemId);
        setSelectedCardIds(new Set([itemId]));
    };

    const itemLookup = React.useMemo(() => {
        return new Map(items.map((item) => [item.id, item]));
    }, [items]);

    const filteredItems = React.useMemo(() => {
        const hydratedVisibleItems = visibleItems.map((item) => itemLookup.get(item.id) || item);
        const currentFolderItem = currentParentId ? itemLookup.get(currentParentId) : null;
        const itemsForView = currentFolderItem && !hydratedVisibleItems.some((item) => item.id === currentFolderItem.id)
            ? [currentFolderItem, ...hydratedVisibleItems]
            : hydratedVisibleItems;

        return itemsForView.filter(shouldItemBeVisible);
    }, [visibleItems, itemLookup, debouncedSearchQuery, currentParentId, isSearchActive]);

    useEffect(() => {
        visibleOffsetRef.current = 0;
        hasMoreVisibleItemsRef.current = true;
        setHasMoreVisibleItems(true);
        void loadVisibleItems(true);
    }, [activeLibraryId, activeTab, debouncedSearchQuery, currentParentId, isSearchActive]);

    useEffect(() => {
        clearVisibleWindowCache();
        visibleItemsRef.current = [];
    }, [activeLibraryId]);

    useEffect(() => {
        visibleItemsRef.current = visibleItems;
    }, [visibleItems]);

    useEffect(() => {
        hasMoreVisibleItemsRef.current = hasMoreVisibleItems;
    }, [hasMoreVisibleItems]);

    useEffect(() => {
        const handleVisibleItemsPatched = async (event: Event) => {
            const customEvent = event as CustomEvent<ClipboardUpdatedDetail | null>;
            const detail = customEvent.detail ?? undefined;
            const queryKey = visibleQueryKeyRef.current;

            if (!detail) {
                clearVisibleWindowCache();
                void loadVisibleItems(true);
                return;
            }

            if (detail.reloadAll) {
                clearVisibleWindowCache();
                visibleItemsRef.current = [];
                void loadVisibleItems(true);
                return;
            }

            const removedIds = Array.from(new Set([
                ...(detail.removedItemId ? [detail.removedItemId] : []),
                ...(detail.removedItemIds || [])
            ]));

            if (removedIds.length > 0) {
                const nextItems = visibleItemsRef.current.filter((item) => !removedIds.includes(item.id));
                applyVisibleWindowState(nextItems);
                updateVisibleWindowCache(queryKey, nextItems);
            }

            const changedIds = Array.from(new Set([
                ...(detail.itemId ? [detail.itemId] : []),
                ...(detail.itemIds || [])
            ]));

            if (changedIds.length === 0) {
                if (detail.reloadAll) {
                    clearVisibleWindowCache();
                    void loadVisibleItems(true);
                }
                return;
            }

            try {
                const normalizedSearch = debouncedSearchQuery.trim();
                const fetchedItems = await (normalizedSearch
                    ? (() => invoke<string>('db_query_items', {
                        libraryId: activeLibraryId,
                        category: null,
                        searchQuery: normalizedSearch,
                        itemIds: changedIds,
                        parentId: null,
                        rootOnly: false,
                        limit: changedIds.length,
                        offset: 0,
                        includeDocumentContent: false
                    }).then((itemsJson) => {
                        const parsedItems = JSON.parse(itemsJson);
                        return Array.isArray(parsedItems) ? parsedItems.map(normalizeQueryItem) : [];
                    }))()
                    : Promise.all(changedIds.map(async (itemId) => {
                        const itemJson = await invoke<string>('db_get_item', {
                            id: itemId,
                            libraryId: activeLibraryId,
                            includeDocumentContent: false
                        });
                        const parsedItem = JSON.parse(itemJson);
                        return parsedItem ? normalizeQueryItem(parsedItem) : null;
                    })).then((items) => items.filter((item): item is ClipboardItem => Boolean(item))));
                const fetchedById = new Map(fetchedItems.map((item) => [item.id, item]));

                const nextItems = sortVisibleItems([
                    ...visibleItemsRef.current.filter((item) => !changedIds.includes(item.id)),
                    ...fetchedItems.filter((item) => shouldItemBeVisible(item))
                ]);
                applyVisibleWindowState(nextItems);
                updateVisibleWindowCache(queryKey, nextItems);

                const missingIds = changedIds.filter((itemId) => !fetchedById.has(itemId));
                if (missingIds.length > 0) {
                    const nextAfterMissing = visibleItemsRef.current.filter((item) => !missingIds.includes(item.id));
                    applyVisibleWindowState(nextAfterMissing);
                    updateVisibleWindowCache(queryKey, nextAfterMissing);
                }
            } catch (error) {
                console.error('Failed to patch visible clipboard items:', error);
                void loadVisibleItems(true);
            }
        };

        window.addEventListener('clipboard-updated', handleVisibleItemsPatched);
        return () => {
            window.removeEventListener('clipboard-updated', handleVisibleItemsPatched);
        };
    }, [activeLibraryId, debouncedSearchQuery, currentParentId, activeTab]);
    

    useEffect(() => {
        filteredItemsRef.current = filteredItems;
    }, [filteredItems]);

    useEffect(() => {
        const filteredIds = new Set(filteredItems.map((item) => item.id));
        if (selectedCardId && !filteredIds.has(selectedCardId)) {
            setSelectedCardId(null);
        }
        setSelectedCardIds((prev) => {
            if (prev.size === 0) return prev;
            const next = new Set([...prev].filter((id) => filteredIds.has(id)));
            if (next.size === prev.size) return prev;
            if (next.size === 0) setSelectedCardId(null);
            return next;
        });
        if (copiedCardId && !items.some((item) => item.id === copiedCardId)) {
            setCopiedCardId(null);
        }
    }, [copiedCardId, filteredItems, items, selectedCardId]);

    const [hoveredTargetCat, setHoveredTargetCat] = useState<string | null>(null);
    const [queuedTags, setQueuedTags] = useState<string[]>([]);

    useDragAutoScroll(draggingIndex, virtuosoRef, scrollRef);





    const handleCopy = async (
        content: string,
        item: ClipboardItem,
        shouldHideAfterCopy: boolean = true,
        copyOnly: boolean = false
    ) => {
        // checks 
        const activeElement = document.activeElement;
        const isInputFocused = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;

        // If user is typing in an input box (like search or tag editing), force NOT to hide window
        if (isInputFocused) {
            shouldHideAfterCopy = false;
        }

        const normalizedSource = normalizeLegacyCardText(content);
        let finalContent = (item.type !== 'IMAGE' && !content.startsWith('http'))
            ? extractCardPasteContent(normalizedSource)
            : normalizedSource;

        const canAttachTags = item.type !== 'TAGS' && item.type !== 'DOCUMENT' && item.type !== 'IMAGE';
        if (pasteContentWithTags && canAttachTags) {
            const visibleTags = (item.tags || [])
                .filter((tag) => typeof tag === 'string' && !tag.startsWith('__status_') && !tag.startsWith('__p:'))
                .map((tag) => tag.trim())
                .filter(Boolean);
            if (visibleTags.length > 0) {
                finalContent = `${visibleTags.join(', ')}，${finalContent}`;
            }
        }

        setLastCopiedId(item.id);
        setTimeout(() => setLastCopiedId(null), 1500);

        try {
            if (copyOnly) {
                const normalized = finalContent.trim();
                if (!normalized) return;
                setQueuedTags((prev) => [...prev, normalized]);
                return;
            }

            // Hide only when copy action requests it and the window is not pinned.
            await invoke('paste_text', {
                shouldHide: shouldHideAfterCopy && !isPinned,
                text: finalContent,
                treatAsImage: item.type === 'IMAGE'
            });
        } catch (e) {
            console.error('Auto-paste trigger failed:', e);
        }
    };

    const removeQueuedTagAt = useCallback((index: number) => {
        setQueuedTags((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const clearQueuedTags = useCallback(() => {
        setQueuedTags([]);
    }, []);

    const handleInsertQueuedTags = useCallback(async () => {
        if (queuedTags.length === 0) return;
        const text = pasteTagsWithComma ? queuedTags.join(', ') : queuedTags.join(' ');
        try {
            await invoke('paste_text', {
                shouldHide: false,
                text,
                treatAsImage: false,
                restoreFocusToMain: true
            });
            setQueuedTags([]);
            showToast(language === 'zh' ? '已插入输入框' : 'Inserted');
        } catch (e) {
            console.error('Insert queued tags failed:', e);
            showToast(language === 'zh' ? '插入失败' : 'Insert failed');
        }
    }, [queuedTags, pasteTagsWithComma, language]);


    const handleDropToCategory = async (targetCat: string) => {
        const dragItemId = draggingId || draggingCardIdRef.current;
        const fallbackDraggedItem = dragItemId
            ? filteredItems.find((item) => item.id === dragItemId)
            : null;
        const itemToMove = draggingIndex !== null ? filteredItems[draggingIndex] : fallbackDraggedItem;
        if (!itemToMove) return;
        if (itemToMove.category === targetCat) return;

        await moveToGroup(itemToMove, targetCat);
        categoryDropHandledRef.current = true;
        setDraggingIndex(null);
        setDraggingId(null);
        setHoveredTargetCat(null);
        draggingCardIdRef.current = null;
    };

    const handleRemoveCategory = (catName: string) => {
        if (categories.length <= 1) return;
        const next = categories.filter(c => c !== catName);
        onUpdateCategories(next);
        if (activeTab === catName) {
            setActiveTab(next[0] || categories[0]);
        }
        setEditingCat(null);
    };

    const handleRemoveItems = async (id: string, e?: React.MouseEvent | null, force: boolean = false) => {
        if (e) e.stopPropagation();

        const sourceIds = selectedCardIds.has(id) && selectedCardIds.size > 1
            ? Array.from(selectedCardIds)
            : [id];

        const existingItems = items.filter((item) => sourceIds.includes(item.id));
        if (existingItems.length === 0) return;

        const idsToDelete = existingItems.map((item) => item.id);
        const hasDocument = existingItems.some((item) => item.type === 'DOCUMENT');

        if (hasDocument && !force) {
            setPendingDeleteIds(idsToDelete);
            setDocToDelete(existingItems.find((item) => item.type === 'DOCUMENT') || null);
            return;
        }

        for (const targetId of idsToDelete) {
            await removeItem(targetId, undefined, force || hasDocument);
        }

        setSelectedCardIds((prev) => {
            const next = new Set([...prev].filter((cardId) => !idsToDelete.includes(cardId)));
            setSelectedCardId(next.values().next().value ?? null);
            return next;
        });
        setPendingDeleteIds(null);
        setDocToDelete(null);
    };

    const handleConfirmDelete = async () => {
        const ids = pendingDeleteIds && pendingDeleteIds.length > 0
            ? pendingDeleteIds
            : (docToDelete ? [docToDelete.id] : []);
        if (ids.length === 0) return;
        for (const targetId of ids) {
            await removeItem(targetId, undefined, true);
        }
        setSelectedCardIds((prev) => {
            const next = new Set([...prev].filter((cardId) => !ids.includes(cardId)));
            setSelectedCardId(next.values().next().value ?? null);
            return next;
        });
        setPendingDeleteIds(null);
        setDocToDelete(null);
    };


    const contextValue = React.useMemo(() => ({
        language,
        activeLibraryId,
        pasteTagsWithComma,
        bilingualTagsEnabled,
        translationSettings,
        isAnyDragActive,
        editingTag,
        setEditingTag,
        editingContent,
        setEditingContent,
        commitEditTag,
        commitEditContent,
        handleCopy,
        startEditItem,
        removeItem: (id: string, e?: React.MouseEvent, force?: boolean) => handleRemoveItems(id, e, force),
        setItems,
        handleAddTag,
        onOpenEditor,
        handleContextMenu,
        handleTagContextMenu,
        handleEnterFolder,
        handleMoveTagToFolder,
        handleCombineDocumentTagsIntoFolder,
        pasteDocumentTags,
        removeDocumentTagsBulk,
    }), [
        language,
          activeLibraryId,
          pasteTagsWithComma,
          bilingualTagsEnabled,
          translationSettings,
          isAnyDragActive,
        editingTag,
        setEditingTag,
        editingContent,
        setEditingContent,
        commitEditTag,
        commitEditContent,
        handleCopy,
        startEditItem,
        handleRemoveItems,
        setItems,
        handleAddTag,
        onOpenEditor,
        handleContextMenu,
        handleTagContextMenu,
        handleEnterFolder,
        handleMoveTagToFolder,
        handleCombineDocumentTagsIntoFolder,
        pasteDocumentTags,
        removeDocumentTagsBulk
    ]);

    // 长按视觉反馈状态
    const [isLongPressActive, setIsLongPressActive] = useState(false);

    // 长按处理 - 工作区菜单
    const longPress = useLongPress({
        threshold: 500,
        onLongPress: (e) => {
            // 获取触发位置
            const touch = 'touches' in e ? e.touches[0] : null;
            const clientX = touch ? touch.clientX : (e as React.MouseEvent).clientX;
            const clientY = touch ? touch.clientY : (e as React.MouseEvent).clientY;
            
            // 检查目标元素
            const target = e.target as HTMLElement;
            if (target.closest('[data-floating-menu="true"]') || 
                target.closest('[data-clipboard-card="true"]') || 
                target.closest('.category-tab') || 
                target.closest('button') || 
                target.closest('input')) {
                setIsLongPressActive(false);
                return;
            }
            
            setWorkspaceContextMenu({ x: clientX, y: clientY });
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
        <ClipboardProvider value={contextValue}>
            <div
                className={`h-full w-full flex flex-col bg-[#09090B] relative overflow-hidden clipboard-view-container pt-2 ${isLongPressActive ? 'long-pressing' : ''}`}
                onMouseDown={(e) => {
                    const target = e.target as HTMLElement;
                    const clickedInMenu = !!target.closest('[data-floating-menu="true"]');
                    if (e.button === 0 && !clickedInMenu) {
                        setSelectedCardId(null);
                        setSelectedCardIds(new Set());
                    }
                }}
                onClick={() => window.getSelection()?.removeAllRanges()}
                onContextMenu={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('[data-floating-menu="true"]') || target.closest('[data-clipboard-card="true"]') || target.closest('.category-tab') || target.closest('button') || target.closest('input')) return;
                    e.preventDefault();
                    setWorkspaceContextMenu({ x: e.clientX, y: e.clientY });
                }}
                {...longPress.touchHandlers}
                {...longPress.mouseHandlers}
                onTouchStart={(e: React.TouchEvent<HTMLDivElement>) => {
                    setIsLongPressActive(true);
                    longPress.touchHandlers.onTouchStart(e);
                }}
            >
                <DecisionModal
                    isOpen={isConfirmOpen}
                    onClose={() => setIsConfirmOpen(false)}
                    onConfirm={clearAll}
                    title={t.clip_clear_title}
                    desc={t.clip_clear_desc}
                    cancelText={t.clip_clear_cancel}
                    confirmText={t.clip_clear_confirm}
                />

                <DecisionModal
                    isOpen={!!docToDelete}
                    onClose={() => {
                        setDocToDelete(null);
                        setPendingDeleteIds(null);
                    }}
                    onConfirm={handleConfirmDelete}
                    title={t.clip_doc_delete_title}
                    desc={t.clip_doc_delete_desc}
                    cancelText={t.cancel}
                    confirmText={t.delete}
                    isDanger
                />



                <div className="flex-1 overflow-hidden flex flex-col relative">
                    {/* Global Undo Toast */}
                    {toast.visible && (
                        <div className={`absolute top-16 left-1/2 -translate-x-1/2 z-[2000] bg-white/10 ${isAnyDragActive ? '' : 'backdrop-blur-md'} border border-white/20 px-4 py-2 rounded-full text-[13px] text-white font-medium shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300`}>
                            <div className="flex items-center gap-2">
                                <Icon name="check_circle" className="!text-[18px] text-white/60" size={18} />
                                {toast.message}
                            </div>
                        </div>
                    )}

                    <ClipboardHeader
                        t={t}
                        language={language}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        isSearchActive={isSearchActive}
                        setIsSearchActive={setIsSearchActive}
                        searchInputRef={searchInputRef}
                        scrollRef={scrollRef}
                        categories={categories}
                        onUpdateCategories={onUpdateCategories}
                        activeTab={activeTab}
                        setActiveTab={setActiveTab}

                        editingCat={editingCat}
                        setEditingCat={setEditingCat}
                        handleRenameCategory={handleRenameCategory}
                        handleDropToCategory={handleDropToCategory}
                        draggingIndex={draggingIndex}
                        hoveredTargetCat={hoveredTargetCat}
                        setHoveredTargetCat={setHoveredTargetCat}
                        isAnyDragActive={isAnyDragActive}
                        handleCategoryDragStart={handleCategoryDragStart}
                        handleCategoryDragEnd={handleCategoryDragEnd}
                        activeCatId={activeCatId}
                        onCategoryContextMenu={handleCategoryContextMenu}
                        libraries={libraries}
                        activeLibraryId={activeLibraryId}
                        pasteTagsWithComma={pasteTagsWithComma}
                        pasteContentWithTags={pasteContentWithTags}
                        onUpdateSetting={onUpdateSetting}
                        onSwitchLibrary={onSwitchLibrary}
                        onOpenManager={onOpenManager}
                        handleCreateItem={handleCreateItem}
                        setIsAddModalOpen={setIsAddModalOpen}
                    />


                    {breadcrumbStack.length > 0 && (
                        <div className="px-6 py-2 flex items-center gap-1.5 text-[12px] text-white/40 border-b border-white/5 bg-black/5">
                            <button 
                                onClick={() => {
                                    setCurrentParentId(null);
                                    setBreadcrumbStack([]);
                                }}
                                className="hover:text-white transition-colors"
                            >
                                {activeTab}
                            </button>
                            {breadcrumbStack.map((crumb, idx) => (
                                <React.Fragment key={idx}>
                                    <Icon name="chevron_right" size={12} className="opacity-50" />
                                    <button
                                        onClick={() => {
                                            setCurrentParentId(crumb.id);
                                            setBreadcrumbStack(prev => prev.slice(0, idx + 1));
                                        }}
                                        className={`hover:text-white transition-colors ${idx === breadcrumbStack.length - 1 ? 'text-white/80 font-medium' : ''}`}
                                    >
                                        {crumb.name}
                                    </button>
                                </React.Fragment>
                            ))}
                        </div>
                    )}

                    <main className="flex-1 min-h-0 px-0 pb-0 no-drag outline-none flex flex-col mt-2">
                        {filteredItems.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                <p className="text-[13px] text-white/20 tracking-wider">
                                    {isSearchActive && searchQuery.trim() !== '' 
                                        ? (language === 'en' ? 'No items found' : '未找到相关内容')
                                        : (language === 'en' ? 'Click + to add content' : '点击右上角加号添加吧')}
                                </p>
                            </div>
                        ) : (
                            <DndContext
                                id="card-list-context"
                                sensors={cardSensors}
                                collisionDetection={closestCenter}
                                onDragStart={handleCardDragStart}
                                onDragMove={handleCardDragMove}
                                onDragCancel={handleCardDragCancel}
                                onDragEnd={handleCardDragEnd}
                                modifiers={[restrictToVerticalAxis]}
                            >
                                <SortableContext
                                    items={filteredItems.map(i => i.id)}
                                    strategy={rectSortingStrategy}
                                >
                                    <Virtuoso
                                        ref={virtuosoRef}
                                        style={{ height: '100%' }}
                                        className="virtuoso-scroller custom-scrollbar pb-20"
                                        data={filteredItems}
                                        totalCount={filteredItems.length}
                                        overscan={VIRTUOSO_OVERSCAN}
                                        endReached={() => {
                                            if (!hasMoreVisibleItems || isLoadingVisibleItems) return;
                                            void loadVisibleItems(false);
                                        }}
                                        computeItemKey={(index, item) => item.id}
                                        itemContent={(index, item) => (
                                            <div className="py-1.5 px-4">
                                                <SortableItem
                                                    id={item.id}
                                                    disabled={editingTag?.itemId === item.id || editingContent?.itemId === item.id}
                                                    freezeTransform={preserveCardPositionWhileDragging || (cardDropHint?.mode === 'merge' && item.id !== draggingId)}
                                                    keepOpacityWhileDragging={preserveCardPositionWhileDragging}
                                                    useHandle
                                                >
                                                    {(dragHandleProps) => (
                                                        <ClipboardCardItem
                                                            item={item}
                                                            index={index}
                                                            draggingIndex={draggingIndex}
                                                            isAnyDragActive={isAnyDragActive}
                                                            isDragging={isDragging}
                                                            draggingId={draggingId}
                                                            preservePositionWhileDragging={preserveCardPositionWhileDragging}
                                                            isSelected={selectedCardIds.has(item.id)}
                                                            cardDropHintMode={cardDropHint?.overId === item.id ? cardDropHint.mode : null}
                                                            onSelect={handleSelectCard}
                                                            onClearSelection={() => {
                                                                setSelectedCardId(null);
                                                                setSelectedCardIds(new Set());
                                                            }}
                                                            dragHandleProps={dragHandleProps}
                                                        />
                                                    )}
                                                </SortableItem>
                                            </div>
                                        )}
                                    />
                                </SortableContext>
                            </DndContext>
                        )}
                    </main>
                </div>

            {queuedTags.length > 0 && (
                <div className="absolute left-4 right-4 bottom-4 z-[120] no-drag">
                    <div className="rounded-2xl border border-white/10 bg-[#111113]/95 backdrop-blur px-3 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[12px] text-white/70">
                                {language === 'zh' ? `待输入 ${queuedTags.length} 项` : `${queuedTags.length} queued`}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={clearQueuedTags}
                                    className="px-2.5 py-1 rounded-lg text-[12px] text-white/70 hover:text-white hover:bg-white/10 transition-all"
                                >
                                    {language === 'zh' ? '清空' : 'Clear'}
                                </button>
                                <button
                                    onClick={() => void handleInsertQueuedTags()}
                                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#0A84FF] hover:bg-[#3A98FF] text-white transition-all"
                                >
                                    {language === 'zh' ? '插入' : 'Insert'}
                                </button>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto custom-scrollbar">
                            {queuedTags.map((tag, idx) => (
                                <span
                                    key={`${tag}-${idx}`}
                                    className="inline-flex items-center gap-1 rounded-full bg-white/8 border border-white/10 px-2.5 py-1 text-[12px] text-white/90"
                                >
                                    <span className="max-w-[200px] truncate">{tag}</span>
                                    <button
                                        onClick={() => removeQueuedTagAt(idx)}
                                        className="text-white/50 hover:text-white transition-colors"
                                    >
                                        <Icon name="close" size={12} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    item={contextMenu.item}
                    categories={categories}
                    onClose={() => setContextMenu(null)}
                    onMove={(cat) => moveToGroup(contextMenu.item, cat)}
                    onDelete={(id) => handleRemoveItems(id, null)}
                    onDuplicate={(id) => { void duplicateItem(id); }}
                    onAdd={(type, parent) => { handleCreateItem(type, { parentItem: parent }); }}
                    onEdit={(item) => { startEditItem(item, { stopPropagation: () => {} } as React.MouseEvent); }}
                />
            )}

            {tagContextMenu && (
                <TagContextMenu
                    x={tagContextMenu.x}
                    y={tagContextMenu.y}
                    item={tagContextMenu.item}
                    tag={tagContextMenu.tag}
                    tagIdx={tagContextMenu.tagIdx}
                    onClose={() => setTagContextMenu(null)}
                    onRemoveTag={async (tagToRemove) => {
                        const tagsToRemove = tagContextMenu.selectedTags.length > 0
                            ? tagContextMenu.selectedTags
                            : [tagToRemove];
                        if (tagsToRemove.length > 1) {
                            await removeDocumentTagsBulk(tagContextMenu.item.id, tagsToRemove);
                        } else {
                            await handleRemoveTag(tagContextMenu.item, tagToRemove, tagContextMenu.tagIdx);
                        }
                        setTagContextMenu(null);
                    }}
                    onRenameTag={(idx, val) => {
                        setEditingTag({ itemId: tagContextMenu.item.id, tagIndex: idx, value: val, startTime: Date.now(), source: 'tag' });
                        setTagContextMenu(null);
                    }}
                    onDuplicateTag={async () => {
                        await duplicateTag(tagContextMenu.item, tagContextMenu.tag, tagContextMenu.tagIdx);
                    }}
                    onOpenLocation={async () => {
                        await handleOpenLocation(tagContextMenu.item, tagContextMenu.tag, tagContextMenu.tagIdx);
                    }}
                    onCopyAsFile={async () => {
                        await handleCopyAsFile(tagContextMenu.item, tagContextMenu.tag, tagContextMenu.tagIdx);
                    }}
                />
            )}


            {categoryContextMenu && (
                <CategoryContextMenu
                    x={categoryContextMenu.x}
                    y={categoryContextMenu.y}
                    category={categoryContextMenu.category}
                    onClose={() => setCategoryContextMenu(null)}
                    onRename={(cat) => {
                        setEditingCat({ old: cat, new: cat });
                        setCategoryContextMenu(null);
                    }}
                    onDelete={deleteCategory}
                    onAddCategory={() => {
                        const defaultName = t.clip_new_group_default || '新分组';
                        let name = defaultName;
                        let i = 1;
                        while (categories.includes(name)) {
                            name = `${defaultName} ${i}`;
                            i += 1;
                        }
                        onUpdateCategories([...categories, name]);
                        setActiveTab(name);
                    }}
                />
            )}

            {workspaceContextMenu && (
                <WorkspaceContextMenu
                    x={workspaceContextMenu.x}
                    y={workspaceContextMenu.y}
                    onClose={() => setWorkspaceContextMenu(null)}
                    onAdd={(type) => { handleCreateItem(type, { category: activeTab }); }}
                />
            )}

            {isAddModalOpen && (
                <div className="absolute inset-0 z-[2001] bg-[#09090B] animate-in slide-in-from-right-4 duration-300">
                    <ClipboardItemModal
                        isOpen={true}
                        isFullScreen={true}
                        onClose={() => { setIsAddModalOpen(false); setEditingItemId(null); setModalConfig(null); }}
                        onSave={handleSaveItems}
                        editingItemId={editingItemId}
                        translationSettings={translationSettings}
                        activeLibraryId={activeLibraryId}
                        activeLibraryName={activeLibraryName}
                        activeGroupName={activeTab}
                        bilingualTagsEnabled={bilingualTagsEnabled}
                        onUpdateBilingualTagsEnabled={(next) => onUpdateSetting('bilingualTagsEnabled', next)}
                        onOpenSettings={() => onNavigate(ViewType.SETTINGS)}
                        language={language}
                        initialConfig={modalConfig}
                        initialData={(() => {
                            if (!editingItemId) return null;
                            const item = items.find(i => i.id === editingItemId);
                            if (!item) return null;
                            return parseClipboardItemInitialData(item);
                        })()}
                    />
                </div>
            )}
        </div >
        </ClipboardProvider>
    );
};


export default ClipboardView;


