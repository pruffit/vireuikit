// Oklab / linear-sRGB — the shared math for mixing the medium's channels (mix in OKLCH/Oklab, not
// raw RGB, or saturated diffusion hues collapse into gray). Coefficients: Björn Ottosson,
// https://bottosson.github.io/posts/oklab/.
//
// The numbers live as ONE set: the shader text is assembled from the same matrices the JS side
// computes with. While the forward direction lived in TS and the inverse was separate literals in
// the shader, they could drift apart silently, and the medium's palette would shift by a hue
// between the GPU and any JS-side precomputation.
type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

export const LINEAR_TO_LMS: Mat3 = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

export const LMS_TO_OKLAB: Mat3 = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

export const OKLAB_TO_LMS: Mat3 = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
];

export const LMS_TO_LINEAR: Mat3 = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

/** GLSL integers aren't floats, so the decimal point is mandatory: `1` won't compile as a float. */
const glsl = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const row = (m: Mat3, i: number, vars: readonly [string, string, string]) =>
  m[i].map((k, j) => `${glsl(k)} * ${vars[j]}`).join(' + ');

export const VG_OKLAB_TO_SRGB = `
float3 vgLinearToSrgb(float3 c) {
  float3 lo = c * 12.92;
  float3 hi = 1.055 * pow(max(c, float3(0.0)), float3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(float3(0.0031308), c));
}

float3 vgOklabToLinear(float3 lab) {
  float l_ = ${row(OKLAB_TO_LMS, 0, ['lab.x', 'lab.y', 'lab.z'])};
  float m_ = ${row(OKLAB_TO_LMS, 1, ['lab.x', 'lab.y', 'lab.z'])};
  float s_ = ${row(OKLAB_TO_LMS, 2, ['lab.x', 'lab.y', 'lab.z'])};
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  return float3(
    ${row(LMS_TO_LINEAR, 0, ['l', 'm', 's'])},
    ${row(LMS_TO_LINEAR, 1, ['l', 'm', 's'])},
    ${row(LMS_TO_LINEAR, 2, ['l', 'm', 's'])}
  );
}
`;

const apply = (m: Mat3, v: readonly [number, number, number]): [number, number, number] => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const srgbChannelToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const linearChannelToSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;

export function srgbToOklab(rgb: readonly [number, number, number]): readonly [number, number, number] {
  const linear = rgb.map(srgbChannelToLinear) as [number, number, number];
  const lms = apply(LINEAR_TO_LMS, linear);
  return apply(LMS_TO_OKLAB, lms.map((v) => Math.cbrt(Math.max(v, 0))) as [number, number, number]);
}

/** The inverse direction in JS — the same numbers that go into the shader: only that way does a
 *  round-trip test prove the GPU and the CPU compute the same thing. */
export function oklabToSrgb(lab: readonly [number, number, number]): readonly [number, number, number] {
  const lms = apply(OKLAB_TO_LMS, lab as [number, number, number]).map((v) => v * v * v) as [
    number,
    number,
    number,
  ];
  return apply(LMS_TO_LINEAR, lms).map(linearChannelToSrgb) as [number, number, number];
}
