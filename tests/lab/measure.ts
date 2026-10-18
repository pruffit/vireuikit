import type { Page } from '@playwright/test';
import type { Footprint } from '../../lab/footprint';

export type Measure = {
  /** OKLab lightness and chroma of the body, median over the ring from 0.15 to 0.45 of the radius inside the rim. */
  bodyL: number;
  bodyC: number;
  /** The same just outside the rim, from 0.15 to 0.55 of the radius out. */
  surroundL: number;
  surroundC: number;
  /** Body minus surround. */
  dL: number;
  dC: number;
  /** Distance between the body's and the surround's (a, b) vectors: how much colour the body did not carry over. */
  dAB: number;
  /** Brightest rim bin (90th percentile of lightness in each of 24 bins) and the dimmest one. */
  rimPeak: number;
  rimMin: number;
  rimOverSurround: number;
};

/** Self-contained, so Playwright can serialize it into the page. */
function measureInPage(arg: { url: string; at: Footprint }): Promise<Measure> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('image did not decode'));
    img.onload = () => {
      const { at } = arg;
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const W = cv.width;
      const H = cv.height;
      const R = Math.min(at.hw, at.hh);
      const lin = (u: number) => {
        const v = u / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      const lab = (r8: number, g8: number, b8: number): [number, number, number] => {
        const r = lin(r8);
        const gg = lin(g8);
        const b = lin(b8);
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * gg + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * gg + 0.1073969566 * b);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * gg + 0.6299787005 * b);
        return [
          0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
        ];
      };
      const pad = Math.ceil(R * 0.7) + 4;
      const x0 = Math.max(0, Math.floor(at.cx - at.hw - pad));
      const x1 = Math.min(W, Math.ceil(at.cx + at.hw + pad));
      const y0 = Math.max(0, Math.floor(at.cy - at.hh - pad));
      const y1 = Math.min(H, Math.ceil(at.cy + at.hh + pad));
      const data = g.getImageData(0, 0, W, H).data;
      const BINS = 24;
      const body: [number, number, number][] = [];
      const surround: [number, number, number][] = [];
      const rim: number[][] = Array.from({ length: BINS }, () => []);
      const rimLo = Math.min(-0.07 * R, -1.5);
      const rimHi = Math.max(0.03 * R, 1);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const px = x + 0.5 - at.cx;
          const py = y + 0.5 - at.cy;
          const qx = Math.abs(px) - (at.hw - R);
          const qy = Math.abs(py) - (at.hh - R);
          const d = at.ellipse
            ? (Math.hypot(px / at.hw, py / at.hh) - 1) * R
            : Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - R;
          const i = (y * W + x) * 4;
          if (d >= -0.45 * R && d <= -0.15 * R) body.push(lab(data[i]!, data[i + 1]!, data[i + 2]!));
          else if (d >= 0.15 * R && d <= 0.55 * R) surround.push(lab(data[i]!, data[i + 1]!, data[i + 2]!));
          else if (d >= rimLo && d <= rimHi) {
            const bin = Math.floor(((Math.atan2(py, px) + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
            rim[bin]!.push(lab(data[i]!, data[i + 1]!, data[i + 2]!)[0]);
          }
        }
      }
      const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]!;
      const quantile = (a: number[], p: number) =>
        [...a].sort((u, v) => u - v)[Math.min(a.length - 1, Math.floor(a.length * p))]!;
      const centre = (P: [number, number, number][]) => [
        median(P.map((v) => v[0])),
        median(P.map((v) => v[1])),
        median(P.map((v) => v[2])),
      ] as [number, number, number];
      const B = centre(body);
      const S = centre(surround);
      const bins = rim.filter((a) => a.length).map((a) => quantile(a, 0.9));
      const out: Measure = {
        bodyL: B[0],
        bodyC: Math.hypot(B[1], B[2]),
        surroundL: S[0],
        surroundC: Math.hypot(S[1], S[2]),
        dL: B[0] - S[0],
        dC: Math.hypot(B[1], B[2]) - Math.hypot(S[1], S[2]),
        dAB: Math.hypot(B[1] - S[1], B[2] - S[2]),
        rimPeak: Math.max(...bins),
        rimMin: Math.min(...bins),
        rimOverSurround: Math.max(...bins) - S[0],
      };
      resolve(out);
    };
    img.src = arg.url;
  });
}

export function measureImage(page: Page, bytes: Buffer, mime: 'png' | 'jpeg', at: Footprint): Promise<Measure> {
  return page.evaluate(measureInPage, { url: `data:image/${mime};base64,${bytes.toString('base64')}`, at });
}

export type RegionStats = { L: number; C: number };
export type Region = { x: number; y: number; width: number; height: number };

/** Median OKLab lightness and chroma over a rectangle of an image, in image pixels. Self-contained like `measureInPage`. */
function regionInPage(arg: { url: string; region: Region }): Promise<RegionStats> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('image did not decode'));
    img.onload = () => {
      const { region } = arg;
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const x0 = Math.max(0, Math.round(region.x));
      const y0 = Math.max(0, Math.round(region.y));
      const data = g.getImageData(x0, y0, Math.max(1, Math.round(region.width)), Math.max(1, Math.round(region.height))).data;
      const lin = (u: number) => {
        const v = u / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      const Ls: number[] = [];
      const Cs: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        const r = lin(data[i]!);
        const gg = lin(data[i + 1]!);
        const b = lin(data[i + 2]!);
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * gg + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * gg + 0.1073969566 * b);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * gg + 0.6299787005 * b);
        Ls.push(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s);
        Cs.push(Math.hypot(1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s));
      }
      const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]!;
      resolve({ L: median(Ls), C: median(Cs) });
    };
    img.src = arg.url;
  });
}

export function regionStats(page: Page, png: Buffer, region: Region): Promise<RegionStats> {
  return page.evaluate(regionInPage, { url: `data:image/png;base64,${png.toString('base64')}`, region });
}
