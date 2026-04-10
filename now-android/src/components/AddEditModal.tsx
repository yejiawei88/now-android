import React, { useEffect, useState } from 'react';
import { ShortcutAction, ShortcutActionType, ShortcutItem } from '../types';
import { BackendService } from '../backend';
import { detectType, normalizeShortcutAction } from '../utils';
import { translations } from '../i18n';
import Icon from './Icon';
import { CustomSelect } from './CustomSelect';

interface AddEditModalProps {
  isOpen: boolean;
  language?: 'zh' | 'en';
  item?: ShortcutItem | null;
  onClose: () => void;
  onSave: (item: Partial<ShortcutItem>) => void;
}

type EditorMode = 'SINGLE' | 'GROUP';

const backend = BackendService.getInstance();

const GROUP_TYPE_OPTIONS: ShortcutActionType[] = ['URL', 'FILE', 'FOLDER', 'APP'];

const createGroupAction = (type: ShortcutActionType = 'URL'): ShortcutAction => ({
  id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  type,
  target: '',
  repeatOpen: type === 'URL',
});

const getActionTypeLabel = (
  type: ShortcutActionType,
  language: 'zh' | 'en' = 'zh',
  t: { modal_type_url: string; modal_type_app: string }
) => {
  if (type === 'URL') return t.modal_type_url;
  if (type === 'APP') return t.modal_type_app;

  const labels = language === 'zh'
    ? { FILE: '文件', FOLDER: '文件夹' }
    : { FILE: 'File', FOLDER: 'Folder' };

  return labels[type] ?? type;
};

const getLocalizedActionTypeLabel = (
  type: ShortcutActionType,
  language: 'zh' | 'en' = 'zh',
  t: { modal_type_url: string; modal_type_app: string }
) => {
  if (type === 'URL') return t.modal_type_url;
  if (type === 'APP') return t.modal_type_app;
  if (type === 'FILE') return language === 'zh' ? '\u6587\u4ef6' : 'File';
  if (type === 'FOLDER') return language === 'zh' ? '\u6587\u4ef6\u5939' : 'Folder';
  return type;
};

const inferNameFromTarget = (
  target: string,
  type: ShortcutActionType | 'APP' | 'URL' | 'TEXT',
  fallback: { webLink: string; textSnippet: string; shortcut: string }
) => {
  if (type === 'URL') {
    try {
      return new URL(target.includes('://') ? target : `https://${target}`).hostname;
    } catch {
      return fallback.webLink;
    }
  }

  if (type === 'TEXT') {
    return target.slice(0, 20) || fallback.textSnippet;
  }

  const fileName = target.split(/[\\/]/).pop()?.split('.').at(0);
  return fileName || fallback.shortcut;
};

