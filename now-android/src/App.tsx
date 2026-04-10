import React, { startTransition, useState, useEffect, useMemo, useRef, useCallback } from 'react';

import { ViewType, AppSettings, ModalType, TranslationSettings, ClipboardItem } from './types';

import { BackendService } from './backend';
import { invoke } from "@tauri-apps/api/core";
import { translations } from './i18n';
import Icon from './components/Icon';
import { useDebouncedLocalStorage } from './hooks/useOptimization';
import { obfuscate, logger } from './utils';
import { isLikelyMojibakeText, repairDisplayText } from './utils/cardContent';
import { useLibraryState } from './app/data/useLibraryState';
import { useTranslationSettings } from './app/settings/useTranslationSettings';
import { useImportExport } from './app/io/useImportExport';
import { useBootstrapConfig } from './app/bootstrap/useBootstrapConfig';
import SettingsView from './views/SettingsView';
import ChatView from './views/ChatView';
import ClipboardView from './views/ClipboardView';
import ClipboardManagerView from './views/ClipboardManagerView';
import DocumentEditorView from './views/DocumentEditorView';
import ActivationView from './views/ActivationView';
import { Notification } from './components/Notification';

const ACTIVE_CONTAINER = 'flex-1 flex flex-col overflow-hidden';
const INACTIVE_CONTAINER = 'hidden';
const LOCAL_STORAGE_TRUE = 'true';
const SUMMON_SETTINGS_KEY = 'summon_settings';
const TRANSLATION_SETTINGS_KEY = 'translation_settings';
const DEFAULT_OFFICIAL_DB_PROMPT_KEY = 'has_seen_official_db_prompt_v2';

// Android 版：底部三 Tab 导航（剪贴板、对话、设置）
const TAB_ITEMS = [
  { key: 'CLIPBOARD', view: ViewType.CLIPBOARD, title: 'sc_clipboard', icon: 'favorite' as const },
  { key: 'CHAT', view: ViewType.CHAT, title: 'sc_quickchat', icon: 'chat' as const },
  { key: 'SETTINGS', view: ViewType.SETTINGS, title: 'tab_general', icon: 'hexagon' as const },
] as const;

class AppErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any) {
    if (import.meta.env.DEV) {
      console.error('[AppErrorBoundary] React crashed:', error);
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ position:'fixed', inset:0, background:'#DC2626', color:'white', padding:'40px', zIndex:999999, fontFamily:'monospace', overflow:'auto' }}>
          <h1 style={{ fontSize:'28px', marginBottom:'20px' }}>React Render Crash Detected!</h1>
          <pre style={{ background:'rgba(0,0,0,0.3)', padding:'20px', borderRadius:'12px', whiteSpace:'pre-wrap', wordBreak:'break-all', fontSize:'14px' }}>
            {String(this.state.error)}
          </pre>
          <button onClick={() => { this.setState({ hasError: false, error: null }); }} style={{ marginTop:'30px', padding:'12px 24px', fontSize:'16px', cursor:'pointer', background:'white', color:'#DC2626', border:'none', borderRadius:'8px', fontWeight:'bold' }}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const backend = BackendService.getInstance();

const INITIAL_SETTINGS: AppSettings = {
  autoStart: false,  // Android 不支持
  runAsAdmin: false,
  runInBackground: false,  // Android 不支持
  hideTray: false,
  hideMainTaskbar: false,
  mainShortcut: '',  // Android 不支持全局快捷键
  topMostKey: '',
  screenshotShortcut: '',
  clipboardShortcut: '',
  voiceInputShortcut: '',
  exportAllShortcut: '',
  importAllShortcut: '',
  exportClipboardShortcut: '',
  importClipboardShortcut: '',
  pasteTagsWithComma: false,
  pasteContentWithTags: false,
  bilingualTagsEnabled: false,
  language: 'zh',
};

