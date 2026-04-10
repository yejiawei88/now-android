export enum ViewType {
  HOME = 'HOME',
  SETTINGS = 'SETTINGS',
  TRANSLATION_SETTINGS = 'TRANSLATION_SETTINGS',
  MODEL_SETTINGS = 'MODEL_SETTINGS',
  CHAT = 'CHAT',
  TRANSLATE = 'TRANSLATE',
  ACTIVATION = 'ACTIVATION',
  CLIPBOARD = 'CLIPBOARD',
  CLIPBOARD_MANAGER = 'CLIPBOARD_MANAGER',
  DOCUMENT_EDITOR = 'DOCUMENT_EDITOR'
}

export interface ShortcutItem {
  id: string;
  name: string;
  type?: 'APP' | 'URL' | 'TEXT' | 'GROUP';
  path?: string;
  textPayload?: string;
  actions?: ShortcutAction[];
  keys: string;
  visible: boolean;
  icon?: string;
  repeatOpen?: boolean;
  justToggle?: boolean;
  isRunning?: boolean;
  instances?: number;
}

export type ShortcutActionType = 'URL' | 'FILE' | 'FOLDER' | 'APP' | 'TEXT';

export interface ShortcutAction {
  id: string;
  type: ShortcutActionType;
  target: string;
  label?: string;
  repeatOpen?: boolean;
}

export interface AppSettings {
  autoStart: boolean;
  runAsAdmin: boolean;
  runInBackground: boolean;
  hideTray: boolean;
  hideMainTaskbar: boolean;
  mainShortcut: string;
  topMostKey?: string;
  screenshotShortcut?: string;
  clipboardShortcut?: string;
  voiceInputShortcut?: string;
  exportAllShortcut?: string;
  importAllShortcut?: string;
  exportClipboardShortcut?: string;
  importClipboardShortcut?: string;
  pasteTagsWithComma: boolean;
  pasteContentWithTags: boolean;
  bilingualTagsEnabled: boolean;
  language?: 'zh' | 'en';
}

export interface CustomAction {
  id: string;
  name: string;
  prompt: string;
  shortcut: string;
  isSystem?: boolean;
}

export type TranslationProvider = 'YOUDAO' | 'GOOGLE' | 'BUILTIN' | 'API';

export interface ApiConfig {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  apiKey: string;
  verified?: boolean;
}

export type ApiProtocolType = 'OPENAI' | 'GEMINI';

export interface TranslationSettings {
  provider: TranslationProvider;
  endpoint: string;
  model: string;
  apiKey: string;
  youdaoAppKey?: string;
  youdaoAppSecret?: string;
  verified: boolean;
  quickChatShortcut?: string;
  selectionShortcut?: string;
  customActions: CustomAction[];
  savedConfigs: ApiConfig[];
  proxyUrl?: string;
}

export type ModalType = 'ADD' | 'EDIT' | 'ACTIVATION' | null;

export interface ClipboardItem {
  id: string;
  content: string;
  title?: string;
  body?: string;
  type: 'TEXT' | 'LINK' | 'CODE' | 'TAGS' | 'IMAGE' | 'DOCUMENT';
  isPinned: boolean;
  timestamp: number;
  category?: string;
  tags?: string[];
  documentContentLoaded?: boolean;
}
