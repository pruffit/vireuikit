#!/usr/bin/env node
/**
 * Compiles the medium's shaders: AGSL -> GLSL (the core's `toGLSL`), headless Chromium, a real
 * WebGL2 context; on failure prints getShaderInfoLog/getProgramInfoLog. The vertex shader is a
 * fullscreen triangle with no buffers, just gl_VertexID.
 *
 * Run: npm run check:glsl
 */
import { chromium } from 'playwright';
import { toGLSL } from 'vireglass';
import {
  MEDIUM_COMPOSITE_SHADER,
  MEDIUM_CONDENSATE_CORRECT_SHADER,
  MEDIUM_CONDENSATE_FORWARD_SHADER,
  MEDIUM_CONDENSATE_REACT_SHADER,
  MEDIUM_EMIT_SHADER,
  MEDIUM_RESAMPLE_SHADER,
  MEDIUM_SEED_SHADER,
  MEDIUM_TRACK_ADVECT_SHADER,
  MEDIUM_VAPOR_CORRECT_SHADER,
  MEDIUM_VAPOR_FORWARD_SHADER,
  MEDIUM_VAPOR_REACT_SHADER,
} from '../src/medium/index.ts';

const SHADERS = {
  'medium-vapor-forward': MEDIUM_VAPOR_FORWARD_SHADER,
  'medium-vapor-correct': MEDIUM_VAPOR_CORRECT_SHADER,
  'medium-vapor-react': MEDIUM_VAPOR_REACT_SHADER,
  'medium-condensate-forward': MEDIUM_CONDENSATE_FORWARD_SHADER,
  'medium-condensate-correct': MEDIUM_CONDENSATE_CORRECT_SHADER,
  'medium-condensate-react': MEDIUM_CONDENSATE_REACT_SHADER,
  'medium-track-advect': MEDIUM_TRACK_ADVECT_SHADER,
  'medium-composite': MEDIUM_COMPOSITE_SHADER,
  'medium-seed': MEDIUM_SEED_SHADER,
  'medium-emit': MEDIUM_EMIT_SHADER,
  'medium-resample': MEDIUM_RESAMPLE_SHADER,
};

const VERTEX_SOURCE = `#version 300 es
const vec2 VG_CHECK_POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(VG_CHECK_POS[gl_VertexID], 0.0, 1.0);
}
`;

function compileCheck({ vertexSource, fragmentSource }) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { contextOk: false };

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('createShader returned null: the WebGL2 context was lost');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return {
      shader,
      ok: gl.getShaderParameter(shader, gl.COMPILE_STATUS),
      log: gl.getShaderInfoLog(shader) ?? '',
    };
  };

  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);

  let linkOk = false;
  let linkLog = '';
  if (vertex.ok && fragment.ok) {
    const program = gl.createProgram();
    gl.attachShader(program, vertex.shader);
    gl.attachShader(program, fragment.shader);
    gl.linkProgram(program);
    linkOk = gl.getProgramParameter(program, gl.LINK_STATUS);
    linkLog = gl.getProgramInfoLog(program) ?? '';
  }

  return {
    contextOk: true,
    vertexOk: vertex.ok,
    vertexLog: vertex.log,
    fragmentOk: fragment.ok,
    fragmentLog: fragment.log,
    linkOk,
    linkLog,
  };
}

async function checkOne(page, label, fragmentSource) {
  const result = await page.evaluate(compileCheck, { vertexSource: VERTEX_SOURCE, fragmentSource });
  if (!result.contextOk) {
    console.error(`[${label}] WebGL2 is unavailable in headless Chromium`);
    return false;
  }
  const ok = result.vertexOk && result.fragmentOk && result.linkOk;
  console.log(`[${label}] ${ok ? 'OK' : 'FAIL'}`);
  if (!result.vertexOk) console.error(result.vertexLog);
  if (!result.fragmentOk) console.error(result.fragmentLog);
  if (!result.linkOk && result.vertexOk && result.fragmentOk) console.error(result.linkLog);
  return ok;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const failed = [];
for (const [label, source] of Object.entries(SHADERS)) {
  if (!(await checkOne(page, label, toGLSL(source)))) failed.push(label);
}
await browser.close();

if (failed.length) {
  console.error(`check-glsl: failed to compile — ${failed.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`check-glsl: all ${Object.keys(SHADERS).length} medium shaders compile and link`);
}
