import { describe, expect, it } from 'vitest';
import { pressResponse } from '../index';

describe('press response', () => {
  it('a piece that lifts into the glass grows and defocuses more than one that sinks', () => {
    const lift = pressResponse('iconButton');
    const sink = pressResponse('button');
    expect(lift.grow).toBeGreaterThan(sink.grow);
    expect(lift.defocus).toBeGreaterThan(sink.defocus);
  });

  it('a button still answers a press', () => {
    expect(pressResponse('button').grow).toBeGreaterThan(0);
  });
});
