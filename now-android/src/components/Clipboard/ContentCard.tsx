import React, { useRef, useState, useEffect } from 'react';
import { ClipboardItem } from '../../types';
import { STYLES } from '../../constants';
import { translations } from '../../i18n';
import Icon from '../Icon';
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEditFieldFocus } from '../../hooks/useEditFieldFocus';
import { normalizeLegacyCardText, parseCardContent } from '../../utils/cardContent';

export interface ContentCardProps {
    item: ClipboardItem;
    isSelected: boolean;
    isAnyDragActive: boolean;
    isDragging: boolean;
    draggingId: string | null;
    preservePositionWhileDragging?: boolean;
    editingTag: any;
    setEditingTag: any;
    editingContent: any;
    setEditingContent: any;
    commitEditTag: (val: string) => void;
    commitEditContent: () => void;
    handleContextMenu: (e: React.MouseEvent, item: ClipboardItem) => void;
    removeItem: (id: string, e: React.MouseEvent) => void;
    startEditItem: (item: ClipboardItem, e: React.MouseEvent) => void;
    language?: 'zh' | 'en';
    onSelect: (itemId: string, event?: React.MouseEvent) => void;
    onClearSelection?: () => void;
    handleCopy: (content: string, item: ClipboardItem, shouldHideAfterCopy?: boolean) => void | Promise<void>;
    dragHandleProps?: {
        attributes: any;
        listeners: any;
        setActivatorNodeRef: (element: HTMLElement | null) => void;
    };
}

