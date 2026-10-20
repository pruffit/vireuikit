import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveGlass, type GlassSession } from '../web/glass';

function session(calls: string[]): GlassSession {
  return {
    setInterim: (on: boolean) => calls.push(`interim:${on}`),
  } as unknown as GlassSession;
}

describe('moveGlass', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('applies the exact frame when the motion stops, before the interim ends', () => {
    const calls: string[] = [];
    const lens = session(calls);
    moveGlass(lens, true, () => calls.push('apply:coarse'));
    moveGlass(lens, false, () => calls.push('apply:exact'));
    expect(calls).toEqual(['interim:true', 'apply:coarse', 'apply:exact']);
    vi.runAllTimers();
    expect(calls).toEqual(['interim:true', 'apply:coarse', 'apply:exact', 'interim:false']);
  });

  it('applies a frame at rest as well, and lands it', () => {
    const calls: string[] = [];
    moveGlass(session(calls), false, () => calls.push('apply'));
    vi.runAllTimers();
    expect(calls).toEqual(['apply', 'interim:false']);
  });

  it('does not land a lens that moves again before the page has been still', () => {
    const calls: string[] = [];
    const lens = session(calls);
    moveGlass(lens, false, () => calls.push('apply:rest'));
    moveGlass(lens, true, () => calls.push('apply:moving'));
    vi.runAllTimers();
    expect(calls).toEqual(['apply:rest', 'interim:true', 'apply:moving']);
  });
});
