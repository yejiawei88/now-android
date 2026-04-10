import { useEffect, RefObject } from 'react';

export const useDragAutoScroll = (
    draggingIndex: number | null,
    virtuosoRef: RefObject<any>,
    scrollRef: RefObject<HTMLDivElement>
) => {
    useEffect(() => {
        if (draggingIndex === null) return;

        const handleDragAutoScroll = (e: MouseEvent) => {
            // Auto-scroll for items list
            const container = document.querySelector('.virtuoso-scroller');
            if (container) {
                const rect = container.getBoundingClientRect();
                const threshold = 120;
                const topDist = e.clientY - rect.top;
                const bottomDist = rect.bottom - e.clientY;

                if (topDist < threshold) {
                    const speed = Math.max(2, (threshold - topDist) / 4);
                    virtuosoRef.current?.scrollBy({ top: -speed * 4, behavior: 'auto' });
                } else if (bottomDist < threshold) {
                    const speed = Math.max(2, (threshold - bottomDist) / 4);
                    virtuosoRef.current?.scrollBy({ top: speed * 4, behavior: 'auto' });
                }
            }

            // Horizontal auto-scroll for categories bar
            const tabsContainer = scrollRef.current;
            if (tabsContainer) {
                const tabsRect = tabsContainer.getBoundingClientRect();
                if (e.clientY >= tabsRect.top - 60 && e.clientY <= tabsRect.bottom + 60) {
                    const hThreshold = 80;
                    const leftDist = e.clientX - tabsRect.left;
                    const rightDist = tabsRect.right - e.clientX;

                    if (rightDist < hThreshold && rightDist > -20) {
                        const speed = Math.max(3, (hThreshold - rightDist) / 4);
                        tabsContainer.scrollLeft += speed * 2;
                    } else if (leftDist < hThreshold && leftDist > -20) {
                        const speed = Math.max(3, (hThreshold - leftDist) / 4);
                        tabsContainer.scrollLeft -= speed * 2;
                    }
                }
            }
        };

        window.addEventListener('mousemove', handleDragAutoScroll);
        return () => window.removeEventListener('mousemove', handleDragAutoScroll);
    }, [draggingIndex, virtuosoRef, scrollRef]);
};