const INITIAL_TRANSLATION_SETTINGS: TranslationSettings = {
  provider: 'YOUDAO',
  endpoint: '',
  model: '',
  apiKey: '',
  verified: false,
  quickChatShortcut: '',  // Android 不支持
  customActions: [],
  savedConfigs: []
};

const sanitizeStoredString = (value: unknown) =>
  typeof value === 'string' ? repairDisplayText(value).trim() : value;

const sanitizeStoredStringArray = (value: unknown, options?: { dropMojibake?: boolean }) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => sanitizeStoredString(entry))
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .filter((entry) => !(options?.dropMojibake && isLikelyMojibakeText(entry)));
};

const App: React.FC = () => {
  // Android 默认从剪贴板页开始
  const [currentView, setCurrentView] = useState<ViewType>(ViewType.CLIPBOARD);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'GENERAL' | 'MODEL'>('GENERAL');
  const [showFirstRunPrompt, setShowFirstRunPrompt] = useState(false);
  const [officialPromptStorageKey, setOfficialPromptStorageKey] = useState(DEFAULT_OFFICIAL_DB_PROMPT_KEY);

  const [notification, setNotification] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'info';
    title: string;
    message?: string;
  }>({ isOpen: false, type: 'success', title: '' });

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(SUMMON_SETTINGS_KEY);
      return saved ? { ...INITIAL_SETTINGS, ...JSON.parse(saved) } : INITIAL_SETTINGS;
    } catch (e) {
      return INITIAL_SETTINGS;
    }
  });

  useEffect(() => {
    try {
      const rawLibraries = localStorage.getItem('clipboard_libraries');
      if (rawLibraries) {
        const parsed = JSON.parse(rawLibraries);
        if (Array.isArray(parsed)) {
          const sanitized = parsed.map((entry: any) => ({
            ...entry,
            name: typeof entry?.name === 'string' ? repairDisplayText(entry.name).trim() || entry.name : entry?.name,
          }));
          localStorage.setItem('clipboard_libraries', JSON.stringify(sanitized));
        }
      }

      const keysToCheck = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean) as string[];
      for (const key of keysToCheck) {
        if (key === 'clipboard_categories' || key.startsWith('clipboard_categories_')) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          const sanitized = sanitizeStoredStringArray(parsed, { dropMojibake: true });
          localStorage.setItem(key, JSON.stringify(sanitized));
          continue;
        }

        if (key === 'custom_agents') {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const sanitized = parsed.map((agent: any) => ({
              ...agent,
              name: typeof agent?.name === 'string' ? repairDisplayText(agent.name) : agent?.name,
            }));
            localStorage.setItem(key, JSON.stringify(sanitized));
          }
          continue;
        }

        if (key === 'chat_sessions') {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const sanitized = parsed.map((session: any) => ({
              ...session,
              title: typeof session?.title === 'string' ? repairDisplayText(session.title) : session?.title,
            }));
            localStorage.setItem(key, JSON.stringify(sanitized));
          }
        }
      }
    } catch (error) {
      console.error('Failed to sanitize local storage text:', error);
    }
  }, []);

  const t = translations[settings.language || 'zh'];

  const { translationSettings, setTranslationSettings } = useTranslationSettings({
    language: settings.language,
    initialSettings: INITIAL_TRANSLATION_SETTINGS,
  });

  const [chatContext, setChatContext] = useState<{ text?: string, actionId?: string, type?: string, requestTimestamp?: number } | null>(null);
  const [activeDocumentItem, setActiveDocumentItem] = useState<ClipboardItem | null>(null);
  const [documentFocusTagIndex, setDocumentFocusTagIndex] = useState<number>(0);
  const documentEditorBackHandlerRef = useRef<(() => void | Promise<void>) | null>(null);
  const [mountedViews, setMountedViews] = useState<Record<string, boolean>>(() => ({
    [ViewType.CLIPBOARD]: true,
    [ViewType.CHAT]: true,
    [ViewType.SETTINGS]: true,
    [ViewType.ACTIVATION]: true,
  }));

  const {
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
  } = useLibraryState({ defaultCategory: t.clip_new_group_default });

  const loadLatestDocumentItem = async (
    itemId: string,
    fallback: ClipboardItem | null = null,
    includeDocumentContent = true
  ) => {
    try {
      const itemJson = await invoke<string>('db_get_item', {
        id: itemId,
        libraryId: activeLibraryId,
        includeDocumentContent
      });
      const latestItem = JSON.parse(itemJson);
      return latestItem || fallback;
    } catch (error) {
      console.error('Failed to load latest document item:', error);
      return fallback;
    }
  };

  useDebouncedLocalStorage(SUMMON_SETTINGS_KEY, settings, 500);
  useDebouncedLocalStorage(TRANSLATION_SETTINGS_KEY, translationSettings, 500, (val) => ({
    ...val,
    apiKey: obfuscate(val.apiKey),
    youdaoAppKey: obfuscate(val.youdaoAppKey),
    youdaoAppSecret: obfuscate(val.youdaoAppSecret),
    savedConfigs: (val.savedConfigs || []).map((c: any) => ({
      ...c,
      apiKey: obfuscate(c.apiKey)
    }))
  }));

  useEffect(() => {
    if (!activeDocumentItem?.id) return;

    const handleClipboardUpdated = () => {
      void loadLatestDocumentItem(activeDocumentItem.id, activeDocumentItem).then((latestItem) => {
        if (latestItem) {
          setActiveDocumentItem(latestItem);
        }
      });
    };

    window.addEventListener('clipboard-updated', handleClipboardUpdated);
    return () => window.removeEventListener('clipboard-updated', handleClipboardUpdated);
  }, [activeDocumentItem, activeLibraryId]);

  useEffect(() => {
    setMountedViews((prev) => (prev[currentView] ? prev : { ...prev, [currentView]: true }));
  }, [currentView]);

  const navigateToView = (view: ViewType) => {
    if (view === currentView) return;
    startTransition(() => {
      setCurrentView(view);
    });
  };

  const handleOpenDocumentEditor = async (item: ClipboardItem, tagIndex = 0) => {
    if (!item) return;

    const latestItem = await loadLatestDocumentItem(item.id, item);
    setActiveDocumentItem(latestItem || item);
    setDocumentFocusTagIndex(tagIndex);
    startTransition(() => {
      setCurrentView(ViewType.DOCUMENT_EDITOR);
    });
  };

  const handleReturnToClipboard = () => {
    if (currentView === ViewType.DOCUMENT_EDITOR && documentEditorBackHandlerRef.current) {
      void documentEditorBackHandlerRef.current();
      return;
    }
    setCurrentView(ViewType.CLIPBOARD);
  };

  useBootstrapConfig({
    activeLibraryId,
    sanitizeVisibleClipboardCategories,
    setSettings,
    setTranslationSettings,
    setLibraries,
    setClipboardCategories,
    setShowFirstRunPrompt,
    setOfficialPromptStorageKey,
    setNotification,
  });

  const { handleExportData, handleImportData, importOfficialLibrary } = useImportExport({
    shortcuts: [],  // Android 版无快捷启动
    settings,
    translationSettings,
    libraries,
    activeLibraryId,
    setActiveLibraryId,
    clipboardCategories,
    sanitizeVisibleClipboardCategories,
    handleUpdateCategories,
    setShortcuts: () => {},
    setSettings,
    setTranslationSettings,
    setLibraries,
    setCurrentView,
    setNotification,
    t,
  });

  // Event Listeners
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  const showBottomNav = currentView !== ViewType.DOCUMENT_EDITOR && currentView !== ViewType.CLIPBOARD_MANAGER;

  return (
    <AppErrorBoundary>
    <div className="h-screen w-screen overflow-hidden bg-[#09090B] flex flex-col">
      {/* 背景层 */}
      <div className="fixed inset-0 bg-[#09090B] z-[-1] pointer-events-none" aria-hidden="true" />
      
      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden relative pb-[64px]">
        {mountedViews[ViewType.CLIPBOARD] && (
          <div className={currentView === ViewType.CLIPBOARD ? ACTIVE_CONTAINER : INACTIVE_CONTAINER}>
            <ClipboardView
              onNavigate={navigateToView}
              language={settings.language}
              categories={clipboardCategories}
              onUpdateCategories={handleUpdateCategories}
              onUpdateSetting={(k, v) => setSettings(p => ({ ...p, [k]: v }))}
              isPinned={false}
              pasteTagsWithComma={settings.pasteTagsWithComma}
              pasteContentWithTags={settings.pasteContentWithTags}
              bilingualTagsEnabled={settings.bilingualTagsEnabled}
              translationSettings={translationSettings}
              onOpenManager={() => navigateToView(ViewType.CLIPBOARD_MANAGER)}
              activeLibraryId={activeLibraryId}
              libraries={libraries}
              onSwitchLibrary={setActiveLibraryId}
              onAddLibrary={addLibrary}
              onOpenEditor={handleOpenDocumentEditor}
            />
          </div>
        )}

        {mountedViews[ViewType.SETTINGS] && (
          <div className={currentView === ViewType.SETTINGS ? ACTIVE_CONTAINER : INACTIVE_CONTAINER}>
            <SettingsView
              settings={settings}
              translationSettings={translationSettings}
              shortcutsActive={false}
              onToggleShortcuts={() => {}}
              onUpdateSetting={(k, v) => setSettings(p => ({ ...p, [k]: v }))}
              onUpdateTranslationSettings={setTranslationSettings}
              onNavigate={navigateToView}
              onExportData={handleExportData}
              onImportData={handleImportData}
              initialTab={settingsInitialTab}
              hideBack={true}
              onOpenActivationModal={() => navigateToView(ViewType.ACTIVATION)}
            />
          </div>
        )}

        {mountedViews[ViewType.CHAT] && (
          <div className={currentView === ViewType.CHAT ? ACTIVE_CONTAINER : INACTIVE_CONTAINER}>
            <ChatView
              settings={translationSettings}
              language={settings.language}
              initialText={chatContext?.text}
              initialType={chatContext?.type}
              actionId={chatContext?.actionId}
              requestTimestamp={chatContext?.requestTimestamp}
              isActive={currentView === ViewType.CHAT}
              onNavigate={navigateToView}
              onNavigateToSettings={(tab) => { setSettingsInitialTab(tab); navigateToView(ViewType.SETTINGS); }}
              hideBack={true}
            />
          </div>
        )}

        {currentView === ViewType.CLIPBOARD_MANAGER && (
          <ClipboardManagerView
            onNavigate={navigateToView}
            language={settings.language}
            clipboardCategories={clipboardCategories}
            onUpdateClipboardCategories={handleUpdateCategories}
            onUpdateSetting={(k, v) => setSettings(p => ({ ...p, [k]: v }))}
            libraries={libraries}
            activeLibraryId={activeLibraryId}
            onSwitchLibrary={setActiveLibraryId}
            onAddLibrary={addLibrary}
            onRenameLibrary={renameLibrary}
            onRemoveLibrary={removeLibrary}
          />
        )}

        {currentView === ViewType.ACTIVATION && (
          <div className={ACTIVE_CONTAINER}>
            <ActivationView
              onNavigate={navigateToView}
            />
          </div>
        )}

        {currentView === ViewType.DOCUMENT_EDITOR && (
          activeDocumentItem ? (
            <DocumentEditorView
              item={activeDocumentItem}
              tagIndex={documentFocusTagIndex}
              onNavigate={navigateToView}
              onRegisterBackHandler={(handler) => {
                documentEditorBackHandlerRef.current = handler;
              }}
              activeLibraryId={activeLibraryId}
              language={settings.language}
              translationSettings={translationSettings}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#09090B] text-white/40">
              <p>文档加载失败，请重试</p>
              <button
                onClick={handleReturnToClipboard}
                className="mt-4 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
              >
                返回
              </button>
            </div>
          )
        )}
      </div>

      {/* 底部导航栏 */}
      {showBottomNav && (
        <nav className="fixed bottom-0 left-0 right-0 h-[64px] bg-[#121214] border-t border-white/5 flex items-center justify-around z-[200]">
          {TAB_ITEMS.map((tab) => {
            const isActive = currentView === tab.view;
            const tabTitle = t[tab.title as keyof typeof t] ?? '';

            return (
              <button
                key={tab.key}
                onClick={() => navigateToView(tab.view)}
                className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${isActive ? 'text-white' : 'text-white/50'}`}
              >
                {tab.icon === 'favorite' ? (
                  <Icon name="favorite" size={24} fill={isActive ? "currentColor" : "none"} className={isActive ? 'text-white' : 'text-white/50'} />
                ) : tab.icon === 'chat' ? (
                  <Icon name="forum" size={24} fill={isActive ? "currentColor" : "none"} className={isActive ? 'text-white' : 'text-white/50'} />
                ) : (
                  <Icon name="hexagon" size={24} fill={isActive ? "currentColor" : "none"} className={isActive ? 'text-white' : 'text-white/50'} />
                )}
                <span className="text-[10px] mt-1">{tabTitle}</span>
              </button>
            );
          })}
        </nav>
      )}

      <Notification
        isOpen={notification.isOpen}
        onClose={() => setNotification({ ...notification, isOpen: false })}
        type={notification.type}
        title={notification.title}
        message={notification.message}
      />

      {/* First Run Import Prompt Modal */}
      {showFirstRunPrompt && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 transition-opacity duration-300">
          <div className="bg-[#121214] border border-white/10 rounded-2xl w-[320px] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-[20px] border border-white/10 bg-[#070b14] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-[#0A84FF]/10">
                <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path
                    d="M17 5.5C15.92 10.58 13.79 13.53 10.95 15.59C9.57 16.59 8 17.36 6 18C8 18.64 9.57 19.41 10.95 20.41C13.79 22.47 15.92 25.42 17 30.5C18.08 25.42 20.21 22.47 23.05 20.41C24.43 19.41 26 18.64 28 18C26 17.36 24.43 16.59 23.05 15.59C20.21 13.53 18.08 10.58 17 5.5Z"
                    fill="url(#firstRunStarGradient)"
                  />
                  <defs>
                    <linearGradient id="firstRunStarGradient" x1="8.5" y1="7" x2="25.5" y2="29" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#26F4E9" />
                      <stop offset="1" stopColor="#1688FF" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <h2 className="text-xl font-medium tracking-wide text-white mb-2">{t.first_run_title}</h2>
              <p className="text-[13px] text-white/60 mb-6 leading-relaxed">
                {t.first_run_desc}
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={async () => {
                    try {
                      const ok = await importOfficialLibrary(
                        true,
                        true,
                        false
                      );
                      localStorage.setItem(officialPromptStorageKey, LOCAL_STORAGE_TRUE);
                      setShowFirstRunPrompt(false);
                      if (ok) {
                        setNotification({ isOpen: true, type: 'success', title: t.import_success_title, message: t.import_success_msg });
                      } else {
                        setNotification({ isOpen: true, type: 'error', title: t.import_failed_title, message: t.import_error_msg });
                      }
                    } catch (e: any) {
                      setNotification({ isOpen: true, type: 'error', title: t.import_failed_title, message: String(e) });
                      setShowFirstRunPrompt(false);
                      localStorage.setItem(officialPromptStorageKey, LOCAL_STORAGE_TRUE);
                    }
                  }}
                  className="w-full py-3 bg-[#0A84FF] hover:bg-[#007AFF] text-white font-medium rounded-xl transition-colors"
                >
                  {t.first_run_import}
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem(officialPromptStorageKey, LOCAL_STORAGE_TRUE);
                    setShowFirstRunPrompt(false);
                  }}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white font-medium rounded-xl transition-colors"
                >
                  {t.first_run_skip}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </AppErrorBoundary>
  );
};

export default App;
