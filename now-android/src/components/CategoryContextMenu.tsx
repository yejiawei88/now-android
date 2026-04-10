import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

interface CategoryContextMenuProps {
    x: number;
    y: number;
    category: string;
    onClose: () => void;
    onRename: (category: string) => void;
    onDelete: (category: string) => void;
    onAddCategory: (category: string) => void;
}

const CategoryContextMenu: React.FC<CategoryContextMenuProps> = ({ x, y, category, onClose, onRename, onDelete, onAddCategory }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x, y });
    const rootMenuWidth = 148;

    useEffect(() => {
        if (menuRef.current) {
            const menuWidth = rootMenuWidth;
            const menuHeight = menuRef.current.offsetHeight || 100;
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
    }, [x, y, onClose, rootMenuWidth]);

    const isSystemCategory = category === '历史' || category === 'History' || category === '全部' || category === 'All';

    if (isSystemCategory) return null;

    return (
        <div
            ref={menuRef}
            data-floating-menu="true"
            className="fixed z-[1000] bg-[#09090B] border border-white/10 rounded-xl shadow-2xl overflow-visible p-1.5"
            style={{ left: pos.x, top: pos.y, width: `${rootMenuWidth}px` }}
        >
            <button
                onClick={() => { onAddCategory(category); onClose(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group"
            >
                <Icon name="library_add" size={16} className="text-white/40 group-hover:text-white" />
                <span className="text-[13px] font-medium">新增组</span>
            </button>

            <div className="h-[1px] bg-white/5 my-1"></div>

            <button
                onClick={() => { onRename(category); onClose(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group"
            >
                <Icon name="edit" size={16} className="text-white/40 group-hover:text-white" />
                <span className="text-[13px] font-medium">重命名</span>
            </button>

            <div className="h-[1px] bg-white/5 my-1"></div>

            <button
                onClick={() => { onDelete(category); onClose(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-red-400/60 hover:bg-red-500/15 hover:text-red-400 transition-all text-left group"
            >
                <Icon name="delete" size={16} className="text-red-400/40 group-hover:text-red-400/70" />
                <span className="text-[13px] font-medium">删除组</span>
            </button>
        </div>
    );
};

export default CategoryContextMenu;
