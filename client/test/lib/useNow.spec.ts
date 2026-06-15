import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useNow } from '../../src/lib/useNow';

describe('useNow', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns the current Date.now() on first render', () => {
    vi.setSystemTime(new Date('2026-06-15T00:00:00Z'));
    const { result } = renderHook(() => useNow(1000));
    expect(result.current).toBe(new Date('2026-06-15T00:00:00Z').getTime());
  });

  it('updates the returned value when the interval fires', () => {
    vi.setSystemTime(new Date('2026-06-15T00:00:00Z'));
    const { result } = renderHook(() => useNow(1000));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(new Date('2026-06-15T00:00:01Z').getTime());
  });

  it('clears the interval on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useNow(1000));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
