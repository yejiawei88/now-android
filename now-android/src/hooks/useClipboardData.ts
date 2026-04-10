import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ClipboardItem } from '../types';
import { translations } from '../i18n';
import { logger } from '../utils';
import { isAllLikeCategory, isHistoryLikeCategory } from '../constants';
import { areItemsEqual, mergeIncomingItemWithCache } from './clipboardDataCacheHelpers';
import { normalizeLegacyCardText, parseCardContent } from '../utils/cardContent';
import {
    generateItemId as generateClipboardItemId,
    getDocumentContentMap,
    getDocumentEntryPayload,
    getFolderDisplayName as getClipboardFolderDisplayName,
    getParentId,
    getVisibleTags,
    getWritableDocumentContentMap,
    hasLoadedDocumentContent,
    normalizeItem,
    normalizeTags,
} from './clipboardDataHelpers';

export const useClipboardData = (
    activeLibraryId: string,
    activeTab: string,
    language: 'zh' | 'en' | undefined,
    callbacks: {
        showToast: (message: string) => void;
        setDocToDelete: (item: ClipboardItem | null) => void;
        setActiveTab?: (tab: string) => void;
    },
    categories: string[],
    onUpdateCategories: (cats: string[]) => void
) => {
    const { showToast, setDocToDelete } = callbacks;
    const t = translations[language || 'zh'];

    type EditingTagState = {
        itemId: string,
        tagIndex: number,
        value: string,
        startTime: number,
        source?: 'tag' | 'content-prefix'
    } | null;
    type EditingContentState = { itemId: string, value: string, prefix?: string, separator?: string } | null;

    const FOLDER_TAG_PREFIX = '\uD83D\uDCC1';
    const getFolderDisplayName = (rawTag: string) => getClipboardFolderDisplayName(rawTag, language);
    const generateItemId = () => generateClipboardItemId();

    const [items, _setItemsState] = useState<ClipboardItem[]>([]);
    const [undoStack, setUndoStack] = useState<ClipboardItem[]>([]);

    const [editingTag, updateEditingTagInternal] = useState<EditingTagState>(null);
    const [editingContent, updateEditingContentInternal] = useState<EditingContentState>(null);

    const [currentParentId, setCurrentParentId] = useState<string | null>(null);
    const [breadcrumbStack, setBreadcrumbStack] = useState<{ id: string | null, name: string }[]>([]);

    const itemsRef = useRef<ClipboardItem[]>([]);
    const categoriesRef = useRef<string[]>(categories);
    const undoStackRef = useRef<ClipboardItem[]>([]);
    const isPendingWriteRef = useRef(false);
    const editingTagRef = useRef<EditingTagState>(null);
    const editingContentRef = useRef<EditingContentState>(null);
    const allItemsCacheLoadedRef = useRef(false);

    const loadedLibId = useRef(activeLibraryId);
    const isLoaded = useRef(false);

    const setItems = (val: ClipboardItem[] | ((prev: ClipboardItem[]) => ClipboardItem[])) => {
        if (typeof val === 'function') {
            _setItemsState(prev => {
                const next = val(prev);
                itemsRef.current = next;
                return next;
            });
        } else {
            itemsRef.current = val;
            _setItemsState(val);
        }
    };

    const setEditingTag: Dispatch<SetStateAction<EditingTagState>> = (val) => {
        updateEditingTagInternal((prev) => {
            const next = typeof val === 'function' ? (val as any)(prev) : val;
            editingTagRef.current = next;
            return next;
        });
    };

    const setEditingContent: Dispatch<SetStateAction<EditingContentState>> = (val) => {
        updateEditingContentInternal((prev) => {
            const next = typeof val === 'function' ? (val as any)(prev) : val;
            editingContentRef.current = next;
            return next;
        });
    };

    useEffect(() => {
        categoriesRef.current = categories;
    }, [categories]);

    type ClipboardUpdatedDetail = {
        itemId?: string;
        itemIds?: string[];
        removedItemId?: string;
        removedItemIds?: string[];
        reloadAll?: boolean;
    };

    const syncCategoriesFromItems = (incomingItems: ClipboardItem[]) => {
        if (incomingItems.length === 0) return;

        const nextCategories = [...categoriesRef.current];
        let changed = false;

        for (const item of incomingItems) {
            const category = typeof item.category === 'string' ? item.category.trim() : '';
            if (!category || isAllLikeCategory(category) || isHistoryLikeCategory(category) || nextCategories.includes(category)) {
                continue;
            }

            nextCategories.push(category);
            changed = true;
        }

        if (changed) {
            onUpdateCategories(nextCategories);
        }
    };

    const hydrateItemsCache = (incomingItems: ClipboardItem[]) => {
        const normalizedIncoming = incomingItems.map(normalizeItem);
        if (normalizedIncoming.length === 0) return;

        syncCategoriesFromItems(normalizedIncoming);
        setItems((prev) => {
            const next = [...prev];
            const indexById = new Map(next.map((item, index) => [item.id, index]));
            let changed = false;

            for (const item of normalizedIncoming) {
                const existingIndex = indexById.get(item.id);
                if (existingIndex === undefined) {
                    indexById.set(item.id, next.length);
                    next.push(item);
                    changed = true;
                    continue;
                }

                const mergedItem = mergeIncomingItemWithCache(next[existingIndex], item);
                if (!areItemsEqual(next[existingIndex], mergedItem)) {
                    next[existingIndex] = mergedItem;
                    changed = true;
                }
            }

            return changed ? next : prev;
        });
    };

    const removeItemsFromCache = (ids: string[]) => {
        const uniqueIds = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && !!id)));
        if (uniqueIds.length === 0) return;

        const idSet = new Set(uniqueIds);
        setItems((prev) => {
            if (!prev.some((item) => idSet.has(item.id))) {
                return prev;
            }
            return prev.filter((item) => !idSet.has(item.id));
        });
    };

    const emitClipboardUpdated = (detail?: ClipboardUpdatedDetail) => {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent<ClipboardUpdatedDetail>('clipboard-updated', { detail }));
    };

    const queryItemsPage = async (options?: {
        category?: string | null;
        searchQuery?: string | null;
        parentId?: string | null;
        rootOnly?: boolean;
        limit?: number;
        offset?: number;
    }) => {
        const queriedJson = await invoke<string>('db_query_items', {
            libraryId: activeLibraryId,
            category: options?.category ?? null,
            searchQuery: options?.searchQuery ?? null,
            parentId: options?.parentId ?? null,
            rootOnly: options?.rootOnly ?? false,
            limit: options?.limit ?? 200,
            offset: options?.offset ?? 0,
            includeDocumentContent: false
        });

        const parsedQueried = JSON.parse(queriedJson);
        const normalizedItems = Array.isArray(parsedQueried) ? parsedQueried.map(normalizeItem) : [];
        hydrateItemsCache(normalizedItems);
        return normalizedItems;
    };

    const queryAllItems = async (options?: {
        category?: string | null;
        searchQuery?: string | null;
        parentId?: string | null;
        rootOnly?: boolean;
        pageSize?: number;
    }) => {
        const pageSize = options?.pageSize ?? 400;
        const aggregated: ClipboardItem[] = [];
        let offset = 0;

        while (true) {
            const batch = await queryItemsPage({
                category: options?.category ?? null,
                searchQuery: options?.searchQuery ?? null,
                parentId: options?.parentId ?? null,
                rootOnly: options?.rootOnly ?? false,
                limit: pageSize,
                offset
            });

            aggregated.push(...batch);
            if (batch.length < pageSize) {
                break;
            }

            offset += batch.length;
        }

        return aggregated;
    };

    const fetchItemById = async (
        itemId: string,
        options?: { merge?: boolean; includeDocumentContent?: boolean }
    ) => {
        const itemJson = await invoke<string>('db_get_item', {
            id: itemId,
            libraryId: activeLibraryId,
            includeDocumentContent: options?.includeDocumentContent ?? true
        });
        const parsedItem = JSON.parse(itemJson);
        if (!parsedItem) {
            return null;
        }

        const normalizedItem = normalizeItem(parsedItem);
        if (options?.merge !== false) {
            hydrateItemsCache([normalizedItem]);
        }

        return normalizedItem;
    };

    const ensureItem = async (itemId: string, options?: { requireDocumentContent?: boolean }) => {
        const cachedItem = itemsRef.current.find((item) => item.id === itemId);
        if (cachedItem && (!options?.requireDocumentContent || hasLoadedDocumentContent(cachedItem))) {
            return cachedItem;
        }

        try {
            return await fetchItemById(itemId, {
                includeDocumentContent: options?.requireDocumentContent ?? true
            });
        } catch (error) {
            console.error('Failed to load clipboard item by id:', itemId, error);
            return null;
        }
    };

    const fetchDocumentEntry = async (itemId: string, tagName: string) => {
        const entryJson = await invoke<string>('db_get_document_entry', {
            itemId,
            tagName
        });
        const parsedEntry = JSON.parse(entryJson);
        return {
            content: typeof parsedEntry?.content === 'string' ? parsedEntry.content : '',
            status: typeof parsedEntry?.status === 'string' ? parsedEntry.status : undefined
        };
    };

    const loadChildrenByParent = async (parentId: string, category?: string | null) => {
        const scopedChildren = await queryAllItems({
            category: category ?? null,
            parentId,
            rootOnly: false,
            pageSize: 400
        });

        if (scopedChildren.length > 0 || !category) {
            return scopedChildren;
        }

        return queryAllItems({
            category: null,
            parentId,
            rootOnly: false,
            pageSize: 400
        });
    };

    const findLinkedChild = async (
        parentId: string,
        tagOrDisplayName: string,
        options?: { category?: string | null; allowIncludes?: boolean }
    ) => {
        const matchesChild = (item: ClipboardItem) => {
            if (getParentId(item) !== parentId) return false;
            const firstTag = getVisibleTags(item.tags)[0] || '';
            if (firstTag === tagOrDisplayName) return true;
            return options?.allowIncludes ? firstTag.includes(tagOrDisplayName) : false;
        };

        const cachedChild = itemsRef.current.find(matchesChild);
        if (cachedChild) {
            return cachedChild;
        }

        const children = await loadChildrenByParent(parentId, options?.category ?? null);
        return children.find(matchesChild) || null;
    };

    const getUniqueTagName = (baseName: string, existingTags: string[], excludeIndex?: number) => {
        let name = baseName.trim() || (language === 'en' ? 'Untitled' : '\u672a\u547d\u540d');
        let counter = 2;
        const otherTags = excludeIndex !== undefined
            ? existingTags.filter((_, i) => i !== excludeIndex)
            : existingTags;

        let uniqueName = name;
        while (otherTags.includes(uniqueName)) {
            uniqueName = `${name} ${counter++}`;
        }
        return uniqueName;
    };

    const getDuplicateTagName = (rawTagName: string, existingTags: string[]) => {
        const isFolder = rawTagName.startsWith(FOLDER_TAG_PREFIX);
        const fallbackName = language === 'en' ? 'Untitled' : '\u672a\u547d\u540d';
        const baseName = (isFolder
            ? rawTagName.replace(FOLDER_TAG_PREFIX, '').trim()
            : rawTagName.trim()) || fallbackName;
        const duplicatedBase = language === 'en' ? `${baseName} Copy` : `${baseName} 副本`;
        const nextTagName = isFolder ? `${FOLDER_TAG_PREFIX} ${duplicatedBase}` : duplicatedBase;

        return getUniqueTagName(nextTagName, existingTags);
    };

    const buildDuplicatedSubtree = (
        rootItemId: string,
        options?: { rootTagName?: string }
    ): ClipboardItem[] | null => {
        const sourceItem = itemsRef.current.find((item) => item.id === rootItemId);
        if (!sourceItem) return null;

        const subtree: ClipboardItem[] = [sourceItem];
        const queue = [sourceItem.id];
        const visited = new Set(queue);

        while (queue.length > 0) {
            const parentId = queue.shift()!;
            const children = itemsRef.current.filter((item) => getParentId(item) === parentId);
            for (const child of children) {
                if (visited.has(child.id)) continue;
                visited.add(child.id);
                subtree.push(child);
                queue.push(child.id);
            }
        }

        const idMap = new Map<string, string>();
        subtree.forEach((item) => {
            idMap.set(item.id, generateItemId());
        });

        const now = Date.now();
        return subtree.map((item, index) => {
            const nextTags = normalizeTags(item.tags).map((tag) => {
                if (!tag.startsWith('__p:')) return tag;
                const originalParentId = tag.slice(4);
                const duplicatedParentId = idMap.get(originalParentId);
                return duplicatedParentId ? `__p:${duplicatedParentId}` : tag;
            });

            let nextContent = item.content;

            if (item.id === sourceItem.id && options?.rootTagName) {
                const visibleTagIndex = nextTags.findIndex((tag) => !tag.startsWith('__status_') && !tag.startsWith('__p:'));
                const sourceRootTag = getVisibleTags(item.tags)[0];

                if (visibleTagIndex !== -1) {
                    nextTags[visibleTagIndex] = options.rootTagName;
                }

                if (item.type === 'DOCUMENT' && sourceRootTag && options.rootTagName !== sourceRootTag) {
                    const contentMap = getDocumentContentMap(item.content);
                    if (Object.keys(contentMap).length > 0) {
                        const renamedContentMap = { ...contentMap };
                        if (Object.prototype.hasOwnProperty.call(renamedContentMap, sourceRootTag)) {
                            renamedContentMap[options.rootTagName] = renamedContentMap[sourceRootTag];
                            delete renamedContentMap[sourceRootTag];
                        }

                        const sourceStatusKey = `__status_${sourceRootTag}`;
                        if (Object.prototype.hasOwnProperty.call(renamedContentMap, sourceStatusKey)) {
                            renamedContentMap[`__status_${options.rootTagName}`] = renamedContentMap[sourceStatusKey];
                            delete renamedContentMap[sourceStatusKey];
                        }

                        nextContent = JSON.stringify(renamedContentMap);
                    }
                }
            }

            return {
                ...item,
                id: idMap.get(item.id)!,
                timestamp: now - index,
                tags: nextTags,
                content: nextContent
            };
        });
    };

    const persistItems = async (itemsToPersist: ClipboardItem[]) => {
        if (itemsToPersist.length === 0) return;

        const preparedItems = await Promise.all(itemsToPersist.map(async (item) => {
            if (item.type !== 'DOCUMENT' || hasLoadedDocumentContent(item)) {
                return item;
            }

            const fullItem = await fetchItemById(item.id, {
                merge: false,
                includeDocumentContent: true
            });
            if (!fullItem || fullItem.type !== 'DOCUMENT') {
                return item;
            }

            return {
                ...fullItem,
                ...item,
                content: fullItem.content,
                documentContentLoaded: true
            };
        }));

        hydrateItemsCache(preparedItems);

        await Promise.all(preparedItems.map((item) =>
            invoke('db_upsert_item', {
                itemJson: JSON.stringify(item),
                libraryId: activeLibraryId
            })
        ));

        if (preparedItems.length === 1) {
            emitClipboardUpdated({ itemId: preparedItems[0].id });
            return;
        }

        emitClipboardUpdated({ itemIds: preparedItems.map((item) => item.id) });
    };

    const persistItem = async (itemToPersist: ClipboardItem) => {
        await persistItems([itemToPersist]);
    };

    const loadItems = async () => {
        if (isPendingWriteRef.current) return;
        try {
            const savedJson = await invoke<string>('db_load_items', { libraryId: activeLibraryId });
            const parsedSaved = JSON.parse(savedJson);
            const savedItems = Array.isArray(parsedSaved) ? parsedSaved : [];

            if (savedItems.length === 0) {
                const key = activeLibraryId === 'default' ? 'clipboard_history' : `clipboard_history_${activeLibraryId}`;
                const legacyData = localStorage.getItem(key);
                if (legacyData) {
                    const parsedLegacy = JSON.parse(legacyData);
                    const migratedItems = Array.isArray(parsedLegacy) ? parsedLegacy.map(normalizeItem) : [];
                    await invoke('db_save_items', {
                        itemsJson: JSON.stringify(migratedItems),
                        libraryId: activeLibraryId
                    });
                    setItems(migratedItems);
                    syncCategoriesFromItems(migratedItems);
                } else {
                    setItems([]);
                }
            } else {
                const normalized = (savedItems || []).map(normalizeItem);
                const normalizedAndSanitized = normalized.map((item) => {
                    if (item.type !== 'TEXT') return item;
                    const nextContent = normalizeLegacyCardText(item.content || '');
                    if (nextContent === item.content) return item;
                    return { ...item, content: nextContent };
                });

                const pickFallbackCategory = (cats: string[]): string | null =>
                    cats.find(c => !isAllLikeCategory(c) && !isHistoryLikeCategory(c)) || null;

                // Legacy migration: the old "全部/All" category used to be a real tab.
                // If present in DB, migrate items into the first usable category so the tab won't reappear.
                const itemCategories = Array.from(new Set(
                    normalizedAndSanitized
                        .map((i: any) => (typeof i?.category === 'string' ? i.category.trim() : ''))
                        .filter(Boolean)
                ));
                const effectiveCategories = categoriesRef.current;
                const fallbackCategory = pickFallbackCategory([...effectiveCategories, ...itemCategories]) || t.clip_new_group_default;
                const migrated = normalizedAndSanitized.map((item) => {
                    if (fallbackCategory && (isAllLikeCategory(item.category) || isHistoryLikeCategory(item.category))) {
                        return { ...item, category: fallbackCategory };
                    }
                    return item;
                });

                setItems(migrated);
                syncCategoriesFromItems(migrated);

                {
                    const toPersist = migrated.filter((it, idx) =>
                        (normalized[idx] as any)?.category !== it.category
                        || (normalized[idx] as any)?.content !== it.content
                    );
                    for (const it of toPersist) {
                        try {
                            await invoke('db_upsert_item', { itemJson: JSON.stringify(it), libraryId: activeLibraryId });
                        } catch (e) {
                            console.error('Failed to migrate legacy item content/category for item:', it?.id, e);
                        }
                    }
                }

                const newCategories: string[] = Array.from(new Set(migrated.map((i: any) => i.category as string)));
                const currentCategories = [...effectiveCategories];
                let changed = false;
                for (const cat of newCategories) {
                    if (cat && !isAllLikeCategory(cat) && !isHistoryLikeCategory(cat) && !currentCategories.includes(cat)) {
                        currentCategories.push(cat);
                        changed = true;
                    }
                }
                if (changed) {
                    onUpdateCategories(currentCategories);
                }
            }
            loadedLibId.current = activeLibraryId;
            isLoaded.current = true;
            allItemsCacheLoadedRef.current = true;
        } catch (e) {
            console.error('Failed to load history from SQLite:', e);
            setItems([]);
            loadedLibId.current = activeLibraryId;
            isLoaded.current = true;
            allItemsCacheLoadedRef.current = false;
        }
    };

    const ensureItemsCacheLoaded = async () => {
        if (loadedLibId.current === activeLibraryId && allItemsCacheLoadedRef.current) {
            return itemsRef.current;
        }

        await loadItems();
        return itemsRef.current;
    };

    const handleCompleteItem = (item: ClipboardItem) => {
        const targetCat = (language === 'en' ? 'Completed' : '\u5df2\u5b8c\u6210');
        const updatedItem = { ...item, category: targetCat };

        setItems(prev => prev.map(it => it.id === item.id ? updatedItem : it));

        if (!categories.includes(targetCat)) {
            onUpdateCategories([...categories, targetCat]);
        }

        void persistItem(updatedItem).then(() => {
            emitClipboardUpdated({ itemId: updatedItem.id, reloadAll: true });
        });

        showToast(t.clip_moved_to_completed);
    };

    const commitEditContent = async (manualData?: any) => {
        const target = (manualData && (manualData.target || manualData.nativeEvent)) ? editingContentRef.current : (manualData || editingContentRef.current);
        if (!target) return;

        const item = await ensureItem(target.itemId, { requireDocumentContent: true });
        if (!item) {
            setEditingContent(null);
            return;
        }

        let newContent = target.value;
        if (target.prefix && target.separator) {
            newContent = `${target.prefix}${target.separator}${newContent}`;
        }

        const updatedItem = { ...item, content: newContent };
        setItems(prev => prev.map(it => it.id === target.itemId ? updatedItem : it));

        isPendingWriteRef.current = true;
        setEditingContent(null);
        try {
            await persistItem(updatedItem);
        } finally {
            isPendingWriteRef.current = false;
        }
    };

    const commitEditTag = async (valueOverride?: string) => {
        const target = editingTagRef.current;
        if (!target || typeof (target as any).itemId !== 'string' || typeof (target as any).tagIndex !== 'number') {
            setEditingTag(null);
            return;
        }

        const item = await ensureItem(target.itemId);
        if (!item) {
            setEditingTag(null);
            return;
        }

        const finalValue = valueOverride !== undefined ? valueOverride : target.value;

        const contentText = item.content;
        const parsedPrefixContent = parseCardContent(contentText);
        const isContentPrefixEdit = target.source === 'content-prefix';
        const finalTagValue = isContentPrefixEdit
            ? (finalValue || '').trim() || (language === 'en' ? 'Untitled' : '\u672a\u547d\u540d')
            : getUniqueTagName(finalValue, item.tags || [], target.tagIndex);

        let updatedItem = { ...item };

        if (isContentPrefixEdit && parsedPrefixContent) {
            const separator = parsedPrefixContent.separator;
            const actualContent = parsedPrefixContent.body;
            updatedItem = { ...item, content: `${finalTagValue}${separator}${actualContent}` };
        } else if (parsedPrefixContent && (!item.tags || item.tags.length === 0)) {
            const separator = parsedPrefixContent.separator;
            const actualContent = parsedPrefixContent.body;
            updatedItem = { ...item, content: `${finalTagValue}${separator}${actualContent}` };
        } else if (item.tags && item.tags.length > 0) {
            const oldTag = item.tags[target.tagIndex];
            const newTagsArr = [...item.tags];

            if (finalTagValue) {
                newTagsArr[target.tagIndex] = finalTagValue;
            } else {
                newTagsArr.splice(target.tagIndex, 1);
            }

            if (item.type === 'DOCUMENT') {
                try {
                    const documentMap = JSON.parse(item.content);
                    if (typeof documentMap === 'object' && documentMap !== null) {
                        if (finalTagValue) {
                            if (documentMap[oldTag] !== undefined) {
                                documentMap[finalTagValue] = documentMap[oldTag];
                                delete documentMap[oldTag];
                            }
                        } else {
                            delete documentMap[oldTag];
                        }
                        updatedItem.content = JSON.stringify(documentMap);
                    }
                } catch (e) {
                    if (target.tagIndex === 0 && finalTagValue) {
                        const newMap = { [finalTagValue]: item.content };
                        updatedItem.content = JSON.stringify(newMap);
                    }
                }
            }
            updatedItem.tags = newTagsArr;
        }

        setItems(prev => prev.map(it => it.id === target.itemId ? updatedItem : it));

        isPendingWriteRef.current = true;
        setEditingTag(null);

        try {
            await persistItem(updatedItem);
        } finally {
            isPendingWriteRef.current = false;
        }
    };

    const handleAddTag = async (itemId: string) => {
        const item = await ensureItem(itemId);
        if (!item) return;

        const newTags = [...(item.tags || [])];
        const uniqueName = getUniqueTagName(language === 'en' ? 'Untitled' : '\u672a\u547d\u540d', newTags);
        newTags.push(uniqueName);
        const updatedItem = { ...item, tags: newTags };

        setItems(prev => prev.map(it => it.id === itemId ? updatedItem : it));

        await persistItem(updatedItem);

        const newIndex = newTags.length - 1;
        setEditingTag({ itemId, tagIndex: newIndex, value: uniqueName, startTime: Date.now(), source: 'tag' });
    };

    const handleCreateItem = async (
        type: 'TEXT' | 'TAGS' | 'DOCUMENT',
        options?: { parentItem?: ClipboardItem; category?: string }
    ) => {
        const parentItem = options?.parentItem;
        const targetCategory = options?.category || parentItem?.category || activeTab;
        const targetParentId = options?.category ? null : currentParentId;

        if (parentItem && parentItem.type === 'DOCUMENT') {
            const isFolder = type === 'TAGS';
            const defaultName = isFolder
                ? getFolderDisplayName(FOLDER_TAG_PREFIX)
                : (language === 'en' ? 'Untitled Document' : '\u672a\u547d\u540d\u6587\u6863');
            const nameToSave = isFolder ? `\uD83D\uDCC1 ${defaultName}` : defaultName;
            
            const newTags = [...(parentItem.tags || []), nameToSave];
            const updatedItem = { ...parentItem, tags: newTags };
            
            setItems(prev => prev.map(p => p.id === updatedItem.id ? updatedItem : p));
            await persistItem(updatedItem);
            
            if (isFolder) {
                const childId = Date.now().toString() + "-child";
                const childItem: ClipboardItem = {
                    id: childId,
                    content: '', 
                    type: 'DOCUMENT',
                    isPinned: false,
                    timestamp: Date.now() + 1,
                    category: targetCategory,
                    tags: [`\uD83D\uDCC1 ${defaultName}`, `__p:${parentItem.id}`]
                };
                setItems(prev => [childItem, ...prev]);
                await persistItem(childItem);
            }

            const newIndex = newTags.length - 1;
            setEditingTag({ itemId: updatedItem.id, tagIndex: newIndex, value: nameToSave, startTime: Date.now(), source: 'tag' });
            return;
        }

        const TEMPLATES = {
            TEXT: { content: language === 'en' ? 'Content: ' : '内容: ', tags: [] },
            TAGS: { content: '', tags: language === 'en' ? ['Tag'] : ['标签'] },
            DOCUMENT: { content: '{}', tags: [language === 'en' ? 'Untitled Document' : '\u672a\u547d\u540d\u6587\u6863'] },
        };

        const { content: templateContent, tags: templateTags } = TEMPLATES[type];

        const newItem: ClipboardItem = {
            id: Date.now().toString(),
            content: templateContent,
            type,
            isPinned: false,
            timestamp: Date.now(),
            category: targetCategory,
            tags: targetParentId 
                ? [...templateTags, `__p:${targetParentId}`] 
                : templateTags
        };

        setItems(prev => [newItem, ...prev]);

        try {
            await persistItem(newItem);
            
            if (newItem.tags && newItem.tags.length > 0) {
                setEditingTag({ itemId: newItem.id, tagIndex: 0, value: newItem.tags[0], startTime: Date.now(), source: 'tag' });
            }
        } catch (error) {
            console.error('Failed to create item:', error);
        }
    };

    const handleEnterFolder = async (tag: string, displayName: string, parentItem: ClipboardItem) => {
        let child = await findLinkedChild(parentItem.id, displayName, {
            category: parentItem.category || activeTab,
            allowIncludes: true
        });

        if (!child) {
            const childId = Date.now().toString() + "-child";
            child = {
                id: childId,
                content: '',
                type: 'DOCUMENT',
                isPinned: false,
                timestamp: Date.now(),
                category: activeTab,
                tags: [tag, `__p:${parentItem.id}`]
            };
            setItems(prev => [child!, ...prev]);
            await persistItem(child);
        }

        setCurrentParentId(child.id);
        setBreadcrumbStack(prev => [...prev, { id: child!.id, name: displayName }]);
    };

    const moveTagToFolder = async (
        tagToMove: string,
        folderTag: string,
        parentItem: ClipboardItem,
        options?: { silent?: boolean }
    ) => {
        const latestParent = await ensureItem(parentItem.id, { requireDocumentContent: true });
        if (!latestParent || latestParent.type !== 'DOCUMENT') {
            return null;
        }
        parentItem = latestParent;

        const displayName = getFolderDisplayName(folderTag);
        if (!tagToMove || tagToMove.startsWith('\uD83D\uDCC1') || tagToMove === folderTag) {
            return null;
        }

        let folderCard = await findLinkedChild(parentItem.id, folderTag, {
            category: parentItem.category || activeTab,
            allowIncludes: false
        });
        if (!folderCard) {
            folderCard = await findLinkedChild(parentItem.id, displayName, {
                category: parentItem.category || activeTab,
                allowIncludes: true
            });
        }

        if (!folderCard) {
            folderCard = {
                id: `${Date.now()}-child`,
                content: '{}',
                type: 'DOCUMENT',
                isPinned: false,
                timestamp: Date.now(),
                category: parentItem.category || activeTab,
                tags: [folderTag, `__p:${parentItem.id}`]
            };
        }

        const { content, status, contentMap } = getDocumentEntryPayload(parentItem, tagToMove);
        const updatedParentMap = { ...contentMap };
        delete updatedParentMap[tagToMove];
        delete updatedParentMap[`__status_${tagToMove}`];

        const folderVisibleTags = getVisibleTags(folderCard.tags);
        const targetTag = getUniqueTagName(tagToMove, folderVisibleTags.slice(1));

        const existingChild = await findLinkedChild(parentItem.id, tagToMove, {
            category: parentItem.category || activeTab,
            allowIncludes: false
        });

        const nextFolderTags = normalizeTags(folderCard.tags);
        if (!nextFolderTags.includes(targetTag)) {
            nextFolderTags.push(targetTag);
        }

        const nextFolderContentMap: Record<string, string> = {
            ...getDocumentContentMap(folderCard.content),
            [targetTag]: content
        };
        if (status !== undefined) {
            nextFolderContentMap[`__status_${targetTag}`] = status;
        }

        const updatedParent = {
            ...parentItem,
            tags: normalizeTags(parentItem.tags).filter(t => t !== tagToMove),
            content: JSON.stringify(updatedParentMap)
        };

        const updatedFolderCard: ClipboardItem = {
            ...folderCard,
            content: JSON.stringify(nextFolderContentMap),
            tags: nextFolderTags,
            category: folderCard.category || parentItem.category || activeTab
        };

        setItems(prev => {
            const next = prev
                .filter((i) => !existingChild || i.id !== existingChild.id)
                .map(i => {
                    if (i.id === updatedParent.id) return updatedParent;
                    if (i.id === updatedFolderCard.id) return updatedFolderCard;
                    return i;
                });

            if (!next.some(i => i.id === updatedFolderCard.id)) {
                next.unshift(updatedFolderCard);
            }

            return next;
        });

        const writes: Promise<unknown>[] = [
            invoke('db_upsert_item', { itemJson: JSON.stringify(updatedParent), libraryId: activeLibraryId }),
            invoke('db_upsert_item', { itemJson: JSON.stringify(updatedFolderCard), libraryId: activeLibraryId })
        ];

        if (existingChild) {
            writes.push(invoke('db_delete_item', { id: existingChild.id, libraryId: activeLibraryId }));
        }

        await Promise.all(writes);
        emitClipboardUpdated({
            itemIds: [updatedParent.id, updatedFolderCard.id],
            removedItemIds: existingChild ? [existingChild.id] : undefined
        });

        if (!options?.silent) {
            showToast(
                targetTag === tagToMove
                    ? t.clip_moved_to_folder
                    : `${t.clip_moved_to_folder} (${targetTag})`
            );
        }

        return {
            updatedParent,
            folderCard: updatedFolderCard,
            movedChild: null
        };
    };

    const handleMoveTagToFolder = async (tagToMove: string, folderTag: string, parentItem: ClipboardItem) => {
        await moveTagToFolder(tagToMove, folderTag, parentItem);
    };

    const handleCombineDocumentTagsIntoFolder = async (
        sourceTag: string,
        targetTag: string,
        parentItem: ClipboardItem
    ) => {
        const latestParent = await ensureItem(parentItem.id, { requireDocumentContent: true });
        if (!latestParent || latestParent.type !== 'DOCUMENT') return;
        parentItem = latestParent;
        if (!sourceTag || !targetTag || sourceTag === targetTag) return;
        if (sourceTag.startsWith(FOLDER_TAG_PREFIX) || targetTag.startsWith(FOLDER_TAG_PREFIX)) return;

        const visibleTags = getVisibleTags(parentItem.tags);
        const sourceVisibleIndex = visibleTags.indexOf(sourceTag);
        const targetVisibleIndex = visibleTags.indexOf(targetTag);
        if (sourceVisibleIndex <= 0 || targetVisibleIndex <= 0) return;

        const folderBaseName = getFolderDisplayName(targetTag);
        const folderTag = getUniqueTagName(`${FOLDER_TAG_PREFIX} ${folderBaseName}`, visibleTags);
        const normalizedTags = normalizeTags(parentItem.tags);
        const targetTagIndex = normalizedTags.indexOf(targetTag);
        if (targetTagIndex === -1) return;

        const updatedParent: ClipboardItem = {
            ...parentItem,
            tags: [
                ...normalizedTags.slice(0, targetTagIndex),
                folderTag,
                ...normalizedTags.slice(targetTagIndex),
            ]
        };

        setItems(prev => prev.map((item) => item.id === updatedParent.id ? updatedParent : item));
        await persistItem(updatedParent);

        const orderedMoves = [
            { tag: sourceTag, index: sourceVisibleIndex },
            { tag: targetTag, index: targetVisibleIndex },
        ].sort((left, right) => left.index - right.index);

        for (const move of orderedMoves) {
            const latestParent = itemsRef.current.find((item) => item.id === parentItem.id);
            if (!latestParent) return;

            await moveTagToFolder(move.tag, folderTag, latestParent, { silent: true });
        }

        showToast(language === 'en' ? 'Created new folder' : '已新建文件夹');
    };

    const pasteDocumentTags = async (
        sourceItemId: string,
        targetItemId: string,
        sourceTags: string[],
        mode: 'copy' | 'cut',
        options?: { silent?: boolean }
    ) => {
        if (!Array.isArray(sourceTags) || sourceTags.length === 0) {
            return { moved: 0 };
        }

        const [sourceItem, targetItem] = await Promise.all([
            ensureItem(sourceItemId, { requireDocumentContent: true }),
            ensureItem(targetItemId, { requireDocumentContent: true })
        ]);
        if (!sourceItem || !targetItem) {
            return { moved: 0 };
        }
        if (sourceItem.type !== 'DOCUMENT' || targetItem.type !== 'DOCUMENT') {
            return { moved: 0 };
        }
        if (mode === 'cut' && sourceItemId === targetItemId) {
            return { moved: 0 };
        }

        const uniqueSourceTags = sourceTags.filter((tag, idx) => sourceTags.indexOf(tag) === idx);
        const folderTags = uniqueSourceTags.filter((tag) => tag.startsWith(FOLDER_TAG_PREFIX));
        if (folderTags.length > 0) {
            await ensureItemsCacheLoaded();
        }

        const nextTargetTags = normalizeTags(targetItem.tags);
        const nextTargetMap = getWritableDocumentContentMap(targetItem);
        const nextSourceTags = normalizeTags(sourceItem.tags);
        const nextSourceMap = getWritableDocumentContentMap(sourceItem);
        const existingIds = new Set(itemsRef.current.map((item) => item.id));
        const createdItems: ClipboardItem[] = [];
        const updatedItemsById = new Map<string, ClipboardItem>();
        const persistMap = new Map<string, ClipboardItem>();
        const sourceChildren = folderTags.length > 0
            ? await loadChildrenByParent(sourceItem.id, sourceItem.category || activeTab)
            : [];

        const markItemUpdated = (item: ClipboardItem) => {
            updatedItemsById.set(item.id, item);
            persistMap.set(item.id, item);
            if (!existingIds.has(item.id) && !createdItems.some((it) => it.id === item.id)) {
                createdItems.push(item);
            }
        };

        let movedCount = 0;
        for (const tag of uniqueSourceTags) {
            const srcVisible = getVisibleTags(nextSourceTags);
            if (!srcVisible.includes(tag)) continue;

            const nextTagName = getUniqueTagName(tag, getVisibleTags(nextTargetTags));
            nextTargetTags.push(nextTagName);
            const isFolderTag = tag.startsWith(FOLDER_TAG_PREFIX);

            if (isFolderTag) {
                const linkedChild = sourceChildren.find((candidate) => getVisibleTags(candidate.tags)[0] === tag);

                if (mode === 'copy') {
                    if (linkedChild) {
                        const duplicatedItems = buildDuplicatedSubtree(linkedChild.id, { rootTagName: nextTagName }) || [];
                        if (duplicatedItems.length > 0) {
                            const root = duplicatedItems[0];
                            const rootTags = normalizeTags(root.tags).map((t) => t.startsWith('__p:') ? `__p:${targetItem.id}` : t);
                            duplicatedItems[0] = { ...root, tags: rootTags };
                            duplicatedItems.forEach(markItemUpdated);
                        } else {
                            const emptyChild: ClipboardItem = {
                                id: generateItemId(),
                                content: '',
                                type: 'DOCUMENT',
                                isPinned: false,
                                timestamp: Date.now(),
                                category: targetItem.category || activeTab,
                                tags: [nextTagName, `__p:${targetItem.id}`]
                            };
                            markItemUpdated(emptyChild);
                        }
                    } else {
                        const emptyChild: ClipboardItem = {
                            id: generateItemId(),
                            content: '',
                            type: 'DOCUMENT',
                            isPinned: false,
                            timestamp: Date.now(),
                            category: targetItem.category || activeTab,
                            tags: [nextTagName, `__p:${targetItem.id}`]
                        };
                        markItemUpdated(emptyChild);
                    }
                } else {
                    const removeIdx = nextSourceTags.findIndex((t) => t === tag);
                    if (removeIdx !== -1) nextSourceTags.splice(removeIdx, 1);
                    delete nextSourceMap[tag];
                    delete nextSourceMap[`__status_${tag}`];

                    if (linkedChild) {
                        const rootTags = normalizeTags(linkedChild.tags);
                        const firstVisibleIdx = rootTags.findIndex((t) => !t.startsWith('__status_') && !t.startsWith('__p:'));
                        const movedRootTags = rootTags.map((t) => t.startsWith('__p:') ? `__p:${targetItem.id}` : t);
                        if (firstVisibleIdx !== -1) {
                            movedRootTags[firstVisibleIdx] = nextTagName;
                        }
                        markItemUpdated({ ...linkedChild, tags: movedRootTags });
                    } else {
                        const emptyChild: ClipboardItem = {
                            id: generateItemId(),
                            content: '',
                            type: 'DOCUMENT',
                            isPinned: false,
                            timestamp: Date.now(),
                            category: targetItem.category || activeTab,
                            tags: [nextTagName, `__p:${targetItem.id}`]
                        };
                        markItemUpdated(emptyChild);
                    }
                }

                movedCount += 1;
                continue;
            }

            const payload = getDocumentEntryPayload(sourceItem, tag);
            nextTargetMap[nextTagName] = payload.content;
            if (payload.status !== undefined) {
                nextTargetMap[`__status_${nextTagName}`] = payload.status;
            }

            if (mode === 'cut') {
                const removeIdx = nextSourceTags.findIndex((t) => t === tag);
                if (removeIdx !== -1) nextSourceTags.splice(removeIdx, 1);
                delete nextSourceMap[tag];
                delete nextSourceMap[`__status_${tag}`];
            }

            movedCount += 1;
        }

        if (movedCount === 0) {
            return { moved: 0 };
        }

        const updatedTarget: ClipboardItem = {
            ...targetItem,
            tags: nextTargetTags,
            content: JSON.stringify(nextTargetMap),
        };

        markItemUpdated(updatedTarget);

        if (mode === 'cut') {
            const updatedSource: ClipboardItem = {
                ...sourceItem,
                tags: nextSourceTags,
                content: JSON.stringify(nextSourceMap),
            };
            markItemUpdated(updatedSource);
        }

        setItems((prev) => {
            const mapped = prev.map((item) => updatedItemsById.get(item.id) ?? item);
            const toAppend = createdItems.filter((item) => !mapped.some((current) => current.id === item.id));
            return toAppend.length > 0 ? [...toAppend, ...mapped] : mapped;
        });
        await persistItems(Array.from(persistMap.values()));
        if (options?.silent) {
            return { moved: movedCount };
        }

        if (mode === 'cut') {
            showToast(language === 'en' ? 'Files moved' : '\u6587\u4ef6\u5df2\u79fb\u52a8');
        } else {
            showToast(language === 'en' ? 'Files pasted' : '\u6587\u4ef6\u5df2\u7c98\u8d34');
        }

        return { moved: movedCount };
    };

    const handleMergeDocumentCards = async (sourceItemId: string, targetItemId: string) => {
        if (!sourceItemId || !targetItemId || sourceItemId === targetItemId) {
            return { merged: false, moved: 0 };
        }

        const [sourceItem, targetItem] = await Promise.all([
            ensureItem(sourceItemId),
            ensureItem(targetItemId)
        ]);
        if (!sourceItem || !targetItem) {
            return { merged: false, moved: 0 };
        }
        if (sourceItem.type !== 'DOCUMENT' || targetItem.type !== 'DOCUMENT') {
            return { merged: false, moved: 0 };
        }

        const sourceVisibleTags = getVisibleTags(sourceItem.tags);
        if (sourceVisibleTags.length === 0) {
            return { merged: false, moved: 0 };
        }

        const result = await pasteDocumentTags(
            sourceItemId,
            targetItemId,
            sourceVisibleTags,
            'cut',
            { silent: true }
        );
        if (result.moved === 0) {
            return { merged: false, moved: 0 };
        }

        setItems((prev) => prev.filter((item) => item.id !== sourceItemId));
        await invoke('db_delete_item', { id: sourceItemId, libraryId: activeLibraryId });
        emitClipboardUpdated({ removedItemId: sourceItemId });
        showToast(language === 'en' ? 'Cards merged' : '\u5361\u7247\u5df2\u5408\u5e76');

        return { merged: true, moved: result.moved };
    };

    const handleSaveItems = async (newItemsData: { content: string, tags: string[], type: 'TEXT' | 'LINK' | 'CODE' | 'TAGS', title?: string, body?: string, name?: string, editingItemId?: string }[]) => {
        const editingItemId = newItemsData[0]?.editingItemId;
        if (editingItemId) {
            const itemData = newItemsData[0];
            if (!itemData) return;

            let updated: ClipboardItem | null = null;
            setItems(prev => prev.map(item => {
                if (item.id === editingItemId) {
                    updated = {
                        ...item,
                        content: itemData.content,
                        title: itemData.title,
                        body: itemData.body,
                        type: itemData.type,
                        tags: itemData.tags
                    };
                    return updated;
                }
                return item;
            }));

            if (updated) {
                await persistItem(updated);
            }
        } else {
            const newItems: ClipboardItem[] = newItemsData.map((data, index) => ({
                id: (Date.now() + index).toString(),
                content: data.content,
                title: data.title,
                body: data.body,
                type: data.type as any, // fallback for types
                isPinned: false,
                timestamp: Date.now(),
                category: activeTab,
                tags: data.tags
            }));
            setItems(prev => [...newItems, ...prev]);

            await persistItems(newItems);
        }
    };

    const duplicateItem = async (itemId: string) => {
        await ensureItemsCacheLoaded();
        const duplicatedItems = buildDuplicatedSubtree(itemId);
        if (!duplicatedItems) return null;

        setItems((prev) => [...duplicatedItems, ...prev]);

        try {
            await persistItems(duplicatedItems);
            return duplicatedItems[0] ?? null;
        } catch (error) {
            console.error('Failed to duplicate item:', error);
            return null;
        }
    };

    const duplicateTag = async (item: ClipboardItem, tagToDuplicate: string, tagIdx: number) => {
        const latestItem = item.type === 'DOCUMENT'
            ? await ensureItem(item.id, { requireDocumentContent: true })
            : item;
        if (!latestItem) return null;

        item = latestItem;
        const normalizedTags = normalizeTags(item.tags);
        const duplicatedTag = getDuplicateTagName(tagToDuplicate, getVisibleTags(normalizedTags));

        if (item.type === 'DOCUMENT') {
            const parentId = getParentId(item);
            const isFolderTag = tagToDuplicate.startsWith(FOLDER_TAG_PREFIX);

            if (tagIdx === 0 && parentId) {
                await ensureItemsCacheLoaded();
                const duplicatedItems = buildDuplicatedSubtree(item.id, { rootTagName: duplicatedTag });
                if (!duplicatedItems) return null;

                setItems((prev) => [...duplicatedItems, ...prev]);

                try {
                    await persistItems(duplicatedItems);
                    showToast(language === 'en' ? 'Copy created' : '\u526f\u672c\u5df2\u521b\u5efa');
                    return duplicatedItems[0] ?? null;
                } catch (error) {
                    console.error('Failed to duplicate nested document:', error);
                    return null;
                }
            }

            if (isFolderTag) {
                await ensureItemsCacheLoaded();
                const linkedChild = await findLinkedChild(item.id, tagToDuplicate, {
                    category: item.category || activeTab,
                    allowIncludes: false
                });

                const updatedParentTags = [...normalizedTags];
                updatedParentTags.splice(tagIdx + 1, 0, duplicatedTag);
                const updatedParent = { ...item, tags: updatedParentTags };

                const duplicatedItems = linkedChild
                    ? (buildDuplicatedSubtree(linkedChild.id, { rootTagName: duplicatedTag }) || [])
                    : [{
                        id: generateItemId(),
                        content: '',
                        type: 'DOCUMENT' as const,
                        isPinned: false,
                        timestamp: Date.now(),
                        category: item.category || activeTab,
                        tags: [duplicatedTag, `__p:${item.id}`]
                    }];

                setItems((prev) => [
                    ...duplicatedItems,
                    ...prev.map((current) => current.id === item.id ? updatedParent : current)
                ]);

                try {
                    await persistItems([updatedParent, ...duplicatedItems]);
                    showToast(language === 'en' ? 'Copy created' : '\u526f\u672c\u5df2\u521b\u5efa');
                    return duplicatedItems[0] ?? null;
                } catch (error) {
                    console.error('Failed to duplicate folder tag:', error);
                    return null;
                }
            }

            const updatedTags = [...normalizedTags];
            updatedTags.splice(tagIdx + 1, 0, duplicatedTag);

            const { content, status, contentMap } = getDocumentEntryPayload(item, tagToDuplicate);
            const nextContentMap = Object.keys(contentMap).length > 0
                ? { ...contentMap }
                : { [tagToDuplicate]: content };
            nextContentMap[duplicatedTag] = content;
            if (status !== undefined) {
                nextContentMap[`__status_${duplicatedTag}`] = status;
            }

            const updatedItem = {
                ...item,
                tags: updatedTags,
                content: JSON.stringify(nextContentMap)
            };

            setItems((prev) => prev.map((current) => current.id === item.id ? updatedItem : current));

            try {
                await persistItems([updatedItem]);
                showToast(language === 'en' ? 'Copy created' : '\u526f\u672c\u5df2\u521b\u5efa');
                return updatedItem;
            } catch (error) {
                console.error('Failed to duplicate document tag:', error);
                return null;
            }
        }

        const updatedTags = [...normalizedTags];
        updatedTags.splice(tagIdx + 1, 0, duplicatedTag);
        const updatedItem = {
            ...item,
            tags: updatedTags,
            content: item.type === 'TAGS' ? updatedTags.join(', ') : item.content
        };

        setItems((prev) => prev.map((current) => current.id === item.id ? updatedItem : current));

        try {
            await persistItems([updatedItem]);
            showToast(language === 'en' ? 'Copy created' : '\u526f\u672c\u5df2\u521b\u5efa');
            return updatedItem;
        } catch (error) {
            console.error('Failed to duplicate tag:', error);
            return null;
        }
    };

    const removeItem = async (id: string, e?: React.MouseEvent | undefined, force: boolean = false) => {
        if (e) e.stopPropagation();

        const itemToRemove = await ensureItem(id);
        if (!itemToRemove) return;

        if (itemToRemove.type === 'DOCUMENT' && !force) {
            setDocToDelete(itemToRemove);
            return;
        }

        if (itemToRemove) {
            undoStackRef.current.push(itemToRemove);
            if (undoStackRef.current.length > 30) undoStackRef.current.shift();
            setUndoStack([...undoStackRef.current]);
        }
        setItems(prev => prev.filter(i => i.id !== id));
        await invoke('db_delete_item', { id });
        emitClipboardUpdated({ removedItemId: id });
    };

    const handleUndo = async () => {
        if (undoStackRef.current.length === 0) {
            showToast(language === 'en' ? 'Nothing to undo' : '\u6ca1\u6709\u53ef\u64a4\u9500\u7684\u64cd\u4f5c');
            return;
        }

        const itemToRestore = undoStackRef.current.pop();
        if (itemToRestore) {
            setUndoStack([...undoStackRef.current]);
            setItems(currentItems => {
                if (currentItems.find(i => i.id === itemToRestore.id)) return currentItems;
                const next = [itemToRestore, ...currentItems].sort((a, b) => b.timestamp - a.timestamp);
                return next;
            });
            await persistItem(itemToRestore);
            showToast(language === 'en' ? 'Card restored' : '\u5361\u7247\u5df2\u6062\u590d');
        }
    };

    const clearAll = async () => {
        const removedIds = itemsRef.current.map((item) => item.id);
        setItems([]);
        await invoke('db_save_items', { itemsJson: '[]', libraryId: activeLibraryId });
        emitClipboardUpdated({ removedItemIds: removedIds });
    };

    const handleRemoveTag = async (
        item: ClipboardItem,
        tagToRemove: string,
        tagIdx: number,
        options?: { silent?: boolean }
    ) => {
        if (!item || !item.tags) return;
        
        const newTags = item.tags.filter((_, i) => i !== tagIdx);
        const newItem = { ...item, tags: newTags };
        
        if (newItem.type === 'TAGS') {
            newItem.content = newTags.join(', ');
        }
        
        setItems(prev => prev.map(p => p.id === newItem.id ? newItem : p));
        
        const isLinkTag = tagToRemove.startsWith('\uD83D\uDCC1') || (item.type === 'DOCUMENT' && tagIdx > 0);
        
        try {
            const removedIds: string[] = [];
            if (isLinkTag) {
                const titleToRemove = tagToRemove.replace('\uD83D\uDCC1', '').trim();
                const childToDelete = await findLinkedChild(item.id, tagToRemove, {
                    category: item.category || activeTab,
                    allowIncludes: false
                }) || await findLinkedChild(item.id, titleToRemove, {
                    category: item.category || activeTab,
                    allowIncludes: true
                });
                
                if (childToDelete) {
                    setItems(prev => prev.filter(i => i.id !== childToDelete.id));
                    removedIds.push(childToDelete.id);
                    await invoke('db_delete_item', { id: childToDelete.id, libraryId: activeLibraryId });
                }
            }

            await persistItem(newItem);
            if (removedIds.length > 0) {
                emitClipboardUpdated({ removedItemIds: removedIds });
            }
            if (!options?.silent) {
                showToast(language === 'en' ? 'Tag removed' : '\u6807\u7b7e\u5df2\u79fb\u9664');
            }
        } catch (err) {
            console.error('Failed to remove tag or child item:', err);
        }
    };

    const removeDocumentTagsBulk = async (itemId: string, tagsToRemove: string[]) => {
        const uniqueTags = Array.from(new Set((tagsToRemove || []).filter((tag): tag is string => typeof tag === 'string' && !!tag)));
        if (uniqueTags.length === 0) return { removed: 0 };

        let removed = 0;
        for (const tag of uniqueTags) {
            const latestItem = await ensureItem(itemId);
            if (!latestItem || latestItem.type !== 'DOCUMENT') continue;

            const latestTags = normalizeTags(latestItem.tags);
            const tagIdx = latestTags.findIndex((t, idx) => idx > 0 && t === tag);
            if (tagIdx === -1) continue;

            await handleRemoveTag(latestItem, tag, tagIdx, { silent: true });
            removed += 1;
        }

        if (removed > 0) {
            showToast(
                language === 'en'
                    ? (removed > 1 ? `${removed} items removed` : 'Tag removed')
                    : (removed > 1 ? `已删除 ${removed} 项` : '标签已移除')
            );
        }

        return { removed };
    };

    const handleOpenLocation = async (item: ClipboardItem, tag: string, tagIdx: number) => {
        try {
            const content = item.type === 'DOCUMENT'
                ? (await fetchDocumentEntry(item.id, tag)).content
                : (() => {
                    const map = (() => {
                        try {
                            const parsed = JSON.parse(item.content);
                            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
                        } catch (e) { }
                        return {};
                    })();

                    return map[tag] || (tagIdx === 0 && Object.keys(map).length === 0 ? item.content : '');
                })();

            await invoke('reveal_file_in_explorer', { 
                filename: tag, 
                content,
                libraryId: activeLibraryId,
                category: item.category || null,
                tagsJson: JSON.stringify(item.tags || []),
                itemType: item.type
            });
        } catch (err) {
            showToast(language === 'en' ? 'Failed to open location' : '打开路径失败');
        }
    };

    const handleCopyAsFile = async (item: ClipboardItem, tag: string, tagIdx: number) => {
        try {
            const content = item.type === 'DOCUMENT'
                ? (await fetchDocumentEntry(item.id, tag)).content
                : (() => {
                    const map = (() => {
                        try {
                            const parsed = JSON.parse(item.content);
                            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
                        } catch (e) { }
                        return {};
                    })();

                    return map[tag] || (tagIdx === 0 && Object.keys(map).length === 0 ? item.content : '');
                })();

            await invoke('copy_file_to_clipboard', { 
                filename: tag, 
                content,
                libraryId: activeLibraryId,
                category: item.category || null,
                tagsJson: JSON.stringify(item.tags || []),
                itemType: item.type
            });
            showToast(language === 'en' ? 'Document copied to clipboard as file' : '\u6587\u6863\u5df2\u4f5c\u4e3a\u6587\u4ef6\u590d\u5236\u5230\u526a\u8d34\u677f');
        } catch (err) {
            showToast(language === 'en' ? 'Failed to copy file' : '拷贝文件失败');
        }
    };

    const deleteCategory = async (catName: string) => {
        if (isHistoryLikeCategory(catName) || isAllLikeCategory(catName)) return;
        if (catName === '历史' || catName === 'History') return;

        const remaining = categories.filter(c => c !== catName && !isAllLikeCategory(c) && !isHistoryLikeCategory(c));
        const targetCat = remaining[0] || t.clip_new_group_default;

        setItems(prev => prev.map(item => {
            if (item.category === catName) {
                return { ...item, category: targetCat };
            }
            return item;
        }));

        const next = remaining.length > 0 ? remaining : [targetCat];
        onUpdateCategories(next);

        if (activeTab === catName && callbacks.setActiveTab) {
            callbacks.setActiveTab(targetCat);
        }

        try {
            await invoke('db_rename_category', {
                libraryId: activeLibraryId,
                oldName: catName,
                newName: targetCat
            });
            emitClipboardUpdated({ reloadAll: true });
            showToast(language === 'en' ? `Category deleted, items moved to ${targetCat}` : `分类已删除，项目已移动到 ${targetCat}`);
        } catch (e) {
            console.error('Failed to delete/merge category in DB:', e);
        }
    };

    const moveToGroup = async (item: ClipboardItem, targetCategory: string) => {
        const updatedItem = { ...item, category: targetCategory };
        
        setItems(prev => prev.map(it => it.id === item.id ? updatedItem : it));
        showToast(language === 'en' ? `Moved to ${targetCategory}` : `已移动到 ${targetCategory}`);

        try {
            await persistItem(updatedItem);
            // Moving across groups can leave the per-category cache stale.
            emitClipboardUpdated({ itemId: updatedItem.id, reloadAll: true });
        } catch (error) {
            console.error('Failed to move item:', error);
            setItems(prev => prev.map(it => it.id === item.id ? item : it));
        }
    };

    const renameCategory = async (oldCat: string, newCat: string) => {
        if (newCat !== oldCat && !categories.includes(newCat)) {
            const next = categories.map(c => c === oldCat ? newCat : c);
            onUpdateCategories(next);

            if (activeTab === oldCat && callbacks.setActiveTab) {
                callbacks.setActiveTab(newCat);
            }

            setItems(prev => prev.map(item => {
                if (item.category === oldCat) {
                    return { ...item, category: newCat };
                }
                return item;
            }));

            try {
                await invoke('db_rename_category', {
                    libraryId: activeLibraryId,
                    oldName: oldCat,
                    newName: newCat
                });
                emitClipboardUpdated({ reloadAll: true });
            } catch (e) {
                console.error('Failed to rename category in DB:', e);
            }
        }
    };

    useEffect(() => {
        setCurrentParentId(null);
        setBreadcrumbStack([]);
    }, [activeTab]);

    useEffect(() => {
        let unlisten: any;
        async function setup() {
            unlisten = await listen('vault-updated', () => {
                logger.log('[ClipboardView] Vault updated event received, reloading...');
                loadItems();
            });
        }
        setup();
        return () => {
            if (unlisten && typeof unlisten === 'function') unlisten();
        };
    }, [activeLibraryId]);

    useEffect(() => {
        const handleClipboardUpdated = async (event: Event) => {
            const customEvent = event as CustomEvent<ClipboardUpdatedDetail | null>;
            const detail = customEvent.detail ?? undefined;

            if (detail) {
                const removedIds = Array.from(new Set([
                    ...(detail.removedItemId ? [detail.removedItemId] : []),
                    ...(detail.removedItemIds || [])
                ]));
                if (removedIds.length > 0) {
                    removeItemsFromCache(removedIds);
                }

                const changedIds = Array.from(new Set([
                    ...(detail.itemId ? [detail.itemId] : []),
                    ...(detail.itemIds || [])
                ]));

                if (changedIds.length > 0) {
                    try {
                        const fetchedItems = await Promise.all(
                            changedIds.map((itemId) => fetchItemById(itemId, {
                                merge: false,
                                includeDocumentContent: false
                            }))
                        );
                        const nextItems = fetchedItems.filter((item): item is ClipboardItem => Boolean(item));
                        hydrateItemsCache(nextItems);

                        if (nextItems.length !== changedIds.length) {
                            const foundIds = new Set(nextItems.map((item) => item.id));
                            removeItemsFromCache(changedIds.filter((itemId) => !foundIds.has(itemId)));
                        }
                        return;
                    } catch (error) {
                        console.error('Failed to patch clipboard item from update event:', error);
                    }
                }

                if (!detail.reloadAll) {
                    return;
                }
            }

            logger.log('[ClipboardView] Clipboard updated event received, reloading...');
            void loadItems();
        };

        window.addEventListener('clipboard-updated', handleClipboardUpdated);
        return () => window.removeEventListener('clipboard-updated', handleClipboardUpdated);
    }, [activeLibraryId]);

    useEffect(() => {
        if (loadedLibId.current !== activeLibraryId) {
            loadedLibId.current = activeLibraryId;
            isLoaded.current = false;
            allItemsCacheLoadedRef.current = false;
            undoStackRef.current = [];
            setUndoStack([]);
            setItems([]);
        }
    }, [activeLibraryId]);

    return {
        items,
        setItems,
        hydrateItemsCache,
        loadItems,
        handleCompleteItem,
        commitEditContent,
        commitEditTag,
        handleAddTag,
        handleCreateItem,
        handleEnterFolder,
        handleMoveTagToFolder,
        handleCombineDocumentTagsIntoFolder,
        pasteDocumentTags,
        handleMergeDocumentCards,
        handleSaveItems,
        duplicateItem,
        duplicateTag,
        removeItem,
        handleUndo,
        clearAll,
        handleRemoveTag,
        removeDocumentTagsBulk,
        handleOpenLocation,
        handleCopyAsFile,
        deleteCategory,
        moveToGroup,
        renameCategory,
        editingTag,
        setEditingTag,
        editingContent,
        setEditingContent,
        currentParentId,
        setCurrentParentId,
        breadcrumbStack,
        setBreadcrumbStack,
        itemsRef
    };
};





