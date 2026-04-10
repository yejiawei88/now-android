import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { useLongPress } from '../../hooks/useLongPress';

export interface TabCategoryProps {
    cat: string;
    activeTab: string;
    isEditing?: boolean;
    editValue?: string;
    editInputRef?: React.RefObject<HTMLInputElement | null>;
    isHoveringTarget: boolean;
    isDropTarget: boolean;
    listeners?: any;
    attributes?: any;
    style?: React.CSSProperties;
    className?: string;
    onClick?: () => void;
    onDoubleClick?: (e: React.MouseEvent) => void;
    onEditChange?: (value: string) => void;
    onEditBlur?: () => void;
    onEditKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    onMouseUp?: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    isAnyDragActive?: boolean;
}

export const TabCategory = React.forwardRef<HTMLDivElement, TabCategoryProps>(({
    cat,
    activeTab,
    isEditing,
    editValue,
    editInputRef,
    isHoveringTarget,
    isDropTarget,
    listeners,
    attributes,
    style,
    className,
    onClick,
    onDoubleClick,
    onEditChange,
    onEditBlur,
    onEditKeyDown,
    onMouseUp,
    onMouseEnter,
    onMouseLeave,
    onContextMenu,
    isAnyDragActive
}: any, ref: any) => {
    return (
        <div
            ref={ref}
            style={style}
            data-category-tab={cat}
            {...(isEditing ? {} : attributes)}
            {...(isEditing ? {} : listeners)}
            role="button"
            tabIndex={isEditing ? -1 : 0}
            onMouseDown={(e) => {
                if (isEditing) {
                    e.stopPropagation();
                    return;
                }
                if (e.detail > 1) {
                    e.preventDefault();
                }
                listeners?.onMouseDown?.(e);
            }}
            onClick={isEditing ? undefined : onClick}
            onDoubleClick={isEditing ? undefined : onDoubleClick}
            onKeyDown={(e) => {
                if (isEditing) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick?.();
                }
            }}
            onMouseUp={onMouseUp}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onContextMenu={onContextMenu}
            className={`group relative shrink-0 h-[36px] px-5 rounded-lg border border-transparent transition-all duration-300 flex items-center gap-2 no-drag ${isAnyDragActive ? 'cursor-grabbing' : 'cursor-pointer'} whitespace-nowrap active:cursor-grabbing text-[14px] font-bold tracking-wide select-none
            ${activeTab === cat
                    ? 'bg-[#121214] text-white border-white/5 shadow-sm'
                    : (isHoveringTarget
                        ? 'bg-[#121214] text-white border-white/5 shadow-sm scale-105'
                        : (isDropTarget
                            ? 'bg-white/5 text-white/70 border-dashed border-white/15 backdrop-blur-sm'
                            : 'bg-transparent text-[#71717B] hover:text-white hover:bg-white/5 hover:border-white/5'))} ${className || ''}`}
        >
            {isEditing ? (
                <input
                    ref={editInputRef}
                    autoFocus
                    size={Math.max((editValue ?? cat).length, 1)}
                    value={editValue ?? cat}
                    onChange={(e) => onEditChange?.(e.target.value)}
                    onBlur={onEditBlur}
                    onKeyDown={onEditKeyDown}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className="w-auto min-w-0 max-w-[10em] bg-transparent text-[14px] font-bold text-white outline-none"
                />
            ) : (
                isHoveringTarget ? '移动到这' : cat
            )}
        </div>
    );
});

export interface SortableCategoryItemProps {
    cat: string;
    activeTab: string;
    isEditing?: boolean;
    editValue?: string;
    editInputRef?: React.RefObject<HTMLInputElement | null>;
    onActivate: (cat: string) => void;
    onStartRename: (cat: string) => void;
    onEditChange?: (value: string) => void;
    onEditBlur?: () => void;
    onEditKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    handleDropToCategory: (cat: string) => void;
    draggingIndex: number | null;
    hoveredTargetCat: string | null;
    setHoveredTargetCat: (cat: string | null) => void;
    isDropTarget: boolean;
    isAnyDragActive: boolean;
    onContextMenu: (e: React.MouseEvent, cat: string) => void;
}

export const SortableCategoryItem = ({
    cat,
    activeTab,
    isEditing = false,
    editValue,
    editInputRef,
    onActivate,
    onStartRename,
    onEditChange,
    onEditBlur,
    onEditKeyDown,
    handleDropToCategory,
    draggingIndex,
    hoveredTargetCat,
    setHoveredTargetCat,
    isDropTarget,
    isAnyDragActive,
    onContextMenu
}: SortableCategoryItemProps) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: cat,
        disabled: draggingIndex !== null || isEditing
    });

    const style: React.CSSProperties = {
        transform: transform ? `translate3d(${Math.round(transform.x)}px, 0px, 0)` : undefined,
        transition: isDragging ? 'none' : transition,
        opacity: 1,
        background: isDragging ? '#121214' : 'transparent',
        zIndex: isDragging ? 50 : 'auto',
    };

    const isHoveringTarget = isDropTarget && hoveredTargetCat === cat;

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
            
            onContextMenu(syntheticEvent, cat);
            setIsLongPressActive(false);
        },
        onPress: () => {
            setIsLongPressActive(false);
        },
        onCancel: () => {
            setIsLongPressActive(false);
        },
    });

    return (
        <TabCategory
            ref={setNodeRef}
            cat={cat}
            activeTab={activeTab}
            isEditing={isEditing}
            editValue={editValue}
            editInputRef={editInputRef}
            isHoveringTarget={isHoveringTarget}
            isDropTarget={isDropTarget}
            listeners={listeners}
            attributes={attributes}
            style={style}
            onClick={() => onActivate(cat)}
            onDoubleClick={(e) => {
                if (cat === '历史' || cat === 'History') return;
                e.preventDefault();
                e.stopPropagation();
                onStartRename(cat);
            }}
            onEditChange={onEditChange}
            onEditBlur={onEditBlur}
            onEditKeyDown={onEditKeyDown}
            onMouseUp={() => handleDropToCategory(cat)}
            onMouseEnter={() => {
                if (isDropTarget) setHoveredTargetCat(cat);
            }}
            onMouseLeave={() => setHoveredTargetCat(null)}
            onContextMenu={(e) => onContextMenu(e, cat)}
            {...longPress.touchHandlers}
            {...longPress.mouseHandlers}
            onTouchStart={(e: React.TouchEvent<HTMLDivElement>) => {
                setIsLongPressActive(true);
                longPress.touchHandlers.onTouchStart(e);
            }}
            style={{
                ...style,
                transform: isLongPressActive ? `scale(0.95)` : style.transform,
            }}
            isAnyDragActive={isAnyDragActive}
        />
    );
};