const AddEditModal: React.FC<AddEditModalProps> = ({ isOpen, language, item, onClose, onSave }) => {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<EditorMode>('SINGLE');
  const [content, setContent] = useState('');
  const [keys, setKeys] = useState('');
  const [icon, setIcon] = useState<string | undefined>(undefined);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [groupActions, setGroupActions] = useState<ShortcutAction[]>([createGroupAction()]);
  const [isRecording, setIsRecording] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const addMenuRef = React.useRef<HTMLDivElement>(null);
  const t = translations[language || 'zh'];
  const isZh = (language || 'zh') === 'zh';
  const uiText = {
    single: isZh ? '单项' : 'Single',
    group: isZh ? '组合' : 'Group',
    targets: isZh ? '目标列表' : 'Targets',
    targetsDesc: isZh ? '一个快捷键按顺序打开多个网页、文件、文件夹或应用。' : 'Open several pages, files, folders, or apps with one shortcut.',
    addUrl: isZh ? '+ 网页' : '+ URL',
    addFile: isZh ? '+ 文件' : '+ File',
    addFolder: isZh ? '+ 文件夹' : '+ Folder',
    remove: isZh ? '删除' : 'Remove',
    chooseLocal: isZh ? '选择本地目标' : 'Choose a local target',
    optionalLabel: isZh ? '可选备注' : 'Optional label',
    alwaysOpen: isZh ? '始终打开' : 'Always Open',
    toggleIfOpen: isZh ? '已打开则切换' : 'Toggle If Open',
    webLink: isZh ? '网页链接' : 'Web Link',
    textSnippet: isZh ? '文本片段' : 'Text Snippet',
    shortcut: isZh ? '快捷方式' : 'Shortcut',
    workspace: isZh ? '组合' : 'Workspace',
    groupBadge: isZh ? '组合' : 'Group',
    itemCount: (count: number) => isZh ? `${count} 项` : `${count} items`,
  };

  useEffect(() => {
    if (item) {
      const isGroup = item.type === 'GROUP' || Boolean(item.actions?.length);
      setMode(isGroup ? 'GROUP' : 'SINGLE');
      setName(item.name);
      setContent(item.type === 'TEXT' ? (item.textPayload || '') : (item.path || ''));
      setKeys(item.keys);
      setIcon(item.icon);
      setRepeatOpen(Boolean(item.repeatOpen));
      setGroupActions(
        isGroup && item.actions && item.actions.length > 0
          ? item.actions.map((action, index) => normalizeShortcutAction(action, index))
          : [createGroupAction()]
      );
    } else {
      setName('');
      setMode('SINGLE');
      setContent('');
      setKeys('');
      setIcon(undefined);
      setRepeatOpen(false);
      setGroupActions([createGroupAction()]);
    }
    setIsRecording(false);
  }, [item, isOpen]);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const modifiers = [];
      if (e.ctrlKey) modifiers.push('Ctrl');
      if (e.shiftKey) modifiers.push('Shift');
      if (e.altKey) modifiers.push('Alt');
      if (e.metaKey) modifiers.push('Meta');

      const key = e.key.toUpperCase();
      if (['CONTROL', 'SHIFT', 'ALT', 'META', 'OS'].includes(key)) return;

      const combo = [...modifiers, key].join('+');
      setKeys(combo);
      setIsRecording(false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecording]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };
    if (isAddMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAddMenuOpen]);

  if (!isOpen) return null;

  const currentType = detectType(content);
  const validGroupActions = groupActions
    .map((action, index) => normalizeShortcutAction(action, index))
    .filter((action) => action.target.trim().length > 0);

  const canSave = Boolean(keys) && (
    mode === 'GROUP'
      ? validGroupActions.length > 0
      : content.trim().length > 0
  );

  const updateGroupAction = (id: string, updates: Partial<ShortcutAction>) => {
    setGroupActions((prev) => prev.map((action) => (
      action.id === id
        ? normalizeShortcutAction({ ...action, ...updates })
        : action
    )));
  };

  const removeGroupAction = (id: string) => {
    setGroupActions((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((action) => action.id !== id);
    });
  };

  const handleBrowseSingleFile = async () => {
    const selectedPath = await backend.selectFile();
    if (selectedPath) {
      setContent(selectedPath);
      if (!name) setName(inferNameFromTarget(selectedPath, 'APP', uiText));
    }
  };

  const handleBrowseSingleFolder = async () => {
    const selectedPath = await backend.selectFolder();
    if (selectedPath) {
      setContent(selectedPath);
      if (!name) setName(inferNameFromTarget(selectedPath, 'APP', uiText));
    }
  };

  const handleBrowseGroupTarget = async (action: ShortcutAction) => {
    const selectedPath = action.type === 'FOLDER'
      ? await backend.selectFolder()
      : await backend.selectFile();

    if (selectedPath) {
      updateGroupAction(action.id, { target: selectedPath });
      if (!name) setName(inferNameFromTarget(selectedPath, action.type, uiText));
    }
  };

  const handleSave = () => {
    if (mode === 'GROUP') {
      const actions = validGroupActions.map((action) => ({
        ...action,
        target: action.target.trim(),
      }));

      const finalName = name.trim()
        || inferNameFromTarget(actions[0]?.target || '', actions[0]?.type || 'URL', uiText)
        || `${uiText.workspace} ${actions.length}`;

      onSave({
        name: finalName,
        type: 'GROUP',
        actions,
        keys,
        icon,
        visible: true,
        repeatOpen: true,
        path: undefined,
        textPayload: undefined,
      });
      return;
    }

    const type = detectType(content);
    let finalName = name.trim();
    if (!finalName) {
      finalName = inferNameFromTarget(content, type, uiText);
    }

    onSave({
      name: finalName,
      type,
      path: type !== 'TEXT' ? content.trim() : undefined,
      textPayload: type === 'TEXT' ? content : undefined,
      keys,
      icon,
      repeatOpen: type === 'URL' ? repeatOpen : false,
      actions: undefined,
    });
  };

  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center p-4 overflow-hidden rounded-xl">
      <div
        className="absolute inset-0 bg-black/60 animate-in fade-in duration-500"
        onClick={onClose}
      />

      <div className="relative w-full max-w-[420px] bg-[#09090B] rounded-xl overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in-95 duration-200 border border-white/10">
        <div className="px-6 h-[70px] flex justify-between items-center bg-[#1C1C1E]/40 border-b border-white/5 no-drag">
          <button onClick={onClose} className="ml-2 text-white/40 text-[16px] font-medium hover:text-white transition-all">{t.modal_cancel}</button>

          <button
            onClick={handleSave}
            disabled={!canSave}
            className="bg-[#0A84FF] text-white px-5 py-2 rounded-full font-bold text-[14px] disabled:opacity-20 disabled:grayscale hover:bg-[#47a1ff] active:scale-90 transition-all shadow-lg shadow-blue-500/20"
          >
            {t.modal_done}
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[78vh] overflow-y-auto custom-scrollbar">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {(['SINGLE', 'GROUP'] as const).map((value) => {
              const active = mode === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold transition-all ${active ? 'bg-white text-black' : 'text-white/65 hover:text-white'}`}
                >
                  {value === 'SINGLE' ? uiText.single : uiText.group}
                </button>
              );
            })}
          </div>

          <div className="flex items-center">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.modal_name_placeholder}
              className="flex-1 min-w-0 bg-transparent border-none text-white focus:outline-none focus:ring-0 text-[18px] placeholder:text-white/80 font-medium"
            />
          </div>

          {mode === 'SINGLE' ? (
            <>
              <div className="flex items-start">
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2 min-h-[22px]">
                    <div className="flex items-center gap-2">
                      {content.trim() && (
                        <>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${currentType === 'TEXT' ? 'bg-white/10 text-white' :
                            currentType === 'URL' ? 'bg-[#0A84FF]/20 text-[#0A84FF]' :
                              'bg-[#30D158]/20 text-[#30D158]'
                            }`}>
                            {currentType === 'TEXT' ? t.modal_type_text : currentType === 'URL' ? t.modal_type_url : t.modal_type_app}
                          </span>

                          {currentType === 'URL' && (
                            <button
                              type="button"
                              onClick={() => setRepeatOpen(!repeatOpen)}
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-all flex items-center gap-1 ${repeatOpen
                                ? 'bg-[#0A84FF]/20 text-[#0A84FF] border border-[#0A84FF]/30'
                                : 'bg-white/5 text-white/80 border border-white/10'
                                }`}
                            >
                              <Icon name={repeatOpen ? 'filter_none' : 'filter_1'} className="!text-[12px]" size={12} />
                              {t.modal_multi_open}
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setIsRecording(true)}
                        className={`h-[22px] px-2 rounded flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 transition-all active:scale-95 gap-1 ${isRecording ? 'border-[var(--ios-red)] text-[var(--ios-red)] animate-pulse' : (keys && keys !== 'None' ? 'text-[#0A84FF] border-[#0A84FF]/30 bg-[#0A84FF]/5' : 'text-white/80')}`}
                      >
                        <span className="text-[12px] font-medium">{isRecording ? t.modal_recording : (keys || t.modal_set_shortcut)}</span>
                      </button>

                      <button
                        onClick={handleBrowseSingleFile}
                        className="h-[22px] px-2 rounded flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-white/80 hover:text-white"
                        title={t.modal_select_file}
                      >
                        <Icon name="file_open" className="!text-[14px]" size={14} />
                      </button>
                      <button
                        onClick={handleBrowseSingleFolder}
                        className="h-[22px] px-2 rounded flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-white/80 hover:text-white"
                        title={t.modal_select_folder}
                      >
                        <Icon name="folder_open" className="!text-[14px]" size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="relative">
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={t.modal_content_placeholder}
                      rows={3}
                      className="w-full bg-transparent border border-white/10 rounded-lg text-white focus:outline-none focus:ring-0 text-[18px] font-medium placeholder:text-white/80 p-3 resize-none custom-scrollbar"
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative inline-block" ref={addMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
                      title={isZh ? "+ 添加" : "+ Add Item"}
                      aria-label={isZh ? "+ 添加" : "+ Add Item"}
                      className="h-[22px] px-2 rounded flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-white/80 hover:text-white active:scale-95 gap-1"
                    >
                      <span className="text-[12px] font-medium">{isZh ? "+ 添加" : "+ Add Item"}</span>
                    </button>

                    {isAddMenuOpen && (
                      <div className="absolute left-0 mt-1 z-[120] w-[140px] overflow-hidden rounded-xl border border-white/10 bg-[#1C1C1E] p-1 shadow-[0_8px_32px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-100 backdrop-blur-xl">
                        {GROUP_TYPE_OPTIONS.map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => {
                              setGroupActions((prev) => [...prev, createGroupAction(type)]);
                              setIsAddMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-white/80 hover:bg-white/5 hover:text-white transition-all"
                          >
                            <Icon 
                              name={type === 'URL' ? 'language' : type === 'FILE' ? 'description' : type === 'FOLDER' ? 'folder_open' : 'apps'} 
                              className="!text-[14px] text-white/40" 
                              size={14} 
                            />
                            <span className="flex-1 truncate">{getLocalizedActionTypeLabel(type, language || 'zh', t)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsRecording(true)}
                    className={`h-[22px] px-2 rounded flex items-center justify-center bg-white/5 hover:bg-white/10 border border-white/10 transition-all active:scale-95 gap-1 ${isRecording ? 'border-[var(--ios-red)] text-[var(--ios-red)] animate-pulse' : (keys && keys !== 'None' ? 'text-[#0A84FF] border-[#0A84FF]/30 bg-[#0A84FF]/5' : 'text-white/80')}`}
                  >
                    <span className="text-[12px] font-medium">{isRecording ? t.modal_recording : (keys || t.modal_set_shortcut)}</span>
                  </button>
                </div>

              <div className="space-y-2">
                {groupActions.map((action) => (
                  <div key={action.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
                    <div className="grid grid-cols-[120px_1fr] gap-3">
                      <CustomSelect
                        value={action.type}
                        onChange={(e) => updateGroupAction(action.id, {
                          type: e as ShortcutActionType,
                          repeatOpen: e === 'URL' ? action.repeatOpen : false,
                        })}
                        options={GROUP_TYPE_OPTIONS.map((type) => ({
                          label: getLocalizedActionTypeLabel(type, language || 'zh', t),
                          value: type,
                          icon: type === 'URL' ? 'language' : type === 'FILE' ? 'description' : type === 'FOLDER' ? 'folder_open' : 'apps'
                        }))}
                      />

                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          type="text"
                          value={action.target}
                          onChange={(e) => updateGroupAction(action.id, { target: e.target.value })}
                          placeholder={action.type === 'URL' ? 'https://example.com' : uiText.chooseLocal}
                          className="min-w-0 flex-1 h-[38px] rounded-xl border border-white/10 bg-[#09090B] px-3 text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-all font-medium"
                        />

                        {action.type !== 'URL' && (
                          <button
                            type="button"
                            onClick={() => handleBrowseGroupTarget(action)}
                            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-all active:scale-95"
                            title={action.type === 'FOLDER' ? t.modal_select_folder : t.modal_select_file}
                          >
                            <Icon name={action.type === 'FOLDER' ? 'folder_open' : 'file_open'} className="!text-[18px]" size={18} />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => removeGroupAction(action.id)}
                          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/40 transition-colors hover:bg-[var(--ios-red)]/20 hover:text-[var(--ios-red)]"
                          title={uiText.remove}
                        >
                          <Icon name="delete" className="!text-[16px]" size={16} />
                        </button>
                      </div>
                    </div>


                  </div>
                ))}
              </div>
            </div>
          )}

            {isRecording && (
              <div className="flex items-center gap-1.5 text-[11px] text-white/80 animate-in fade-in slide-in-from-top-1 mt-2">
                <Icon name="info" className="!text-[14px]" size={14} />
                <span>{t.modal_shortcut_hint}</span>
              </div>
            )}
        </div>

        <div className="h-4 bg-transparent" />
      </div>
    </div>
  );
};

export default AddEditModal;
