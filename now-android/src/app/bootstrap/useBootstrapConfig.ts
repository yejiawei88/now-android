import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettings, ShortcutItem, TranslationSettings } from '../../types';
import { logger, normalizeShortcutItems } from '../../utils';

type UseBootstrapConfigArgs = {
  activeLibraryId: string;
  sanitizeVisibleClipboardCategories: (raw: unknown) => string[];
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setShortcuts: Dispatch<SetStateAction<ShortcutItem[]>>;
  setTranslationSettings: Dispatch<SetStateAction<TranslationSettings>>;
  setLibraries: Dispatch<SetStateAction<{ id: string; name: string }[]>>;
  setClipboardCategories: Dispatch<SetStateAction<string[]>>;
  setShowFirstRunPrompt: Dispatch<SetStateAction<boolean>>;
  setOfficialPromptStorageKey: Dispatch<SetStateAction<string>>;
  setNotification: Dispatch<SetStateAction<{
    isOpen: boolean;
    type: 'success' | 'error' | 'info';
    title: string;
    message?: string;
  }>>;
};

let hasPromptedThisSession = false;
let hasShownSeedValidationErrorThisSession = false;
const LEGACY_OFFICIAL_DB_PROMPT_KEY = 'has_seen_official_db_prompt_v2';

export const useBootstrapConfig = ({
  activeLibraryId,
  sanitizeVisibleClipboardCategories,
  setSettings,
  setShortcuts,
  setTranslationSettings,
  setLibraries,
  setClipboardCategories,
  setShowFirstRunPrompt,
  setOfficialPromptStorageKey,
  setNotification,
}: UseBootstrapConfigArgs) => {
  useEffect(() => {
    const checkDefaults = async () => {
      const hasSettings = localStorage.getItem('summon_settings');
      if (!hasSettings) {
        try {
          logger.log('[Frontend] No settings found, attempting to load default_app_config.json...');
          const configStr = await invoke<string>('get_default_config').catch(() => null);
          if (!configStr) {
            logger.warn('[Frontend] Failed to load default config or backend unavailable.');
          } else {
            const config = JSON.parse(configStr);

            if (config.settings) {
              setSettings((prev) => ({ ...prev, ...config.settings }));
            }
            if (config.shortcuts && Array.isArray(config.shortcuts)) {
              setShortcuts(normalizeShortcutItems(config.shortcuts));
            }
            if (config.translationSettings) {
              setTranslationSettings((prev) => ({ ...prev, ...config.translationSettings }));
            }
            if (config.libraries && Array.isArray(config.libraries)) {
              setLibraries(config.libraries);
              localStorage.setItem('clipboard_libraries', JSON.stringify(config.libraries));
            }
            if (config.clipboardCategories && typeof config.clipboardCategories === 'object') {
              Object.entries(config.clipboardCategories as Record<string, unknown>).forEach(([libId, cats]) => {
                const key = libId === 'default' ? 'clipboard_categories' : `clipboard_categories_${libId}`;
                const nextCats = sanitizeVisibleClipboardCategories(cats);
                localStorage.setItem(key, JSON.stringify(nextCats));
              });
              const currentKey = activeLibraryId === 'default' ? 'clipboard_categories' : `clipboard_categories_${activeLibraryId}`;
              const currentCats = (config.clipboardCategories as any)?.[activeLibraryId];
              if (currentCats) {
                setClipboardCategories(sanitizeVisibleClipboardCategories(currentCats));
                localStorage.setItem(currentKey, JSON.stringify(sanitizeVisibleClipboardCategories(currentCats)));
              }
            }
            logger.log('[Frontend] Loaded defaults successfully');
          }
        } catch (e) {
          console.error('[Frontend] Failed to load default config:', e);
        }
      } // End of !hasSettings block

      if (hasPromptedThisSession) return;

      if (!hasShownSeedValidationErrorThisSession) {
        const validationError = await invoke('validate_official_seed_package')
          .then(() => null)
          .catch((e) => String(e));

        if (validationError) {
          hasShownSeedValidationErrorThisSession = true;
          logger.warn('[Frontend] Official seed validation failed:', validationError);
          setNotification({
            isOpen: true,
            type: 'error',
            title: 'Official Seed Invalid',
            message: validationError,
          });
        }
      }

      let isEmptyDB = false;
      try {
        const itemsStr = await invoke<string>('db_load_items', { libraryId: 'default' });
        const items = JSON.parse(itemsStr);
        isEmptyDB = Array.isArray(items) && items.length === 0;
      } catch (e) {
        console.error('Failed to load DB items during bootstrap check:', e);
      }

      const promptStorageKey = await invoke<string>('get_official_seed_signature')
        .then((signature) => {
          const normalizedSignature = signature?.trim();
          return normalizedSignature
            ? `has_seen_official_db_prompt_${normalizedSignature}`
            : LEGACY_OFFICIAL_DB_PROMPT_KEY;
        })
        .catch(() => LEGACY_OFFICIAL_DB_PROMPT_KEY);

      setOfficialPromptStorageKey(promptStorageKey);

      const hasSeenPrompt = localStorage.getItem(promptStorageKey);
      // Tie the prompt key to the bundled official library signature so updated bundles can prompt once again.
      if (!hasSeenPrompt || isEmptyDB) {
        hasPromptedThisSession = true;
        setTimeout(() => {
          setShowFirstRunPrompt(true);
        }, 500);
      }
    };

    void checkDefaults();
  }, [
    activeLibraryId,
    sanitizeVisibleClipboardCategories,
    setClipboardCategories,
    setLibraries,
    setOfficialPromptStorageKey,
    setNotification,
    setSettings,
    setShortcuts,
    setShowFirstRunPrompt,
    setTranslationSettings,
  ]);
};

