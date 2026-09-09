'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type StoredState<T> = { namespace: string; value: T; scrollY: number };

export function useNavigationState<T extends Record<string, unknown>>(
  namespace: string,
  fallback: T,
) {
  const storageKey = `nutri:navigation:${namespace}`;
  const fallbackRef = useRef(fallback);
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return fallback;
    const historyValue = window.history.state?.nutriNavigation as
      | StoredState<T>
      | undefined;
    if (historyValue?.namespace === namespace)
      return { ...fallback, ...historyValue.value };
    try {
      return {
        ...fallback,
        ...(JSON.parse(sessionStorage.getItem(storageKey) || '') as T),
      };
    } catch {
      return fallback;
    }
  });
  const initialValue = useRef(value);
  const valueRef = useRef(value);

  useEffect(() => {
    const current = window.history.state?.nutriNavigation as
      | StoredState<T>
      | undefined;
    if (current?.namespace !== namespace) {
      const restored = initialValue.current;
      const base = fallbackRef.current;
      const hasRestoredContext =
        JSON.stringify(restored) !== JSON.stringify(base);
      const baseState = {
        ...window.history.state,
        nutriNavigation: { namespace, value: base, scrollY: 0 },
      };
      window.history.replaceState(baseState, '');
      if (hasRestoredContext) {
        window.history.pushState(
          {
            ...baseState,
            nutriNavigation: { namespace, value: restored, scrollY: 0 },
          },
          '',
        );
      }
    }
    sessionStorage.setItem(storageKey, JSON.stringify(initialValue.current));
    const onPopState = (event: PopStateEvent) => {
      if (event.state?.nutriOverlayReturn) return;
      const stored = event.state?.nutriNavigation as StoredState<T> | undefined;
      if (stored?.namespace !== namespace) return;
      valueRef.current = stored.value;
      setValue(stored.value);
      sessionStorage.setItem(storageKey, JSON.stringify(stored.value));
      requestAnimationFrame(() =>
        window.scrollTo({ top: stored.scrollY ?? 0, behavior: 'auto' }),
      );
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [namespace, storageKey]);

  const navigate = useCallback(
    (
      update: Partial<T> | ((current: T) => T),
      options?: { replace?: boolean },
    ) => {
      const current = valueRef.current;
      const next =
        typeof update === 'function'
          ? update(current)
          : { ...current, ...update };
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      window.history.replaceState(
        {
          ...window.history.state,
          nutriNavigation: {
            namespace,
            value: current,
            scrollY: window.scrollY,
          },
        },
        '',
      );
      const state = {
        ...window.history.state,
        nutriNavigation: { namespace, value: next, scrollY: 0 },
      };
      if (options?.replace) window.history.replaceState(state, '');
      else window.history.pushState(state, '');
      valueRef.current = next;
      setValue(next);
      requestAnimationFrame(() =>
        window.scrollTo({ top: 0, behavior: 'auto' }),
      );
    },
    [namespace, storageKey],
  );

  return [value, navigate] as const;
}