export const ContentCard: React.FC<ContentCardProps> = ({
    item,
    isSelected,
    isAnyDragActive,
    isDragging,
    draggingId,
    preservePositionWhileDragging = false,
    editingTag,
    setEditingTag,
    editingContent,
    setEditingContent,
    commitEditTag,
    commitEditContent,
    handleContextMenu,
    removeItem,
    startEditItem,
    language,
    onSelect,
    onClearSelection,
    handleCopy,
    dragHandleProps
}) => {
    const t = translations[language || 'zh'];
    const prefixEditRef = useRef<HTMLInputElement>(null);
    const contentEditRef = useRef<HTMLTextAreaElement>(null);
    const clickTimeoutRef = useRef<number | null>(null);
    const [showActions, setShowActions] = React.useState(false);
    const normalizedContent = normalizeLegacyCardText(item.content);
    const parsedContent = parseCardContent(normalizedContent);
    const isPrefixEditing = Boolean(parsedContent && editingTag?.itemId === item.id && editingTag?.tagIndex === 0);
    const isBodyEditing = editingContent?.itemId === item.id;

    // 长按按钮状态
    const longPressTimerRef = useRef<number | null>(null);
    const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
    const [longPressButton, setLongPressButton] = useState<'delete' | 'edit' | null>(null);
    const LONG_PRESS_THRESHOLD = 500; // 500ms

    // 上下文菜单状态
    const [showContextMenu, setShowContextMenu] = useState(false);
    const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);

    // 打开上下文菜单（显示在卡片右上角）
    const openContextMenu = (e: React.TouchEvent | React.MouseEvent) => {
        // 获取卡片位置，菜单显示在卡片右上角
        const cardRect = cardRef.current?.getBoundingClientRect();
        if (cardRect) {
            setContextMenuPos({ x: cardRect.right - 10, y: cardRect.top + 10 });
        } else {
            const clientX = 'changedTouches' in e ? e.changedTouches[0].clientX : e.clientX;
            const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;
            setContextMenuPos({ x: clientX, y: clientY });
        }
        setShowContextMenu(true);
        clearLongPress();
    };

    // 关闭上下文菜单
    const closeContextMenu = () => {
        setShowContextMenu(false);
    };

    // 点击菜单外部关闭
    useEffect(() => {
        if (!showContextMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                closeContextMenu();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showContextMenu]);

    // 长按按钮处理
    const clearLongPress = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        longPressStartRef.current = null;
        setLongPressButton(null);
    };

    const handleLongPressStart = (buttonType: 'delete' | 'edit', e: React.TouchEvent | React.MouseEvent) => {
        clearLongPress();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        longPressStartRef.current = { x: clientX, y: clientY };
        setLongPressButton(buttonType);

        longPressTimerRef.current = window.setTimeout(() => {
            // 长按打开菜单而不是直接执行
            openContextMenu(e);
            clearLongPress();
        }, LONG_PRESS_THRESHOLD);
    };

    const handleLongPressMove = (e: React.TouchEvent) => {
        if (!longPressStartRef.current) return;
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - longPressStartRef.current.x);
        const dy = Math.abs(touch.clientY - longPressStartRef.current.y);
        if (dx > 10 || dy > 10) {
            clearLongPress();
        }
    };

    useEffect(() => {
        return () => clearLongPress();
    }, []);

    // Check if device is touch-enabled
    const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

    const handleCardClick = (e: React.MouseEvent) => {
        if (isTouchDevice) {
            setShowActions(prev => !prev);
        }
    };

    const shouldIgnoreSelectionTarget = (target: EventTarget | null) => {
        if (!(target instanceof Element)) return false;
        return Boolean(
            target.closest('button, input, textarea, [contenteditable="true"], [role="textbox"], .cm-editor, .cm-content')
        );
    };

    useEditFieldFocus(prefixEditRef, {
        enabled: isPrefixEditing,
        moveCaretToEnd: true,
        triggerKey: isPrefixEditing ? item.id : null
    });

    useEditFieldFocus(contentEditRef, {
        enabled: isBodyEditing,
        fitHeightToContent: true,
        moveCaretToEnd: true,
        triggerKey: isBodyEditing ? item.id : null
    });

    const isDraggedCard = isDragging && draggingId === item.id;

    return (
        <div
            ref={cardRef}
            key={item.id}
            data-clipboard-card="true"
            className={`${STYLES.CARD_CONTAINER} ${isAnyDragActive ? STYLES.CARD_ACTIVE : STYLES.CARD_INACTIVE} ${isSelected ? 'bg-[#18181B]' : ''} ${isDraggedCard && preservePositionWhileDragging ? 'ring-1 ring-sky-400/35 bg-[#17171A]' : ''} ${isDraggedCard && !preservePositionWhileDragging ? 'opacity-0 scale-[0.98]' : (isAnyDragActive ? 'cursor-grabbing' : 'cursor-default')}`}
            onContextMenu={(e) => handleContextMenu(e, item)}
            onMouseDownCapture={(e) => {
                if (e.button !== 0) return;
                if (shouldIgnoreSelectionTarget(e.target)) return;
                onSelect(item.id, e);
                e.stopPropagation();
            }}
            onClickCapture={(e) => {
                if (shouldIgnoreSelectionTarget(e.target)) return;
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                if (isAnyDragActive || isBodyEditing || isPrefixEditing) return;
                if (window.getSelection()?.toString()) return;
                if (clickTimeoutRef.current) {
                    clearTimeout(clickTimeoutRef.current);
                    clickTimeoutRef.current = null;
                }
                clickTimeoutRef.current = window.setTimeout(() => {
                    void Promise.resolve(handleCopy(item.content, item, true))
                        .then(() => {
                            onClearSelection?.();
                        });
                    clickTimeoutRef.current = null;
                }, 220);
            }}
            onDoubleClickCapture={() => {
                if (clickTimeoutRef.current) {
                    clearTimeout(clickTimeoutRef.current);
                    clickTimeoutRef.current = null;
                }
            }}
        >
            {dragHandleProps && (
                <button
                    ref={dragHandleProps.setActivatorNodeRef as any}
                    {...dragHandleProps.listeners}
                    {...dragHandleProps.attributes}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`absolute left-1.5 top-1/2 -translate-y-1/2 w-[12px] h-[20px] cursor-grab active:cursor-grabbing z-20 transition-opacity flex items-center justify-center ${isTouchDevice ? 'opacity-40' : 'opacity-0 group-hover/card:opacity-40 hover:opacity-40'}`}
                    title={language === 'en' ? 'Drag to reorder' : '拖动排序'}
                    aria-label="Drag card"
                    type="button"
                >
                    <span className="grid grid-cols-2 gap-[2px]">
                        {Array.from({ length: 6 }).map((_, idx) => (
                            <span
                                key={idx}
                                className="w-[3px] h-[3px] rounded-full bg-white/30"
                            />
                        ))}
                    </span>
                </button>
            )}
            <div className="flex items-center justify-between">
                {(() => {
                    // Detect prefix pattern "Name: Content"
                    const match = parsedContent;
                    const isEditingPrefix = match && editingTag?.itemId === item.id && editingTag?.tagIndex === 0;
                    const isEditingBody = editingContent?.itemId === item.id;
                    const content = match ? match.body : normalizedContent;
                    const prefix = match ? match.prefix : '';
                    const separator = match ? match.separator : '';

                    return (
                        <div className={`flex w-full pr-10 text-[14px] leading-relaxed text-white/70 font-medium transition-colors duration-200 group-hover:text-white/95 tracking-wide ${isEditingBody ? 'items-start' : 'items-center'}`}>
                            {(() => {
                                if (item.type === 'IMAGE') {
                                    const imgSrc = item.content.startsWith('data:image/')
                                        ? item.content
                                        : convertFileSrc(item.content);
                                    return (
                                        <div className="flex-1 overflow-hidden rounded-lg bg-black/20 p-1 flex items-center justify-center min-h-[60px]">
                                            <img
                                                src={imgSrc}
                                                alt="History item"
                                                className="max-w-full max-h-[120px] object-contain rounded hover:scale-[1.02] transition-transform duration-300 shadow-lg"
                                                draggable={false}
                                                loading="lazy"
                                            />
                                        </div>
                                    );
                                }

                                // Color Detection Logic
                                const isHex = /^#?([0-9A-F]{3}|[0-9A-F]{4}|[0-9A-F]{6}|[0-9A-F]{8})$/i.test(item.content);
                                const isRgba = /^rgba?\(.+\)$/i.test(item.content);
                                const isHsla = /^hsla?\(.+\)$/i.test(item.content);

                                if ((isHex || isRgba || isHsla) && !isEditingBody) {
                                    const colorValue = isHex && !item.content.startsWith('#') ? `#${item.content}` : item.content;
                                    return (
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-6 h-6 rounded-full border border-white/10 shadow-lg shrink-0"
                                                style={{ backgroundColor: colorValue }}
                                                title={colorValue}
                                            />
                                            <span
                                                className="select-text cursor-text font-mono hover:text-white transition-colors truncate flex-1 min-w-0"
                                                onClick={(e) => e.stopPropagation()}
                                                onDoubleClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setEditingContent({ itemId: item.id, value: item.content });
                                                }}
                                            >
                                                {item.content}
                                            </span>
                                        </div>
                                    );
                                }

                                if (match) {
                                    return (
                                        <>
                                            <span className="relative inline-block mr-2 align-middle shrink-0 my-0.5" onClick={(e) => e.stopPropagation()}>
                                                <span
                                                    onDoubleClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setEditingTag({ itemId: item.id, tagIndex: 0, value: prefix, startTime: Date.now(), source: 'content-prefix' });
                                                    }}
                                                    className={`inline-block px-4 py-2.5 rounded-[16px] text-[14px] font-semibold select-text align-middle transition-all bg-gradient-to-br from-white/[0.08] to-white/[0.02] text-white/90 tracking-wider hover:from-white/[0.12] hover:to-white/[0.05] hover:text-white cursor-text shadow-sm shadow-black/40 ${isEditingPrefix ? 'opacity-0' : 'opacity-100'}`}
                                                >
                                                    {isEditingPrefix ? (editingTag.value || ' ') : prefix}
                                                </span>
                                                {isEditingPrefix && (
                                                    <input
                                                        ref={prefixEditRef}
                                                        autoFocus
                                                        className="absolute inset-0 w-full h-full px-4 py-2.5 bg-gradient-to-br from-[#1a1a1c] to-[#121214] text-white/90 rounded-[16px] text-[14px] font-semibold outline-none z-10 tracking-wider shadow-xl border border-white/10"
                                                        value={editingTag.value}
                                                        onChange={(e) => setEditingTag({ ...editingTag, value: e.target.value })}
                                                        onBlur={(e) => commitEditTag(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') commitEditTag((e.target as HTMLInputElement).value);
                                                            if (e.key === 'Escape') setEditingTag(null);
                                                        }}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                )}
                                            </span>
                                            {isEditingBody ? (
                                                <textarea
                                                    ref={contentEditRef}
                                                    className="bg-gradient-to-br from-[#121214] to-[#09090B] text-[#71717B] font-semibold tracking-wider text-[14px] outline-none focus:ring-0 border-none flex-1 min-w-0 align-middle resize-y overflow-hidden rounded-md p-2 leading-relaxed"
                                                    value={editingContent.value}
                                                    rows={1}
                                                    onChange={(e) => {
                                                        setEditingContent({ ...editingContent, value: e.target.value });
                                                        e.target.style.height = 'auto';
                                                        e.target.style.height = e.target.scrollHeight + 'px';
                                                    }}
                                                    onBlur={commitEditContent}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && !e.shiftKey) {
                                                            e.preventDefault();
                                                            commitEditContent();
                                                        }
                                                        if (e.key === 'Escape') setEditingContent(null);
                                                    }}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <span
                                                    className={`select-text cursor-text hover:text-white transition-colors block truncate w-full min-w-0 ${!content?.trim() ? 'text-white/20' : ''}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDoubleClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setEditingContent({ itemId: item.id, value: content, prefix, separator });
                                                    }}
                                                >
                                                    {content?.trim() ? content : t.modal_input_placeholder}
                                                </span>
                                            )}
                                        </>
                                    );
                                }

                                // Fallback for regular items
                                return isEditingBody ? (
                                    <textarea
                                        ref={contentEditRef}
                                        className="bg-gradient-to-br from-[#121214] to-[#09090B] text-white/80 font-medium tracking-wide text-[14px] outline-none focus:ring-0 border-none w-full align-middle resize-y overflow-hidden rounded-md p-2 leading-relaxed"
                                        value={editingContent.value}
                                        rows={1}
                                        onChange={(e) => {
                                            setEditingContent({ ...editingContent, value: e.target.value });
                                            e.target.style.height = 'auto';
                                            e.target.style.height = e.target.scrollHeight + 'px';
                                        }}
                                        onBlur={commitEditContent}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                commitEditContent();
                                            }
                                            if (e.key === 'Escape') setEditingContent(null);
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <span
                                        className={`select-text cursor-text hover:text-white transition-colors block truncate w-full min-w-0 ${!item.content?.trim() ? 'text-white/20' : ''}`}
                                        onClick={(e) => e.stopPropagation()}
                                        onDoubleClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setEditingContent({ itemId: item.id, value: item.content });
                                        }}
                                    >
                                        {item.content?.trim() ? item.content : t.modal_input_placeholder}
                                    </span>
                                );
                            })()}
                        </div>
                    );
                })()}
            </div>

            {/* 长按弹出上下文菜单 */}
            {showContextMenu && (
                <div
                    ref={contextMenuRef}
                    className="fixed z-50 bg-[#2A2A32] rounded-xl shadow-2xl border border-white/10 py-1 min-w-[160px]"
                    style={{
                        left: Math.min(contextMenuPos.x, window.innerWidth - 180),
                        top: Math.min(contextMenuPos.y, window.innerHeight - 180),
                    }}
                >
                    <button
                        onClick={() => {
                            startEditItem(item, null);
                            closeContextMenu();
                        }}
                        className="w-full px-4 py-3 text-left text-white/90 hover:bg-white/10 flex items-center gap-3 transition-colors"
                    >
                        <Icon name="edit" size={18} />
                        <span>{t.edit || '编辑'}</span>
                    </button>
                    <button
                        onClick={() => {
                            removeItem(item.id, null);
                            closeContextMenu();
                        }}
                        className="w-full px-4 py-3 text-left text-red-400 hover:bg-white/10 flex items-center gap-3 transition-colors"
                    >
                        <Icon name="delete" size={18} />
                        <span>{t.delete}</span>
                    </button>
                </div>
            )}
        </div>
    );
};

