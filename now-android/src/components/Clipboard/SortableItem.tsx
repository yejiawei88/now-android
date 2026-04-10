import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface SortableItemProps {
    id: string;
    children: React.ReactNode | ((dragHandleProps: {
        attributes: any;
        listeners: any;
        setActivatorNodeRef: (element: HTMLElement | null) => void;
        isDragging: boolean;
    }) => React.ReactNode);
    disabled?: boolean;
    freezeTransform?: boolean;
    keepOpacityWhileDragging?: boolean;
    useHandle?: boolean;
}

export const SortableItem = ({
    id,
    children,
    disabled,
    freezeTransform = false,
    keepOpacityWhileDragging = false,
    useHandle = false
}: SortableItemProps) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id, disabled });

    const style = {
        transform: freezeTransform ? undefined : CSS.Translate.toString(transform),
        transition: freezeTransform ? 'none' : transition,
        zIndex: isDragging ? 100 : 'auto',
        position: 'relative' as const,
        opacity: isDragging && !keepOpacityWhileDragging ? 0.4 : 1,
    };

    const content = typeof children === 'function'
        ? children({ attributes, listeners, setActivatorNodeRef, isDragging })
        : children;

    return useHandle ? (
        <div ref={setNodeRef} style={style} {...attributes}>
            {content}
        </div>
    ) : (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            {content}
        </div>
    );
};
