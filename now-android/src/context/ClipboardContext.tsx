import React, { createContext, useContext, ReactNode } from 'react';
import { ClipboardItem, TranslationSettings } from '../types';

export interface EditingTagState {
  itemId: string;
  tagIndex: number;
  value: string;
  startTime: number;
  source: 'tag' | 'content';
}

export interface ClipboardContextValue {
  language?: 'zh' | 'en';
  activeLibraryId: string;
  pasteTagsWithComma: boolean;
  bilingualTagsEnabled: boolean;
  translationSettings: TranslationSettings;
  isAnyDragActive: boolean;

  // Editing states
  editingTag: EditingTagState | null;
  setEditingTag: (tag: EditingTagState | null) => void;
  editingContent: EditingTagState | null;
  setEditingContent: (content: EditingTagState | null) => void;
  commitEditTag: () => void;
  commitEditContent: () => void;

  // Actions
  handleCopy: (content: string, item: ClipboardItem, shouldHideAfterCopy?: boolean, copyOnly?: boolean) => Promise<void>;
  startEditItem: (item: ClipboardItem, e: React.MouseEvent) => void;
  removeItem: (id: string, e?: React.MouseEvent, force?: boolean) => void;
  setItems: React.Dispatch<React.SetStateAction<ClipboardItem[]>>;
  handleAddTag: (itemId: string) => void;
  onOpenEditor: (item: ClipboardItem, tagIndex?: number) => void;

  // Context menu handlers
  handleContextMenu: (e: React.MouseEvent, item: ClipboardItem) => void;
  handleTagContextMenu: (e: React.MouseEvent, item: ClipboardItem, tag: string, tagIdx: number, selectedTags?: string[]) => void;

  // Folder operations
  handleEnterFolder: (item: ClipboardItem) => void;
  handleMoveTagToFolder: (item: ClipboardItem, tag: string, tagIdx: number) => void;
  handleCombineDocumentTagsIntoFolder: (item: ClipboardItem) => void;
  pasteDocumentTags: (item: ClipboardItem, tags: string[]) => void;
  removeDocumentTagsBulk: (itemId: string, tags: string[]) => void;
}

const ClipboardContext = createContext<ClipboardContextValue | null>(null);

export interface ClipboardProviderProps {
  value: ClipboardContextValue;
  children: ReactNode;
}

export const ClipboardProvider: React.FC<ClipboardProviderProps> = ({ value, children }) => {
  return (
    <ClipboardContext.Provider value={value}>
      {children}
    </ClipboardContext.Provider>
  );
};

export const useClipboard = (): ClipboardContextValue => {
  const context = useContext(ClipboardContext);
  if (!context) {
    throw new Error('useClipboard must be used within a ClipboardProvider');
  }
  return context;
};
