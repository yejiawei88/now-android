import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { ClipboardItem } from '../types';

interface ContextMenuProps {
    x: number;
    y: number;
    item: ClipboardItem;
    categories: string[];
    onClose: () => void;
    onMove: (category: string) => void;
    onDelete: (id: string) => void;
    onDuplicate: (id: string) => void;
    onAdd: (type: 'TEXT' | 'TAGS' | 'DOCUMENT', parent?: ClipboardItem) => void;
    onEdit: (item: ClipboardItem) => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, item, categories, onClose, onMove, onDelete, onDuplicate, onAdd, onEdit }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x, y });
    const [openLeft, setOpenLeft] = useState(false);
    const rootMenuWidth = 168;
    const addSubmenuWidth = 128;
    const moveSubmenuWidth = 148;

    const isDocument = item.type === 'DOCUMENT';
    const isTags = item.type === 'TAGS';
    const isNormal = !isDocument && !isTags;

    useEffect(() => {
        if (menuRef.current) {
            const menuWidth = rootMenuWidth;
            const menuHeight = menuRef.current.offsetHeight || 150;
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            let newX = x;
            let newY = y;

            if (x + menuWidth > windowWidth) newX = x - menuWidth;
            if (y + menuHeight > windowHeight) newY = y - menuHeight;
            
            if (newX < 0) newX = 5;
            if (newY < 0) newY = 5;

            setPos({ x: newX, y: newY });
            
            // Check if submenu will go off screen to the right
            const maxSubmenuWidth = Math.max(addSubmenuWidth, moveSubmenuWidth);
            if (newX + menuWidth + maxSubmenuWidth > windowWidth) {
                setOpenLeft(true);
            } else {
                setOpenLeft(false);
            }
        }

        const handleOutsideClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        window.addEventListener('mousedown', handleOutsideClick, true);
        return () => window.removeEventListener('mousedown', handleOutsideClick, true);
    }, [x, y, onClose, rootMenuWidth]);

    // Filter out restricted categories and the current one
    const otherCategories = categories.filter(c => 
        c !== item.category && 
        c !== '历史' && 
        c !== 'History' && 
        c !== '全部' && 
        c !== 'All'
    );

    return (
        <div
            ref={menuRef}
            data-floating-menu="true"
            className="fixed z-[1000] bg-[#09090B] border border-white/10 rounded-xl shadow-2xl overflow-visible p-1.5"
            style={{ left: pos.x, top: pos.y, width: `${rootMenuWidth}px` }}
        >
            {!isNormal && (
                <>
                    <div className="relative group/addmenu">
                        <button className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group">
                            <Icon name="add" size={16} className="text-white/40 group-hover:text-white" />
                            <span className="text-[13px] font-medium flex-1">新增项目</span>
                            <Icon name="chevron_right" size={12} className={`text-white/20 ${openLeft ? 'rotate-180' : ''}`} />
                        </button>
                        
                        <div className={`absolute ${openLeft ? 'right-[100%] pr-1' : 'left-[100%] pl-1'} top-[-5px] opacity-0 pointer-events-none group-hover/addmenu:opacity-100 group-hover/addmenu:pointer-events-auto transition-all duration-200 transform ${openLeft ? 'translate-x-[4px] group-hover/addmenu:translate-x-0' : 'translate-x-[-4px] group-hover/addmenu:translate-x-0'} z-[1001]`}>
                            <div
                                className="bg-[#09090B]/98 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl p-1.5 ring-1 ring-black/50"
                                style={{ width: `${addSubmenuWidth}px` }}
                            >
                                {isNormal && (
                                    <button
                                        onClick={() => { onAdd('TEXT', item); onClose(); }}
                                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-all text-left group/item"
                                    >
                                        <Icon name="article" size={14} className="text-white/20 group-hover/item:text-white/50" />
                                        <span className="text-[13px]">内容</span>
                                    </button>
                                )}
                                
                                {(isTags || isNormal) && (
                                    <button
                                        onClick={() => { onAdd('TAGS', item); onClose(); }}
                                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-all text-left group/item"
                                    >
                                        <Icon name="label" size={14} className="text-white/20 group-hover/item:text-white/50" />
                                        <span className="text-[13px]">标签组</span>
                                    </button>
                                )}
                                
                                {isDocument && (
                                    <button
                                        onClick={() => { onAdd('TAGS', item); onClose(); }}
                                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-all text-left group/item"
                                    >
                                        <Icon name="create_new_folder" size={14} className="text-white/20 group-hover/item:text-white/50" />
                                        <span className="text-[13px]">文件夹</span>
                                    </button>
                                )}

                                {(isDocument || isNormal) && (
                                    <button
                                        onClick={() => { onAdd('DOCUMENT', item); onClose(); }}
                                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-all text-left group/item"
                                    >
                                        <Icon name="description" size={14} className="text-white/20 group-hover/item:text-white/50" />
                                        <span className="text-[13px]">文档</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="h-[1px] bg-white/5 my-1"></div>
                </>
            )}

            <div className="relative group/submenu">
                <button className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group">
                    <Icon name="folder_managed" size={16} className="text-white/40 group-hover:text-white" />
                    <span className="text-[13px] font-medium flex-1">移动到分组</span>
                    <Icon name="chevron_right" size={12} className={`text-white/20 ${openLeft ? 'rotate-180' : ''}`} />
                </button>
                
                <div className={`absolute ${openLeft ? 'right-[100%] pr-1' : 'left-[100%] pl-1'} top-[-5px] opacity-0 pointer-events-none group-hover/submenu:opacity-100 group-hover/submenu:pointer-events-auto transition-all duration-200 transform ${openLeft ? 'translate-x-[4px] group-hover/submenu:translate-x-0' : 'translate-x-[-4px] group-hover/submenu:translate-x-0'}`}>
                    <div
                        className="bg-[#09090B] border border-white/10 rounded-xl shadow-2xl p-1.5 max-h-[232px] overflow-y-auto custom-scrollbar ring-1 ring-black/50"
                        style={{ width: `${moveSubmenuWidth}px` }}
                    >
                        {otherCategories.length === 0 ? (
                            <div className="px-3 py-2 text-[12px] text-white/30 italic">没有其他分组</div>
                        ) : (
                            otherCategories.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => { onMove(cat); onClose(); }}
                                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-white/80 hover:bg-white/10 hover:text-white transition-all text-left truncate group/item"
                                >
                                    <Icon name="label" size={14} className="text-white/20 group-hover/item:text-white/50" />
                                    <span className="text-[13px] truncate">{cat}</span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <button
                onClick={() => { onEdit(item); onClose(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group"
            >
                <Icon name="edit" size={16} className="text-white/40 group-hover:text-white" />
                <span className="text-[13px] font-medium">编辑</span>
            </button>

            <div className="h-[1px] bg-white/5 my-1"></div>

            <button
                onClick={() => { onDuplicate(item.id); onClose(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white transition-all text-left group"
            >
                <Icon name="content_copy" size={16} className="text-white/40 group-hover:text-white" />
                <span className="text-[13px] font-medium">创建副本</span>
            </button>

            <div className="h-[1px] bg-white/5 my-1"></div>

            <button
                onClick={() => { onDelete(item.id); onClose(); }}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-red-400/60 hover:bg-red-500/15 hover:text-red-400 transition-all text-left group"
            >
                <Icon name="delete" size={16} className="text-red-400/40 group-hover:text-red-400/70" />
                <span className="text-[13px] font-medium">删除项目</span>
            </button>
        </div>
    );
};

export default ContextMenu;
