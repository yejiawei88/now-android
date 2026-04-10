import React, { useState, useRef, useEffect } from 'react';
import Icon from './Icon';

interface Option<T extends string> {
  label: string;
  value: T;
  icon?: string;
}

interface CustomSelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  className?: string;
}

const getScrollableParent = (element: HTMLElement | null): HTMLElement | null => {
  let current = element?.parentElement ?? null;

  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    const canScroll = /(auto|scroll|overlay)/.test(overflowY) && current.scrollHeight > current.clientHeight;
    if (canScroll) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
};

export function CustomSelect<T extends string>({
  value,
  onChange,
  options,
  className = '',
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const frameId = window.requestAnimationFrame(() => {
      const dropdown = dropdownRef.current;
      if (!dropdown) return;

      const scrollParent = getScrollableParent(selectRef.current);
      if (!scrollParent) return;

      const dropdownRect = dropdown.getBoundingClientRect();
      const scrollParentRect = scrollParent.getBoundingClientRect();
      const padding = 16;

      if (dropdownRect.bottom > scrollParentRect.bottom - padding) {
        const offset = dropdownRect.bottom - scrollParentRect.bottom + padding;
        scrollParent.scrollTo({
          top: Math.min(
            scrollParent.scrollTop + offset,
            scrollParent.scrollHeight - scrollParent.clientHeight
          ),
          behavior: 'smooth',
        });
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen]);

  const selectedOption = options.find((o) => o.value === value);
  const selectedLabel = selectedOption?.label || value;

  return (
    <div ref={selectRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-[38px] w-full items-center justify-between rounded-xl border border-white/10 bg-[#09090B] px-3 py-2 text-[13px] text-white transition-all hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-white/20"
      >
        <div className="flex items-center gap-2 truncate">
          {selectedOption?.icon && (
            <Icon name={selectedOption.icon} className="!text-[16px] text-white/50" size={16} />
          )}
          <span className="truncate">{selectedLabel}</span>
        </div>
        <Icon 
          name="unfold_more" 
          className="!text-[16px] text-white/40" 
          size={16} 
        />
      </button>

      {isOpen && (
        <div ref={dropdownRef} className="absolute z-[110] mt-1.5 w-full min-w-[120px] overflow-hidden rounded-xl border border-white/10 bg-[#1C1C1E] p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 duration-100 backdrop-blur-xl">
          <div className="max-h-[220px] overflow-y-auto custom-scrollbar">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-all ${
                  value === option.value
                    ? 'bg-[#0A84FF]/15 text-[#67B3FF] font-medium'
                    : 'text-white/80 hover:bg-white/5 hover:text-white'
                }`}
              >
                {option.icon && (
                  <Icon 
                    name={option.icon} 
                    className={`!text-[16px] ${value === option.value ? 'text-[#0A84FF]' : 'text-white/50'}`} 
                    size={16} 
                  />
                )}
                <span className="flex-1 truncate">{option.label}</span>
                {value === option.value && (
                  <Icon name="check" className="!text-[14px] text-[#0A84FF]" size={14} />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
