import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { logger } from '../../utils';
import { isReservedSystemShortcut } from '../../utils';

type UseAppEventsArgs = {
  clipboardShortcut?: string;
  onAiTriggered: (payload: any) => void;
  onClipboardTriggered: () => void;
  onShortcutRegistrationReport: (payload: any) => void;
  onPinnedChanged: (isPinned: boolean) => void;
  onExportAllTriggered: () => void;
  onImportAllTriggered: () => void;
  onExportClipboardTriggered: () => void;
  onImportClipboardTriggered: () => void;
  onMaximizedChanged: (isMaximized: boolean) => void;
};

const matchesShortcut = (e: KeyboardEvent, shortcutStr?: string) => {
  if (!shortcutStr) return false;
  const parts = shortcutStr.toLowerCase().split('+');
  const key = parts.pop();
  if (!key) return false;

  const needsCtrl = parts.includes('ctrl') || parts.includes('control');
  const needsAlt = parts.includes('alt');
  const needsShift = parts.includes('shift');
  const needsMeta = parts.includes('meta') || parts.includes('command') || parts.includes('cmd');

  return (
    e.key.toLowerCase() === key &&
    e.ctrlKey === needsCtrl &&
    e.altKey === needsAlt &&
    e.shiftKey === needsShift &&
    e.metaKey === needsMeta
  );
};

export const useAppEvents = ({
  clipboardShortcut,
  onAiTriggered,
  onClipboardTriggered,
  onShortcutRegistrationReport: _onShortcutRegistrationReport,
  onPinnedChanged,
  onExportAllTriggered,
  onImportAllTriggered,
  onExportClipboardTriggered,
  onImportClipboardTriggered,
  onMaximizedChanged,
}: UseAppEventsArgs) => {
  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      try {
        const u1 = await listen('trigger-ai', (event: any) => {
          logger.log('[Frontend] trigger-ai received:', event.payload);
          onAiTriggered(event.payload as any);
        });
        unlisteners.push(u1);

        const u2 = await listen('trigger-clipboard', () => {
          logger.log('[Frontend] Clipboard trigger received');
          onClipboardTriggered();
        });
        unlisteners.push(u2);

        const u3 = await listen('topmost-changed', (event: any) => {
          onPinnedChanged(event.payload as boolean);
        });
        unlisteners.push(u3);

        const u4 = await listen('trigger-export-all', onExportAllTriggered);
        unlisteners.push(u4);
        const u5 = await listen('trigger-import-all', onImportAllTriggered);
        unlisteners.push(u5);
        const u6 = await listen('trigger-export-clipboard', onExportClipboardTriggered);
        unlisteners.push(u6);
        const u7 = await listen('trigger-import-clipboard', onImportClipboardTriggered);
        unlisteners.push(u7);

        const syncMaximizedState = async () => {
          const win = getCurrentWindow();
          const maximized = await win.isMaximized();
          onMaximizedChanged(maximized);
        };

        syncMaximizedState();

        const u10 = await listen('tauri://resize', syncMaximizedState);
        unlisteners.push(u10);
        const u11 = await listen('tauri://moved', syncMaximizedState);
        unlisteners.push(u11);
      } catch (err) {
        console.error('Setup listeners failed:', err);
      }
    };

    setup();

    return () => {
      unlisteners.forEach((u) => typeof u === 'function' && u());
    };
  }, [
    onAiTriggered,
    onClipboardTriggered,
    onPinnedChanged,
    onExportAllTriggered,
    onImportAllTriggered,
    onExportClipboardTriggered,
    onImportClipboardTriggered,
    onMaximizedChanged,
  ]);

  useEffect(() => {
    const handleLocalShortcut = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (isReservedSystemShortcut(clipboardShortcut)) return;

      if (matchesShortcut(e, clipboardShortcut)) {
        logger.log('[Frontend] Local clipboard shortcut detected');
        e.preventDefault();
        onClipboardTriggered();
      }
    };

    window.addEventListener('keydown', handleLocalShortcut);
    return () => window.removeEventListener('keydown', handleLocalShortcut);
  }, [clipboardShortcut, onClipboardTriggered]);
};

