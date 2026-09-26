// The crisp track layer's GPU half: an instanced, additive geometry pass — one oriented quad per
// live track (`track-layer.ts`), drawn straight into the backdrop's target framebuffer after the
// fullscreen composite. RAW WebGL2 GLSL ES 3.0, not the vireglass AGSL-style shader DSL the rest of
// `medium/` is written in (`MEDIUM_COMPOSITE_SHADER` et al., transpiled by `toGLSL`): that pipeline
// only ever draws a single fullscreen triangle, and has no instancing story of its own. Compiled
// with the SAME `createProgram` vireglass/web already exports — it just links whatever GLSL text
// it's given, transpiled or not. The Android port will need its OWN path for this layer (a
// Canvas/AGSL geometry draw, or a dot compute) — this file is web-only.
import { locationCache, setUniform } from 'vireglass/web';
import {
  MEDIUM_TRACK_LAYER_LIFE_SECONDS,
  type VireUIKitMediumLight,
} from '../medium';
import { trackLayerFade, trackLayerWidthMul, type VireUIKitLiveTrack } from './track-layer';

const TRACK_LAYER_VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_source;
layout(location = 2) in vec2 a_head;
layout(location = 3) in float a_headWidth;
layout(location = 4) in float a_tailWidth;
layout(location = 5) in float a_raggedAmp;
layout(location = 6) in float a_raggedFreq;
layout(location = 7) in float a_tailDim;
layout(location = 8) in float a_intensity;
layout(location = 9) in float a_depth;
layout(location = 10) in float a_kind;
layout(location = 11) in float a_seed;

uniform vec2 u_resolution;

out float v_t;
out float v_sPx;
out float v_lenPx;
out float v_headWidth;
out float v_tailWidth;
out float v_raggedAmp;
out float v_raggedFreq;
out float v_tailDim;
out float v_intensity;
out float v_depth;
out float v_kind;
out float v_seed;

