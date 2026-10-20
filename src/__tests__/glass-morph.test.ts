import { describe, expect, it } from 'vitest';
import { glassMorph } from '../web/glass';

const shape = { offsetX: 10.4, offsetY: 3, width: 40, height: 20, cornerRadius: 10 };

describe('glassMorph', () => {
  it('is null without a second shape', () => {
    expect(glassMorph(undefined, false)).toBeNull();
  });

  it('keeps no smoothing as none and a smoothing below half a pixel as none at rest', () => {
    expect(glassMorph({ ...shape, smoothing: 0 }, false)!.smoothing).toBe(0);
    expect(glassMorph({ ...shape, smoothing: 0.3 }, false)!.smoothing).toBe(0);
    expect(glassMorph({ ...shape, smoothing: 0.5 }, false)!.smoothing).toBe(1);
    expect(glassMorph({ ...shape, smoothing: 6.4 }, false)!.smoothing).toBe(6);
  });

  it('never turns a smoothing that exists into none while moving', () => {
    expect(glassMorph({ ...shape, smoothing: 0.3 }, true)!.smoothing).toBe(1);
    expect(glassMorph({ ...shape, smoothing: 0 }, true)!.smoothing).toBe(0);
  });

  it('snaps the shape to whole pixels at rest and to a coarse grid while moving', () => {
    expect(glassMorph({ ...shape, smoothing: 4 }, false)!.shape!.offsetX).toBe(10);
    expect(glassMorph({ ...shape, smoothing: 4 }, true)!.shape!.offsetX).toBe(8);
  });
});
