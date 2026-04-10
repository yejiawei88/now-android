import { ClipboardItem } from '../types';
import { hasLoadedDocumentContent, normalizeTags } from './clipboardDataHelpers';

export const areTagsEqual = (left: ClipboardItem['tags'], right: ClipboardItem['tags']) => {
    const normalizedLeft = normalizeTags(left);
    const normalizedRight = normalizeTags(right);
    if (normalizedLeft.length !== normalizedRight.length) return false;

    return normalizedLeft.every((tag, index) => tag === normalizedRight[index]);
};

export const areItemsEqual = (left: ClipboardItem, right: ClipboardItem) => {
    return (
        left.id === right.id &&
        left.content === right.content &&
        left.type === right.type &&
        left.isPinned === right.isPinned &&
        left.timestamp === right.timestamp &&
        (left.category || '') === (right.category || '') &&
        areTagsEqual(left.tags, right.tags) &&
        hasLoadedDocumentContent(left) === hasLoadedDocumentContent(right)
    );
};

export const mergeIncomingItemWithCache = (existingItem: ClipboardItem, incomingItem: ClipboardItem) => {
    if (
        existingItem.type === 'DOCUMENT' &&
        hasLoadedDocumentContent(existingItem) &&
        !hasLoadedDocumentContent(incomingItem)
    ) {
        return {
            ...incomingItem,
            content: existingItem.content,
            documentContentLoaded: true,
        };
    }

    return incomingItem;
};
