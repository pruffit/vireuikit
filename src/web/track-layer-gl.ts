// The crisp track layer's GPU half: one instanced, additive quad per live track, drawn into the
// backdrop's target right after the fullscreen composite. Raw GLSL ES 3.0 rather than the
// transpiled shader dialect, which only draws fullscreen passes; the Android port needs its own path.
import { locationCache, setUniform } from 'vireglass/web';
import {
  MEDIUM_TRACK_LAYER_LIFE_SECONDS,
  MEDIUM_TRACK_LAYER_LOOK,
  type VireUIKitMediumLight,
} from '../medium';
import { trackLayerFade, trackLayerSigmaMul, type VireUIKitLiveTrack } from './track-layer';

const TRACK_LAYER_VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_geom;
layout(location = 2) in vec4 a_span;
layout(location = 3) in vec4 a_path;
layout(location = 4) in vec4 a_grain;

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

out vec2 v_local;
flat out vec4 v_span;
flat out vec4 v_path;
flat out vec4 v_grain;
flat out float v_reach;
out vec3 v_illum;

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

// Keep in step with vgLightAmount in composite-shader.ts.
float vgLightAmount(vec2 xy, vec2 lightPosFrac, vec2 lightDir, float cosCone, float falloff, vec2 resolution, float seed) {
  vec2 rel = xy - lightPosFrac * resolution;
  if (cosCone <= -0.999) {
    float depth = max(dot(rel, lightDir), 0.0);
    return exp(-(depth / max(resolution.y, 1.0)) * falloff);
  }
  float dist = length(rel);
  vec2 dirN = dist > 1e-4 ? rel / dist : lightDir;
  float cosAngle = dot(dirN, lightDir);
  float lobe = log(0.5) / log(clamp(cosCone, 0.05, 0.999));
  float edge = pow(max(cosAngle, 0.0), lobe);
  float atten = exp(-(dist / max(resolution.y, 1.0)) * falloff);
  if (edge * atten < 0.001) return 0.0;
  float angle = atan(dirN.x * lightDir.y - dirN.y * lightDir.x, cosAngle);
  float shafts = 0.6 + 0.32 * vgValueNoise(vec2(angle * 14.0, seed)) + 0.18 * vgValueNoise(vec2(angle * 33.0, seed + 5.3));
  return edge * atten * clamp(shafts, 0.0, 1.0);
}

