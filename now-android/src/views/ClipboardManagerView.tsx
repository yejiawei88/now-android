import React, { useState, useEffect, useRef } from 'react';
import { ViewType } from '../types';
import { invoke } from "@tauri-apps/api/core";
import { translations } from '../i18n';
import Icon from '../components/Icon';
import { useEditFieldFocus } from '../hooks/useEditFieldFocus';

interface ClipboardManagerViewProps {
    onNavigate: (view: ViewType) => void;
    clipboardCategories: string[];
    onUpdateClipboardCategories: (cats: string[]) => void;
    libraries: { id: string, name: string }[];
    activeLibraryId: string;
    onSwitchLibrary: (id: string) => void;
    onAddLibrary: (name: string) => void;
    onRenameLibrary: (id: string, name: string) => void;
    onRemoveLibrary: (id: string) => void;
    onUpdateSetting: (key: string, value: any) => void;
    language?: 'zh' | 'en';
}

const ClipboardManagerView: React.FC<ClipboardManagerViewProps> = ({
    onNavigate,
    clipboardCategories,
    onUpdateClipboardCategories,
    libraries,
    activeLibraryId,
    onSwitchLibrary,
    onAddLibrary,
    onRenameLibrary,
    onRemoveLibrary,
    onUpdateSetting,
    language
}) => {
    const t = translations[language || 'zh'];
    const [newCatName, setNewCatName] = useState('');
    const [editingCat, setEditingCat] = useState<{ old: string, new: string } | null>(null);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [deletingLibId, setDeletingLibId] = useState<string | null>(null);
    const [deletingCatName, setDeletingCatName] = useState<string | null>(null);
    const [movingCatName, setMovingCatName] = useState<string | null>(null);
    const [selectedTargetLibId, setSelectedTargetLibId] = useState<string>('');
    const [isTargetLibDropdownOpen, setIsTargetLibDropdownOpen] = useState(false);

    const [isLibMenuOpen, setIsLibMenuOpen] = useState(false);
    const [newLibName, setNewLibName] = useState('');
    const [renamingLib, setRenamingLib] = useState(false);
    const [tempLibName, setTempLibName] = useState('');
    const [isAddingGroup, setIsAddingGroup] = useState(false);

    const activeLib = libraries.find(l => l.id === activeLibraryId) || libraries[0];

    const libMenuRef = useRef<HTMLDivElement>(null);
    const libButtonRef = useRef<HTMLButtonElement>(null);
    const libraryNameInputRef = useRef<HTMLInputElement>(null);
    const categoryNameInputRef = useRef<HTMLInputElement>(null);

    useEditFieldFocus(libraryNameInputRef, {
        enabled: renamingLib,
        moveCaretToEnd: true,
        triggerKey: renamingLib ? activeLibraryId : null
    });

    useEditFieldFocus(categoryNameInputRef, {
        enabled: editingCat !== null,
        moveCaretToEnd: true,
        triggerKey: editingCat?.old ?? null
    });

    useEffect(() => {
        if (movingCatName) {
            const targets = libraries.filter(l => l.id !== activeLibraryId);
            if (targets.length > 0) {
                setSelectedTargetLibId(targets[0].id);
            }
        }
    }, [movingCatName, libraries, activeLibraryId]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                isLibMenuOpen &&
                libMenuRef.current &&
                !libMenuRef.current.contains(event.target as Node) &&
                libButtonRef.current &&
                !libButtonRef.current.contains(event.target as Node)
            ) {
                setIsLibMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isLibMenuOpen]);

    useEffect(() => {
        const handleGlobalMouseUp = () => {
            setDraggedIndex(null);
            document.body.classList.remove('resizing');
        };
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, []);

    const handleManualDragStart = (index: number) => {
        setDraggedIndex(index);
        document.body.classList.add('resizing');
    };
    const isInteractiveTarget = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) return false;
        return !!target.closest('button, input, textarea, select, a, [role="button"]');
    };

    const handleManualDragEnter = (index: number) => {
        if (draggedIndex === null || draggedIndex === index) return;

        const next = [...clipboardCategories];
        const draggedItem = next[draggedIndex];
        next.splice(draggedIndex, 1);
        next.splice(index, 0, draggedItem);

        onUpdateClipboardCategories(next);
        setDraggedIndex(index);
    };

    const handleAddCat = () => {
        const name = newCatName.trim();
        if (name && !clipboardCategories.includes(name)) {
            onUpdateClipboardCategories([...clipboardCategories, name]);
            setNewCatName('');
            setIsAddingGroup(false);
        }
    };

    const handleRenameCat = () => {
        if (editingCat && editingCat.new.trim() && !clipboardCategories.includes(editingCat.new.trim())) {
            const oldName = editingCat.old;
            const newName = editingCat.new.trim();

            // 1. Update Categories List
            const next = clipboardCategories.map(c => c === oldName ? newName : c);
            onUpdateClipboardCategories(next);

            // 2. Update Items in SQLite
            const updateItemsInDb = async () => {
                try {
                    await invoke('db_rename_category', {
                        libraryId: activeLibraryId,
                        oldName,
                        newName
                    });
                    // Notify ClipboardView to reload
                    window.dispatchEvent(new Event('clipboard-updated'));
                } catch (e) {
                    console.error('Failed to update category items in DB', e);
                }
            };
            updateItemsInDb();

            setEditingCat(null);
        } else {
            setEditingCat(null);
        }
    };

    const confirmRemoveCat = (name: string) => {
        onUpdateClipboardCategories(clipboardCategories.filter(c => c !== name));

        // Remove items from database
        const removeItemsInDb = async () => {
            try {
                await invoke('db_delete_items_by_category', {
                    libraryId: activeLibraryId,
                    category: name
                });
                window.dispatchEvent(new Event('clipboard-updated'));
            } catch (e) {
                console.error('Failed to delete category items from DB', e);
            }
        };
        removeItemsInDb();
        setDeletingCatName(null);
    };

    const handleMoveCatConfirm = async (targetLibId: string) => {
        if (!movingCatName) return;

        try {
            await invoke('db_move_category_to_library', {
                category: movingCatName,
                oldLibraryId: activeLibraryId,
                newLibraryId: targetLibId
            });

            // Update local categorires
            onUpdateClipboardCategories(clipboardCategories.filter(c => c !== movingCatName));
            
            // Notify other views
            window.dispatchEvent(new Event('clipboard-updated'));
            
            setMovingCatName(null);
        } catch (e) {
            console.error('Failed to move category to library', e);
        }
    };

    const handleRemoveCat = (name: string) => {
        if (clipboardCategories.length > 1) {
            setDeletingCatName(name);
        } else {
            alert(t.clip_at_least_one_group);
        }
    };
    const startRenameCategory = (cat: string) => {
        window.setTimeout(() => {
            setEditingCat({ old: cat, new: cat });
        }, 0);
    };

    return (
        <div className="h-full flex flex-col bg-[#09090B]">
            <header className="px-6 h-[64px] flex items-center justify-between border-b border-white/5 bg-[#09090B] shrink-0 sticky top-0 z-20 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => onNavigate(ViewType.CLIPBOARD)}
                        className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-all focus:outline-none"
                        title={t.back}
                    >
                        <Icon name="arrow_back" size={20} className="!text-[20px]" />
                    </button>
                    <div className="flex items-center gap-2 relative">
                        <Icon name="folder_managed" className="text-[20px] text-white/40" size={20} />
                        {renamingLib ? (
                            <input
                                ref={libraryNameInputRef}
                                autoFocus
                                className="bg-[#2C2C2E] text-white font-bold text-[15px] border-none outline-none rounded px-1 w-[120px]"
                                value={tempLibName}
                                onChange={e => setTempLibName(e.target.value)}
                                onBlur={() => {
                                    if (tempLibName.trim()) onRenameLibrary(activeLibraryId, tempLibName.trim());
                                    setRenamingLib(false);
                                }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        if (tempLibName.trim()) onRenameLibrary(activeLibraryId, tempLibName.trim());
                                        setRenamingLib(false);
                                    }
                                }}
                            />
                        ) : (
                            <span
                                className="text-[15px] font-bold text-white cursor-text select-none"
                                onDoubleClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setTempLibName(activeLib?.name || t.clip_lib_default);
                                    setRenamingLib(true);
                                }}
                                title={t.clip_lib_rename_hint}
                            >
                                {activeLib?.name || t.clip_lib_default}
                            </span>
                        )}

                        <button
                            ref={libButtonRef}
                            onClick={() => setIsLibMenuOpen(!isLibMenuOpen)}
                            className="w-5 h-5 flex items-center justify-center bg-white/10 rounded text-white hover:bg-white/20 transition-all"
                        >
                            <Icon name="expand_more" className="text-[16px]" size={16} />
                        </button>

                        {isLibMenuOpen && (
                            <div ref={libMenuRef} className="absolute top-8 left-0 min-w-[200px] bg-[#141416] border border-white/5 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col p-1">
                                <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                                    {libraries.map(lib => (
                                        <div
                                            key={lib.id}
                                            className={`px-3 py-2 rounded-lg text-[13px] text-white flex items-center justify-between cursor-pointer group ${lib.id === activeLibraryId ? 'bg-white/10 font-bold' : 'hover:bg-white/5'}`}
                                            onClick={() => { onSwitchLibrary(lib.id); setIsLibMenuOpen(false); }}
                                        >
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <span className="truncate">{lib.name}</span>
                                                {lib.id === activeLibraryId && <Icon name="check" className="text-[14px]" size={14} />}
                                            </div>
                                            {lib.id !== 'default' && lib.id !== activeLibraryId && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeletingLibId(lib.id);
                                                    }}
                                                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 text-white/60 hover:text-[#FF453A] transition-opacity"
                                                    title={translations[language || 'zh']?.clip_delete_group}
                                                >
                                                    <Icon name="delete" className="text-[14px]" size={14} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <div className="h-[1px] bg-white/5 my-1"></div>
                                <div className="flex items-center gap-1 px-1 pb-1">
                                    <input
                                        className="flex-1 bg-[#0B0B0C] border border-white/5 rounded px-2 py-1 text-[12px] text-white outline-none focus:border-white/10"
                                        placeholder={t.clip_add_lib + "..."}
                                        value={newLibName}
                                        onChange={e => setNewLibName(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && newLibName.trim()) { onAddLibrary(newLibName.trim()); setNewLibName(''); setIsLibMenuOpen(false); } }}
                                    />
                                    <button
                                        onClick={() => { if (newLibName.trim()) { onAddLibrary(newLibName.trim()); setNewLibName(''); setIsLibMenuOpen(false); } }}
                                        className="p-1 bg-white/10 rounded text-white hover:bg-white/20 transition-all"
                                    >
                                        <Icon name="add" className="text-[14px]" size={14} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <button
                    onClick={() => setIsAddingGroup(true)}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 transition-all border border-white/5 active:scale-95 shadow-none"
                    title={t.clip_add_group}
                >
                    <Icon name="add" size={18} />
                </button>
            </header>

            <main className="mt-2 flex-1 overflow-y-auto custom-scrollbar pb-10 space-y-6">
                <div className="animate-fade-in h-full flex flex-col">
                    <div className="bg-[#09090B] flex-1 flex flex-col relative">

                        <div className="py-4 space-y-4 max-w-[800px] mx-auto w-full px-4">
                            <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar">
                                {clipboardCategories
                                    .map((cat, index) => {
                                        const isEditing = editingCat?.old === cat;
                                        return (
                                            <div
                                                key={cat}
                                                onMouseDown={(e) => {
                                                    if (isInteractiveTarget(e.target)) return;
                                                    if (e.detail > 1) {
                                                        e.preventDefault();
                                                        return;
                                                    }
                                                    handleManualDragStart(index);
                                                }}
                                                onMouseEnter={() => handleManualDragEnter(index)}
                                                onDoubleClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    startRenameCategory(cat);
                                                }}
                                                className={`group flex items-center justify-between p-4 bg-gradient-to-br from-[#18181B]/40 to-[#09090B]/60 hover:from-[#1C1C1E]/60 hover:to-[#09090B]/80 rounded-2xl border transition-all cursor-grab active:cursor-grabbing select-none ${draggedIndex === index ? 'opacity-30 border-white/20 scale-[0.98]' : 'border-white/5 hover:border-white/10'}`}
                                            >
                                                <div className="flex items-center gap-3 flex-1 overflow-hidden">
                                                    <Icon name="drag_indicator" className="!text-[18px] shrink-0 text-white/10 group-hover:text-white/30 transition-colors" size={18} />
                                                    {isEditing ? (
                                                        <input
                                                            ref={categoryNameInputRef}
                                                            autoFocus
                                                            className="bg-white/10 border-none rounded-lg px-2 py-1 text-[14px] text-white w-full focus:ring-1 focus:ring-white/20 outline-none"
                                                            value={editingCat.new}
                                                            onChange={e => setEditingCat({ ...editingCat, new: e.target.value })}
                                                            onBlur={handleRenameCat}
                                                            onKeyDown={e => e.key === 'Enter' && handleRenameCat()}
                                                            onMouseDown={e => e.stopPropagation()}
                                                        />
                                                    ) : (
                                                        <span
                                                            className={`text-[14px] font-bold truncate text-white`}
                                                        >
                                                            {cat}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                                                    <button onMouseDown={(e) => e.stopPropagation()} onClick={() => startRenameCategory(cat)} className={`w-[28px] h-[28px] flex items-center justify-center hover:bg-white/10 rounded-lg text-white/50 hover:text-white transition-all shadow-sm`}>
                                                        <Icon name="edit" className="!text-[14px]" size={14} />
                                                    </button>
                                                    <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setMovingCatName(cat)} className={`w-[28px] h-[28px] flex items-center justify-center hover:bg-white/10 rounded-lg text-white/50 hover:text-white transition-all shadow-sm`} title="移动到其他资料库">
                                                        <Icon name="import_export" className="!text-[14px]" size={14} />
                                                    </button>
                                                    <button onMouseDown={(e) => e.stopPropagation()} onClick={() => handleRemoveCat(cat)} className={`w-[28px] h-[28px] flex items-center justify-center hover:bg-[#FF453A]/10 rounded-lg text-white/50 hover:text-[#FF453A] transition-all shadow-sm`}>
                                                        <Icon name="delete" className="!text-[14px]" size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            {isAddingGroup && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setIsAddingGroup(false)}>
                    <div className="w-[320px] bg-[#1C1C1E] border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-white font-bold text-[17px] mb-4 text-center">{t.clip_add_group}</h3>
                        <div className="mb-6">
                            <input
                                autoFocus
                                type="text"
                                value={newCatName}
                                onChange={e => setNewCatName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddCat()}
                                placeholder={t.clip_cat_new_placeholder}
                                className="w-full bg-[#2C2C2E] border border-white/10 rounded-xl px-4 py-3 text-white text-[14px] focus:outline-none focus:border-white/30 transition-all placeholder:text-white/30"
                            />
                        </div>
                        <div className="flex gap-3 w-full">
                            <button
                                onClick={() => setIsAddingGroup(false)}
                                className="flex-1 py-2.5 rounded-xl bg-white/5 text-white/80 text-[14px] font-bold hover:bg-white/10 transition-all active:scale-95"
                            >
                                {t.cancel}
                            </button>
                            <button
                                onClick={handleAddCat}
                                className="flex-1 py-2.5 rounded-xl bg-white text-black text-[14px] font-bold shadow-lg shadow-white/10 active:scale-95 transition-all hover:bg-white/90"
                            >
                                {t.confirm}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deletingLibId && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setDeletingLibId(null)}>
                    <div className="w-[320px] bg-[#1C1C1E] border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                        <div className="w-12 h-12 rounded-full bg-[#FF453A]/10 flex items-center justify-center mb-4 text-[#FF453A]">
                            <Icon name="delete_forever" className="text-[28px]" size={28} />
                        </div>
                        <h3 className="text-white font-bold text-[17px] mb-2">{t.clip_delete_group}</h3>
                        <p className="text-white/60 text-[13px] mb-6 leading-relaxed px-4">
                            {language === 'en'
                                ? `Are you sure you want to delete the library "${libraries.find(l => l.id === deletingLibId)?.name || ''}"?`
                                : `确定要删除资料库 "${libraries.find(l => l.id === deletingLibId)?.name || ''}" 吗？`}
                        </p>
                        <div className="flex gap-3 w-full">
                            <button
                                onClick={() => setDeletingLibId(null)}
                                className="flex-1 py-2.5 rounded-xl bg-white/5 text-white/80 text-[14px] font-bold hover:bg-white/10 transition-all active:scale-95"
                            >
                                {t.clip_clear_cancel}
                            </button>
                            <button
                                onClick={() => {
                                    if (deletingLibId) onRemoveLibrary(deletingLibId);
                                    setDeletingLibId(null);
                                }}
                                className="flex-1 py-2.5 rounded-xl bg-[#FF453A] text-white text-[14px] font-bold shadow-lg shadow-[#FF453A]/20 active:scale-95 transition-all hover:bg-[#FF3B30]"
                            >
                                {t.clip_clear_confirm}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deletingCatName && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setDeletingCatName(null)}>
                    <div className="w-[320px] bg-[#1C1C1E] border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                        <div className="w-12 h-12 rounded-full bg-[#FF453A]/10 flex items-center justify-center mb-4 text-[#FF453A]">
                            <Icon name="delete_forever" className="text-[28px]" size={28} />
                        </div>
                        <h3 className="text-white font-bold text-[17px] mb-2">{t.clip_delete_group}</h3>
                        <p className="text-white/60 text-[13px] mb-6 leading-relaxed px-4">
                            {language === 'en'
                                ? `Are you sure you want to delete the group "${deletingCatName}" and all its items?`
                                : `确定要删除分组 "${deletingCatName}" 及其中所有内容吗？`}
                        </p>
                        <div className="flex gap-3 w-full">
                            <button
                                onClick={() => setDeletingCatName(null)}
                                className="flex-1 py-2.5 rounded-xl bg-white/5 text-white/80 text-[14px] font-bold hover:bg-white/10 transition-all active:scale-95"
                            >
                                {t.clip_clear_cancel}
                            </button>
                            <button
                                onClick={() => confirmRemoveCat(deletingCatName)}
                                className="flex-1 py-2.5 rounded-xl bg-[#FF453A] text-white text-[14px] font-bold shadow-lg shadow-[#FF453A]/20 active:scale-95 transition-all hover:bg-[#FF3B30]"
                            >
                                {t.clip_clear_confirm}
                            </button>
                        </div>
                    </div>
                </div>
            )}



            {movingCatName && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => { setMovingCatName(null); setIsTargetLibDropdownOpen(false); }}>
                    <div className="w-[320px] bg-[#1C1C1E] border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col items-center animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                        <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mb-4 text-white">
                            <Icon name="import_export" className="text-[28px]" size={28} />
                        </div>
                        <h3 className="text-white font-bold text-[17px] mb-2">{language === 'en' ? 'Move Group to Another Library' : '移动分组到其他资料库'}</h3>
                        <p className="text-white/60 text-[13px] mb-4 leading-relaxed px-4 text-center">
                            {language === 'en' ? `Select target library for "${movingCatName}":` : `选择要将 "${movingCatName}" 移动到的目标资料库：`}
                        </p>
                        
                        <div className="relative w-full mb-6">
                            <button 
                                onClick={() => setIsTargetLibDropdownOpen(!isTargetLibDropdownOpen)}
                                className="w-full px-4 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-white text-[14px] font-medium transition-all text-left flex items-center justify-between group border border-white/5"
                            >
                                <span className="truncate">
                                    {libraries.find(l => l.id === selectedTargetLibId)?.name || (language === 'en' ? 'Select Library' : '选择资料库')}
                                </span>
                                <Icon name="expand_more" size={16} className={`text-white/40 transition-transform duration-200 ${isTargetLibDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>
                            
                            {isTargetLibDropdownOpen && (
                                <div className="absolute top-[110%] left-0 w-full bg-[#1A1A1C] border border-white/10 rounded-xl shadow-2xl z-[200] overflow-hidden flex flex-col p-1 animate-in fade-in zoom-in-95 duration-150">
                                    <div className="max-h-[160px] overflow-y-auto custom-scrollbar">
                                        {libraries
                                            .filter(l => l.id !== activeLibraryId)
                                            .map(lib => (
                                                <div 
                                                    key={lib.id}
                                                    onClick={(e) => { e.stopPropagation(); setSelectedTargetLibId(lib.id); setIsTargetLibDropdownOpen(false); }}
                                                    className={`px-3 py-2 rounded-lg text-[13px] text-white flex items-center justify-between cursor-pointer ${selectedTargetLibId === lib.id ? 'bg-white/10 font-bold' : 'hover:bg-white/5'}`}
                                                >
                                                    <span className="truncate">{lib.name}</span>
                                                    {selectedTargetLibId === lib.id && <Icon name="check" size={14} className="text-white" />}
                                                </div>
                                            ))}
                                        {libraries.filter(l => l.id !== activeLibraryId).length === 0 && (
                                            <p className="text-[12px] text-white/30 text-center py-4">{language === 'en' ? 'No other libraries' : '没有其他资料库'}</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 w-full">
                            <button
                                onClick={() => { setMovingCatName(null); setSelectedTargetLibId(''); setIsTargetLibDropdownOpen(false); }}
                                className="flex-1 py-2.5 rounded-xl bg-white/5 text-white/80 text-[14px] font-bold hover:bg-white/10 transition-all active:scale-95"
                            >
                                {t.cancel}
                            </button>
                            <button
                                onClick={() => { if (selectedTargetLibId) handleMoveCatConfirm(selectedTargetLibId); setSelectedTargetLibId(''); }}
                                className={`flex-1 py-2.5 rounded-xl text-[14px] font-bold shadow-lg active:scale-95 transition-all ${selectedTargetLibId ? 'bg-white text-black hover:bg-white/90 shadow-white/10' : 'bg-white/5 text-white/20 cursor-not-allowed'}`}
                                disabled={!selectedTargetLibId}
                            >
                                {t.confirm}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ClipboardManagerView;

