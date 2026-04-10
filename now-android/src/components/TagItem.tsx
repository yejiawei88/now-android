import React from 'react';
import Icon from './Icon';

const inferBilingualFromRawTag = (raw: string): { left: string; right: string } | null => {
    const text = (raw || '').trim();
    if (!text) return null;

    const fromPipe = (() => {
        const idx = text.indexOf('|');
        if (idx < 0) return null;
        const left = text.slice(0, idx).trim();
        const right = text.slice(idx + 1).trim();
        if (!left || !right) return null;
        return { left, right };
    })();
    if (fromPipe) return fromPipe;

    const firstZhIdx = text.search(/[\u4e00-\u9fff]/);
    const firstEnIdx = text.search(/[A-Za-z]/);
    if (firstZhIdx < 0 || firstEnIdx < 0) return null;

    const cleanBoundary = (value: string) => value.trim().replace(/^[|:/：\-\s]+|[|:/：\-\s]+$/g, '').trim();

    if (firstZhIdx < firstEnIdx) {
        const left = cleanBoundary(text.slice(0, firstEnIdx));
        const right = cleanBoundary(text.slice(firstEnIdx));
        if (left && right) return { left, right };
        return null;
    }

    if (firstEnIdx < firstZhIdx) {
        const left = cleanBoundary(text.slice(0, firstZhIdx));
        const right = cleanBoundary(text.slice(firstZhIdx));
        if (left && right) return { left, right };
        return null;
    }

    return null;
};

