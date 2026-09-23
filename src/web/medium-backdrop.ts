import {
  FULLSCREEN_TRIANGLE_VERTEX_SOURCE,
  type VireGlassBackdropPass,
} from 'vireglass/web';
import type { VireUIKitMediumEmission, VireUIKitMediumParams } from '../medium';
import { createMediumRuntime, type MediumRuntime } from './medium';

/** The simulation grid — its own resolution, coarser than the frame. `time`/`dt` are the caller's
 *  clock: pausing on `prefers-reduced-motion` and testability both stay on its side. */
export type MediumFrame = {
  gridWidth: number;
  gridHeight: number;
  time: number;
  dt: number;
  params?: Partial<VireUIKitMediumParams>;
  /** Tracks stamped this frame; `createMediumDynamics` schedules them. */
  emissions?: readonly VireUIKitMediumEmission[];
};

export type MediumBackdrop = {
  /** The VireGlass renderer's backdrop for this frame: steps the medium and composites it into
   *  the lens's texture. */
  pass(frame: MediumFrame): VireGlassBackdropPass;
  /** Measurement hooks for balance and structure gates; `null` until the medium has rendered once. */
  readTotals(): { vapor: number; condensate: number; track: number } | null;
  readVaporGrid(): { cols: number; rows: number; data: number[] } | null;
  destroy(): void;
};

export function createMediumBackdrop(): MediumBackdrop {
  let runtime: MediumRuntime | null = null;
  let owner: WebGL2RenderingContext | null = null;

  return {
    pass: (frame) => (gl, target) => {
      if (owner && owner !== gl) throw new Error('vireuikit: the medium is already bound to another WebGL context');
      owner = gl;
      runtime ??= createMediumRuntime(gl, FULLSCREEN_TRIANGLE_VERTEX_SOURCE);
      runtime.ensureGrid(frame.gridWidth, frame.gridHeight);
      runtime.step(frame.dt, frame.time, frame.params);
      runtime.emit(frame.emissions ?? []);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      runtime.composite(target.width, target.height, frame.params);
    },
    readTotals: () => runtime?.readTotals() ?? null,
    readVaporGrid: () => runtime?.readVaporGrid() ?? null,
    destroy: () => {
      runtime?.destroy();
      runtime = null;
      owner = null;
    },
  };
}
