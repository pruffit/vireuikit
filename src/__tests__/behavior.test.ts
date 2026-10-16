import { describe, expect, it } from 'vitest';
import {
  CONTROL_IDLE,
  POINTER_INPUT,
  TOUCH_INPUT,
  atomLift,
  atomMaterial,
  controlTargets,
  createControlVisual,
  settleControlVisual,
  stepControl,
  stepControlVisual,
  visualAtomState,
  type ControlEvent,
  type ControlState,
  type InputCaps,
} from '../index';
import { VIREGLASS_CONTROL_MATERIAL } from 'vireglass';

const run = (events: ControlEvent[], caps: InputCaps = POINTER_INPUT, from: ControlState = CONTROL_IDLE) => {
  let state = from;
  let activations = 0;
  for (const event of events) {
    const step = stepControl(state, event, caps);
    state = step.state;
    if (step.activated) activations += 1;
  }
  return { state, activations };
};

const tap = [
  { type: 'down', source: 'pointer' },
  { type: 'up', source: 'pointer' },
] as const satisfies readonly ControlEvent[];

describe('press', () => {
  it('is held between down and up, and activates on up', () => {
    const held = run([tap[0]]);
    expect(held.state.press.by).toBe('pointer');
    expect(held.activations).toBe(0);
    const done = run([...tap]);
    expect(done.state.press.by).toBeNull();
    expect(done.activations).toBe(1);
  });

  it('is cancelled by the pointer leaving, and release afterwards does not activate', () => {
    const out = run([tap[0], { type: 'leave' }, tap[1]]);
    expect(out.state.press.by).toBeNull();
    expect(out.activations).toBe(0);
  });

  it('is cancelled by cancel', () => {
    expect(run([tap[0], { type: 'cancel' }, tap[1]]).activations).toBe(0);
  });

  it('a key press survives the pointer leaving', () => {
    const out = run([
      { type: 'down', source: 'keyboard' },
      { type: 'leave' },
      { type: 'up', source: 'keyboard' },
    ]);
    expect(out.activations).toBe(1);
  });

  it('ignores a release from the other input', () => {
    const out = run([tap[0], { type: 'up', source: 'keyboard' }]);
    expect(out.state.press.by).toBe('pointer');
    expect(out.activations).toBe(0);
  });

  it('a second down while held does not restart it', () => {
    const out = run([tap[0], { type: 'down', source: 'keyboard' }, tap[1]]);
    expect(out.activations).toBe(1);
  });
});

describe('keyboard press', () => {
  const keyDown = { type: 'down', source: 'keyboard' } as const;

  it('does not outlive the focus it started on', () => {
    const out = run([keyDown, { type: 'blur' }, { type: 'up', source: 'keyboard' }]);
    expect(out.state.press.by).toBeNull();
    expect(out.activations).toBe(0);
  });

  it('the next press after losing focus works', () => {
    const out = run([keyDown, { type: 'blur' }, { type: 'focus', visible: true }, keyDown, { type: 'up', source: 'keyboard' }]);
    expect(out.activations).toBe(1);
  });

  it('a pointer press is not affected by blur', () => {
    expect(run([tap[0], { type: 'blur' }]).state.press.by).toBe('pointer');
  });
});

describe('disabled', () => {
  const disabled: ControlState = { ...CONTROL_IDLE, disabled: true };

  it('never presses, hovers or focuses', () => {
    const out = run(
      [tap[0], tap[1], { type: 'enter' }, { type: 'focus', visible: true }],
      POINTER_INPUT,
      disabled,
    );
    expect(out.activations).toBe(0);
    expect(controlTargets(out.state)).toEqual({ pressed: 0, hovered: 0, focus: 0, disabled: true });
  });

  it('disabling mid-press drops the press and the release does not activate', () => {
    const out = run([tap[0], { type: 'enter' }, { type: 'disable', disabled: true }, tap[1]]);
    expect(out.state).toEqual({ ...CONTROL_IDLE, disabled: true });
    expect(out.activations).toBe(0);
  });

  it('can be enabled again', () => {
    const out = run([{ type: 'disable', disabled: false }, ...tap], POINTER_INPUT, disabled);
    expect(out.activations).toBe(1);
  });
});

describe('hover and focus follow the input', () => {
  it('hover comes with a cursor and ends on leave', () => {
    expect(run([{ type: 'enter' }]).state.hovered).toBe(true);
    expect(run([{ type: 'enter' }, { type: 'leave' }]).state.hovered).toBe(false);
  });

  it('touch has no hover', () => {
    expect(run([{ type: 'enter' }], TOUCH_INPUT).state).toEqual(CONTROL_IDLE);
  });

  it('a key on a touch device still shows the focus ring', () => {
    expect(run([{ type: 'focus', visible: true }], TOUCH_INPUT).state.focused).toBe(true);
    expect(run([{ type: 'focus', visible: false }], TOUCH_INPUT).state.focused).toBe(false);
  });

  it('only keyboard focus counts', () => {
    expect(run([{ type: 'focus', visible: false }]).state.focused).toBe(false);
    expect(run([{ type: 'focus', visible: true }]).state.focused).toBe(true);
    expect(run([{ type: 'focus', visible: true }, { type: 'blur' }]).state.focused).toBe(false);
  });
});

describe('visual', () => {
  const pressed = run([tap[0]]).state;

  it('chases the press target and settles', () => {
    const visual = createControlVisual();
    let moving = true;
    let frames = 0;
    while (moving && frames < 600) {
      moving = stepControlVisual(visual, 1 / 60, pressed);
      frames += 1;
    }
    expect(visual.pressed.x).toBe(1);
    expect(frames).toBeLessThan(60);
  });

  it('is visible within a few frames of the press, not after release', () => {
    const visual = createControlVisual();
    for (let i = 0; i < 4; i += 1) stepControlVisual(visual, 1 / 60, pressed);
    expect(visual.pressed.x).toBeGreaterThan(0.3);
  });

  it('jumps in one step under reduced motion', () => {
    const visual = createControlVisual();
    stepControlVisual(visual, 1 / 60, pressed, true);
    expect(visual.pressed.x).toBe(1);
    expect(visual.pressed.v).toBe(0);
  });

  it('settling places the springs exactly on the state', () => {
    const visual = createControlVisual();
    settleControlVisual(visual, { ...CONTROL_IDLE, hovered: true, focused: true });
    expect(visual.hovered.x).toBe(1);
    expect(visual.focus.x).toBe(1);
  });

  it('feeds the atom material: pressed is denser than rest, disabled loses presence', () => {
    const visual = createControlVisual();
    settleControlVisual(visual, pressed);
    const on = atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'iconButton', visualAtomState(visual, pressed));
    expect(on.ior).toBeGreaterThan(VIREGLASS_CONTROL_MATERIAL.ior);

    const off: ControlState = { ...CONTROL_IDLE, disabled: true };
    const dim = atomMaterial(VIREGLASS_CONTROL_MATERIAL, 'button', visualAtomState(createControlVisual(), off));
    expect(dim.presence).toBeLessThan(VIREGLASS_CONTROL_MATERIAL.presence);
  });

  it('a button sinks under press and an icon button lifts into the glass', () => {
    expect(atomLift('button')).toBe(0);
    expect(atomLift('iconButton')).toBe(1);
  });
});
