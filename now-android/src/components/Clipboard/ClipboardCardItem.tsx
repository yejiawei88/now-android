import React, { useState } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { ClipboardItem } from '../../types';
import { TagCard } from './TagCard';
import { ContentCard } from './ContentCard';
import { useClipboard } from '../../context/ClipboardContext';
import { useLongPress } from '../../hooks/useLongPress';

export interface ClipboardCardItemProps {
    item: ClipboardItem;
    index: number;
    draggingIndex: number | null;
    isAnyDragActive: boolean;
    isDragging: boolean;
    draggingId: string | null;
    preservePositionWhileDragging?: boolean;
    isSelected: boolean;
    cardDropHintMode?: 'merge' | 'before' | 'after' | null;
    onSelect: (itemId: string, event?: React.MouseEvent) => void;
    onClearSelection?: () => void;
    dragHandleProps?: {
        attributes: any;
        listeners: any;
        setActivatorNodeRef: (element: HTMLElement | null) => void;
    };
}

export const ClipboardCardItem: React.FC<ClipboardCardItemProps> = ({
    item,
    index,
    draggingIndex,
    isAnyDragActive,
    isDragging,
    draggingId,
    preservePositionWhileDragging = false,
    isSelected,
    cardDropHintMode,
    onSelect,
    onClearSelection,
    dragHandleProps
}) => {
    const {
        editingTag, setEditingTag, editingContent, setEditingContent, commitEditTag, commitEditContent,
        handleCopy, startEditItem, removeItem, setItems, activeLibraryId, pasteTagsWithComma, bilingualTagsEnabled, translationSettings, language,
        handleAddTag, onOpenEditor, handleContextMenu, handleTagContextMenu, handleEnterFolder, handleMoveTagToFolder, handleCombineDocumentTagsIntoFolder,
        pasteDocumentTags, removeDocumentTagsBulk
    } = useClipboard();

    // 长按视觉反馈状态
    const [isLongPressActive, setIsLongPressActive] = useState(false);

    // 长按处理
    const longPress = useLongPress({
        threshold: 500,
        onLongPress: (e) => {
            // 获取触发位置
            const touch = 'touches' in e ? e.touches[0] : null;
            const clientX = touch ? touch.clientX : (e as React.MouseEvent).clientX;
            const clientY = touch ? touch.clientY : (e as React.MouseEvent).clientY;
            
            // 创建模拟的鼠标事件
            const syntheticEvent = {
                ...e,
                clientX,
                clientY,
                preventDefault: () => {},
                stopPropagation: () => {},
            } as React.MouseEvent;
            
            handleContextMenu(syntheticEvent, item);
            setIsLongPressActive(false);
        },
        onPress: () => {
            setIsLongPressActive(false);
        },
        onCancel: () => {
            setIsLongPressActive(false);
        },
    });

    const handleUpdateTagsInternal = async (newTags: string[]) => {
        let newItem = { ...item, tags: newTags };
        if (item.type === 'TAGS') {
            newItem.content = newTags.join(', ');
        }
        if (item.type === 'DOCUMENT' && item.documentContentLoaded === false) {
            const fullItemJson = await invoke<string>('db_get_item', {
                id: item.id,
                libraryId: activeLibraryId,
                includeDocumentContent: true
            });
            const fullItem = JSON.parse(fullItemJson);
            if (fullItem) {
                newItem = {
                    ...fullItem,
                    ...newItem,
                    content: fullItem.content,
                    documentContentLoaded: true
                };
            }
        }
        setItems(prev => prev.map(p => p.id === newItem.id ? newItem : p));
        await invoke('db_upsert_item', {
            itemJson: JSON.stringify(newItem),
            libraryId: activeLibraryId
        });
    };

    const cardContent = item.type === 'TAGS' || item.type === 'DOCUMENT'
        ? (
            <TagCard
                key={item.id}
                item={item}
                index={index}
                draggingIndex={draggingIndex}
                isSelected={isSelected}
                isEditingItem={editingTag?.itemId === item.id}
                editingTag={editingTag}
                setEditingTag={setEditingTag}
                pasteTagsWithComma={pasteTagsWithComma}
                bilingualTagsEnabled={bilingualTagsEnabled}
                translationSettings={translationSettings}
                activeLibraryId={activeLibraryId}
                handleCopy={(content: string, _: any, shouldHide: boolean, copyOnly?: boolean) =>
                    handleCopy(content, item, shouldHide, copyOnly)
                }
                onUpdateTags={handleUpdateTagsInternal}
                onAddTag={() => handleAddTag(item.id)}
                onDeleteCard={(itemId: string, e: any) => removeItem(itemId, e)}
                onEditCard={(item: any, e: any) => startEditItem(item, e)}
                handleManualDragEnter={() => { }}
                handleItemMouseDown={() => { }}
                handleItemMouseUpOrLeave={() => { }}
                language={language}
                commitEditTag={commitEditTag}
                isAnyDragActive={isAnyDragActive}
                onOpenEditor={onOpenEditor}
                onContextMenu={handleContextMenu}
                onTagContextMenu={handleTagContextMenu}
                onEnterFolder={handleEnterFolder}
                onMoveTagToFolder={handleMoveTagToFolder}
                onCombineDocumentTagsIntoFolder={handleCombineDocumentTagsIntoFolder}
                onPasteDocumentTags={pasteDocumentTags}
                onRemoveSelectedTags={(tags: string[]) => removeDocumentTagsBulk(item.id, tags)}
                onSelect={onSelect}
                dragHandleProps={dragHandleProps}
                preservePositionWhileDragging={preservePositionWhileDragging}
            />
        )
        : (
            <ContentCard
                item={item}
                isSelected={isSelected}
                isAnyDragActive={isAnyDragActive}
                isDragging={isDragging}
                draggingId={draggingId}
                editingTag={editingTag}
                setEditingTag={setEditingTag}
                editingContent={editingContent}
                setEditingContent={setEditingContent}
                commitEditTag={commitEditTag}
                commitEditContent={commitEditContent}
                handleContextMenu={handleContextMenu}
                removeItem={removeItem}
                startEditItem={startEditItem}
                language={language}
                onSelect={onSelect}
                onClearSelection={onClearSelection}
                handleCopy={handleCopy}
                dragHandleProps={dragHandleProps}
                preservePositionWhileDragging={preservePositionWhileDragging}
            />
        );

    return (
        <div 
            className={`relative ${isLongPressActive ? 'long-pressing scale-[0.98]' : ''}`} 
            data-card-drop-id={item.id}
            {...longPress.touchHandlers}
            {...longPress.mouseHandlers}
            onTouchStart={(e) => {
                setIsLongPressActive(true);
                longPress.touchHandlers.onTouchStart(e);
            }}
        >
            {cardContent}
            {cardDropHintMode === 'merge' && (
                <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[26px] border border-sky-300/55 bg-[linear-gradient(135deg,rgba(14,165,233,0.18),rgba(8,47,73,0.34))] shadow-[0_0_0_1px_rgba(125,211,252,0.14),0_24px_60px_rgba(8,47,73,0.28)] backdrop-blur-sm">
                    <div className="rounded-2xl border border-sky-200/20 bg-[#08141c]/90 px-5 py-3 text-center shadow-xl">
                        <div className="text-[11px] font-semibold tracking-[0.24em] text-sky-200/70">
                            {language === 'en' ? 'MERGE' : '合并文档'}
                        </div>
                        <div className="mt-1 text-[13px] font-medium text-sky-50">
                            {language === 'en' ? 'Drop here to combine into this document' : '松开后会合并到这个文档'}
                        </div>
                    </div>
                </div>
            )}
            {cardDropHintMode === 'before' && (
                <div className="pointer-events-none absolute left-5 right-5 top-0 -translate-y-1/2">
                    <div className="relative h-[3px] rounded-full bg-sky-400 shadow-[0_0_0_1px_rgba(125,211,252,0.28),0_0_18px_rgba(56,189,248,0.42)]">
                    </div>
                </div>
            )}
            {cardDropHintMode === 'after' && (
                <div className="pointer-events-none absolute left-5 right-5 bottom-0 translate-y-1/2">
                    <div className="relative h-[3px] rounded-full bg-sky-400 shadow-[0_0_0_1px_rgba(125,211,252,0.28),0_0_18px_rgba(56,189,248,0.42)]">
                    </div>
                </div>
            )}
        </div>
    );
};

export default ClipboardCardItem;
