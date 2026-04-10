import { useEffect, useRef } from 'react';

export function useDebouncedLocalStorage<T>(
    key: string,
    value: T,
    delay: number = 500,
    transform?: (val: T) => any
): void {
    const keyRef = useRef(key);
    const valueRef = useRef(value);
    const transformRef = useRef(transform);

    keyRef.current = key;
    valueRef.current = value;
    transformRef.current = transform;

    useEffect(() => {
        const timer = setTimeout(() => {
            try {
                const dataToSave = transformRef.current ? transformRef.current(valueRef.current) : valueRef.current;
                localStorage.setItem(keyRef.current, JSON.stringify(dataToSave));
            } catch (e) {
                console.error(`Failed to save to localStorage (${keyRef.current}):`, e);
            }
        }, delay);

        return () => {
            clearTimeout(timer);
        };
    }, [key, value, delay]);
}
