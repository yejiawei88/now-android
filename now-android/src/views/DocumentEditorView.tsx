import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ViewType, ClipboardItem, TranslationSettings } from '../types';
import { invoke } from '@tauri-apps/api/core';
import Icon from '../components/Icon';
import { translations } from '../i18n';
import { BackendService } from '../backend';
import remarkGfm from 'remark-gfm';
import type { CodeMirrorEditorRef } from '../components/CodeMirrorEditor';
import { normalizeMarkdownForRender } from '../utils/markdownNormalize';

const CodeMirrorEditor = React.lazy(() =>
    import('../components/CodeMirrorEditor')
);

const ReactMarkdownLazy = React.lazy(() =>
    import('react-markdown')
);

const ChatViewLazy = React.lazy(() =>
    import('./ChatView')
);

interface DocumentEditorViewProps {
    item: ClipboardItem;
    tagIndex: number;
    onNavigate: (view: ViewType) => void;
    onRegisterBackHandler?: (handler: () => void | Promise<void>) => void;
    activeLibraryId: string;
    language?: 'zh' | 'en';
    translationSettings: TranslationSettings;
}

const DocumentEditorView: React.FC<DocumentEditorViewProps> = (props) => {
    const language = props.language || 'zh';
    const t = (translations as any)[language] || translations['zh'];
    const { item, tagIndex, onNavigate, onRegisterBackHandler, activeLibraryId, translationSettings } = props;

    if (!item) return <div className="h-full w-full bg-[#09090B] flex items-center justify-center text-white/50">Item is missing</div>;

        // Helper to get multi-content map
        const getContentMap = (rawContent: string): Record<string, string> => {
            try {
                if (!rawContent || rawContent === '{}') return {};
                const parsed = JSON.parse(rawContent);
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                    return parsed;
                }
            } catch (e) {
                // Handled below
            }
            return {};
        };

        const tags = item?.tags || ['未命名文档'];
        const safeTagIndex = Math.max(0, Math.min(tagIndex, tags.length - 1));
        const currentTagName = tags[safeTagIndex] || '未命名文档';

        // Initialize content from JSON map or fallback to raw content for the first tag
        const [content, setContent] = useState(() => {
            if (!item) return '';
            try {
                const map = getContentMap(item.content);
                if (Object.keys(map).length > 0) {
                    const val = map[currentTagName] || map[tags[0]] || '';
                    return typeof val === 'string' ? val : String(val);
                }
                if (safeTagIndex === 0 || tags.length === 1) {
                    return item.content === '{}' ? '' : item.content;
                }
                return '';
            } catch (err) {
                console.error('[DocumentEditorView] Error initializing content:', err);
                return '';
            }
        });

        const [title, setTitle] = useState(currentTagName || '');
        const [isEditingTitle, setIsEditingTitle] = useState(false);
        const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
        const [isGenerating, setIsGenerating] = useState(false);
        const [isChatOpen, setIsChatOpen] = useState(false);
        const [isReviewingAi, setIsReviewingAi] = useState(false);
        const [cursorState, setCursorState] = useState<string>('正文');
        const [preAiContent, setPreAiContent] = useState<string | null>(null);
        const [viewMode] = useState<'edit' | 'preview' | 'split'>('edit');
        const [isReminderMenuOpen, setIsReminderMenuOpen] = useState(false);
        const [scheduledReminder, setScheduledReminder] = useState<string | null>(null);
        const [reminderId, setReminderId] = useState<string | null>(null);
        const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
        const [chatInitialText, setChatInitialText] = useState<string | undefined>(undefined);
        const [chatTimestamp, setChatTimestamp] = useState<number | undefined>(undefined);
        const [currentSelection, setCurrentSelection] = useState<string>('');
    const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);
    const previewContent = useMemo(
        () => normalizeMarkdownForRender(content),
        [content]
    );
    const [chatWidth, setChatWidth] = useState(400);
    const [isDraggingChat, setIsDraggingChat] = useState(false);
    const isResizingChatRef = useRef(false);

    const startResizingChat = (e: React.MouseEvent) => {
        setIsDraggingChat(true);
        isResizingChatRef.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingChatRef.current) return;
            const newWidth = Math.min(Math.max(280, window.innerWidth - e.clientX), window.innerWidth * 0.6);
            setChatWidth(newWidth);
        };

        const handleMouseUp = () => {
            if (isResizingChatRef.current) {
                isResizingChatRef.current = false;
                setIsDraggingChat(false);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

        const reminderMenuRef = useRef<HTMLDivElement>(null);
        const formatMenuRef = useRef<HTMLDivElement>(null);
        const editorRef = useRef<CodeMirrorEditorRef>(null);
        const toastTimerRef = useRef<number | null>(null);

        const showToast = (message: string, type: 'success' | 'error' = 'success') => {
            if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
            setToast({ message, type });
            toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
        };

        const saveTimerRef = useRef<number | null>(null);
        const persistDraftRef = useRef<((opts?: { suppressUiState?: boolean }) => Promise<boolean>) | null>(null);
        const backend = BackendService.getInstance();

    const persistDraft = useCallback(async (opts?: { suppressUiState?: boolean }) => {
        if (!item || isGenerating || isReviewingAi) return false;
        if (item.type === 'DOCUMENT' && item.documentContentLoaded === false) {
            return false;
        }

        const hasTitleChanged = title !== currentTagName;
        const currentMap = getContentMap(item.content);
        const savedContentForTag =
            currentMap[currentTagName] ||
            (safeTagIndex === 0 && Object.keys(currentMap).length === 0 ? (item.content === '{}' ? '' : item.content) : '');

        if (content === savedContentForTag && !hasTitleChanged) {
            if (!opts?.suppressUiState) {
                setSaveStatus('idle');
            }
            return false;
        }

        try {
            let finalTitle = title.trim() || '未命名文档';

            if (hasTitleChanged) {
                const otherTags = tags.filter((_, i) => i !== tagIndex);
                let uniqueTitle = finalTitle;
                let counter = 2;
                while (otherTags.includes(uniqueTitle)) {
                    uniqueTitle = `${finalTitle} ${counter++}`;
                }
                finalTitle = uniqueTitle;
                if (!opts?.suppressUiState && finalTitle !== title) {
                    setTitle(finalTitle);
                }
            }

            const newTags = [...tags];
            if (hasTitleChanged) {
                newTags[tagIndex] = finalTitle;
            }

            const map = getContentMap(item.content);
            if (hasTitleChanged) {
                map[finalTitle] = content;
                const isOldTagNameStillUsed = newTags.some((t, i) => i !== tagIndex && t === currentTagName);
                if (!isOldTagNameStillUsed) {
                    delete map[currentTagName];
                }
            } else {
                map[finalTitle] = content;
            }

            const updatedItem = {
                ...item,
                content: JSON.stringify(map),
                tags: newTags,
                timestamp: item.timestamp
            };

            if ((window as any).__TAURI_INTERNALS__) {
                await invoke('db_upsert_item', {
                    itemJson: JSON.stringify(updatedItem),
                    libraryId: activeLibraryId
                }).catch(e => console.warn('Auto-save skipped (non-tauri/error):', e));
            }

            const cat = item.category;
            const isHistoryLike =
                cat === '历史' ||
                cat === 'History' ||
                cat === '全部' ||
                cat === 'All';
            if (isHistoryLike) {
                window.dispatchEvent(new CustomEvent('clipboard-updated'));
            }

            if (!opts?.suppressUiState) {
                setSaveStatus('saved');
                setTimeout(() => setSaveStatus('idle'), 2000);
            }
            return true;
        } catch (e) {
            console.error('Failed to auto-save document:', e);
            if (!opts?.suppressUiState) {
                setSaveStatus('idle');
            }
            return false;
        }
    }, [activeLibraryId, content, currentTagName, isGenerating, isReviewingAi, item, safeTagIndex, tagIndex, tags, title]);

    useEffect(() => {
        persistDraftRef.current = persistDraft;
    }, [persistDraft]);

    // Flush pending draft on component unmount / window close.
    useEffect(() => {
        const flushDraft = () => {
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            void persistDraftRef.current?.({ suppressUiState: true });
        };

        window.addEventListener('beforeunload', flushDraft);
        return () => {
            window.removeEventListener('beforeunload', flushDraft);
            flushDraft();
        };
    }, []);


    // Auto-save logic (including title) - skip during AI generation to avoid conflicts
    useEffect(() => {
        if (isGenerating || isReviewingAi || !item) return;
        if (item.type === 'DOCUMENT' && item.documentContentLoaded === false) return;

        if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
        }

        setSaveStatus('saving');
        saveTimerRef.current = window.setTimeout(async () => {
            saveTimerRef.current = null;
            await persistDraft();
        }, 800);

        return () => {
            if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        };
    }, [content, title, isGenerating, isReviewingAi, item, persistDraft]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (reminderMenuRef.current && !reminderMenuRef.current.contains(event.target as Node)) {
                setIsReminderMenuOpen(false);
            }
            if (formatMenuRef.current && !formatMenuRef.current.contains(event.target as Node)) {
                setIsFormatMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleBack = async () => {
        if (isReviewingAi) {
            handleCancelAi();
        }
        if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        await persistDraft({ suppressUiState: true });
        onNavigate(ViewType.CLIPBOARD);
    };

    useEffect(() => {
        onRegisterBackHandler?.(handleBack);
    }, [onRegisterBackHandler, handleBack]);

    const handleGenerateSchedule = async () => {
        if (isGenerating) {
            backend.stopGeneration();
            setIsGenerating(false);
            return;
        }

        // Backup current content
        setPreAiContent(content);
        setIsGenerating(true);
        setIsReviewingAi(true);
        setContent(''); // Start fresh (replace mode), with rollback support.
        // Let's replace but allow rollback.

        const safeTitle = (title || '').trim() || '未命名文档';
        const safeContent = (content || '').trim();
        const sanitizeScheduleOutput = (raw: string) => {
            if (!raw) return raw;
            let text = raw.replace(/\r\n/g, '\n');
            // Remove accidental extra sections occasionally echoed by the model.
            text = text.replace(/\n(?:#+\s*)?(?:约束补充|补充说明|说明|备注)\s*\n[\s\S]*$/u, '');
            // Remove accidental task id prefixes like T1/T2.
            text = text.replace(/^(\s*\[\s\]\s*)T\d+\s*/gmu, '$1');
            text = text.replace(/([：:]\s*)T\d+(?:\s*[、,，]\s*T\d+)*/gmu, '$1无');
            text = text.replace(/\bT\d+\b/gmu, '');
            return text.trimEnd();
        };
        const prompt = `请根据【标题】和【正文】生成“可直接执行”的日程清单，禁止跑题。

【标题】
${safeTitle}

【正文】
${safeContent || '（正文为空，请仅基于标题补全合理计划）'}

要求：
1. 全文中文，直接输出结果，不要解释过程。
2. 必须与标题强相关；若正文与标题冲突，以标题为准。
3. 第2、3部分每条仅允许一个复选框，格式必须是“[ ] 文本”，禁止出现“[ ] [ ]”。
4. 第2部分每条任务只写任务内容+预计时长（整数分钟），禁止任何编号前缀（如 T1/T2/1./①）。
5. 第4部分严禁出现复选框，且使用第2部分任务的“短语原文”进行分类，不得使用编号代称。
6. 估时要保守可执行：单条 5-60 分钟，总时长控制在 45-180 分钟。
7. 严格使用以下结构与顺序，不得增删标题：
8. 只允许输出这4个一级标题：1. 目标 / 2. 拆解 / 3. 准备 / 4. 排序。禁止输出任何其他标题（如“约束补充”“说明”“备注”）。
9. 除上述4个标题和其内容外，不得追加任何结尾文本。

1. 目标
将模糊想法转为可衡量指标，使用 SMART 原则。
仅输出 1 句目标，尽量 15 字以内（必要时可放宽到 20 字）。

2. 拆解
输出 4-6 条最小可执行动作，每条都带预计时长（如“20分钟”）：
[ ] 收集报告所需数据（20分钟）
[ ] 整理报告结构（15分钟）
末尾增加一行：总时长：xx分钟

3. 准备
列出完成该任务所需材料/工具，每条都用复选框：
[ ] 身份证
[ ] xxx
若无准备项，输出：[ ] 无

4. 排序
按艾森豪威尔矩阵（重要/紧急）给第2部分动作分类，四类都必须输出：
- 重要且紧急：任务短语A、任务短语B
- 重要不紧急：任务短语C
- 紧急不重要：无
- 不重要不紧急：无
第4部分使用与第2部分一致的任务短语，不得新增任务。`;

        try {
            await backend.chatStream(
                translationSettings,
                [
                    {
                        role: 'system',
                        content: '你是中文日程规划助手。输出必须与给定标题高度相关，禁止跑题、禁止乱码、禁止输出模板说明。严格遵守用户给定的结构与格式：第2、3部分每行仅一个复选框，第4部分禁止复选框。禁止输出任何任务编号前缀（如T1/T2/1./①），排序中必须使用任务短语原文。只允许输出4个一级标题（1.目标/2.拆解/3.准备/4.排序），禁止输出任何额外标题或补充段落。'
                    },
                    { role: 'user', content: prompt }
                ],
                (chunk) => {
                    setContent(prev => prev + chunk);
                },
                () => {
                    setContent(prev => sanitizeScheduleOutput(prev));
                    setIsGenerating(false);
                },
                (error) => {
                    console.error('AI Generation Error:', error);
                    setIsGenerating(false);
                }
            );
        } catch (e) {
            console.error('Failed to start AI generation:', e);
            setIsGenerating(false);
        }
    };

    const handleAcceptAi = () => {
        setPreAiContent(null);
        setIsReviewingAi(false);
        setIsGenerating(false);
    };

    const handleCancelAi = () => {
        if (preAiContent !== null) {
            setContent(preAiContent);
        }
        setPreAiContent(null);
        setIsReviewingAi(false);
        setIsGenerating(false);
        backend.stopGeneration();
    };

    const getInitialTime = () => {
        const now = new Date();
        const future = new Date(now.getTime() + 60 * 60 * 1000); // Default to 1 hour later
        return {
            month: future.getMonth() + 1,
            day: future.getDate(),
            hour: future.getHours(),
            minute: future.getMinutes()
        };
    };

    const [reminderTime, setReminderTime] = useState(getInitialTime);

    // Reset reminder time when menu opens to ensure it's not in the past
    useEffect(() => {
        if (isReminderMenuOpen) {
            setReminderTime(getInitialTime());
        }
    }, [isReminderMenuOpen]);

    const handleScheduleReminder = async () => {
        try {
            const now = new Date();
            let year = now.getFullYear();

            // Basic logic: if selected month is earlier than current month, assume next year
            if (reminderTime.month < (now.getMonth() + 1)) {
                year += 1;
            }

            const target = new Date(
                year,
                reminderTime.month - 1,
                reminderTime.day,
                reminderTime.hour,
                reminderTime.minute
            );

            let delayMs = target.getTime() - now.getTime();

            // If it's the same month but an earlier day or time, it might still need year increment if we didn't do it above
            if (delayMs <= 0 && year === now.getFullYear()) {
                target.setFullYear(year + 1);
                delayMs = target.getTime() - now.getTime();
            }

            if (delayMs <= 0) {
                showToast(language === 'zh' ? '所选时间已过，请设置未来时间' : 'Selected time is in the past, please choose a future time', 'error');
                return;
            }

            const id = crypto.randomUUID();
            await invoke('schedule_notification', {
                id,
                title: title || 'Now Reminder',
                body: t.reminder_body || 'Your scheduled reminder is due.',
                delayMs: delayMs
            }).catch(e => console.warn('Reminder skipped (non-tauri/error):', e));
            setIsReminderMenuOpen(false);
            const timeStr = `${reminderTime.month}-${reminderTime.day} ${reminderTime.hour}:${reminderTime.minute.toString().padStart(2, '0')}`;
            setScheduledReminder(timeStr);
            setReminderId(id);
            showToast(t.reminder_success || (language === 'zh' ? '提醒设置成功' : 'Reminder set successfully'), 'success');
        } catch (e) {
            console.error('Failed to schedule reminder:', e);
            showToast(language === 'zh' ? '设置提醒失败' : 'Failed to set reminder', 'error');
        }
    };

    const handleDeleteReminder = async () => {
        if (!reminderId) return;
        try {
            await invoke('cancel_notification', { id: reminderId });
            setScheduledReminder(null);
            setReminderId(null);
            showToast(language === 'zh' ? '已取消提醒' : 'Reminder cancelled', 'success');
        } catch (e) {
            console.error('Failed to cancel reminder:', e);
            showToast(language === 'zh' ? '取消提醒失败' : 'Failed to cancel reminder', 'error');
        }
    };

    const handleApplySelection = (text: string) => {
        if (editorRef.current) {
            editorRef.current.replaceSelection(text);
            showToast(language === 'zh' ? '已替换选中内容' : 'Selection replaced', 'success');
        }
    };

    const adjustTime = (field: keyof typeof reminderTime, delta: number) => {
        setReminderTime(prev => {
            const next = { ...prev };
            if (field === 'month') next.month = Math.max(1, Math.min(12, prev.month + delta));
            else if (field === 'day') next.day = Math.max(1, Math.min(31, prev.day + delta));
            else if (field === 'hour') next.hour = (prev.hour + delta + 24) % 24;
            else if (field === 'minute') next.minute = (prev.minute + delta + 60) % 60;
            return next;
        });
    };

    const [draggingField, setDraggingField] = useState<keyof typeof reminderTime | null>(null);
    const dragStartYRef = useRef<number>(0);
    const dragAccumulatedRef = useRef<number>(0);

    const handleScrubberMouseDown = (e: React.MouseEvent, field: keyof typeof reminderTime) => {
        setDraggingField(field);
        dragStartYRef.current = e.clientY;
        dragAccumulatedRef.current = 0;
        document.body.style.cursor = 'ns-resize';
    };

    const handleScrubberWheel = (e: React.WheelEvent, field: keyof typeof reminderTime) => {
        const delta = e.deltaY < 0 ? 1 : -1;
        adjustTime(field, delta);
    };

    useEffect(() => {
        if (!draggingField) return;

        const handleMouseMove = (e: MouseEvent) => {
            const currentY = e.clientY;
            const deltaY = dragStartYRef.current - currentY; 
            dragAccumulatedRef.current += deltaY;
            dragStartYRef.current = currentY; 

            const STEP_HEIGHT = 15; 
            if (Math.abs(dragAccumulatedRef.current) >= STEP_HEIGHT) {
                const steps = Math.trunc(dragAccumulatedRef.current / STEP_HEIGHT);
                if (steps !== 0) {
                    adjustTime(draggingField, steps);
                    dragAccumulatedRef.current = dragAccumulatedRef.current % STEP_HEIGHT;
                }
            }
        };

        const handleMouseUp = () => {
            setDraggingField(null);
            document.body.style.cursor = '';
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
        };
    }, [draggingField]);

    // Close reminder menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (reminderMenuRef.current && !reminderMenuRef.current.contains(event.target as Node)) {
                setIsReminderMenuOpen(false);
            }
        };
        if (isReminderMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isReminderMenuOpen]);

    return (
        <div className="flex flex-col h-full bg-[#09090B] text-white font-sans selection:bg-blue-500/20">
            {/* Header - now centered to align with content */}
            <header className="sticky top-0 left-0 right-0 z-40 bg-transparent shrink-0 h-[54px] border-b border-white/[0.04] transition-all duration-300 drag-region" data-tauri-drag-region>
                <div className="w-full h-full flex items-center justify-between pl-10 md:pl-16 pr-4 relative drag-region" data-tauri-drag-region>
                    <div className="flex flex-col justify-center min-w-[50px] overflow-hidden">
                        {isEditingTitle ? (
                            <input
                                autoFocus
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                onBlur={() => setIsEditingTitle(false)}
                                onKeyDown={(e) => e.key === 'Enter' && setIsEditingTitle(false)}
                                className="bg-transparent border-none p-0 text-[26px] font-bold text-white/95 tracking-tight outline-none focus:ring-0 selection:bg-white/20 caret-white/40 no-drag"
                                style={{ width: `${Math.max(160, title.length * 26)}px` }}
                            />
                        ) : (
                            <h1
                                onClick={() => setIsEditingTitle(true)}
                                className="text-[22px] font-bold tracking-tight text-white/95 cursor-text hover:text-white transition-colors truncate no-drag"
                            >
                                {title}
                            </h1>
                        )}
                    </div>

                    <div className="flex items-center gap-3">


                        {/* Accept/Cancel Buttons - Show during generating or reviewing */}
                        {isReviewingAi && (
                            <div className="flex items-center gap-2 mr-2 animate-in slide-in-from-right-4 duration-300">
                                <button
                                    onClick={handleCancelAi}
                                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-all no-drag"
                                    title="取消生成"
                                >
                                    <Icon name="close" size={18} />
                                </button>
                                <button
                                    onClick={handleAcceptAi}
                                    disabled={isGenerating}
                                    className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all no-drag ${isGenerating
                                        ? 'bg-white/5 border border-white/10 text-white/20 cursor-not-allowed'
                                        : 'bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 hover:text-green-300'
                                        }`}
                                    title="接受修改"
                                >
                                    <Icon name="check" size={18} />
                                </button>
                            </div>
                        )}

                        {/* Tool Group (AI, Reminder & Chat) */}
                        <div className="flex items-center gap-1 bg-white/[0.02] p-1 rounded-full border border-white/[0.04] shadow-sm ml-1 transition-all duration-300">
                            {/* Format Selection Dropdown */}
                            <div className="relative no-drag" ref={formatMenuRef}>
                                <button
                                    onClick={() => setIsFormatMenuOpen(!isFormatMenuOpen)}
                                    className="px-3.5 py-1.5 flex items-center gap-1 group cursor-pointer border-r border-white/5 mr-1 hover:bg-white/5 rounded-l-full transition-all no-drag"
                                >
                                    <span className="text-[12px] font-medium text-white/50 tracking-wide transition-colors group-hover:text-white/80">
                                        {cursorState}
                                    </span>
                                    <svg width="8" height="6" viewBox="0 0 8 6" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white/20 group-hover:text-white/40 transition-all duration-200">
                                        <path d="M4 6L0 0H8L4 6Z" fill="currentColor" />
                                    </svg>
                                </button>

                                {isFormatMenuOpen && (
                                    <div className="absolute top-12 left-0 w-40 bg-[#1A1A1E] border border-white/10 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.8)] z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200 py-2">
                                        {[
                                            '正文',
                                            '标题 1',
                                            '标题 2',
                                            '标题 3',
                                            '待办事项',
                                            '列表'
                                        ].map((option) => (
                                            <button
                                                key={option}
                                                onClick={() => {
                                                    editorRef.current?.setLineFormat(option);
                                                    setIsFormatMenuOpen(false);
                                                }}
                                                className={`w-full px-4 py-2.5 text-left text-[13px] transition-all flex items-center justify-between group ${cursorState === option
                                                    ? 'bg-white/10 text-white font-medium'
                                                    : 'text-white/50 hover:bg-white/5 hover:text-white/80'
                                                    }`}
                                            >
                                                <span>{option}</span>
                                                {cursorState === option && <Icon name="check" size={14} className="text-blue-400" />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {/* AI Generation Button */}
                            <button
                                onClick={handleGenerateSchedule}
                                title={isGenerating ? "停止生成" : "完善日程"}
                                className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-300 no-drag ${isGenerating
                                    ? 'bg-white/20 text-white'
                                    : isReviewingAi
                                        ? 'bg-white/10 text-white'
                                        : 'bg-transparent text-white/50 hover:bg-white/10 hover:text-white'
                                    }`}
                            >
                                <Icon
                                    name={isGenerating ? 'stop_circle' : 'auto_awesome'}
                                    size={15}
                                    className={`${isGenerating ? 'text-white animate-pulse' : 'text-current'} transition-colors`}
                                />
                            </button>
                            {/* Reminder Button */}
                            <div className="relative no-drag" ref={reminderMenuRef}>
                                <button
                                    onClick={() => setIsReminderMenuOpen(!isReminderMenuOpen)}
                                    title={t.reminder_set}
                                    className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${isReminderMenuOpen
                                        ? 'bg-white/15 text-white'
                                        : scheduledReminder
                                            ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
                                            : 'bg-transparent text-white/50 hover:bg-white/10 hover:text-white'
                                        }`}
                                >
                                    <Icon
                                        name="alarm"
                                        size={16}
                                        className={scheduledReminder && !isReminderMenuOpen ? 'text-blue-400' : ''}
                                    />
                                </button>

                                {isReminderMenuOpen && (
                                    <div className="absolute top-12 right-0 w-64 bg-[#09090B] border border-white/10 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.8)] z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col">
                                        {scheduledReminder && (
                                            <div className="px-4 py-3 bg-blue-500/10 border-b border-white/5 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <Icon name="alarm" size={14} className="text-blue-400" />
                                                    <span className="text-[12px] font-bold text-blue-400/90 tracking-wide uppercase">已计划</span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-[13px] font-bold text-blue-300 tabular-nums">{scheduledReminder}</span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteReminder();
                                                        }}
                                                        className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 text-white/40 hover:text-red-400 transition-all"
                                                        title={language === 'zh' ? '取消提醒' : 'Cancel Reminder'}
                                                    >
                                                        <Icon name="close" size={15} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        <div className="p-5">
                                            <div className="text-[11px] font-bold text-white/30 mb-5 ml-1 uppercase tracking-[0.1em]">{t.set_reminder_time}</div>

                                            <div className="grid grid-cols-4 gap-2.5 mb-5 select-none no-drag">
                                                {[
                                                    { label: t.time_month, field: 'month' as const },
                                                    { label: t.time_day, field: 'day' as const },
                                                    { label: t.time_hour, field: 'hour' as const },
                                                    { label: t.time_minute, field: 'minute' as const }
                                                ].map(({ label, field }) => (
                                                    <div 
                                                        key={field} 
                                                        className={`flex flex-col items-center py-5 w-full bg-white/[0.04] rounded-xl border border-white/[0.05] cursor-ns-resize select-none active:bg-white/[0.08] hover:bg-white/[0.07] transition-all duration-200 ${draggingField === field ? 'border-blue-500/30 bg-blue-500/[0.03]' : ''}`}
                                                        onMouseDown={(e) => handleScrubberMouseDown(e, field)}
                                                        onWheel={(e) => handleScrubberWheel(e, field)}
                                                    >
                                                        <span className="text-[20px] font-bold text-white/95 tabular-nums pointer-events-none">{reminderTime[field].toString().padStart(2, '0')}</span>
                                                        <span className="text-[10px] text-white/30 font-bold uppercase tracking-wider scale-95 pointer-events-none">{label}</span>
                                                    </div>
                                                ))}
                                            </div>

                                            <button
                                                onClick={handleScheduleReminder}
                                                className="w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-bold text-[14px] shadow-[0_0_15px_rgba(59,130,246,0.2)] transition-all flex items-center justify-center gap-2"
                                            >
                                                <Icon name="check" size={16} />
                                                <span>{t.confirm_reminder}</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>



                            {/* Chat Button */}                            <button
                                onClick={() => {
                                    const sel = editorRef.current?.getSelection();
                                    if (sel) {
                                        setChatInitialText(sel);
                                        setChatTimestamp(Date.now());
                                    }
                                    setIsChatOpen(!isChatOpen);
                                }}
                                disabled={isReviewingAi}
                                title="自定义对话"
                                className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-300 no-drag ${isChatOpen
                                    ? 'bg-white/15 text-white'
                                    : isReviewingAi
                                        ? 'opacity-30 cursor-not-allowed'
                                        : 'bg-transparent text-white/50 hover:bg-white/10 hover:text-white'
                                    }`}
                            >
                                <Icon name="forum" size={16} className={isChatOpen ? 'text-white' : 'text-white/50 group-hover:text-white'} />
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Writing Area - No mt needed as header is now sticky/flow-based */}
            <main className="flex-1 overflow-hidden flex">
                <div className="flex-1 overflow-y-auto overflow-x-auto selection:text-white selection:bg-blue-500/30 custom-editor-scrollbar bg-transparent">
                    <div className={`w-full min-h-full flex px-10 md:px-16 pt-[20px] pb-32 relative ${viewMode === 'split' ? 'flex-col md:flex-row md:items-start md:gap-8' : 'flex-col'}`}>
                        <div className="fixed inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#09090B] via-[#09090B]/80 to-transparent pointer-events-none z-0 opacity-80" />

                        {viewMode !== 'preview' && (
                            <div className={`relative z-10 ${viewMode === 'split' ? 'w-full md:w-1/2' : 'w-full'}`}>
                                <CodeMirrorEditor
                                    ref={editorRef}
                                    value={content}
                                    onChange={(val) => setContent(val)}
                                    onCursorStateChange={(info) => setCursorState(info)}
                                    onSelectionChange={(sel) => setCurrentSelection(sel)}
                                />
                            </div>
                        )}
                        {viewMode !== 'edit' && (
                            <div className={`relative z-10 overflow-y-auto ${viewMode === 'split' ? 'w-full md:w-1/2 pt-8 md:pt-0 md:border-l border-white/5 md:pl-8' : 'w-full'}`}>
                                <div className="markdown-preview prose prose-invert max-w-none">
                                    <React.Suspense fallback={null}>
                                        <ReactMarkdownLazy remarkPlugins={[remarkGfm]}>
                                        {previewContent}
                                        </ReactMarkdownLazy>
                                    </React.Suspense>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Chat Sidebar */}
                <div
                    style={{ width: isChatOpen ? `${chatWidth}px` : '0px' }}
                    className={`h-full bg-[#09090B] border-l border-white/5 relative flex flex-col ${isChatOpen ? 'opacity-100' : 'opacity-0 border-none'} ${!isDraggingChat ? 'transition-all duration-300' : ''}`}
                >
                    {/* Drag Handle */}
                    {isChatOpen && (
                        <div 
                            onMouseDown={startResizingChat}
                            className="absolute top-0 -left-1 w-2 h-full cursor-col-resize z-50 group/handle"
                        >
                            <div className="absolute left-1/2 -translate-x-1/2 w-[2px] h-full bg-transparent group-hover/handle:bg-white/20 transition-colors"></div>
                        </div>
                    )}
                    {isChatOpen && (
                        <div className="flex-1 flex flex-col h-full p-4">
                            <ChatViewLazy
                                settings={translationSettings}
                                language={language}
                                initialText={chatInitialText}
                                initialType={chatInitialText ? 'CHAT' : undefined}
                                requestTimestamp={chatTimestamp}
                                currentSelection={currentSelection}
                                onNavigate={onNavigate}
                                onNavigateToSettings={() => onNavigate(ViewType.SETTINGS)}
                                onApplySelection={handleApplySelection}
                                hideBack={true}
                            />
                        </div>
                    )}
                </div>
            </main >

            {/* Custom Toast Notification */}
            {
                toast && (
                    <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] animate-in fade-in slide-in-from-bottom-4 duration-300">
                        <div className={`px-6 py-3.5 rounded-2xl border flex items-center gap-3 shadow-2xl ${toast.type === 'success'
                            ? 'bg-green-500/10 border-green-500/20 text-green-400'
                            : 'bg-red-500/10 border-red-500/20 text-red-400'
                            }`}>
                            <Icon
                                name={toast.type === 'success' ? 'check_circle' : 'error'}
                                size={20}
                                className={toast.type === 'success' ? 'text-green-400' : 'text-red-400'}
                            />
                            <span className="text-[14px] font-medium tracking-wide">{toast.message}</span>
                        </div>
                    </div>
                )
            }

            <style dangerouslySetInnerHTML={{
                __html: `
                .custom-editor-scrollbar::-webkit-scrollbar {
                    width: 5px;
                }
                .custom-editor-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-editor-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.06);
                    border-radius: 20px;
                    border: 1px solid transparent;
                    background-clip: padding-box;
                    transition: all 0.3s;
                }
                .custom-editor-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.15);
                    background-clip: padding-box;
                }
                /* For Firefox */
                .custom-editor-scrollbar {
                    scrollbar-width: thin;
                    scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
                }
                textarea::placeholder {
                    transition: opacity 0.3s ease;
                }
                textarea:focus::placeholder {
                    opacity: 0.3;
                }
            ` }} />
        </div >
    );
};

export default DocumentEditorView;

