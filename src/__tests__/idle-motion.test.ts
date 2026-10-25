import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelMotionFrame, requestMotionFrame, whenIdle } from '../web/dom';

type Task = (t: number) => void;

let frames: Map<number, Task>;
let idles: Map<number, () => void>;
let nextId: number;

const flushFrames = (): void => {
  const due = Array.from(frames.entries());
  frames.clear();
  for (const [, task] of due) task(0);
};
const runIdle = (): void => {
  const due = Array.from(idles.values());
  idles.clear();
  for (const task of due) task();
};
const microtasks = () => Promise.resolve();

function install(withIdle: boolean): void {
  frames = new Map();
  idles = new Map();
  nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (task: Task) => (frames.set(nextId, task), nextId++));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('window', { setTimeout: (task: () => void) => (idles.set(nextId, task), nextId++), clearTimeout: (id: number) => idles.delete(id) });
  if (withIdle) {
    vi.stubGlobal('requestIdleCallback', (task: () => void) => (idles.set(nextId, task), nextId++));
    vi.stubGlobal('cancelIdleCallback', (id: number) => idles.delete(id));
  } else vi.stubGlobal('requestIdleCallback', undefined);
}

afterEach(() => vi.unstubAllGlobals());

describe.each([true, false])('idle work with requestIdleCallback %s', (withIdle) => {
  beforeEach(() => install(withIdle));

  it('runs at once on a quiet page', () => {
    const run = vi.fn();
    whenIdle(run);
    runIdle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits while a motion runs and runs after it ends', async () => {
    const run = vi.fn();
    let steps = 0;
    const tick = (): void => {
      steps += 1;
      if (steps < 3) requestMotionFrame(tick);
    };
    requestMotionFrame(tick);
    whenIdle(run);
    runIdle();
    expect(run).not.toHaveBeenCalled();
    flushFrames();
    runIdle();
    flushFrames();
    runIdle();
    expect(run).not.toHaveBeenCalled();
    flushFrames();
    await microtasks();
    runIdle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not run an idle callback that was already queued when a motion starts', async () => {
    const run = vi.fn();
    whenIdle(run);
    requestMotionFrame(() => undefined);
    runIdle();
    expect(run).not.toHaveBeenCalled();
    flushFrames();
    await microtasks();
    runIdle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a cancelled wait never runs, and a cancelled motion releases the wait', async () => {
    const run = vi.fn();
    const id = requestMotionFrame(() => undefined);
    const cancel = whenIdle(run);
    cancel();
    cancelMotionFrame(id);
    await microtasks();
    runIdle();
    expect(run).not.toHaveBeenCalled();
    const second = vi.fn();
    const id2 = requestMotionFrame(() => undefined);
    whenIdle(second);
    cancelMotionFrame(id2);
    await microtasks();
    runIdle();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
