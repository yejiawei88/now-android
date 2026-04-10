import React, { useState, useEffect, useRef } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, DragOverlay } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import Icon from './Icon';
import { SortableCategoryItem, TabCategory } from './Clipboard/SortableCategoryItem';
import ClipboardAddMenu from './ClipboardAddMenu';
import { isAllLikeCategory, isHistoryLikeCategory } from '../constants';
import { useEditFieldFocus } from '../hooks/useEditFieldFocus';
import { AppSettings } from '../types';

export interface ClipboardHeaderProps {
    t: any;
    language?: 'zh' | 'en';
    
    // Search states & callbacks
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    isSearchActive: boolean;
    setIsSearchActive: (active: boolean) => void;
    searchInputRef: React.RefObject<HTMLInputElement>;

    // Category states & callbacks
    scrollRef: React.RefObject<HTMLDivElement>;
    categories: string[];
    onUpdateCategories: (cats: string[]) => void;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    editingCat: { old: string; new: string } | null;
    setEditingCat: (cat: { old: string; new: string } | null) => void;
    handleRenameCategory: () => Promise<void>;
    handleDropToCategory: (targetCat: string) => void;
    draggingIndex: number | null;
    hoveredTargetCat: string | null;
    setHoveredTargetCat: (cat: string | null) => void;
    isAnyDragActive: boolean;
    handleCategoryDragStart: (event: any) => void;
    handleCategoryDragEnd: (event: any) => void;
    activeCatId: string | null;
    onCategoryContextMenu: (e: React.MouseEvent, cat: string) => void;
    
    // Library states & callbacks
    libraries: { id: string; name: string }[];
    activeLibraryId: string;
    pasteTagsWithComma: boolean;
    pasteContentWithTags: boolean;
    onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
    onSwitchLibrary: (id: string) => void;
    onOpenManager: () => void;

    // Add modal/Menu callbacks
    handleCreateItem: (type: any, parent?: any) => void;
    setIsAddModalOpen: (open: boolean) => void;
}

