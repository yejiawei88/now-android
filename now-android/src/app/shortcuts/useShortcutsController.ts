import { useCallback, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ShortcutItem } from '../../types';

type SummonResult = { instances: number };

type BackendLike = {
  summon: (item: ShortcutItem) => Promise<SummonResult>;
  smartSummon: (query: string, shortcuts: ShortcutItem[]) => Promise<string[]>;
};

type UseShortcutsControllerArgs = {
  backend: BackendLike;
  shortcuts: ShortcutItem[];
  searchQuery: string;
  mainShortcut: string;
  setShortcuts: Dispatch<SetStateAction<ShortcutItem[]>>;
  setIsSearching: Dispatch<SetStateAction<boolean>>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setIsShortcutsActive: Dispatch<SetStateAction<boolean>>;
  prevShortcutsRef: MutableRefObject<string>;
};

export const useShortcutsController = ({
  backend,
  shortcuts,
  searchQuery,
  mainShortcut,
  setShortcuts,
  setIsSearching,
  setSearchQuery,
  setIsShortcutsActive,
  prevShortcutsRef,
}: UseShortcutsControllerArgs) => {
  const handleExecute = useCallback(async (item: ShortcutItem) => {
    const result = await backend.summon(item);
    setShortcuts((prev) =>
      prev.map((s) => (
        s.id === item.id
          ? { ...s, isRunning: result.instances > 0, instances: result.instances }
          : s
      ))
    );
  }, [backend, setShortcuts]);

  const handleSearchKeyPress = useCallback(async (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && searchQuery.trim().length > 0) {
      setIsSearching(true);
      const idsToRun = await backend.smartSummon(searchQuery, shortcuts);
      if (idsToRun.length > 0) {
        idsToRun.forEach((id) => {
          const item = shortcuts.find((s) => s.id === id);
          if (item) void handleExecute(item);
        });
        setSearchQuery('');
      }
      setIsSearching(false);
    }
  }, [backend, handleExecute, searchQuery, setIsSearching, setSearchQuery, shortcuts]);

  const updateShortcutsState = useCallback((active: boolean) => {
    setIsShortcutsActive(active);
    if (!active) {
      invoke('update_shortcuts', {
        items: [],
        topMostKey: '',
        mainShortcut,
        quickChatShortcut: '',
        screenshotShortcut: '',
        clipboardShortcut: '',
      });
    } else {
      prevShortcutsRef.current = '';
    }
  }, [mainShortcut, prevShortcutsRef, setIsShortcutsActive]);

  return { handleExecute, handleSearchKeyPress, updateShortcutsState };
};

