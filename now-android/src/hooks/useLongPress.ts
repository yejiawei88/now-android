import { useRef, useCallback, useEffect } from 'react';

interface UseLongPressOptions {
    threshold?: number; // 长按触发时间（毫秒），默认 500ms
    onLongPress: (e: React.TouchEvent | React.MouseEvent) => void;
    onPress?: (e: React.TouchEvent | React.MouseEvent) => void;
    onCancel?: () => void;
}

export function useLongPress({
    threshold = 500,
    onLongPress,
    onPress,
    onCancel
}: UseLongPressOptions) {
    const timerRef = useRef<number | null>(null);
    const isLongPressedRef = useRef(false);
    const startPosRef = useRef<{ x: number; y: number } | null>(null);

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const start = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        const touch = 'touches' in e ? e.touches[0] : null;
        const clientX = touch ? touch.clientX : (e as React.MouseEvent).clientX;
        const clientY = touch ? touch.clientY : (e as React.MouseEvent).clientY;

        startPosRef.current = { x: clientX, y: clientY };
        isLongPressedRef.current = false;

        // 设置长按计时器
        timerRef.current = window.setTimeout(() => {
            isLongPressedRef.current = true;
            onLongPress(e);
        }, threshold);
    }, [threshold, onLongPress]);

    const move = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        if (!startPosRef.current) return;

        const touch = 'touches' in e ? e.touches[0] : null;
        const clientX = touch ? touch.clientX : (e as React.MouseEvent).clientX;
        const clientY = touch ? touch.clientY : (e as React.MouseEvent).clientY;

        // 如果移动超过 10px，取消长按
        const deltaX = Math.abs(clientX - startPosRef.current.x);
        const deltaY = Math.abs(clientY - startPosRef.current.y);

        if (deltaX > 10 || deltaY > 10) {
            clearTimer();
            startPosRef.current = null;
        }
    }, [clearTimer]);

    const end = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        clearTimer();

        if (!isLongPressedRef.current && onPress) {
            onPress(e);
        }

        if (isLongPressedRef.current && onCancel) {
            onCancel();
        }

        isLongPressedRef.current = false;
        startPosRef.current = null;
    }, [clearTimer, onPress, onCancel]);

    const cancel = useCallback(() => {
        clearTimer();
        isLongPressedRef.current = false;
        startPosRef.current = null;
        if (onCancel) {
            onCancel();
        }
    }, [clearTimer, onCancel]);

    // 清理
    useEffect(() => {
        return () => {
            clearTimer();
        };
    }, [clearTimer]);

    // 触摸设备事件处理
    const touchHandlers = {
        onTouchStart: start,
        onTouchMove: move,
        onTouchEnd: end,
        onTouchCancel: cancel,
    };

    // 桌面设备（鼠标右键）事件处理
    const mouseHandlers = {
        onMouseDown: (e: React.MouseEvent) => {
            // 右键仍然触发右键菜单
            if (e.button === 2) {
                e.preventDefault();
                onLongPress(e);
                return;
            }
            start(e);
        },
        onMouseMove: move,
        onMouseUp: end,
        onMouseLeave: cancel,
        onContextMenu: (e: React.MouseEvent) => {
            // 阻止默认右键菜单，用长按代替
            e.preventDefault();
            onLongPress(e);
        },
    };

    return {
        touchHandlers,
        mouseHandlers,
        isLongPressed: () => isLongPressedRef.current,
    };
}

export default useLongPress;
