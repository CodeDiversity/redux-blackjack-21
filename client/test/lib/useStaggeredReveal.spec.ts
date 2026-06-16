import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStaggeredReveal } from '../../src/lib/useStaggeredReveal';

// Mock usePrefersReducedMotion so the hook's reduced-motion branch is testable.
vi.mock('../../src/lib/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: vi.fn(() => false),
}));
import { usePrefersReducedMotion } from '../../src/lib/usePrefersReducedMotion';
const mockReducedMotion = vi.mocked(usePrefersReducedMotion);

describe('useStaggeredReveal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion.mockReturnValue(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    mockReducedMotion.mockReset();
  });

  it('starts at initialCount (default 0) on first render', () => {
    const { result } = renderHook(() => useStaggeredReveal(3, 'k', 100));
    expect(result.current).toBe(0);
  });

  it('increments by 1 every intervalMs until reaching targetCount', () => {
    const { result } = renderHook(() => useStaggeredReveal(3, 'k', 100));
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(1);
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(2);
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(3);
  });

  it('honors initialCount', () => {
    const { result } = renderHook(() => useStaggeredReveal(3, 'k', 100, { initialCount: 1 }));
    expect(result.current).toBe(1);
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current).toBe(3);
  });

  it('honors startDelayMs before the first increment', () => {
    const { result } = renderHook(() => useStaggeredReveal(3, 'k', 100, { startDelayMs: 200 }));
    expect(result.current).toBe(0);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe(1);
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(2);
  });

  it('resets to initialCount when key changes', () => {
    let key = 'k1';
    const { result, rerender } = renderHook(() => useStaggeredReveal(3, key, 100));
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe(3);
    key = 'k2';
    rerender();
    expect(result.current).toBe(0);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe(2);
  });

  it('snaps to targetCount when targetCount decreases below the current count', () => {
    let target = 3;
    const { result, rerender } = renderHook(() => useStaggeredReveal(target, 'k', 100));
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe(2);
    target = 1;
    rerender();
    expect(result.current).toBe(1);
  });

  it('returns targetCount immediately when enabled is false', () => {
    const { result } = renderHook(() => useStaggeredReveal(3, 'k', 100, { enabled: false }));
    expect(result.current).toBe(3);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(3);
  });

  it('returns targetCount immediately when prefers-reduced-motion is true', () => {
    mockReducedMotion.mockReturnValue(true);
    const { result } = renderHook(() => useStaggeredReveal(3, 'k', 100));
    expect(result.current).toBe(3);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(3);
  });

  it('cancels in-flight timers on unmount (no late state update)', () => {
    const { result, unmount } = renderHook(() => useStaggeredReveal(3, 'k', 100));
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(1);
    unmount();
    // Advancing timers after unmount must not throw React warnings.
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });
});
