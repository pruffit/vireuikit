import { describe, expect, it } from 'vitest';
import { moveGlass, type GlassSession } from '../web/glass';

function session(calls: string[]): GlassSession {
  return {
    setInterim: (on: boolean) => calls.push(`interim:${on}`),
    land: () => calls.push('land'),
  } as unknown as GlassSession;
}

describe('moveGlass', () => {
  it('applies the exact frame when the motion stops and lands the lens in the same call', () => {
    const calls: string[] = [];
    const lens = session(calls);
    moveGlass(lens, true, () => calls.push('apply:coarse'));
    moveGlass(lens, false, () => calls.push('apply:exact'));
    expect(calls).toEqual(['interim:true', 'apply:coarse', 'apply:exact', 'land']);
  });

  it('applies a frame at rest as well, and lands it', () => {
    const calls: string[] = [];
    moveGlass(session(calls), false, () => calls.push('apply'));
    expect(calls).toEqual(['apply', 'land']);
  });
});