void main() {
  vec2 dir = a_head - a_source;
  float len = max(length(dir), 1.0);
  vec2 dirN = dir / len;
  vec2 side = vec2(-dirN.y, dirN.x);
  // Margin beyond the nominal half-width: room for the soft core and the droplets' own jitter to
  // extend past the hard preset edge, plus a depth-dependent allowance for the far/near defocus the
  // fragment shader applies (see its own u_depth use) — a near, wide track needs more headroom than
  // a far, thin one, or its own glow would clip against the quad's edge.
  float maxWidth = max(a_headWidth, a_tailWidth);
  float margin = maxWidth * 0.7 + mix(2.0, 6.0, a_depth);
  float halfSpan = maxWidth * 0.5 + margin;
  vec2 pos = a_source + dirN * (a_corner.y * len) + side * (a_corner.x * halfSpan);
  v_t = a_corner.y;
  v_sPx = a_corner.x * halfSpan;
  v_lenPx = len;
  v_headWidth = a_headWidth;
  v_tailWidth = a_tailWidth;
  v_raggedAmp = a_raggedAmp;
  v_raggedFreq = a_raggedFreq;
  v_tailDim = a_tailDim;
  v_intensity = a_intensity;
  v_depth = a_depth;
  v_kind = a_kind;
  v_seed = a_seed;
  vec2 ndc = (pos / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

// FRAGMENT: track-local coordinates are (v_t: 0 tail…1 head, v_sPx: signed px across the track).
// `gl_FragCoord.xy` is already the SAME window-pixel, y=0-at-bottom frame `MEDIUM_COMPOSITE_SHADER`
// calls `xy` (see that shader's own file header on the orientation contract) — no flip needed here
// either, and no plumbing to get it: a geometry pass reads it directly off the fragment itself.
const TRACK_LAYER_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in float v_t;
in float v_sPx;
in float v_lenPx;
in float v_headWidth;
in float v_tailWidth;
in float v_raggedAmp;
in float v_raggedFreq;
in float v_tailDim;
in float v_intensity;
in float v_depth;
in float v_kind;
in float v_seed;

uniform vec2 u_resolution;
uniform float u_trackLightFloor;
uniform vec2 u_light0Pos;
uniform vec2 u_light0Dir;
uniform float u_light0CosCone;
uniform float u_light0Falloff;
uniform vec3 u_light0Color;
uniform float u_light0Intensity;
uniform vec2 u_light1Pos;
uniform vec2 u_light1Dir;
uniform float u_light1CosCone;
uniform float u_light1Falloff;
uniform vec3 u_light1Color;
uniform float u_light1Intensity;
uniform vec2 u_light2Pos;
uniform vec2 u_light2Dir;
uniform float u_light2CosCone;
uniform float u_light2Falloff;
uniform vec3 u_light2Color;
uniform float u_light2Intensity;

out vec4 fragColor;

float vgHash21(vec2 p) {
  float h = dot(p, vec2(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

float vgValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = vgHash21(i);
  float b = vgHash21(i + vec2(1.0, 0.0));
  float c = vgHash21(i + vec2(0.0, 1.0));
  float d = vgHash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

// Same cone/edge-strip math as MEDIUM_COMPOSITE_SHADER's vgLightAmount, ported to plain vec2/float
// (that one is written in the vireglass DSL's float2 dialect) — duplicated rather than shared
// because the two live on opposite sides of the raw-GLSL/transpiled-DSL boundary this file's header
// describes; keep them in step by eye if the lighting model itself changes.
float vgLightAmount(vec2 xy, vec2 lightPosFrac, vec2 lightDir, float cosCone, float falloff, vec2 resolution) {
  vec2 rel = xy - lightPosFrac * resolution;
  if (cosCone <= -0.999) {
    float depth = max(dot(rel, lightDir), 0.0);
    return exp(-(depth / max(resolution.y, 1.0)) * falloff);
  }
  float dist = length(rel);
  vec2 dirN = dist > 1e-4 ? rel / dist : lightDir;
  float cosAngle = dot(dirN, lightDir);
  float edge = smoothstep(cosCone, mix(cosCone, 1.0, 0.85), cosAngle);
  edge *= edge;
  float atten = exp(-(dist / max(resolution.y, 1.0)) * falloff);
  return edge * atten;
}

void main() {
  float t = clamp(v_t, 0.0, 1.0);
  float halfWidth = mix(v_tailWidth, v_headWidth, t) * 0.5;

  // Path: straight for alpha/muon (v_kind 0/2); electrons (v_kind 1) get a sideways ragged offset
  // growing toward the tail — the same shape emit-shader.ts stamps into the grid, so the crisp
  // layer agrees with the soft residue underneath it.
  float tailness = 1.0 - t;
  float isElectron = step(0.5, v_kind) * step(v_kind, 1.5);
  float ragged = isElectron * v_raggedAmp * tailness *
    vgValueNoise(vec2(t * v_raggedFreq + v_seed, v_seed * 3.7));
  float s = v_sPx - ragged;

  // Depth softens the edge: a near track (depth→1) defocuses into a bigger, softer shape; a far one
  // (depth→0) stays a crisp thin thread — one knob for both, the same idea
  // MEDIUM_TRACK_DEPTH_WIDTH_RANGE already uses for the grid stamp's own width/softness link. A
  // Gaussian, not a smoothstep band: a hard-edged core at nearly the full nominal width is what
  // made many overlapping alpha rays read as a straight-edged wireframe instead of an organic haze
  // (measured against an early render of this layer) — a low-amplitude Gaussian glow contributes a
  // soft unifying haze without itself reading as a solid shape.
  float sigma = halfWidth * 0.5 + mix(1.0, 3.0, v_depth);
  float core = exp(-(s * s) / (2.0 * sigma * sigma));

  // Droplet chain: hashed dots on a 2D track-local grid — spacing ALONG the track is a fixed PX
  // constant per kind (so droplets are the same physical size on a short alpha ray as on a long
  // muon), spacing ACROSS it instead ties to a small fixed ROW COUNT so the cross-section reads as
  // a handful of coherent, slightly overlapping grains rather than a fine, isotropic dust — the
  // reference's rays read as fibrous streaks, not scattered sand.
  float isAlpha = step(v_kind, 0.5);
  float alongSpacingPx = isAlpha > 0.5 ? 6.0 : (isElectron > 0.5 ? 11.0 : 8.0);
  float rowsAcross = isAlpha > 0.5 ? 3.0 : 2.0;
  float acrossSpacingPx = max((halfWidth * 2.0) / rowsAcross, 2.0);
  float dotChance = isAlpha > 0.5 ? 0.78 : (isElectron > 0.5 ? 0.42 : 0.6);
  float dotRadius = isAlpha > 0.5 ? 0.62 : (isElectron > 0.5 ? 0.42 : 0.48);

  vec2 cellSpace = vec2((t * v_lenPx) / alongSpacingPx, s / acrossSpacingPx);
  vec2 cell = floor(cellSpace);
  vec2 cellF = fract(cellSpace) - 0.5;
  float cellSeed = vgHash21(cell + vec2(v_seed * 13.1, v_seed * 5.3));
  float dotOn = step(1.0 - dotChance, cellSeed);
  vec2 jitter = (vec2(vgHash21(cell + vec2(3.1, 7.7)), vgHash21(cell + vec2(9.3, 2.1))) - 0.5) * 0.5;
  float dot = dotOn * smoothstep(dotRadius, dotRadius * 0.25, length(cellF - jitter));

  // The core stays a faint haze (well under 1 on its own); the droplets carry almost all of the
  // brightness, so the track reads as a chain of grains with a soft glow around it, not a filled
  // band.
  float shape = clamp(core * 0.22 + dot, 0.0, 1.0);
  if (shape <= 0.01) discard;

  float brightness = v_intensity * mix(v_tailDim, 1.0, t) * shape;

  float light0 = vgLightAmount(gl_FragCoord.xy, u_light0Pos, u_light0Dir, u_light0CosCone, u_light0Falloff, u_resolution) * u_light0Intensity;
  float light1 = vgLightAmount(gl_FragCoord.xy, u_light1Pos, u_light1Dir, u_light1CosCone, u_light1Falloff, u_resolution) * u_light1Intensity;
  float light2 = vgLightAmount(gl_FragCoord.xy, u_light2Pos, u_light2Dir, u_light2CosCone, u_light2Falloff, u_resolution) * u_light2Intensity;
  vec3 illum = u_light0Color * light0 + u_light1Color * light1 + u_light2Color * light2;

  vec3 glow = brightness * (illum + vec3(u_trackLightFloor));
  // A mild tonemap of the layer's OWN contribution before it lands, additively, on the already
  // tonemapped composite underneath (MEDIUM_COMPOSITE_SHADER's own 1 - exp(-x * 0.9)) — not
  // colorimetrically exact (the composite's tonemap already happened once), but it keeps a bright,
  // overlapping cluster of near tracks from blowing straight to flat white.
  glow = vec3(1.0) - exp(-glow * 1.1);
  fragColor = vec4(glow, 1.0);
}
`;

const FLOATS_PER_INSTANCE = 13;

const KIND_ID: Readonly<Record<keyof typeof MEDIUM_TRACK_LAYER_LIFE_SECONDS, number>> = {
  alpha: 0,
  electron: 1,
  muon: 2,
};

/** Fraction-space live tracks → a flat per-instance float buffer in CONTENT PIXELS, resolved
 *  against the frame's own `contentWidth`/`contentHeight` — the one place resolution enters this
 *  layer (see `track-layer.ts`'s file header: everything upstream of this is resolution-free).
 *  Skips anything already fully faded (or `amount<=0`, the canary `check:medium` uses) rather than
 *  uploading dead weight. Exported for direct testing without a GPU. */
export function buildTrackLayerInstances(
  tracks: readonly VireUIKitLiveTrack[],
  contentWidth: number,
  contentHeight: number,
  amount: number,
): { data: Float32Array; count: number } {
  const minDim = Math.min(contentWidth, contentHeight);
  const data = new Float32Array(tracks.length * FLOATS_PER_INSTANCE);
  let count = 0;
  if (amount <= 0) return { data, count };

  for (const track of tracks) {
    const life = MEDIUM_TRACK_LAYER_LIFE_SECONDS[track.emission.kind];
    const fade = trackLayerFade(track.age, life);
    if (fade <= 1e-4) continue;

    const widthMul = trackLayerWidthMul(track.age, life);
    const sourceX = track.emission.source[0] * contentWidth + track.driftX * minDim;
    const sourceY = track.emission.source[1] * contentHeight + track.driftY * minDim;
    const lengthPx = track.emission.lengthFrac * minDim;
    const headX = sourceX + Math.cos(track.emission.angle) * lengthPx;
    const headY = sourceY + Math.sin(track.emission.angle) * lengthPx;

    const o = count * FLOATS_PER_INSTANCE;
    data[o + 0] = sourceX;
    data[o + 1] = sourceY;
    data[o + 2] = headX;
    data[o + 3] = headY;
    data[o + 4] = track.emission.headWidthFrac * minDim * widthMul;
    data[o + 5] = track.emission.tailWidthFrac * minDim * widthMul;
    data[o + 6] = track.emission.raggedFrac * minDim;
    data[o + 7] = track.emission.raggedFreq;
    data[o + 8] = track.emission.tailDim;
    data[o + 9] = track.emission.intensity * fade * amount;
    data[o + 10] = track.emission.depth;
    data[o + 11] = KIND_ID[track.emission.kind];
    data[o + 12] = track.emission.seed;
    count += 1;
  }
  return { data, count };
}

export type TrackLayerProgram = {
  /** Draws every instance in `data`/`count` (as built by `buildTrackLayerInstances`) additively
   *  into whatever framebuffer is currently bound — the caller (`web/medium.ts`'s `composite`) has
   *  already bound the backdrop's target and drawn the fullscreen composite into it. Leaves blend
   *  state enabled on return; the renderer's own contract puts it back (see
   *  `VireGlassBackdropPass`'s doc comment in vireglass/web). */
  draw(
    contentWidth: number,
    contentHeight: number,
    data: Float32Array,
    count: number,
    trackLightFloor: number,
    lights: readonly (VireUIKitMediumLight | undefined)[],
  ): void;
  destroy(): void;
};

export function createTrackLayerProgram(gl: WebGL2RenderingContext): TrackLayerProgram {
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vertex || !fragment) throw new Error('vireuikit: track layer shader creation failed');
  gl.shaderSource(vertex, TRACK_LAYER_VERTEX_SOURCE);
  gl.compileShader(vertex);
  if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS)) {
    throw new Error(`vireuikit: track layer vertex shader failed:\n${gl.getShaderInfoLog(vertex) ?? ''}`);
  }
  gl.shaderSource(fragment, TRACK_LAYER_FRAGMENT_SOURCE);
  gl.compileShader(fragment);
  if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) {
    throw new Error(`vireuikit: track layer fragment shader failed:\n${gl.getShaderInfoLog(fragment) ?? ''}`);
  }
  const program = gl.createProgram();
  if (!program) throw new Error('vireuikit: track layer program creation failed');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`vireuikit: track layer program failed to link:\n${gl.getProgramInfoLog(program) ?? ''}`);
  }

  const loc = locationCache(gl, program);

  // A static unit quad (s ∈ [-1,1] across the track, t ∈ [0,1] tail→head) — TRIANGLE_STRIP order
  // BL, BR, TL, TR. Every instance's own width/length is applied in the vertex shader, not here.
  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const instanceBuffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const stride = FLOATS_PER_INSTANCE * 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  const layout: readonly [number, number, number][] = [
    [1, 2, 0], // a_source
    [2, 2, 8], // a_head
    [3, 1, 16], // a_headWidth
    [4, 1, 20], // a_tailWidth
    [5, 1, 24], // a_raggedAmp
    [6, 1, 28], // a_raggedFreq
    [7, 1, 32], // a_tailDim
    [8, 1, 36], // a_intensity
    [9, 1, 40], // a_depth
    [10, 1, 44], // a_kind
    [11, 1, 48], // a_seed
  ];
  for (const [location, size, offset] of layout) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);

  function bindLight(slot: number, light: VireUIKitMediumLight | undefined): void {
    const position = light?.position ?? [0, 0];
    const direction = light?.direction ?? [0, 1];
    const dirLen = Math.hypot(direction[0], direction[1]) || 1;
    setUniform(gl, loc(`u_light${slot}Pos`), position);
    setUniform(gl, loc(`u_light${slot}Dir`), [direction[0] / dirLen, direction[1] / dirLen]);
    setUniform(gl, loc(`u_light${slot}CosCone`), Math.cos(light?.coneAngle ?? 0));
    setUniform(gl, loc(`u_light${slot}Falloff`), light?.falloff ?? 0);
    setUniform(gl, loc(`u_light${slot}Color`), light?.color ?? [0, 0, 0]);
    setUniform(gl, loc(`u_light${slot}Intensity`), light?.intensity ?? 0);
  }

  function draw(
    contentWidth: number,
    contentHeight: number,
    data: Float32Array,
    count: number,
    trackLightFloor: number,
    lights: readonly (VireUIKitMediumLight | undefined)[],
  ): void {
    if (count <= 0) return;
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * FLOATS_PER_INSTANCE), gl.DYNAMIC_DRAW);

    setUniform(gl, loc('u_resolution'), [contentWidth, contentHeight]);
    setUniform(gl, loc('u_trackLightFloor'), trackLightFloor);
    for (let slot = 0; slot < 3; slot += 1) bindLight(slot, lights[slot]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, contentWidth, contentHeight);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }

  function destroy(): void {
    gl.deleteBuffer(quadBuffer);
    gl.deleteBuffer(instanceBuffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
  }

  return { draw, destroy };
}
