
import {
    AppSettings,
    ClipboardItem,
    ShortcutAction,
    ShortcutItem,
    TranslationSettings,
} from './types';

export const detectType = (str: string | undefined): 'URL' | 'APP' | 'TEXT' => {
    if (!str) return 'TEXT';
    const trimmed = str.trim();
    if (!trimmed) return 'TEXT';

    // URL Check (matches http/s or common domain patterns or .url files)
    const isUrl = /^(https?:\/\/|[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/.test(trimmed) ||
        trimmed.toLowerCase().endsWith('.url');
    if (isUrl) return 'URL';

    // File Path Check (Absolute path for Win/Mac or ends with executable ext)
    const isPath = /^[a-zA-Z]:\\/.test(trimmed) ||
        /^\//.test(trimmed) ||
        /\.(exe|lnk|app|bat|cmd|sh)$/i.test(trimmed);
    if (isPath) return 'APP';

    return 'TEXT';
};

export const getItemType = (item: ShortcutItem): 'URL' | 'APP' | 'TEXT' | 'GROUP' => {
    if (item.type === 'GROUP' || (Array.isArray(item.actions) && item.actions.length > 0)) return 'GROUP';
    // Legacy fix: path ending in .url is URL
    if (item.path?.toLowerCase().endsWith('.url')) return 'URL';

    if (item.type) return item.type;
    if (item.textPayload) return 'TEXT';


    return detectType(item.path || '');
};

export const normalizeShortcutAction = (action: Partial<ShortcutAction> | null | undefined, index = 0): ShortcutAction => {
    const normalizedType = action?.type || 'URL';
    return {
        id: action?.id || `action_${Date.now()}_${index}`,
        type: normalizedType,
        target: (action?.target || '').trim(),
        label: action?.label,
        repeatOpen: normalizedType === 'URL' ? Boolean(action?.repeatOpen) : false,
    };
};

export const normalizeShortcutItem = (item: Partial<ShortcutItem>): ShortcutItem => {
    const hasActions = Array.isArray(item.actions) && item.actions.length > 0;
    const normalizedActions = hasActions
        ? item.actions!.map((action, index) => normalizeShortcutAction(action, index)).filter((action) => action.target)
        : undefined;
    const isGroup = item.type === 'GROUP' || Boolean(normalizedActions?.length);

    return {
        id: item.id || Date.now().toString(),
        name: item.name || 'Untitled',
        type: isGroup ? 'GROUP' : item.type,
        path: isGroup ? undefined : item.path,
        textPayload: isGroup ? undefined : item.textPayload,
        actions: isGroup ? normalizedActions || [] : undefined,
        keys: item.keys || 'None',
        visible: item.visible ?? true,
        icon: item.icon,
        repeatOpen: isGroup ? true : Boolean(item.repeatOpen),
        justToggle: item.justToggle,
        isRunning: item.isRunning,
        instances: item.instances,
    };
};

export const normalizeShortcutItems = (items: unknown): ShortcutItem[] => {
    if (!Array.isArray(items)) return [];
    return items.map((item) => normalizeShortcutItem(item as Partial<ShortcutItem>));
};

const SHORTCUT_MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const;
const RESERVED_SYSTEM_SHORTCUTS = new Set([
    'ctrl+c',
    'ctrl+x',
    'ctrl+v',
    'ctrl+a',
    'ctrl+z',
    'ctrl+y',
    'meta+c',
    'meta+x',
    'meta+v',
    'meta+a',
    'meta+z',
    'meta+y',
    'meta+shift+z',
]);

const normalizeShortcutPart = (part: string): string => {
    const normalized = part.trim().toLowerCase();
    if (normalized === 'control') return 'ctrl';
    if (normalized === 'command' || normalized === 'cmd' || normalized === 'win' || normalized === 'super') return 'meta';
    if (normalized === 'option') return 'alt';
    return normalized;
};

export const canonicalizeShortcut = (shortcut?: string | null): string => {
    const parts = (shortcut || '')
        .split('+')
        .map(normalizeShortcutPart)
        .filter(Boolean);

    if (parts.length === 0) return '';

    const modifiers = new Set<string>();
    let key = '';

    parts.forEach((part) => {
        if ((SHORTCUT_MODIFIER_ORDER as readonly string[]).includes(part)) {
            modifiers.add(part);
            return;
        }
        key = part;
    });

    if (!key) return '';

    return [
        ...SHORTCUT_MODIFIER_ORDER.filter((part) => modifiers.has(part)),
        key,
    ].join('+');
};

export const isReservedSystemShortcut = (shortcut?: string | null): boolean =>
    RESERVED_SYSTEM_SHORTCUTS.has(canonicalizeShortcut(shortcut));

export const mergeShortcutsAppendUnique = (
    existing: unknown,
    incoming: unknown
): ShortcutItem[] => {
    const base = normalizeShortcutItems(existing);
    const additions = normalizeShortcutItems(incoming);
    const existingIds = new Set(base.map((item) => item.id));
    const existingKeys = new Set(
        base
            .map((item) => canonicalizeShortcut(item.keys))
            .filter(Boolean)
    );

    const merged = [...base];
    additions.forEach((item) => {
        const key = canonicalizeShortcut(item.keys);
        if (existingIds.has(item.id)) return;
        if (key && existingKeys.has(key)) return;
        merged.push(item);
        existingIds.add(item.id);
        if (key) existingKeys.add(key);
    });

    return merged;
};

type ShortcutBinding = {
    target: string;
    shortcut: string;
    clear: () => void;
};

export const resolveShortcutConflicts = (
    settings: AppSettings,
    translationSettings: TranslationSettings,
    preferredTarget?: string | null
): { settings: AppSettings; translationSettings: TranslationSettings } => {
    const nextSettings: AppSettings = { ...settings };
    const nextTranslationSettings: TranslationSettings = {
        ...translationSettings,
        customActions: (translationSettings.customActions || []).map((action) => ({ ...action })),
    };

    const bindings: ShortcutBinding[] = [
        { target: 'MAIN', shortcut: nextSettings.mainShortcut, clear: () => { nextSettings.mainShortcut = ''; } },
        { target: 'TOPMOST', shortcut: nextSettings.topMostKey || '', clear: () => { nextSettings.topMostKey = ''; } },
        { target: 'SCREENSHOT', shortcut: nextSettings.screenshotShortcut || '', clear: () => { nextSettings.screenshotShortcut = ''; } },
        { target: 'CLIPBOARD', shortcut: nextSettings.clipboardShortcut || '', clear: () => { nextSettings.clipboardShortcut = ''; } },
        { target: 'VOICE_INPUT', shortcut: nextSettings.voiceInputShortcut || '', clear: () => { nextSettings.voiceInputShortcut = ''; } },
        { target: 'EXPORT_ALL', shortcut: nextSettings.exportAllShortcut || '', clear: () => { nextSettings.exportAllShortcut = ''; } },
        { target: 'IMPORT_ALL', shortcut: nextSettings.importAllShortcut || '', clear: () => { nextSettings.importAllShortcut = ''; } },
        { target: 'EXPORT_CLIPBOARD', shortcut: nextSettings.exportClipboardShortcut || '', clear: () => { nextSettings.exportClipboardShortcut = ''; } },
        { target: 'IMPORT_CLIPBOARD', shortcut: nextSettings.importClipboardShortcut || '', clear: () => { nextSettings.importClipboardShortcut = ''; } },
        { target: 'QUICK_CHAT', shortcut: nextTranslationSettings.quickChatShortcut || '', clear: () => { nextTranslationSettings.quickChatShortcut = ''; } },
        { target: 'SELECTION', shortcut: nextTranslationSettings.selectionShortcut || '', clear: () => { nextTranslationSettings.selectionShortcut = ''; } },
        ...nextTranslationSettings.customActions.map((action) => ({
            target: action.id,
            shortcut: action.shortcut || '',
            clear: () => { action.shortcut = ''; },
        })),
    ];

    const preferredBinding = preferredTarget
        ? bindings.find((binding) => binding.target === preferredTarget)
        : undefined;
    const preferredKey = canonicalizeShortcut(preferredBinding?.shortcut);

    if (preferredBinding && preferredKey) {
        bindings.forEach((binding) => {
            if (binding.target !== preferredBinding.target && canonicalizeShortcut(binding.shortcut) === preferredKey) {
                binding.clear();
                binding.shortcut = '';
            }
        });
    }

    const owners = new Map<string, ShortcutBinding>();
    bindings.forEach((binding) => {
        const key = canonicalizeShortcut(binding.shortcut);
        if (!key) return;

        const previous = owners.get(key);
        if (previous) {
            previous.clear();
            previous.shortcut = '';
        }
        owners.set(key, binding);
    });

    return {
        settings: nextSettings,
        translationSettings: nextTranslationSettings,
    };
};

const SECRET = 'NOW_SECURE_SALT_2024';
const SEC_PREFIX = '__NOW_SEC__:';

/**
 * 简单的混淆逻辑，防止在 localStorage 中直接看到明�?API Key
 */
export const obfuscate = (text: string): string => {
    if (!text || text.startsWith(SEC_PREFIX)) return text || '';
    try {
        const chars = text.split('').map((c, i) =>
            String.fromCharCode(c.charCodeAt(0) ^ SECRET.charCodeAt(i % SECRET.length))
        );
        const encoded = btoa(unescape(encodeURIComponent(chars.join(''))));
        return `${SEC_PREFIX}${encoded}`;
    } catch (e) {
        console.error('Obfuscation failed:', e);
        return text;
    }
};

/**
 * 解混淆逻辑，支持旧版明文兼�?
 */
export const deobfuscate = (text: string): string => {
    if (!text || !text.startsWith(SEC_PREFIX)) return text || '';
    try {
        const raw = text.slice(SEC_PREFIX.length);
        const decoded = decodeURIComponent(escape(atob(raw)));
        const chars = decoded.split('').map((c, i) =>
            String.fromCharCode(c.charCodeAt(0) ^ SECRET.charCodeAt(i % SECRET.length))
        );
        return chars.join('');
    } catch (e) {
        console.warn('Deobfuscation failed, returning raw text:', e);
        return text;
    }
};

/**
 * 生产环境安全的日志工�?
 */
export const logger = {
    log: (..._args: any[]) => {
        if (process.env.NODE_ENV === 'development') {
            console.log(..._args);
        }
    },
    error: (...args: any[]) => {
        console.error(...args);
    },
    warn: (..._args: any[]) => {
        if (process.env.NODE_ENV === 'development') {
            console.warn(..._args);
        }
    },
    debug: (..._args: any[]) => {
        if (process.env.NODE_ENV === 'development') {
            console.debug(..._args);
        }
    }
};

/**
 * 解析剪贴板项的初始数据，抽离复杂逻辑
 */
export const parseClipboardItemInitialData = (item: ClipboardItem) => {
    let content = typeof item.body === 'string' ? item.body : item.content;
    let name = typeof item.title === 'string' ? item.title : '';

    if (!name && !content.startsWith('http')) {
        const match = content.match(/^([^:：\n]+)[:：]\s*([\s\S]*)$/);
        if (match) {
            name = match[1].trim();
            content = match[2];
        }
    }

    return {
        content,
        tags: item.tags || [],
        name,
        tab: (item.type === 'TAGS' ? 'TAGS' : 'CONTENT') as any
    };
};





