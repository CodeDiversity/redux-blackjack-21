import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export type StaggeredRevealOptions = {
  initialCount?: number;
  enabled?: boolean;
  startDelayMs?: number;
};

/**
 * Returns the number of items currently "revealed" for the current key,
 * starting at `initialCount` and incrementing by 1 every `intervalMs`
 * (after an optional `startDelayMs`) until it reaches `targetCount`.
 *
 * Resets to `initialCount` when `key` changes.
 * When `enabled` is false, returns `targetCount` immediately.
 * When `usePrefersReducedMotion()` is true, returns `targetCount` immediately.
 *
 * If `targetCount` decreases below the current visible count, the returned
 * value snaps to the new `targetCount` (the in-flight stagger is cancelled).
 */
export function useStaggeredReveal(
  targetCount: number,
  key: unknown,
  intervalMs: number,
  options: StaggeredRevealOptions = {},
): number {
  const { initialCount = 0, enabled = true, startDelayMs = 0 } = options;
  const reducedMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState<number>(initialCount);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeyRef = useRef<unknown>(key);
  const visibleRef = useRef<number>(initialCount);

  // Keep the latest visible count in a ref so the effect can read it.
  visibleRef.current = visible;

  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    clear();

    if (!enabled || reducedMotion) {
      setVisible(targetCount);
      lastKeyRef.current = key;
      return clear;
    }

    const keyChanged = lastKeyRef.current !== key;
    lastKeyRef.current = key;

    if (keyChanged) {
      // Hard reset: snap to initialCount and restart the stagger.
      setVisible(initialCount);
      visibleRef.current = initialCount;
      if (targetCount <= initialCount) return clear;

      let cancelled = false;
      const step = (current: number, isFirst: boolean) => {
        if (cancelled) return;
        if (current >= targetCount) {
          timerRef.current = null;
          return;
        }
        const delay = isFirst ? (startDelayMs > 0 ? startDelayMs : intervalMs) : intervalMs;
        timerRef.current = setTimeout(() => {
          const next = current + 1;
          setVisible(next);
          step(next, false);
        }, delay);
      };
      step(initialCount, true);

      return () => {
        cancelled = true;
        clear();
      };
    }

    // Same key: handle targetCount change without a full reset.
    const currentVisible = visibleRef.current;
    if (targetCount <= currentVisible) {
      // Target dropped to or below current visible: snap to the new target.
      setVisible(targetCount);
      return clear;
    }
    if (targetCount <= initialCount) {
      setVisible(targetCount);
      return clear;
    }

    // Target grew above current visible: continue staggering from where we are.
    let cancelled = false;
    const step = (current: number, isFirst: boolean) => {
      if (cancelled) return;
      if (current >= targetCount) {
        timerRef.current = null;
        return;
      }
      const delay = isFirst ? (startDelayMs > 0 ? startDelayMs : intervalMs) : intervalMs;
      timerRef.current = setTimeout(() => {
        const next = current + 1;
        setVisible(next);
        step(next, false);
      }, delay);
    };
    step(currentVisible, true);

    return () => {
      cancelled = true;
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, targetCount, enabled, intervalMs, startDelayMs, initialCount, reducedMotion]);

  return visible;
}
