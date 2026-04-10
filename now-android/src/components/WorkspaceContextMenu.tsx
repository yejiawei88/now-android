import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

interface WorkspaceContextMenuProps {
    x: number;
    y: number;
    onClose: () => void;
    onAdd: (type: 'TEXT' | 'TAGS' | 'DOCUMENT') => void;
}

const WorkspaceContextMenu: React.FC<WorkspaceContextMenuProps> = ({ x, y, onClose, onAdd }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x, y });
    const menuWidth = 148;

    useEffect(() => {
        if (menuRef.current) {
            const menuHeight = menuRef.current.offsetHeight || 120;
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

        window.addEventListener('mousedown', handleOutsideClick, true);
        return () => window.removeEventListener('mousedown', handleOutsideClick, true);
    }, [x, y, onClose, menuWidth]);

    return (
        <div
            ref={menuRef}
            data-floating-menu="true"
            className="fixed z-[1000] bg-[#09090B] border border-white/10 rounded-xl shadow-2xl p-1.5 overflow-visible"
            style={{ left: pos.x, top: pos.y, width: `${menuWidth}px` }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <button
                onClick={() => { onAdd('TEXT'); onClose(); }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group/item"
            >
                <Icon name="article" size={14} className="text-white/40 group-hover/item:text-white/70" />
                <span className="text-[13px] font-medium">添加内容卡片</span>
            </button>
            <button
                onClick={() => { onAdd('TAGS'); onClose(); }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group/item"
            >
                <Icon name="label" size={14} className="text-white/40 group-hover/item:text-white/70" />
                <span className="text-[13px] font-medium">添加标签卡片</span>
            </button>
            <button
                onClick={() => { onAdd('DOCUMENT'); onClose(); }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group/item"
            >
                <Icon name="description" size={14} className="text-white/40 group-hover/item:text-white/70" />
                <span className="text-[13px] font-medium">添加文档卡片</span>
            </button>
        </div>
    );
};

export default WorkspaceContextMenu;
