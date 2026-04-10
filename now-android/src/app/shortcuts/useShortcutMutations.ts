import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { ModalType, ShortcutItem } from '../../types';
import { normalizeShortcutItem } from '../../utils';

type BackendLike = {
  toggleAppVisibility: (path: string, targetVisible: boolean) => void;
};

type UseShortcutMutationsArgs = {
  backend: BackendLike;
  modalType: ModalType;
  editingItem: ShortcutItem | null;
  setShortcuts: Dispatch<SetStateAction<ShortcutItem[]>>;
  setModalType: Dispatch<SetStateAction<ModalType>>;
  setEditingItem: Dispatch<SetStateAction<ShortcutItem | null>>;
};

export const useShortcutMutations = ({
  backend,
  modalType,
  editingItem,
  setShortcuts,
  setModalType,
  setEditingItem,
}: UseShortcutMutationsArgs) => {
  const toggleVisibility = useCallback((id: string) => {
    setShortcuts((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          if (item.type === 'GROUP' || item.actions?.length) {
            return item;
          }
          const nextVisible = !item.visible;
          if (item.path) backend.toggleAppVisibility(item.path, nextVisible);
          return { ...item, visible: nextVisible };
        }
        return item;
      })
    );
  }, [backend, setShortcuts]);

  const handleSaveItem = useCallback((data: Partial<ShortcutItem>) => {
    const normalized = normalizeShortcutItem({
      ...data,
      id: modalType === 'EDIT' && editingItem ? editingItem.id : undefined,
    });

    if (modalType === 'EDIT' && editingItem) {
      setShortcuts((prev) =>
        prev.map((item) => (item.id === editingItem.id ? { ...item, ...normalized } : item))
      );
    } else if (modalType === 'ADD') {
      setShortcuts((prev) => [
        normalized as ShortcutItem,
        ...prev,
      ]);
    }
    setModalType(null);
    setEditingItem(null);
  }, [editingItem, modalType, setEditingItem, setModalType, setShortcuts]);

  return { toggleVisibility, handleSaveItem };
};

