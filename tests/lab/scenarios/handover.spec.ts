import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import type { Box, Recording } from './capture';
import { Frames, pop } from './gates';

// The pop gate on frames made in memory from the menu's hand-back to its trigger (the "Sort" button, owner viewport):
// the pale drop turns into the cream button and its grey label into black. Every case is deterministic.

const W = 120;
const H = 80;
const crc = (() => {
  const table = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  return (b: Buffer): number => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

const chunk = (type: string, body: Buffer): Buffer => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
};

const lerp = (a: number[], b: number[], k: number): number[] => a.map((v, i) => Math.round(v + (b[i]! - v) * k));
const DROP = [240, 234, 220];
const BUTTON = [246, 238, 216];
const GREY = [110, 106, 100];
const BLACK = [20, 18, 16];
const PAGE = [246, 240, 228];

/** The trigger at `k` (0: the drop with its faded label, 1: the button with its label); the label is a bar in the middle of the box. */
function png(k: number): Buffer {
  const rows: Buffer[] = [];
  const body = lerp(DROP, BUTTON, k);
  const ink = lerp(GREY, BLACK, k);
  for (let y = 0; y < H; y += 1) {
    const row = Buffer.alloc(1 + W * 3);
    for (let x = 0; x < W; x += 1) {
      const inBox = x >= 20 && x < 100 && y >= 20 && y < 60;
      const inLabel = x >= 40 && x < 80 && y >= 36 && y < 44;
      row.set(inLabel ? ink : inBox ? body : PAGE, 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const box = (hidden: boolean): Box => ({ x: 20, y: 20, w: 80, h: 40, r: 20, hidden });

/** `ks[i]` is how far toward the button frame i is; the drop is out until frame `leaves`; `gaps` overrides the 17 ms between frames. */
function recording(ks: number[], leaves: number, gaps: Record<number, number> = {}): Recording {
  const times: number[] = [];
  ks.forEach((_, i) => times.push(i === 0 ? 0 : times[i - 1]! + (gaps[i] ?? 17)));
  const cache = new Map<number, Buffer>();
  return {
    name: 'handover',
    viewport: { width: W, height: H },
    shots: ks.map((k, i) => ({ t: times[i]!, png: cache.get(k) ?? (cache.set(k, png(k)), cache.get(k)!) })),
    input: 0,
    motion: [],
    marks: {},
    samples: times.map((t, i) => ({ t, boxes: { trig: [box(false)], list: [box(i >= leaves)] } })),
    backdrops: [],
    pageErrors: [],
    scrollers: [],
    stats: null,
  };
}

const still = (n: number, k: number) => Array<number>(n).fill(k);
const verdict = (rec: Recording) => {
  const r = pop(new Frames(rec), { keys: ['trig'], surface: 'list' });
  console.log(`  ${r.verdict}: ${r.line}`);
  return r;
};

test('pop: the body and the label swapped in the frame the drop leaves', () => {
  const r = verdict(recording([...still(20, 0), ...still(20, 1)], 20));
  expect(r.verdict, r.line).toBe('fail');
});

test('pop: the same swap in a frame that follows a compositor stall', () => {
  const r = verdict(recording([...still(20, 0), ...still(20, 1)], 20, { 19: 5 }));
  expect(r.verdict, r.line).toBe('fail');
});

test('pop: the same swap in the 40 ms after the drop has left', () => {
  const r = verdict(recording([...still(22, 0), ...still(20, 1)], 20));
  expect(r.verdict, r.line).toBe('fail');
});

test('pop: body and label that ramp over twelve frames, the stall included', () => {
  const ramp = Array.from({ length: 12 }, (_, i) => (i + 1) / 12);
  const r = verdict(recording([...still(20, 0), ...ramp, ...still(10, 1)], 20, { 19: 5 }));
  expect(r.verdict, r.line).toBe('pass');
});
