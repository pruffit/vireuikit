/** A control's footprint in image pixels: half sizes, and a circle or capsule of the smaller one (or an ellipse). */
export type Footprint = { cx: number; cy: number; hw: number; hh: number; ellipse?: boolean };
