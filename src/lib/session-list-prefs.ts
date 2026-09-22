import { useCallback, useState } from 'react';

const sessionPrefs = new Map<string, unknown>();

export function useSessionPref<T extends object>(key: string, defaults: T): [T, (patch: Partial<T>) => void] {
  const [value, setValue] = useState<T>(() => ({
    ...defaults,
    ...(sessionPrefs.get(key) as Partial<T> | undefined),
  }));

  const patch = useCallback(
    (next: Partial<T>) => {
      setValue((prev) => {
        const merged = { ...prev, ...next };
        sessionPrefs.set(key, merged);
        return merged;
      });
    },
    [key]
  );

  return [value, patch];
}
