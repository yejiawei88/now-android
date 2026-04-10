
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ShortcutItem, ViewType } from '../types';
import { BackendService } from '../backend';
import { getItemType } from '../utils';
import { TYPE_LABELS } from '../constants';
import { translations } from '../i18n';
import Icon from '../components/Icon';

interface HomeViewProps {
  shortcuts: ShortcutItem[];
  shortcutsActive: boolean;
  onToggleVisibility: (id: string) => void;
  onRemove: (id: string) => void;
  onNavigate: (view: ViewType) => void;
  onNavigateToSettings: (tab: 'GENERAL' | 'SHORTCUTS' | 'MODEL') => void;
  onAddClick: () => void;
  onEditClick: (item: ShortcutItem) => void;
  onExecute: (item: ShortcutItem) => void;
  onStopAll: () => void;
  onStartAll: () => void;
  searchQuery: string;
  isSearching: boolean;
  onSearchChange: (value: string) => void;
  onSearchKeyPress: (e: React.KeyboardEvent) => void;
  language?: 'zh' | 'en';
}

const HomeView: React.FC<HomeViewProps> = ({
  shortcuts,
  searchQuery,
  isSearching,
  onSearchChange,
  onSearchKeyPress,
  onToggleVisibility,
  onRemove,
  onNavigate,
  onNavigateToSettings,
  onAddClick,
  onEditClick,
  onExecute,
  language,
  shortcutsActive,
  onStopAll,
  onStartAll
}) => {
  const t = translations[language || 'zh'];
  const [activeItemId, setActiveItemId] = React.useState<string | null>(null);

  // Check if device is touch-enabled
  const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  const filteredShortcuts = useMemo(() => shortcuts.filter(s => {
    const q = searchQuery.toLowerCase();
    const itemType = getItemType(s);
    let typeName = '';
    if (itemType === 'TEXT') typeName = t.modal_type_text;
    else if (itemType === 'URL') typeName = t.modal_type_url;
    else if (itemType === 'APP') typeName = t.modal_type_app;
    else if (itemType === 'GROUP') typeName = language === 'zh' ? '组合' : 'group';

    return s.name.toLowerCase().includes(q) ||
      s.keys.toLowerCase().includes(q) ||
      typeName.toLowerCase().includes(q);
  }), [shortcuts, searchQuery, t]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#09090B]">
      <header className="flex-none z-50 pt-2 pb-1 px-4 drag-region">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              {isSearching ? <div className="w-4 h-4 border-2 border-white/20 border-t-transparent rounded-full animate-spin"></div> : <Icon name="search" className="text-white/40" size={20} />}
            </div>
            <input
              type="text"
              placeholder={t.search_placeholder}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={onSearchKeyPress}
              className="w-full h-11 bg-black/60 border border-white/5 rounded-xl pl-12 pr-4 text-white text-[15px] focus:outline-none transition-all placeholder:text-white/20 no-drag"
            />
          </div>
          
          <div className="flex items-center gap-1.5 no-drag">
            <button 
              onClick={(e) => { e.stopPropagation(); shortcutsActive ? onStopAll() : onStartAll(); }} 
              title={shortcutsActive ? "暂停快捷键" : "启动快捷键"} 
              className={`h-9 w-9 bg-black/40 rounded-xl flex items-center justify-center text-white/40 active:scale-95 transition-all border border-white/5 shrink-0 ${shortcutsActive ? 'hover:bg-[#FF453A]/10 hover:text-[#FF453A]' : 'hover:bg-[#0A84FF]/10 hover:text-[#0A84FF]'}`}
            >
              <Icon name={shortcutsActive ? "pause" : "play"} size={18} />
            </button>

            <button onClick={onAddClick} title={t.add_shortcut} className="h-9 w-9 bg-black/40 rounded-xl flex items-center justify-center text-white/40 hover:bg-[#2C2C2E] hover:text-white active:scale-95 transition-all border border-white/5 shrink-0">
              <Icon name="add" className="font-bold" size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto custom-scrollbar px-4 pt-3 pb-2 bg-transparent">
        {filteredShortcuts.length > 0 ? (
          <div className="bg-gradient-to-br from-[#121214] to-[#09090B] rounded-xl overflow-hidden border border-white/5 shadow-2xl mt-2">
            {filteredShortcuts.map((item, index) => (
              <div 
                key={item.id} 
                className="relative group"
                onClick={() => setActiveItemId(activeItemId === item.id ? null : item.id)}
              >
                <div className="flex items-stretch transition-all cursor-pointer ios-item-hover active:bg-white/5" onClick={() => onExecute(item)}>
                  <div className="px-6 py-5 flex flex-1 items-center gap-4 overflow-hidden">
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                      title={t.delete_shortcut}
                      className={`text-[#FF453A] flex items-center shrink-0 active:scale-90 transition-all duration-300 ${activeItemId === item.id || !isTouchDevice ? 'opacity-100 ml-0' : 'opacity-0 -ml-12 group-hover:opacity-100 group-hover:ml-0'}`}
                    >
                      <Icon name="remove_circle" size={24} />
                    </button>
                    <div className="flex flex-1 items-center gap-3 overflow-hidden">
                      <div className="flex flex-col overflow-hidden">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[17px] text-white truncate leading-tight tracking-tight">{item.name}</span>
                          {(() => {
                            const itemType = getItemType(item);
                            const actionCount = item.actions?.length || 0;
                            return (
                              <div className="flex items-center gap-1 ml-2">
                                {itemType === 'TEXT' && <span className="bg-white/10 text-white/90 text-[10px] px-1.5 py-0.5 rounded font-medium border border-white/10">{t.modal_type_text}</span>}
                                {itemType === 'URL' && <span className="bg-[#0A84FF]/20 text-[#0A84FF] text-[10px] px-1.5 py-0.5 rounded font-medium">{t.modal_type_url}</span>}
                                {itemType === 'APP' && <span className="bg-[#30D158]/20 text-[#30D158] text-[10px] px-1.5 py-0.5 rounded font-medium">{t.modal_type_app}</span>}
                                {itemType === 'GROUP' && <span className="bg-[#BF5AF2]/20 text-[#BF5AF2] text-[10px] px-1.5 py-0.5 rounded font-medium">{language === 'zh' ? '组合' : 'Group'}</span>}
                                {item.repeatOpen && (itemType === 'URL' || itemType === 'APP') && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/5 text-white/70">{t.modal_multi_open}</span>}
                                {itemType === 'GROUP' && actionCount > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/5 text-white/70">{language === 'zh' ? `${actionCount} 项` : `${actionCount} items`}</span>}
                              </div>
                            );
                          })()}
                        </div>
                        <span className="text-[13px] text-white/80 font-medium mt-1 tracking-tight">{item.keys}</span>
                      </div>
                    </div>
                  </div>
                  <div className="absolute right-0 top-0 bottom-0 flex items-center pr-6 gap-1">
                    {getItemType(item) !== 'GROUP' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleVisibility(item.id); }}
                        title={item.visible ? t.hide_shortcut : t.show_shortcut}
                        className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-full transition-all ${item.visible ? 'text-white/80 bg-white/10' : 'text-white/10 bg-white/5'} hover:scale-110 active:scale-95`}
                      >
                        <Icon name={item.visible ? 'visibility' : 'visibility_off'} className="leading-none" size={20} />
                      </button>
                    )}

                    {/* Enlarged Edit Hit Area - Centered but tall */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditClick(item); }}
                      className="group/edit h-12 w-12 -mr-4 flex items-center justify-center text-[#3A3A3C] hover:text-white/80 hover:bg-white/5 rounded-full transition-all duration-300 active:scale-90"
                      title={t.edit_shortcut}
                    >
                      <Icon name="chevron_right" className="leading-none group-hover/edit:scale-125 transition-transform" size={24} />
                    </button>
                  </div>
                </div>
                {index < filteredShortcuts.length - 1 && <div className="absolute bottom-0 right-0 left-6 h-[1px] bg-white/5"></div>}
              </div>
            ))}
          </div>
        ) : null}
        <div className="h-20"></div>
      </main>
    </div>
  );
};
export default HomeView;