export const ClipboardHeader: React.FC<ClipboardHeaderProps> = ({
    t, language,
    searchQuery, setSearchQuery, isSearchActive, setIsSearchActive, searchInputRef,
    scrollRef, categories, onUpdateCategories, activeTab, setActiveTab,
    editingCat, setEditingCat, handleRenameCategory,
    handleDropToCategory, draggingIndex, hoveredTargetCat, setHoveredTargetCat,
    isAnyDragActive, handleCategoryDragStart, handleCategoryDragEnd, activeCatId,
    onCategoryContextMenu,
    libraries, activeLibraryId, pasteTagsWithComma, pasteContentWithTags, onUpdateSetting, onSwitchLibrary, onOpenManager,
    handleCreateItem, setIsAddModalOpen
}) => {
    const headerRef = useRef<HTMLElement>(null);
    const libMenuCloseTimerRef = useRef<number | null>(null);
    const addMenuCloseTimerRef = useRef<number | null>(null);
    const categoryMenuCloseTimerRef = useRef<number | null>(null);
    const [isLibMenuOpen, setIsLibMenuOpen] = useState(false);
    const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
    const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
    const visibleCategories = categories.filter(cat => !isAllLikeCategory(cat) && !isHistoryLikeCategory(cat));
    const renameInputRef = useRef<HTMLInputElement>(null);

    const clearLibMenuCloseTimer = () => {
        if (libMenuCloseTimerRef.current !== null) {
            window.clearTimeout(libMenuCloseTimerRef.current);
            libMenuCloseTimerRef.current = null;
        }
    };

    const openLibMenu = () => {
        clearLibMenuCloseTimer();
        setIsAddMenuOpen(false);
        setIsLibMenuOpen(true);
    };

    const scheduleCloseLibMenu = () => {
        clearLibMenuCloseTimer();
        libMenuCloseTimerRef.current = window.setTimeout(() => {
            setIsLibMenuOpen(false);
            libMenuCloseTimerRef.current = null;
        }, 160);
    };

    const clearAddMenuCloseTimer = () => {
        if (addMenuCloseTimerRef.current !== null) {
            window.clearTimeout(addMenuCloseTimerRef.current);
            addMenuCloseTimerRef.current = null;
        }
    };

    const openAddMenu = () => {
        clearAddMenuCloseTimer();
        setIsLibMenuOpen(false);
        setIsAddMenuOpen(true);
    };

    const scheduleCloseAddMenu = () => {
        clearAddMenuCloseTimer();
        addMenuCloseTimerRef.current = window.setTimeout(() => {
            setIsAddMenuOpen(false);
            addMenuCloseTimerRef.current = null;
        }, 160);
    };

    const clearCategoryMenuCloseTimer = () => {
        if (categoryMenuCloseTimerRef.current !== null) {
            window.clearTimeout(categoryMenuCloseTimerRef.current);
            categoryMenuCloseTimerRef.current = null;
        }
    };

    const openCategoryMenu = () => {
        clearCategoryMenuCloseTimer();
        setIsCategoryMenuOpen(true);
    };

    const scheduleCloseCategoryMenu = () => {
        clearCategoryMenuCloseTimer();
        categoryMenuCloseTimerRef.current = window.setTimeout(() => {
            setIsCategoryMenuOpen(false);
            categoryMenuCloseTimerRef.current = null;
        }, 160);
    };

    useEditFieldFocus(renameInputRef, {
        enabled: editingCat !== null,
        moveCaretToEnd: true,
        triggerKey: editingCat?.old ?? null
    });

    const startRenameCategory = (cat: string) => {
        setEditingCat({ old: cat, new: cat });
    };

    useEffect(() => {
        const handleMouseDownGlobal = () => {
            clearLibMenuCloseTimer();
            clearAddMenuCloseTimer();
            clearCategoryMenuCloseTimer();
            setIsLibMenuOpen(false);
            setIsAddMenuOpen(false);
            setIsCategoryMenuOpen(false);
        };
        
        window.addEventListener('mousedown', handleMouseDownGlobal);
        return () => window.removeEventListener('mousedown', handleMouseDownGlobal);
    }, []);

    useEffect(() => {
        return () => {
            clearLibMenuCloseTimer();
            clearAddMenuCloseTimer();
            clearCategoryMenuCloseTimer();
        };
    }, []);

    return (
        <header ref={headerRef} className="relative px-4 pt-4 pb-2 drag-region z-50 flex items-center justify-between gap-3 min-h-[40px]">
            {/* Search Bar */}
            <div className={`${isSearchActive ? 'flex' : 'hidden'} flex-1 items-center gap-2 no-drag h-12`} onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex-1 relative flex items-center h-10">
                    <Icon name="search" className="absolute left-4 text-white/10 text-[20px]" size={20} />
                    <input
                        ref={searchInputRef}
                        type="text"
                        className="w-full h-full bg-black/60 border border-white/5 rounded-full pl-11 pr-4 py-0 text-[14px] text-white focus:outline-none transition-all placeholder:text-white/10"
                        placeholder={t.clip_search_placeholder}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                setIsSearchActive(false);
                                setSearchQuery('');
                            }
                        }}
                    />
                    {searchQuery && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setSearchQuery('');
                            }}
                            className="absolute right-3 text-white/20 hover:text-white flex items-center justify-center"
                        >
                            <Icon name="close" className="text-[16px]" size={16} />
                        </button>
                    )}
                </div>
                <button
                    onClick={() => {
                        setIsSearchActive(false);
                        setSearchQuery('');
                    }}
                    className="px-3 h-full flex items-center text-[13px] text-white/60 hover:text-white font-medium transition-colors"
                >
                    {t.cancel}
                </button>
            </div>

            {/* Category List */}
            <div className={`${!isSearchActive ? 'flex' : 'hidden'} flex-1 overflow-hidden items-center`}>
                <div className={`flex items-center gap-2 no-drag w-full`}>
                    <div
                        ref={scrollRef}
                        className={`flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar scroll-smooth bg-[#09090B] ${isAnyDragActive ? '' : 'backdrop-blur-md'} rounded-xl p-1 border ${isAnyDragActive ? 'border-white/10' : 'border-white/5'}`}
                        onWheel={(e) => {
                            const el = scrollRef.current;
                            if (!el) return;

                            if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.deltaY !== 0) {
                                e.preventDefault();
                                el.scrollLeft += e.deltaY;
                            } else if (e.deltaX !== 0) {
                                e.preventDefault();
                                el.scrollLeft += e.deltaX;
                            }
                        }}
                    >
                        <div className="inline-flex w-max min-w-full items-center gap-1">
                            <DndContext
                                id="category-tabs-context"
                                sensors={useSensors(
                                    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
                                    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
                                )}
                                collisionDetection={closestCenter}
                                onDragStart={handleCategoryDragStart}
                                onDragEnd={handleCategoryDragEnd}
                            >
                                <SortableContext
                                    items={visibleCategories}
                                    strategy={horizontalListSortingStrategy}
                                >
                                    {visibleCategories.map((cat) => (
                                        <SortableCategoryItem
                                            key={cat}
                                            cat={cat}
                                            activeTab={activeTab}
                                            isEditing={editingCat?.old === cat}
                                            editValue={editingCat?.old === cat ? editingCat.new : undefined}
                                            editInputRef={editingCat?.old === cat ? renameInputRef : undefined}
                                            onActivate={setActiveTab}
                                            onStartRename={startRenameCategory}
                                            onEditChange={(value) => {
                                                if (editingCat?.old !== cat) return;
                                                setEditingCat({ ...editingCat, new: value });
                                            }}
                                            onEditBlur={() => {
                                                void handleRenameCategory();
                                            }}
                                            onEditKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    void handleRenameCategory();
                                                }
                                                if (e.key === 'Escape') {
                                                    setEditingCat(null);
                                                }
                                            }}
                                            handleDropToCategory={handleDropToCategory}
                                            draggingIndex={draggingIndex}
                                            hoveredTargetCat={hoveredTargetCat}
                                            setHoveredTargetCat={setHoveredTargetCat}
                                            isDropTarget={draggingIndex !== null && activeTab !== cat}
                                            isAnyDragActive={isAnyDragActive}
                                            onContextMenu={onCategoryContextMenu}
                                        />
                                    ))}
                                </SortableContext>

                                <DragOverlay dropAnimation={null}>
                                    {activeCatId ? (
                                        <TabCategory
                                            cat={activeCatId}
                                            activeTab={activeTab}
                                            isHoveringTarget={false}
                                            isDropTarget={false}
                                            isAnyDragActive={true}
                                            className="cursor-grabbing scale-105 shadow-2xl !bg-[#1E1E20] !border-white/30"
                                        />
                                    ) : null}
                                </DragOverlay>
                            </DndContext>

                            <button
                                onClick={() => {
                                    let name = t.clip_new_group_default;
                                    let i = 1;
                                    while (categories.includes(name)) {
                                        name = `${t.clip_new_group_default} ${i++}`;
                                    }
                                    onUpdateCategories([...categories, name]);
                                    setActiveTab(name);
                                }}
                                className="shrink-0 h-[32px] px-2 rounded-[10px] text-white/40 hover:bg-white/5 hover:text-white transition-all cursor-pointer group flex items-center justify-center ml-1 active:scale-95"
                                title={t.clip_add_group}
                            >
                                <Icon name="add" className="!text-[18px] transition-colors" size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions Bar */}
            <div className="flex items-center no-drag justify-end gap-2">
                <button
                    onClick={() => setIsSearchActive(true)}
                    className={`${isSearchActive ? 'hidden' : 'flex'} w-8 h-8 shrink-0 items-center justify-center rounded-lg bg-white/5 border border-white/5 text-white/80 hover:bg-white/10 hover:text-white transition-colors`}
                    title={t.search}
                >
                    <Icon name="search" className="!text-[16px]" size={16} />
                </button>

                <div
                    className="relative"
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => {
                            clearLibMenuCloseTimer();
                            setIsAddMenuOpen(false);
                            setIsCategoryMenuOpen(false);
                            setIsLibMenuOpen((prev) => !prev);
                        }}
                        className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-all border active:scale-95 ${isLibMenuOpen
                            ? 'bg-white border-white text-black shadow-lg shadow-white/10'
                            : 'bg-white/5 border-white/5 text-white/80 hover:bg-white/10 hover:text-white'}`}
                        title={t.clip_switch_lib}
                    >
                        <Icon name="folder" className="!text-[16px]" size={16} />
                    </button>

                    {isLibMenuOpen && (
                        <div
                            className="absolute top-10 right-0 z-[140] w-[212px] no-drag"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <div className="absolute left-0 right-0 top-[-14px] h-[18px]" />
                            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#09090B]/98 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100">
                                <div className="max-h-[420px] overflow-y-auto custom-scrollbar space-y-1">
                                    {libraries.map(lib => {
                                        const isActive = lib.id === activeLibraryId;

                                        return (
                                            <button
                                                key={lib.id}
                                                type="button"
                                                onClick={() => { onSwitchLibrary(lib.id); setIsLibMenuOpen(false); }}
                                                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[14px] font-bold transition-all ${
                                                    isActive
                                                        ? 'border border-transparent bg-white/6 text-white'
                                                        : 'border border-transparent text-white/70 hover:border-transparent hover:bg-white/5 hover:text-white'
                                                }`}
                                                title={lib.name}
                                            >
                                                <span className="truncate pr-3">{lib.name}</span>
                                                {isActive && <Icon name="check" className="!text-[14px] text-white/70 shrink-0" size={14} />}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="my-2 h-px bg-white/10" />

                                <button
                                    onClick={() => {
                                        onUpdateSetting('pasteTagsWithComma', !pasteTagsWithComma);
                                        setIsLibMenuOpen(false);
                                    }}
                                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[14px] font-bold transition-all ${
                                        pasteTagsWithComma
                                            ? 'border border-transparent bg-white/6 text-white'
                                            : 'border border-transparent text-white/70 hover:border-transparent hover:bg-white/5 hover:text-white'
                                    }`}
                                >
                                    <span className="flex min-w-0 items-center gap-2">
                                        <Icon name="label" className="!text-[15px] shrink-0" size={15} />
                                        <span className="truncate">
                                            {language === 'en' ? 'Paste tags with comma' : '\u7c98\u8d34\u6807\u7b7e\u5e26\u9017\u53f7'}
                                        </span>
                                    </span>
                                    {pasteTagsWithComma && <Icon name="check" className="!text-[14px] text-white/70 shrink-0" size={14} />}
                                </button>

                                <button
                                    onClick={() => {
                                        onUpdateSetting('pasteContentWithTags', !pasteContentWithTags);
                                        setIsLibMenuOpen(false);
                                    }}
                                    className={`mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[14px] font-bold transition-all ${
                                        pasteContentWithTags
                                            ? 'border border-transparent bg-white/6 text-white'
                                            : 'border border-transparent text-white/70 hover:border-transparent hover:bg-white/5 hover:text-white'
                                    }`}
                                >
                                    <span className="flex min-w-0 items-center gap-2">
                                        <Icon name="description" className="!text-[15px] shrink-0" size={15} />
                                        <span className="truncate">
                                            {language === 'en' ? 'Paste content card with tags' : '\u7c98\u8d34\u5185\u5bb9\u5361\u7247\u5e26\u6807\u7b7e'}
                                        </span>
                                    </span>
                                    {pasteContentWithTags && <Icon name="check" className="!text-[14px] text-white/70 shrink-0" size={14} />}
                                </button>

                                <div className="my-2 h-px bg-white/10" />

                                <button
                                    onClick={() => { setIsLibMenuOpen(false); onOpenManager(); }}
                                    className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[14px] font-bold text-white/70 transition-all hover:bg-white/5 hover:text-white"
                                >
                                    <span className="flex min-w-0 items-center gap-2">
                                        <Icon name="folder_managed" className="!text-[16px] shrink-0" size={16} />
                                        <span className="truncate">{t.clip_manager}</span>
                                    </span>
                                    <Icon name="chevron_right" className="!text-[14px] shrink-0" size={14} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div
                    className="relative"
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => {
                            clearAddMenuCloseTimer();
                            setIsLibMenuOpen(false);
                            setIsCategoryMenuOpen(false);
                            setIsAddMenuOpen((prev) => !prev);
                        }}
                        className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-all border active:scale-95 ${isAddMenuOpen
                            ? 'bg-white border-white text-black shadow-lg shadow-white/10'
                            : 'bg-white/5 border-white/5 text-white/80 hover:bg-white/10 hover:text-white'}`}
                        title={t.add}
                    >
                        <Icon name="add" className="!text-[16px]" size={16} />
                    </button>

                    {isAddMenuOpen && (
                        <div onMouseDown={(e) => e.stopPropagation()}>
                            <ClipboardAddMenu
                                onClose={() => setIsAddMenuOpen(false)}
                                onAdd={(type) => { handleCreateItem(type); }}
                                onBatch={() => setIsAddModalOpen(true)}
                                language={language}
                            />
                        </div>
                    )}
                </div>

                <div
                    className="relative"
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <button
                        type="button"
                        onClick={() => {
                            clearCategoryMenuCloseTimer();
                            setIsLibMenuOpen(false);
                            setIsAddMenuOpen(false);
                            setIsCategoryMenuOpen((prev) => !prev);
                        }}
                        className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-all border active:scale-95 ${
                            isCategoryMenuOpen
                                ? 'bg-white border-white text-black shadow-lg shadow-white/10'
                                : 'bg-white/5 border-white/5 text-white/80 hover:bg-white/10 hover:text-white'
                        }`}
                        title={language === 'en' ? 'All groups' : '所有分组'}
                    >
                        <Icon name="keyboard_arrow_down" className="!text-[16px]" size={16} />
                    </button>

                    {isCategoryMenuOpen && visibleCategories.length > 0 && (
                        <div
                            className="absolute top-10 right-0 z-[140] w-[188px] no-drag"
                            onMouseDown={(e) => e.stopPropagation()}
                        >
                            <div className="absolute left-0 right-0 top-[-14px] h-[18px]" />
                            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#09090B]/98 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                                <div className="max-h-[420px] overflow-y-auto custom-scrollbar space-y-1">
                                    {visibleCategories.map((cat) => {
                                        const isActive = activeTab === cat;

                                        return (
                                            <button
                                                key={cat}
                                                type="button"
                                                onClick={() => {
                                                    setActiveTab(cat);
                                                    setIsCategoryMenuOpen(false);
                                                }}
                                                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[14px] font-bold transition-all ${
                                                    isActive
                                                        ? 'border border-transparent bg-white/6 text-white'
                                                        : 'border border-transparent text-white/70 hover:border-transparent hover:bg-white/5 hover:text-white'
                                                }`}
                                                title={cat}
                                            >
                                                <span className="truncate">{cat}</span>
                                                {isActive && (
                                                    <Icon name="check" className="!text-[14px] text-white/70" size={14} />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
};

export default ClipboardHeader;
