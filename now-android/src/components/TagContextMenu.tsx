import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { ClipboardItem } from '../types';

interface TagContextMenuProps {
    x: number;
    y: number;
    item: ClipboardItem;
    tag: string;
    tagIdx: number;
    onClose: () => void;
    onRemoveTag: (tag: string) => void;
    onRenameTag: (tagIdx: number, value: string) => void;
    onDuplicateTag: () => void;
    onOpenLocation?: () => void;
    onCopyAsFile?: () => void;
}

const TagContextMenu: React.FC<TagContextMenuProps> = ({
    x,
    y,
    item,
    tag,
    tagIdx,
    onClose,
    onRemoveTag,
    onRenameTag,
    onDuplicateTag,
    onOpenLocation,
}) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x, y });
    const menuWidth = 176;

    useEffect(() => {
        if (menuRef.current) {
            const menuHeight = menuRef.current.offsetHeight || 152;
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            let newX = x;
            let newY = y;

            if (x + menuWidth > windowWidth) newX = x - menuWidth;
            if (y + menuHeight > windowHeight) newY = y - menuHeight;

            if (newX < 0) newX = 5;
            if (newY < 0) newY = 5;

            setPos({ x: newX, y: newY });
        }

        const handleOutsideClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        window.addEventListener('mousedown', handleOutsideClick);
        return () => window.removeEventListener('mousedown', handleOutsideClick);
    }, [x, y, onClose, menuWidth]);

    return (
        <div
            ref={menuRef}
            data-floating-menu="true"
            className="fixed z-[1000] bg-[#09090B] border border-white/10 rounded-xl shadow-2xl p-1.5"
            style={{ left: pos.x, top: pos.y, width: `${menuWidth}px` }}
            onContextMenu={(e) => e.preventDefault()}
        >
            {item.type === 'DOCUMENT' && (
                <button
                    onClick={(e) => { e.stopPropagation(); onOpenLocation?.(); onClose(); }}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group"
                >
                    <Icon name="folder_open" size={16} className="text-white/40 group-hover:text-white" />
                    <span className="text-[13px] font-medium">打开路径</span>
                </button>
            )}

            <button
                onClick={() => { onDuplicateTag(); onClose(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group"
            >
                <Icon name="content_copy" size={16} className="text-white/40 group-hover:text-white" />
                <span className="text-[13px] font-medium">创建副本</span>
            </button>

            <button
                onClick={() => { onRenameTag(tagIdx, tag); onClose(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group"
            >
                <Icon name="edit" size={16} className="text-white/40 group-hover:text-white" />
                <span className="text-[13px] font-medium">重命名</span>
            </button>

            <div className="h-[1px] bg-white/5 my-1"></div>

            <button
                onClick={() => { onRemoveTag(tag); onClose(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-red-400/60 hover:bg-red-500/15 hover:text-red-400 transition-all text-left group"
            >
                <Icon name="delete" size={16} className="text-red-400/40 group-hover:text-red-400/70" />
                <span className="text-[13px] font-medium">移除标签</span>
            </button>
        </div>
    );
};

export default TagContextMenu;