export const TagItem = React.forwardRef<HTMLDivElement, {
    tag: string,
    bilingualTag?: {
        left: string;
        right: string;
    } | null,
    onRemove?: (t: string) => void,
    onClick?: (e: React.MouseEvent) => void,
    onDoubleClick?: (e: React.MouseEvent) => void,
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    style?: React.CSSProperties,
    listeners?: any,
    attributes?: any,
    isOverlay?: boolean,
    isAnyDragActive?: boolean,
    className?: string,
    isActive?: boolean,
    iconName?: string,
    clickable?: boolean,
    onContextMenu?: (e: React.MouseEvent) => void,
    compact?: boolean,
    onBilingualSegmentClick?: (segment: 'left' | 'right', text: string, e: React.MouseEvent) => void
}>(
    ({ tag, bilingualTag, onRemove, onClick, onDoubleClick, onMouseEnter, onMouseLeave, onContextMenu, onBilingualSegmentClick, style, listeners, attributes, isOverlay, isAnyDragActive, className, isActive, iconName, clickable = true, compact = false }, ref) => {
        const [showRemove, setShowRemove] = React.useState(false);

        // Check if device is touch-enabled
        const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

        const handleTagClick = (e: React.MouseEvent) => {
            if (isTouchDevice && onRemove) {
                setShowRemove(prev => !prev);
            }
            onClick?.(e);
        };
        const isDragging = attributes?.["aria-pressed"] === true || isOverlay;
        const effectiveBilingualTag = React.useMemo(() => {
            if (bilingualTag?.left && bilingualTag?.right) return bilingualTag;
            return inferBilingualFromRawTag(tag);
        }, [bilingualTag, tag]);
        const isBilingual = Boolean(effectiveBilingualTag?.left && effectiveBilingualTag?.right);
        const chipPaddingClass = isBilingual ? 'px-0 py-0 overflow-hidden' : (compact ? 'px-3 py-2' : 'px-4 py-2.5');
        const chipRadiusClass = compact ? 'rounded-[14px]' : 'rounded-[16px]';
        const chipTextClass = compact ? 'text-[13px]' : 'text-[14px]';
        const segmentBaseSizeClass = compact ? 'py-2 text-[12px]' : 'py-2.5 text-[13px]';
        const segmentLeftPaddingClass = compact ? 'pl-3 pr-2' : 'pl-3.5 pr-2.5';
        const segmentRightPaddingClass = compact ? 'pl-2 pr-3' : 'pl-2.5 pr-3.5';

        return (
            <div
                ref={ref}
                style={style}
                {...attributes}
                {...listeners}
                onClick={handleTagClick}
                onDoubleClick={onDoubleClick}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
                onMouseDown={(e) => {
                    if (e.detail > 1) {
                        e.preventDefault();
                    }
                    // Stop propagation to prevent card drag (if any)
                    if (clickable) e.stopPropagation();
                    listeners?.onMouseDown?.(e);
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onContextMenu?.(e);
                }}
                className={`group relative flex items-center ${chipPaddingClass} ${chipRadiusClass} ${chipTextClass} font-medium select-none shrink-0 transition-all duration-150 ease-out
                ${isDragging ? 'z-[100] scale-105 shadow-2xl shadow-black/50' : (isAnyDragActive ? 'cursor-grabbing' : (clickable ? 'cursor-pointer hover:shadow-lg hover:shadow-black/20 hover:z-50' : 'cursor-default'))}
                ${isOverlay ? '!cursor-grabbing shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[99999] bg-[#161618] scale-105' : ''}
                ${clickable ? 'active:brightness-125 active:scale-[0.985]' : ''}
                ${onRemove && !isOverlay ? (isTouchDevice ? (showRemove ? 'pr-8' : '') : 'hover:pr-8') : ''}
                ${className || ''}`}
            >
                <div className="flex items-center gap-2">
                    {iconName && (
                        <Icon name={iconName} size={14} className="text-white/40 group-hover:text-white/60 shrink-0" />
                    )}
                    {isBilingual ? (
                        <div className="group/bilingual relative flex items-stretch rounded-[14px] bg-[#0F0F12]/65 overflow-hidden transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
                            {onBilingualSegmentClick ? (
                                <>
                                    <button
                                        type="button"
                                        className={`${segmentBaseSizeClass} ${segmentLeftPaddingClass} relative z-10 bg-gradient-to-b from-[#6C6C74]/84 to-[#54545D]/80 text-white/95 font-semibold tracking-wide leading-none transition-all duration-200 cursor-pointer`}
                                        onPointerDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onBilingualSegmentClick('left', effectiveBilingualTag!.left, e);
                                        }}
                                    >
                                        {effectiveBilingualTag!.left}
                                    </button>
                                    <div className="relative z-10 block self-center w-px h-[62%] bg-white/28 transition-colors duration-200 shrink-0" />
                                    <button
                                        type="button"
                                        className={`${segmentBaseSizeClass} ${segmentRightPaddingClass} relative z-10 bg-gradient-to-b from-[#88C67B]/88 to-[#6DAA63]/84 text-white font-semibold leading-none transition-all duration-200 cursor-pointer`}
                                        onPointerDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onBilingualSegmentClick('right', effectiveBilingualTag!.right, e);
                                        }}
                                    >
                                        {effectiveBilingualTag!.right}
                                    </button>
                                </>
                            ) : (
                                <>
                                    <span className={`${segmentBaseSizeClass} ${segmentLeftPaddingClass} relative z-10 bg-gradient-to-b from-[#6C6C74]/84 to-[#54545D]/80 text-white/95 font-semibold tracking-wide leading-none transition-all duration-200`}>
                                        {effectiveBilingualTag!.left}
                                    </span>
                                    <div className="relative z-10 block self-center w-px h-[62%] bg-white/28 transition-colors duration-200 shrink-0" />
                                    <span className={`${segmentBaseSizeClass} ${segmentRightPaddingClass} relative z-10 bg-gradient-to-b from-[#88C67B]/88 to-[#6DAA63]/84 text-white font-semibold leading-none transition-all duration-200`}>
                                        {effectiveBilingualTag!.right}
                                    </span>
                                </>
                            )}
                        </div>
                    ) : (() => {
                        const isHex = /^#?([0-9A-F]{3}|[0-9A-F]{4}|[0-9A-F]{6}|[0-9A-F]{8})$/i.test(tag);
                        const isRgba = /^rgba?\(.+\)$/i.test(tag);
                        const isHsla = /^hsla?\(.+\)$/i.test(tag);

                        if (isHex || isRgba || isHsla) {
                            const colorValue = isHex && !tag.startsWith('#') ? `#${tag}` : tag;
                            return (
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-3 h-3 rounded-full shadow-sm shrink-0"
                                        style={{ backgroundColor: colorValue }}
                                    />
                                    <span>{tag}</span>
                                </div>
                            );
                        }
                        return <span>{tag}</span>;
                    })()}
                </div>

                {!isOverlay && onRemove && (
                    <button
                        className={`absolute right-1.5 transition-opacity bg-white/10 hover:bg-white/20 text-white rounded-full p-0.5 flex items-center justify-center cursor-pointer ${isTouchDevice ? (showRemove ? 'opacity-100' : 'opacity-0') : 'opacity-0 group-hover:opacity-100'}`}
                        onPointerDown={(e) => {
                            e.stopPropagation();
                            // Prevent drag start on button
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            onRemove(tag);
                        }}
                    >
                        <Icon name="close" className="!text-[12px] font-bold" size={12} />
                    </button>
                )}
            </div >
        );
    }
);