void main() {
  vec2 dir = a_geom.zw;
  vec2 side = vec2(-dir.y, dir.x);
  // Beads widen sigma by up to 20%; 3.5 sigma leaves under 1% of the core outside the quad.
  float reach = max(a_span.z, a_span.w) * 1.2 * 3.5 + 1.5;
  float margin = reach + a_path.x * 1.7;
  float u = mix(a_span.y - reach, a_span.x + reach, a_corner.y);
  float s = a_corner.x * margin;
  vec2 pos = a_geom.xy + dir * u + side * s;
  v_local = vec2(u, s);
  v_span = a_span;
  v_path = a_path;
  v_grain = a_grain;
  v_reach = reach;
  // Lit per corner: light varies over hundreds of px, a track is a few px wide. The backdrop
  // target stores the scene top row at y = 0; lights use y up.
  vec2 xy = vec2(pos.x, u_resolution.y - pos.y);
  float light0 = vgLightAmount(xy, u_light0Pos, u_light0Dir, u_light0CosCone, u_light0Falloff, u_resolution, 1.7) * u_light0Intensity;
  float light1 = vgLightAmount(xy, u_light1Pos, u_light1Dir, u_light1CosCone, u_light1Falloff, u_resolution, 4.1) * u_light1Intensity;
  float light2 = vgLightAmount(xy, u_light2Pos, u_light2Dir, u_light2CosCone, u_light2Falloff, u_resolution, 8.3) * u_light2Intensity;
  v_illum = u_light0Color * light0 + u_light1Color * light1 + u_light2Color * light2 + vec3(u_trackLightFloor);
  gl_Position = vec4((pos / u_resolution) * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Track-local coordinates: x along the track from its source in px, y across it in px. A track
// is a Gaussian core whose width and brightness bead along its length, plus stray droplets
// scattered around it; all noise is 1D along the track, so nothing lines up on a screen grid.
const TRACK_LAYER_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 v_local;
flat in vec4 v_span;
flat in vec4 v_path;
flat in vec4 v_grain;
flat in float v_reach;
in vec3 v_illum;

out vec4 fragColor;

float vgHash(float a, float b) {
  uint x = floatBitsToUint(a) * 0x9E3779B1u ^ (floatBitsToUint(b) + 0x7F4A7C15u);
  x ^= x >> 16;
  x *= 0x7FEB352Du;
  x ^= x >> 15;
  x *= 0x846CA68Bu;
  x ^= x >> 16;
  return float(x) * (1.0 / 4294967295.0);
}

float vgNoise1(float x, float salt) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(vgHash(i, salt), vgHash(i + 1.0, salt), u);
}

void main() {
  float len = v_span.x;
  float start = v_span.y;
  float sigma0 = v_span.z;
  float sigma1 = v_span.w;
  float wiggleAmp = v_path.x;
  float wiggleFreq = v_path.y;
  float amp = v_path.z;
  float seed = v_path.w;
  float beadPx = v_grain.x;
  float dropPx = v_grain.y;
  float dropChance = v_grain.z;
  float blur = v_grain.w;

  float u = v_local.x;
  float s = v_local.y;
  float t = clamp((u - start) / max(len - start, 1.0), 0.0, 1.0);

  float wiggle = 0.0;
  if (wiggleAmp > 0.0) {
    float x = u * wiggleFreq;
    wiggle = wiggleAmp * smoothstep(0.0, 0.2, t) *
      ((vgNoise1(x, seed) - 0.5) * 2.0 + (vgNoise1(x * 3.1, seed + 1.0) - 0.5) * 0.7);
  }
  float across = s - wiggle;
  if (abs(across) > v_reach) discard;

  float bead = vgNoise1(u / beadPx, seed + 2.0);
  // Blur (age, defocus) washes the beads out rather than stretching them into ribs.
  float sigma = mix(sigma0, sigma1, t * t) * (1.0 + (bead - 0.5) * 0.4 / blur);
  float beyond = u < start ? start - u : max(u - len, 0.0);
  float core = exp(-0.5 * (across * across + beyond * beyond) / (sigma * sigma));
  float along = 1.0 - 0.35 / blur * vgNoise1(u / (beadPx * 2.3), seed + 3.0);

  float drops = 0.0;
  float cell0 = floor(u / dropPx);
  for (int k = -1; k <= 1; k++) {
    float c = cell0 + float(k);
    if (vgHash(c, seed + 4.0) > dropChance) continue;
    float cu = (c + vgHash(c, seed + 5.0)) * dropPx;
    if (cu < start || cu > len) continue;
    float cs = (vgHash(c, seed + 6.0) + vgHash(c, seed + 7.0) - 1.0) * 1.7 * sigma + wiggle;
    float r = max(0.7, sigma * mix(0.35, 0.8, vgHash(c, seed + 8.0)));
    float dx = u - cu;
    float dy = s - cs;
    drops += mix(0.35, 1.0, vgHash(c, seed + 9.0)) * exp(-0.5 * (dx * dx + dy * dy) / (r * r));
  }

  float lum = amp * (core * along + drops * 0.7 / (blur * blur));
  if (lum < 0.002) discard;

  vec3 glow = lum * v_illum;
  fragColor = vec4(vec3(1.0) - exp(-glow), 1.0);
}
`;

const FLOATS_PER_INSTANCE = 16;

/** Where near tracks start to defocus, on the emission's 0 (far) … 1 (near) depth. */
const DEFOCUS_FROM_DEPTH = 0.7;
/** Sigma multiplier of the nearest track: large and soft, like an out-of-focus droplet line. */
const DEFOCUS_MAX = 2.4;

/** Fraction-space live tracks → per-instance floats in content px, y down like the emission
 *  fractions and the backdrop target (drift is y-up, hence its sign flip). Skips tracks not yet born,
 *  fully faded, or everything when `amount <= 0` (the canary `check:medium` uses). Exported for
 *  testing without a GPU. */
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
    if (track.age < 0) continue;
    const e = track.emission;
    const fade = trackLayerFade(track.age, MEDIUM_TRACK_LAYER_LIFE_SECONDS[e.kind]);
    if (fade <= 1e-4) continue;
    const look = MEDIUM_TRACK_LAYER_LOOK[e.kind];

    const sigmaMul = trackLayerSigmaMul(track.age, look.broaden);
    const near = Math.max(0, (e.depth - DEFOCUS_FROM_DEPTH) / (1 - DEFOCUS_FROM_DEPTH));
    const defocus = 1 + (DEFOCUS_MAX - 1) * near * near;
    const sigma0 = Math.max(look.sigmaFrac * minDim, 0.6) * sigmaMul * defocus;

    const o = count * FLOATS_PER_INSTANCE;
    data[o + 0] = e.source[0] * contentWidth + track.driftX * minDim;
    data[o + 1] = e.source[1] * contentHeight - track.driftY * minDim;
    data[o + 2] = Math.cos(e.angle);
    data[o + 3] = Math.sin(e.angle);
    const len = e.lengthFrac * minDim;
    data[o + 4] = len;
    data[o + 5] = Math.min(look.startFrac * minDim, len * 0.5);
    data[o + 6] = sigma0;
    data[o + 7] = sigma0 * look.endSigmaMul;
    data[o + 8] = e.raggedFrac > 0 ? look.wiggleFrac * minDim : 0;
    data[o + 9] = e.raggedFreq / Math.max(len, 1);
    data[o + 10] = (e.intensity * look.gain * fade * amount) / (sigmaMul ** 0.7 * defocus);
    data[o + 11] = e.seed;
    data[o + 12] = look.beadFrac * minDim;
    data[o + 13] = look.dropletFrac * minDim;
    data[o + 14] = look.dropletChance;
    data[o + 15] = sigmaMul * defocus;
    count += 1;
  }
  return { data, count };
}

export type TrackLayerProgram = {
  /** Draws the instances additively into the currently bound framebuffer. Leaves blending enabled;
   *  the renderer restores its own state after the backdrop pass. */
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

function compile(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`vireuikit: track layer ${label} shader creation failed`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`vireuikit: track layer ${label} shader failed:\n${gl.getShaderInfoLog(shader) ?? ''}`);
  }
  return shader;
}

export function createTrackLayerProgram(gl: WebGL2RenderingContext): TrackLayerProgram {
  const vertex = compile(gl, gl.VERTEX_SHADER, TRACK_LAYER_VERTEX_SOURCE, 'vertex');
  const fragment = compile(gl, gl.FRAGMENT_SHADER, TRACK_LAYER_FRAGMENT_SOURCE, 'fragment');
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

  // Unit quad as a triangle strip: x across (-1…1), y along (0…1).
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
  for (let location = 1; location <= 4; location += 1) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, (location - 1) * 16);
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
