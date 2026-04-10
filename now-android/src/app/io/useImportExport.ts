import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import * as XLSX from 'xlsx';
import { ViewType, type AppSettings, type TranslationSettings, type ShortcutItem } from '../../types';
import { logger, mergeShortcutsAppendUnique, normalizeShortcutItems } from '../../utils';
import { normalizeLegacyCardText } from '../../utils/cardContent';

type Library = { id: string; name: string };

type NotificationState = {
  isOpen: boolean;
  type: 'success' | 'error' | 'info';
  title: string;
  message?: string;
};

type UseImportExportArgs = {
  shortcuts: ShortcutItem[];
  settings: AppSettings;
  translationSettings: TranslationSettings;
  libraries: Library[];
  activeLibraryId: string;
  setActiveLibraryId: Dispatch<SetStateAction<string>>;
  clipboardCategories: string[];
  sanitizeVisibleClipboardCategories: (raw: unknown) => string[];
  handleUpdateCategories: (cats: string[]) => void;
  setShortcuts: Dispatch<SetStateAction<ShortcutItem[]>>;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setTranslationSettings: Dispatch<SetStateAction<TranslationSettings>>;
  setLibraries: Dispatch<SetStateAction<Library[]>>;
  setCurrentView: Dispatch<SetStateAction<ViewType>>;
  setNotification: Dispatch<SetStateAction<NotificationState>>;
  t: any;
};

type PickedFileBytes = {
  path: string;
  bytes: number[];
};

const generateImportItemId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const parseCsvRows = (input: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  rows.push(row);

  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c.length > 0));
};

const parseSpreadsheetRows = (picked: PickedFileBytes): string[][] => {
  const ext = picked.path.split('.').pop()?.toLowerCase() || '';
  const rawBytes = new Uint8Array(picked.bytes);

  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(rawBytes, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const firstSheet = workbook.Sheets[firstSheetName];
    if (!firstSheet) return [];

    const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
      header: 1,
      raw: false,
      defval: '',
    });

    return rows
      .map((row) => row.map((cell) => String(cell ?? '').trim()))
      .filter((row) => row.some((cell) => cell.length > 0));
  }

  // CSV: prefer UTF-8; fallback to gb18030 for common Excel exports on Chinese Windows.
  let csvText = '';
  try {
    csvText = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  } catch {
    csvText = new TextDecoder('gb18030').decode(rawBytes);
  }
  return parseCsvRows(csvText);
};

const normalizeHeader = (header: string) => header.replace(/\uFEFF/g, '').replace(/\s+/g, '').toLowerCase();

