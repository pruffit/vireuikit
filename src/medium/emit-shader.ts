import { VG_VALUE_NOISE } from './noise';

// Stamps a track into the vapor: one pass that stamps a density burst DIRECTLY into the dye buffer
// — the same one that carries the curl-noise field and that composite-shader.ts reads. From there
// the track lives and fades through exactly the same code as the gas: advection carries and spins
// it, exponential decay extinguishes it. It has no position of its own and no lifetime timer here —
// the track's entire physics is the shape of this ONE stamped frame.
//
// The head (s=1, at u_head) is sharp, narrow, bright — fresh ionization. The tail (s=0, at
// u_source) is wider, dimmer and has settled downward — those droplets had time to grow earlier.
// The path's noise-driven spread also grows toward the tail and fades toward the head, so the
// thread stays straight and crisp at its leading end.
//
// Stamped equally into r/g/b (no per-track color mask): a track carries no color of its own, it is
// lit the same way as the mist around it (`MEDIUM_COMPOSITE_SHADER`) — species/lights own hue now,
// not which random channel a track happened to land on.
export const MEDIUM_EMIT_SHADER = `
uniform float2 u_source;
uniform float2 u_head;
uniform float  u_headWidth;
uniform float  u_tailWidth;
uniform float  u_raggedAmp;
uniform float  u_raggedFreq;
uniform float  u_settle;
uniform float  u_tailDim;
uniform float  u_intensity;
uniform float  u_seed;

${VG_VALUE_NOISE}

half4 main(float2 xy) {
  float2 dir = u_head - u_source;
  float len = max(length(dir), 1.0);
  float2 side = float2(-dir.y, dir.x) / len;

  float best = 0.0;
  const int STEPS = 12;
  for (int i = 0; i < STEPS; i++) {
    float s = float(i) / float(STEPS - 1);
    float tailness = 1.0 - s;
    float ragged = u_raggedAmp * tailness * vgValueNoise(float2(s * u_raggedFreq + u_seed, u_seed * 3.7));
    float2 p = mix(u_source, u_head, s) + side * ragged + float2(0.0, u_settle * tailness * tailness);
    float w = max(mix(u_tailWidth, u_headWidth, s), 0.5);
    float amp = mix(u_tailDim, 1.0, s);
    float d = length(xy - p);
    float v = amp * exp(-(d * d) / (2.0 * w * w));
    best = max(best, v);
  }

  float3 dye = float3(best * u_intensity);
  return half4(half3(dye), half(1.0));
}
`;
