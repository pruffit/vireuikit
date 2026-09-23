import { describe, expect, it } from 'vitest';
import { MEDIUM_EMIT_SHADER, VG_CURL_NOISE, VG_VALUE_NOISE } from '../medium';
import { toGLSL } from 'vireglass';

describe('MEDIUM_EMIT_SHADER: the "track, not a sprite" criterion', () => {
  it("does not read its own previous frame — stamping needs no other buffer's state", () => {
    expect(MEDIUM_EMIT_SHADER).not.toContain('.eval(');
    expect(MEDIUM_EMIT_SHADER).not.toContain('uniform shader');
  });

  it('reuses the shared noise instead of copying its text', () => {
    expect(MEDIUM_EMIT_SHADER).toContain(VG_VALUE_NOISE);
  });

  it('carries head/tail geometry and the channel the density is stamped into', () => {
    for (const name of ['u_source', 'u_head', 'u_headWidth', 'u_tailWidth', 'u_channelMask', 'u_intensity']) {
      expect(MEDIUM_EMIT_SHADER).toContain(name);
    }
  });

  it('transpiles into well-formed GLSL (the same pipeline as every other shader)', () => {
    const glsl = toGLSL(MEDIUM_EMIT_SHADER);
    expect(glsl).toContain('#version 300 es');
    expect(glsl).toContain('void main()');
    expect(glsl).not.toContain('half');
    expect(glsl).not.toContain('float2');
  });
});

describe('noise refactor: VG_CURL_NOISE still carries vgValueNoise', () => {
  it('is composed from VG_VALUE_NOISE rather than duplicating its text', () => {
    expect(VG_CURL_NOISE).toContain(VG_VALUE_NOISE);
    expect(VG_CURL_NOISE).toContain('vgCurlVelocity');
  });
});
