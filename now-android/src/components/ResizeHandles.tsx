import React, { useEffect, useState } from 'react';
import { BackendService } from '../backend';

const backend = BackendService.getInstance();

const ResizeHandles: React.FC = () => {
    const [isResizing, setIsResizing] = useState(false);

    useEffect(() => {
        const handleUp = () => setIsResizing(false);
        window.addEventListener('mouseup', handleUp);
        return () => window.removeEventListener('mouseup', handleUp);
    }, []);

    const startResize = (direction: string) => (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        document.body.classList.add('resizing'); // Disable transitions during resize
        const startX = e.screenX;
        const startY = e.screenY;
        const startWidth = window.outerWidth;
        const startHeight = window.outerHeight;
        // Note: window.screenX/Y might not be perfectly sync'd in all environments but usually works
        // We don't strictly need startScreenX/Y unless we move the window

        // However, to move the window (Left/Top resizing), we need to request the new X/Y.
        // Electron's window.screenX / window.screenY give the current position.

        const handleMove = (moveEvent: MouseEvent) => {

            const deltaX = moveEvent.screenX - startX;
            const deltaY = moveEvent.screenY - startY;

            // Calculate new bounds
            let newW = startWidth;
            let newH = startHeight;
            let newX = undefined;
            let newY = undefined;

            if (direction.includes('e')) { // East (Right)
                newW = startWidth + deltaX;
            }
            if (direction.includes('s')) { // South (Bottom)
                newH = startHeight + deltaY;
            }
            if (direction.includes('w')) { // West (Left) - tricky
                // When resizing left, we increase width AND move X left
                // Actually, deltaX is negative when creating more space to the left
                // so width should be startWidth - deltaX
                // and X should be currentX + deltaX
                // BUT standard window resize behavior: 
                // dragging left edge left (negative delta) -> width increases, x decreases.

                // Let's use MoveEvent - Start
                newW = startWidth - deltaX;
                // We can't easily get atomic current X from renderer without flickering if we rely on window.screenX constantly updating
                // But for IPC `setBounds`, we probably should send the *intended* new X.
                // Let's grab initial X once.
            }

            // For simplicity and stability in this "Custom UI" context, 
            // let's prioritize Right and Bottom resizing as requested by user.
            // Implementing Left/Top reliably via high-freq IPC often leads to jitter.
            // User specifically showed Bottom-Right in the screenshot.

            const bounds: any = {
                width: startWidth,
                height: startHeight
            };

            if (direction.includes('e') || direction.includes('w')) {
                bounds.width = Math.max(100, newW);
            }

            if (direction.includes('s') || direction.includes('n')) {
                bounds.height = Math.max(100, newH);
            }

            // Clean up undefined if logic changes, but here we set them explicitly to start dims if not modified
            // This prevents "drifting" of the non-resized dimension due to OS/Electron glitches

            backend.resizeWindow(bounds);
        };

        const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleMouseUp);
            setIsResizing(false);
            document.body.classList.remove('resizing'); // Re-enable transitions
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    // Only doing Right, Bottom, Bottom-Right for stability as per "Mouse on edge" request usually implies these.
    // Left/Top often conflicts with window moving.

    return (
        <>
            {/* Right Edge */}
            <div
                className="fixed top-0 right-0 w-[6px] h-full cursor-e-resize z-[99999] hover:bg-blue-500/10 transition-colors"
                onMouseDown={startResize('e')}
            />

            {/* Bottom Edge */}
            <div
                className="fixed bottom-0 left-0 w-full h-[6px] cursor-s-resize z-[99999] hover:bg-blue-500/10 transition-colors"
                onMouseDown={startResize('s')}
            />

            {/* Bottom-Right Corner */}
            <div
                className="fixed bottom-0 right-0 w-[15px] h-[15px] cursor-se-resize z-[100000] hover:bg-blue-500/20 transition-colors rounded-tl-lg"
                onMouseDown={startResize('se')}
            />
        </>
    );
};

export default ResizeHandles;
