import { useLayoutEffect, type RefObject } from 'react';

type EditableField = HTMLInputElement | HTMLTextAreaElement;

interface UseEditFieldFocusOptions {
    enabled: boolean;
    selectAll?: boolean;
    moveCaretToEnd?: boolean;
    fitHeightToContent?: boolean;
    triggerKey?: string | number | null;
}

export const useEditFieldFocus = <T extends EditableField>(
    ref: RefObject<T | null>,
    {
        enabled,
        selectAll = false,
        moveCaretToEnd = false,
        fitHeightToContent = false,
        triggerKey = null
    }: UseEditFieldFocusOptions
) => {
    useLayoutEffect(() => {
        if (!enabled) return;

        let timeoutId: number | null = null;
        let cancelled = false;

        const applyFocus = () => {
            if (cancelled) return;
            const field = ref.current;
            if (!field) return;

            if (fitHeightToContent && field instanceof HTMLTextAreaElement) {
                field.style.height = 'auto';
                field.style.height = `${field.scrollHeight}px`;
            }

            field.focus({ preventScroll: true });

            if (selectAll) {
                field.select();
                return;
            }

            if (moveCaretToEnd) {
                const end = field.value.length;
                field.setSelectionRange(end, end);
            }
        };

        const ensureFocus = (attempt = 0) => {
            if (cancelled) return;

            const field = ref.current;
            if (!field) return;

            if (document.activeElement !== field) {
                applyFocus();
            }

            if (document.activeElement !== field && attempt < 6) {
                timeoutId = window.setTimeout(() => ensureFocus(attempt + 1), 16);
            }
        };

        const frameId = window.requestAnimationFrame(() => ensureFocus());

        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frameId);
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
        };
    }, [enabled, fitHeightToContent, moveCaretToEnd, ref, selectAll, triggerKey]);
};