const splitTagValues = (raw: string) =>
  raw
    .split(/[,\n，、；;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const asNonEmptyString = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : '';
};

const toCsvCell = (value: unknown) => {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const parseBaseTitleAndContent = (rawContent: string) => {
  const source = String(rawContent || '').trim();
  if (!source) {
    return {
      title: '',
      content: '',
    };
  }

  // Highest-priority legacy delimiter: "title\t,\tbody"
  const legacyParts = source.split(/\t+\s*,\s*\t+/, 2);
  if (legacyParts.length === 2 && legacyParts[0].trim() && legacyParts[1].trim()) {
    return {
      title: legacyParts[0].trim(),
      content: legacyParts[1].trim(),
    };
  }

  const normalized = normalizeLegacyCardText(source).trim();

  const commaMatch = normalized.match(/^([^\n,\uFF0C]{1,40}?)\s*([,\uFF0C])\s*([\s\S]+)$/);
  const colonMatch = normalized.match(/^([^\n:\uFF1A,\uFF0C]{1,28}?)\s*([:\uFF1A])\s*([\s\S]+)$/);
  const firstCommaIdx = normalized.search(/[,\uFF0C]/);
  const firstColonIdx = normalized.search(/[:\uFF1A]/);

  if (
    commaMatch
    && commaMatch[3].trim()
    && firstCommaIdx >= 0
    && (firstColonIdx < 0 || firstCommaIdx < firstColonIdx)
  ) {
    return {
      title: commaMatch[1].trim(),
      content: commaMatch[3].trim(),
    };
  }

  if (colonMatch && colonMatch[3].trim()) {
    return {
      title: colonMatch[1].trim(),
      content: colonMatch[3].trim(),
    };
  }

  if (commaMatch && commaMatch[3].trim()) {
    return {
      title: commaMatch[1].trim(),
      content: commaMatch[3].trim(),
    };
  }

  return {
    title: '',
    content: normalized,
  };
};

const inferBaseTitle = (content: string, fallbackTags: unknown) => {
  if (Array.isArray(fallbackTags)) {
    const firstTag = fallbackTags.find((tag) => typeof tag === 'string' && tag.trim().length > 0);
    if (typeof firstTag === 'string' && firstTag.trim()) return firstTag.trim();
  }

  const firstLine = (content || '').split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() || '';
  if (!firstLine) return '';

  const byPunctuation = firstLine.split(/[，,。！？!?；;:：]/)[0]?.trim() || '';
  const candidate = byPunctuation || firstLine;
  return candidate.slice(0, 28).trim();
};

export const useImportExport = ({
  shortcuts,
  settings,
  translationSettings,
  libraries,
  activeLibraryId,
  setActiveLibraryId,
  clipboardCategories,
  sanitizeVisibleClipboardCategories,
  handleUpdateCategories,
  setShortcuts,
  setSettings,
  setTranslationSettings,
  setLibraries,
  setCurrentView,
  setNotification,
  t,
}: UseImportExportArgs) => {
  const getOfficialImportErrorMessage = useCallback((error: unknown) => {
    const raw = String(error ?? '');
    const lower = raw.toLowerCase();
    const isSeedMissing =
      lower.includes('official seed package not found')
      || (lower.includes('app_config.json') && lower.includes('not found'))
      || (lower.includes('clipboard_data') && lower.includes('not found'));

    if (!isSeedMissing) return raw;

    return settings.language === 'zh'
      ? '官方种子包缺失或结构不完整，请检查 src-tauri/resources/official_seed 下是否包含 app_config.json 和 clipboard_data。'
      : 'Official seed package is missing or invalid. Please ensure src-tauri/resources/official_seed contains app_config.json and clipboard_data.';
  }, [settings.language]);

  const importOfficialLibrary = useCallback(async (
    importCards = true,
    importShortcuts = true,
    showNotification = true,
  ) => {
    try {
      const importedShortcutsRaw = await invoke<string>('db_import_official_seed', {
        importCards,
        importShortcuts,
      });

      if (importShortcuts) {
        const importedShortcuts = JSON.parse(importedShortcutsRaw);
        if (Array.isArray(importedShortcuts)) {
          setShortcuts((prev) => mergeShortcutsAppendUnique(prev, importedShortcuts));
        }
      }

      if (importCards) {
        // Official seed cards are always imported into the default library.
        // Switch to default and align visible categories/tab so users can see imported cards immediately.
        setActiveLibraryId('default');
        try {
          const defaultItemsJson = await invoke<string>('db_load_items', { libraryId: 'default' });
          const parsedDefaultItems = JSON.parse(defaultItemsJson);
          const defaultItems = Array.isArray(parsedDefaultItems) ? parsedDefaultItems : [];
          const importedCategories = Array.from(
            new Set(
              defaultItems
                .map((item: any) => (typeof item?.category === 'string' ? item.category.trim() : ''))
                .filter(Boolean)
                .filter((cat) => !/^all$/i.test(cat) && !/^history$/i.test(cat))
            )
          );
          const nextDefaultCategories = sanitizeVisibleClipboardCategories(importedCategories);
          localStorage.setItem('clipboard_categories', JSON.stringify(nextDefaultCategories));
          if (nextDefaultCategories.length > 0) {
            localStorage.setItem('clipboard_active_tab', nextDefaultCategories[0]);
          }
          if (activeLibraryId === 'default') {
            handleUpdateCategories(nextDefaultCategories);
          }
        } catch (categorySyncError) {
          logger.warn('[Import] Failed to sync default categories after official import:', categorySyncError);
        }

        window.dispatchEvent(new CustomEvent('clipboard-updated'));
        setCurrentView(ViewType.CLIPBOARD);
      }

      if (showNotification) {
        setNotification({
          isOpen: true,
          type: 'success',
          title: t.import_success_title,
          message: t.import_success_msg,
        });
      }

      return true;
    } catch (e) {
      if (showNotification) {
        setNotification({
          isOpen: true,
          type: 'error',
          title: t.import_failed_title,
          message: getOfficialImportErrorMessage(e),
        });
      }
      return false;
    }
  }, [activeLibraryId, getOfficialImportErrorMessage, handleUpdateCategories, sanitizeVisibleClipboardCategories, setActiveLibraryId, setCurrentView, setNotification, setShortcuts, t.import_failed_title, t.import_success_msg, t.import_success_title]);

  const handleExportData = useCallback(async (type: 'ALL' | 'CLIPBOARD' | 'TABLE') => {
    if (type === 'TABLE') {
      try {
        const itemsJson = await invoke<string>('db_load_items', { libraryId: activeLibraryId });
        const items = JSON.parse(itemsJson);
        const activeLibraryName = libraries.find((lib) => lib.id === activeLibraryId)?.name || activeLibraryId;
        const header = ['库名', '组名', '卡片样式', '标题', '内容'];
        const lines = [header.map(toCsvCell).join(',')];

        for (const item of items) {
          const groupName = String(item?.category || '').trim() || (settings.language === 'zh' ? '未分组' : 'Ungrouped');
          if (String(item?.type || '').toUpperCase() === 'TAGS') {
            const tags = Array.isArray(item?.tags) ? item.tags.map((t: any) => String(t).trim()).filter(Boolean) : [];
            const title = tags[0] || '';
            const content = tags.length > 1 ? tags.slice(1).join(', ') : String(item?.content || '').trim();
            lines.push([activeLibraryName, groupName, 'tags', title, content].map(toCsvCell).join(','));
            continue;
          }

          const rawContent = String(item?.content || '');
          const structuredTitle = typeof item?.title === 'string' ? item.title.trim() : '';
          const structuredBody = typeof item?.body === 'string' ? item.body.trim() : '';
          const parsed = parseBaseTitleAndContent(rawContent);
          const title = structuredTitle || parsed.title || inferBaseTitle(structuredBody || parsed.content, item?.tags);
          const content = structuredBody || parsed.content;
          lines.push([activeLibraryName, groupName, 'base', title, content].map(toCsvCell).join(','));
        }

        const csvContent = `\uFEFF${lines.join('\r\n')}\r\n`;
        const ok = await invoke<boolean>('save_file', {
          content: csvContent,
          filename: 'now_cards_export.csv',
        });
        if (!ok) return;

        setNotification({
          isOpen: true,
          type: 'success',
          title: t.import_success_title,
          message: settings.language === 'zh' ? `导出成功，共 ${Math.max(lines.length - 1, 0)} 条` : `Exported ${Math.max(lines.length - 1, 0)} rows`,
        });
      } catch (e) {
        setNotification({
          isOpen: true,
          type: 'error',
          title: t.import_failed_title,
          message: settings.language === 'zh' ? '导出 CSV 失败' : 'CSV export failed',
        });
      }
      return;
    }

    if (type === 'CLIPBOARD') {
      const folderPath = await invoke<string | null>('select_folder');
      if (!folderPath) return;

      await Promise.all(libraries.map(async (lib) => {
        const itemsJson = await invoke<string>('db_load_items', { libraryId: lib.id });
        const items = JSON.parse(itemsJson);
        const catsJson = localStorage.getItem(lib.id === 'default' ? 'clipboard_categories' : `clipboard_categories_${lib.id}`) || '["历史"]';
        const cats: string[] = JSON.parse(catsJson);
        const groups: Record<string, string[]> = {};
        cats.forEach((c) => { groups[c] = []; });

        items.forEach((item: any) => {
          const c = item.category || (cats[0] || '默认分类');
          if (!groups[c]) groups[c] = [];
          let content = item.content;
          if (item.tags && item.tags.length > 0) {
            content += `\n\nTags: ${item.tags.join(', ')}`;
          }
          groups[c].push(content);
        });
      }));

      const library = libraries.find((l) => l.id === activeLibraryId);
      if (!library) return;

      try {
        await invoke('export_markdown_files', {
          basePath: folderPath,
          libraryId: activeLibraryId,
          libraryName: library.name,
        });
        setNotification({
          isOpen: true,
          type: 'success',
          title: '导出成功！',
          message: '剪贴板数据已导出',
        });
      } catch (e) {
        setNotification({
          isOpen: true,
          type: 'error',
          title: '导出失败',
          message: String(e),
        });
      }
      return;
    }

    try {
      const basePath = await invoke<string | null>('select_folder');
      if (!basePath) return;

      const now = new Date();
      const folderName = `Now_Backup_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

      const appConfig = {
        shortcuts,
        settings,
        translationSettings,
        libraries,
        clipboardCategories: libraries.reduce((acc, lib) => {
          const key = lib.id === 'default' ? 'clipboard_categories' : `clipboard_categories_${lib.id}`;
          const raw = (() => {
            try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
          })();
          acc[lib.id] = sanitizeVisibleClipboardCategories(raw);
          return acc;
        }, {} as Record<string, string[]>),
        version: '1.5',
      };

      await invoke('export_full_backup', {
        basePath,
        folderName,
        appConfigJson: JSON.stringify(appConfig, null, 2),
        libraries: libraries.map((lib) => ({ id: lib.id, name: lib.name })),
      });

      setNotification({
        isOpen: true,
        type: 'success',
        title: '导出成功！',
        message: `数据已导出至：${folderName}`,
      });
    } catch (e) {
      setNotification({
        isOpen: true,
        type: 'error',
        title: '导出失败',
        message: String(e),
      });
    }
  }, [
    activeLibraryId,
    libraries,
    sanitizeVisibleClipboardCategories,
    setNotification,
    settings,
    shortcuts,
    translationSettings,
  ]);

  const handleImportData = useCallback(async (type: 'ALL' | 'CLIPBOARD' | 'OFFICIAL' | 'TABLE') => {
    if (type === 'OFFICIAL') {
      await importOfficialLibrary(true, true, true);
      return;
    }

    if (type === 'TABLE') {
      try {
        const pickedFile = await invoke<PickedFileBytes | null>('read_file_bytes');
        if (!pickedFile) return;

        const rows = parseSpreadsheetRows(pickedFile);
        if (rows.length < 2) {
          setNotification({
            isOpen: true,
            type: 'error',
            title: t.import_failed_title,
            message: settings.language === 'zh' ? '表格内容为空或行数不足' : 'Table is empty or has too few rows',
          });
          return;
        }

        const headers = rows[0];
        const headerIndexMap = new Map(headers.map((h, idx) => [normalizeHeader(h), idx]));

        const groupCol =
          headerIndexMap.get('组名')
          ?? headerIndexMap.get('group');
        const styleCol =
          headerIndexMap.get('卡片样式')
          ?? headerIndexMap.get('样式')
          ?? headerIndexMap.get('style');
        const titleCol =
          headerIndexMap.get('标题')
          ?? headerIndexMap.get('title');
        const payloadCol =
          headerIndexMap.get('内容')
          ?? headerIndexMap.get('content');
        const rawContentCol =
          headerIndexMap.get('原始内容')
          ?? headerIndexMap.get('rawcontent')
          ?? headerIndexMap.get('raw_content')
          ?? headerIndexMap.get('raw');

        if (groupCol == null || styleCol == null || titleCol == null || payloadCol == null) {
          setNotification({
            isOpen: true,
            type: 'error',
            title: t.import_failed_title,
            message: settings.language === 'zh'
              ? '表头缺失：需要“组名、卡片样式、标题、内容”四列'
              : 'Missing headers: 组名, style, title, and content are required',
          });
          return;
        }

        const importCategory = settings.language === 'zh' ? '表格导入' : 'Table Import';
        const now = Date.now();
        const importedItems: any[] = [];
        let skippedRows = 0;

        for (let i = 1; i < rows.length; i += 1) {
          const row = rows[i];
          const groupName = (row[groupCol] || '').trim() || importCategory;
          const styleRaw = (row[styleCol] || '').trim().toLowerCase();
          const title = (row[titleCol] || '').trim();
          const payload = (row[payloadCol] || '').trim();
          const rawContentFromTable = rawContentCol != null ? asNonEmptyString(row[rawContentCol]) : '';

          if (!groupName && !styleRaw && !title && !payload) {
            skippedRows += 1;
            continue;
          }

          const isBase = styleRaw === 'base' || styleRaw === '内容卡' || styleRaw === 'content';
          const isTags = styleRaw === 'tags' || styleRaw === 'tag' || styleRaw === '标签卡' || styleRaw === '标签';

          if (!isBase && !isTags) {
            skippedRows += 1;
            continue;
          }

          if (isBase) {
            const finalContent = rawContentFromTable || (title && payload ? `${title}: ${payload}` : (payload || title));
            if (!finalContent) {
              skippedRows += 1;
              continue;
            }

            importedItems.push({
              id: generateImportItemId(),
              content: finalContent,
              title: title || undefined,
              body: payload || undefined,
              type: 'TEXT',
              isPinned: false,
              timestamp: now + i,
              category: groupName,
              tags: [],
            });
            continue;
          }

          const tagValues = splitTagValues(payload);
          const tags = title
            ? [title, ...tagValues.filter((v) => v !== title)]
            : tagValues;
          if (tags.length === 0) {
            skippedRows += 1;
            continue;
          }

          importedItems.push({
            id: generateImportItemId(),
            content: tags.join(', '),
            type: 'TAGS',
            isPinned: false,
            timestamp: now + i,
            category: groupName,
            tags,
          });
        }

        if (importedItems.length === 0) {
          setNotification({
            isOpen: true,
            type: 'error',
            title: t.import_failed_title,
            message: settings.language === 'zh'
              ? '没有可导入的数据，请检查样式列是否为 base/tags'
              : 'No importable rows found, please check style values base/tags',
          });
          return;
        }

        const currentJson = await invoke<string>('db_load_items', { libraryId: activeLibraryId });
        let currentItems = JSON.parse(currentJson);
        const importedKeySet = new Set(importedItems.map((item) => `${item.type}::${item.content.trim()}`));
        currentItems = currentItems.filter((item: any) => !importedKeySet.has(`${item.type}::${String(item.content || '').trim()}`));
        const combined = [...currentItems, ...importedItems];

        await invoke('db_save_items', {
          itemsJson: JSON.stringify(combined),
          libraryId: activeLibraryId,
        });

        const importedCategories = importedItems
          .map((item) => String(item.category || '').trim())
          .filter(Boolean);
        const uniqueCats = Array.from(new Set([...clipboardCategories, ...importedCategories]));
        handleUpdateCategories(uniqueCats);

        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('clipboard-updated'));
        }, 100);

        const message = settings.language === 'zh'
          ? `导入成功 ${importedItems.length} 条，跳过 ${skippedRows} 条`
          : `Imported ${importedItems.length}, skipped ${skippedRows}`;
        setNotification({
          isOpen: true,
          type: 'success',
          title: t.import_success_title,
          message,
        });
      } catch (e) {
        setNotification({
          isOpen: true,
          type: 'error',
          title: t.import_failed_title,
          message: settings.language === 'zh' ? '表格导入失败，请检查 CSV/XLSX 文件格式' : 'Table import failed, please check CSV/XLSX format',
        });
      }
      return;
    }

    if (type === 'ALL') {
      try {
        logger.log('[Import] Starting import process...');
        const folderPath = await invoke<string | null>('select_folder');
        logger.log('[Import] Selected folder:', folderPath);
        if (!folderPath) return;

        const rawData = await invoke<string>('read_full_backup', { folderPath });
        const backup = JSON.parse(rawData);
        const data = JSON.parse(backup.app_config_json);

        if (data.shortcuts) setShortcuts(normalizeShortcutItems(data.shortcuts));
        if (data.settings) setSettings((p) => ({ ...p, ...data.settings }));
        if (data.translationSettings) setTranslationSettings((p) => ({ ...p, ...data.translationSettings }));

        if (data.libraries) {
          setLibraries(data.libraries);
          localStorage.setItem('clipboard_libraries', JSON.stringify(data.libraries));
        }

        if (data.clipboardCategories) {
          Object.entries(data.clipboardCategories).forEach(([libId, cats]) => {
            const key = libId === 'default' ? 'clipboard_categories' : `clipboard_categories_${libId}`;
            const nextCats = sanitizeVisibleClipboardCategories(cats);
            localStorage.setItem(key, JSON.stringify(nextCats));
          });
        }

        if (backup.libraries) {
          for (const lib of backup.libraries) {
            let match = data.libraries?.find((l: any) => l.name === lib.name);
            if (!match && data.libraries) {
              const sanitizeFileName = (name: string) =>
                name
                  .split('')
                  .map((c) => ((/[a-zA-Z0-9_\- ]/.test(c) || c.charCodeAt(0) > 127) ? c : '_'))
                  .join('');
              match = data.libraries.find((l: any) => sanitizeFileName(l.name) === lib.name);
            }
            const libId = match ? match.id : 'default';
            await invoke('db_save_items', { itemsJson: lib.full_json, libraryId: libId });
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
        window.dispatchEvent(new CustomEvent('clipboard-updated'));
        setCurrentView(ViewType.CLIPBOARD);
        setNotification({
          isOpen: true,
          type: 'success',
          title: t.import_success_title,
          message: t.import_all_success_msg,
        });
        return;
      } catch (e) {
        setNotification({
          isOpen: true,
          type: 'error',
          title: t.import_failed_title,
          message: String(e),
        });
        return;
      }
    }

    logger.log('[Import] Starting CLIPBOARD import from folder...');
    const rawContent = await invoke<string | null>('read_folder_markdown_files');
    if (!rawContent) return;

    try {
      const mdFiles = JSON.parse(rawContent);
      const importedItems: any[] = [];

      for (const file of mdFiles) {
        const category = file.filename;
        const content = file.content;
        const cleanedContent = content.replace(/^###\s+.+?\n+/, '');
        const paragraphs = cleanedContent.split(/\n\s*\n/).filter((p: string) => p.trim());
        for (const paragraph of paragraphs) {
          const text = paragraph.trim();
          if (text && !text.startsWith('#')) {
            importedItems.push({
              id: Date.now().toString() + Math.random().toString().slice(2, 8),
              content: text,
              type: text.startsWith('http') ? 'LINK' : (text.includes('{') || text.includes('function') ? 'CODE' : 'TEXT'),
              isPinned: false,
              timestamp: Date.now(),
              category,
            });
          }
        }
      }

      if (importedItems.length > 0) {
        const currentJson = await invoke<string>('db_load_items', { libraryId: activeLibraryId });
        let currentItems = JSON.parse(currentJson);
        const importedContentSet = new Set(importedItems.map((i: any) => i.content.trim()));
        currentItems = currentItems.filter((i: any) => !importedContentSet.has(i.content.trim()));
        const combined = [...currentItems, ...importedItems];

        await invoke('db_save_items', {
          itemsJson: JSON.stringify(combined),
          libraryId: activeLibraryId,
        });

        const importedCats = Array.from(new Set(importedItems.map((i) => i.category)));
        const uniqueCats = Array.from(new Set([...clipboardCategories, ...importedCats]));
        handleUpdateCategories(uniqueCats);

        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('clipboard-updated'));
        }, 100);
        setNotification({
          isOpen: true,
          type: 'success',
          title: t.import_success_title,
          message: settings.language === 'zh'
            ? `${importedItems.length}${t.import_clipboard_success_msg}`
            : `${importedItems.length} ${t.import_clipboard_success_msg}`,
        });
      } else {
        setNotification({
          isOpen: true,
          type: 'error',
          title: t.import_failed_title,
          message: t.import_empty_msg,
        });
      }
    } catch (e) {
      setNotification({
        isOpen: true,
        type: 'error',
        title: t.import_failed_title,
        message: t.import_error_msg,
      });
    }
  }, [
    activeLibraryId,
    clipboardCategories,
    handleUpdateCategories,
    sanitizeVisibleClipboardCategories,
    importOfficialLibrary,
    setLibraries,
    setNotification,
    setSettings,
    setTranslationSettings,
    settings.language,
    t,
  ]);

  return { handleExportData, handleImportData, importOfficialLibrary };
};






