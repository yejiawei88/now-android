import React, { useState, useEffect } from 'react';
import { ClipboardItem } from '../types';
import Icon from './Icon';
import { invoke } from '@tauri-apps/api/core';

interface DocumentListModalProps {
    isOpen: boolean;
    onClose: () => void;
    item: ClipboardItem | null;
    activeLibraryId: string;
    onItemUpdated: (updatedItem: ClipboardItem) => void;
    onOpenEditor: (item: ClipboardItem, index: number) => void;
}

const DocumentListModal: React.FC<DocumentListModalProps> = ({
    isOpen,
    onClose,
    item,
    activeLibraryId,
    onItemUpdated,
    onOpenEditor
}) => {
    // Local state for the item to trigger re-renders when status changes
    const [localItem, setLocalItem] = useState<ClipboardItem | null>(null);

    useEffect(() => {
        setLocalItem(item);

        if (!item || item.type !== 'DOCUMENT' || item.documentContentLoaded !== false) {
            return;
        }

        let cancelled = false;
        void invoke<string>('db_get_item', {
            id: item.id,
            libraryId: activeLibraryId,
            includeDocumentContent: true
        }).then((itemJson) => {
            if (cancelled) return;
            const fullItem = JSON.parse(itemJson);
            if (fullItem) {
                setLocalItem(fullItem);
            }
        }).catch((error) => {
            console.error('Failed to hydrate document list modal item:', error);
        });

        return () => {
            cancelled = true;
        };
    }, [item, activeLibraryId]);

    if (!isOpen || !localItem) return null;

    const tags = localItem.tags || ['未命名文档'];
    const mainTitle = tags[0] || '未命名文档';
    const subTasks = tags.slice(1);

    // Helper to get multi-content map
    const getContentMap = (rawContent: string): Record<string, string> => {
        try {
            const parsed = JSON.parse(rawContent);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (e) {
            // Not a JSON map
        }
        return {};
    };

    const contentMap = getContentMap(localItem.content);

    const taskCount = subTasks.filter(taskName => {
        const statusKey = `__status_${taskName}`;
        return contentMap[statusKey] !== 'DONE';
    }).length;

    const handleToggleStatus = async (e: React.MouseEvent, tagIndex: number, tagName: string) => {
        e.stopPropagation();

        const statusKey = `__status_${tagName}`;
        const currentStatus = contentMap[statusKey] || 'DOING';
        const newStatus = currentStatus === 'DONE' ? 'DOING' : 'DONE';

        const newMap = { ...contentMap, [statusKey]: newStatus };

        let updatedItem = {
            ...localItem,
            content: JSON.stringify(newMap)
        };

        if (localItem.type === 'DOCUMENT' && localItem.documentContentLoaded === false) {
            const fullItemJson = await invoke<string>('db_get_item', {
                id: localItem.id,
                libraryId: activeLibraryId,
                includeDocumentContent: true
            });
            const fullItem = JSON.parse(fullItemJson);
            if (fullItem) {
                updatedItem = {
                    ...fullItem,
                    ...updatedItem,
                    content: JSON.stringify(newMap),
                    documentContentLoaded: true
                };
            }
        }

        setLocalItem(updatedItem); // Optimistic UI update
        onItemUpdated(updatedItem);

        try {
            await invoke('db_upsert_item', {
                itemJson: JSON.stringify(updatedItem),
                libraryId: activeLibraryId
            });
            window.dispatchEvent(new CustomEvent('clipboard-updated'));
        } catch (error) {
            console.error('Failed to update status:', error);
            // Revert on failure
            setLocalItem(localItem);
            onItemUpdated(localItem);
        }
    };

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    };

    const formattedDate = formatDate(localItem.timestamp);

    return (
        <div className="fixed inset-0 z-[100] bg-[#09090B] flex flex-col animate-in fade-in duration-200">
            {/* Header like DocumentEditorView */}
            <header className="fixed top-0 left-0 right-0 z-50 flex items-end justify-between pl-8 pr-4 pb-4 border-b border-white/[0.04] bg-[#09090B] shrink-0 h-24 transition-all duration-300">
                {/* Back button at top left window bar */}
                <button
                    onClick={onClose}
                    className="fixed top-1 left-6 z-[60] group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md appearance-none !bg-transparent hover:!bg-transparent active:!bg-transparent focus:!bg-transparent focus-visible:!bg-transparent border-0 shadow-none ring-0 active:scale-95 transition-all outline-none"
                    title="返回"
                >
                    <Icon name="arrow_back" size={15} className="text-white/50 group-hover:text-white/90 transition-colors" />
                    <span className="text-[12px] font-medium text-white/50 group-hover:text-white/90 transition-colors">返回</span>
                </button>

                <div className="flex items-center gap-6 pl-2">
                    <div className="flex flex-col justify-center min-w-[120px]">
                        <div className="flex items-center gap-3">
                            <span className="text-[20px] font-semibold tracking-wider text-white/80">{mainTitle}</span>
                            <div className="px-2.5 py-1 rounded-full bg-white/5 text-white/50 text-[12px] font-medium mt-1">
                                {taskCount} 个任务
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Empty placeholder to keep justify-between balance if needed, or window controls are on top */}
                </div>
            </header>

            {/* List Body */}
            <div className="flex-1 mt-24 overflow-y-auto px-6 py-8 custom-scrollbar">
                <div className="max-w-[800px] mx-auto flex flex-col gap-3 pb-20">
                    {subTasks.map((taskName, index) => {
                        const actualIndex = index + 1;
                        const statusKey = `__status_${taskName}`;
                        const status = contentMap[statusKey] || 'DOING';
                        const isDone = status === 'DONE';
                        return { taskName, actualIndex, isDone };
                    }).sort((a, b) => {
                        if (a.isDone === b.isDone) return a.actualIndex - b.actualIndex;
                        return a.isDone ? 1 : -1;
                    }).map(({ taskName, actualIndex, isDone }, displayIndex) => {

                        return (
                            <div
                                key={`${taskName}-${actualIndex}`}
                                onClick={() => {
                                    onClose();
                                    onOpenEditor(localItem, actualIndex);
                                }}
                                className={`group flex flex-col p-5 rounded-2xl border transition-all cursor-pointer ${isDone
                                    ? 'bg-gradient-to-br from-[#121214]/50 to-[#09090B]/50 border-white/[0.02] hover:bg-white/5' // Muted gradient for done
                                    : 'bg-gradient-to-br from-[#121214] to-[#09090B] border-white/5 hover:border-white/10 hover:from-[#1C1C1E] hover:to-[#09090B]' // Active gradient
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col gap-2">
                                        <span className={`text-[16px] font-medium transition-colors ${isDone ? 'text-white/30' : 'text-white/90 group-hover:text-white'
                                            }`}>
                                            {taskName}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        {/* Open Path Button */}
                                        <button
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                try {
                                                    const { open } = await import('@tauri-apps/plugin-shell');
                                                    await open(taskName);
                                                } catch (err) {
                                                    console.error("Failed to open path", err);
                                                }
                                            }}
                                            className="w-7 h-7 rounded flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all opacity-0 group-hover:opacity-100"
                                            title="打开文件路径"
                                        >
                                            <Icon name="folder_open" size={16} />
                                        </button>

                                        {/* Toggle Button */}
                                        <button
                                            onClick={(e) => handleToggleStatus(e, actualIndex, taskName)}
                                            className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all group/btn relative
                                                    ${isDone
                                                    ? 'bg-white/20 border-white/10 text-white/60 opacity-100'
                                                    : 'border-white/20 hover:border-white/40 text-transparent opacity-0 group-hover:opacity-100'
                                                } transition-opacity duration-200`}
                                            title={isDone ? "取消已完成" : "标记为已完成"}
                                        >
                                            {isDone && <Icon name="check" size={16} className="font-bold stroke-[3px]" />}

                                            {/* Hover Text Tooltip */}
                                            <div className="absolute -top-10 right-1/2 translate-x-1/2 px-2.5 py-1.5 bg-white text-black text-[12px] font-medium rounded opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-xl">
                                                {isDone ? "取消已完成" : "标记为已完成"}
                                                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45"></div>
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {subTasks.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-white/30">
                            <Icon name="description" size={48} className="mb-4 opacity-50" />
                            <p>没有子任务</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DocumentListModal;
