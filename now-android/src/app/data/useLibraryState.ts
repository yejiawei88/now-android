import { useCallback, useEffect, useState } from 'react';
import { isAllLikeCategory, isHistoryLikeCategory } from '../../constants';
import { logger } from '../../utils';
import { isLikelyMojibakeText, repairDisplayText } from '../../utils/cardContent';

type Library = { id: string; name: string };

type UseLibraryStateArgs = {
  defaultCategory: string;
};

const STORAGE_KEY_LIBRARIES = 'clipboard_libraries';
const STORAGE_KEY_ACTIVE_LIBRARY = 'active_library_id';

const getCategoryStorageKey = (libraryId: string) =>
  libraryId === 'default' ? 'clipboard_categories' : `clipboard_categories_${libraryId}`;

export const useLibraryState = ({ defaultCategory }: UseLibraryStateArgs) => {
  const sanitizeClipboardCategories = useCallback((raw: unknown): string[] => {
    const asArray = Array.isArray(raw) ? raw : [];
    const seen = new Set<string>();
    const cleaned = asArray
      .filter((c): c is string => typeof c === 'string')
      .map((c) => repairDisplayText(c).trim())
      .filter(Boolean)
      .filter((c) => !isLikelyMojibakeText(c))
      .filter((c) => c !== '常用' && c !== '全部' && c !== 'All')
      .filter((c) => (seen.has(c) ? false : (seen.add(c), true)));

    return cleaned.length > 0 ? cleaned : [defaultCategory];
  }, [defaultCategory]);

  const sanitizeVisibleClipboardCategories = useCallback((raw: unknown): string[] => {
    const withoutSystemTabs = Array.isArray(raw)
      ? raw.filter(
          (c): c is string =>
            typeof c === 'string' &&
            !isAllLikeCategory(c.trim()) &&
            !isHistoryLikeCategory(c.trim())
        )
      : [];

    return sanitizeClipboardCategories(withoutSystemTabs);
  }, [sanitizeClipboardCategories]);

  const [libraries, setLibraries] = useState<Library[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LIBRARIES);
      return saved ? JSON.parse(saved) : [{ id: 'default', name: '默认库' }];
    } catch {
      return [{ id: 'default', name: '默认库' }];
    }
  });
  const [activeLibraryId, setActiveLibraryId] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY_ACTIVE_LIBRARY) || 'default'
  );
  const [clipboardCategories, setClipboardCategories] = useState<string[]>([]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_LIBRARIES, JSON.stringify(libraries));
  }, [libraries]);

  useEffect(() => {
    logger.log('[App] activeLibraryId changed to:', activeLibraryId);
    localStorage.setItem(STORAGE_KEY_ACTIVE_LIBRARY, activeLibraryId);
    const key = getCategoryStorageKey(activeLibraryId);

    try {
      const saved = localStorage.getItem(key);
      const parsedRaw: unknown = saved ? JSON.parse(saved) : [];
      const parsed = sanitizeVisibleClipboardCategories(parsedRaw);
      logger.log('[App] Loading categories from localStorage (filtered):', parsed);
      setClipboardCategories(parsed);

      if (saved) {
        const rawNormalized = Array.isArray(parsedRaw)
          ? parsedRaw
              .filter((c): c is string => typeof c === 'string')
              .map((c) => c.trim())
              .filter(Boolean)
          : [];
        const same =
          rawNormalized.length === parsed.length &&
          rawNormalized.every((v, idx) => v === parsed[idx]);
        if (!same) {
          localStorage.setItem(key, JSON.stringify(parsed));
        }
      }
    } catch {
      logger.log('[App] Failed to parse categories, using defaults');
      setClipboardCategories(sanitizeVisibleClipboardCategories([]));
    }
  }, [activeLibraryId, sanitizeVisibleClipboardCategories]);

  const handleUpdateCategories = useCallback((cats: string[]) => {
    logger.log('[App] handleUpdateCategories called with:', cats);
    logger.log('[App] Current activeLibraryId:', activeLibraryId);
    const nextCats = sanitizeVisibleClipboardCategories(cats);
    setClipboardCategories(nextCats);
    localStorage.setItem(getCategoryStorageKey(activeLibraryId), JSON.stringify(nextCats));
  }, [activeLibraryId, sanitizeVisibleClipboardCategories]);

  const addLibrary = useCallback((name: string) => {
    const newLib = { id: Date.now().toString(), name };
    setLibraries((prev) => [...prev, newLib]);
    setActiveLibraryId(newLib.id);
  }, []);

  const renameLibrary = useCallback((id: string, name: string) => {
    setLibraries((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
  }, []);

  const removeLibrary = useCallback((id: string) => {
    setLibraries((prev) => prev.filter((l) => l.id !== id));
    if (activeLibraryId === id) {
      setActiveLibraryId('default');
    }
    localStorage.removeItem(getCategoryStorageKey(id));
  }, [activeLibraryId]);

  return {
    libraries,
    setLibraries,
    activeLibraryId,
    setActiveLibraryId,
    clipboardCategories,
    setClipboardCategories,
    sanitizeVisibleClipboardCategories,
    handleUpdateCategories,
    addLibrary,
    renameLibrary,
    removeLibrary,
  };
};

