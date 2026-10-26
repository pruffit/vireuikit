import type { Known } from './run';

/**
 * The findings of the acceptance issue (#44) each gate fails on today, per scenario and per profile: `gpu` is the case
 * at its own size on the machine's adapter, `gpu@owner` the case as the owner opens it (1920 × 960, chrome on), `swiftshader`
 * the software render. A finding a profile does not list is one that profile does not see; a listed gate that passes on
 * the GPU profiles is stale and fails the run, so the entry goes with the fix.
 */
export const KNOWN: Record<string, Known> = {
  'popover as a bottom sheet, grow and collapse': { seam: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' }, pop: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' }, ghost: { 'gpu@owner': '#44 D', gpu: '#44 D', swiftshader: '#44 D' } },
  'sheet grow and collapse into its trigger': { seam: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' }, pop: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' }, hole: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' }, ghost: { 'gpu@owner': '#44 D', gpu: '#44 D', swiftshader: '#44 D' } },
  'sheet drag between detents': { seam: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' } },
  'sheet scroll its content': { scrollbar: { 'gpu@owner': '#44 D', gpu: '#44 D', swiftshader: '#44 D' } },
  'adaptive popover grow and collapse': { seam: { 'gpu@owner': '#44 A', gpu: '#44 A' }, pop: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' }, hole: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' } },
  'toolbar collapse into its button and expand': { seam: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' }, shape: { gpu: '#44 A', swiftshader: '#44 A' } },
  'toolbar change of place': { seam: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' } },
  'toolbar hover each button': { highlight: { 'gpu@owner': '#44 B', gpu: '#44 B', swiftshader: '#44 B' } },
  'navigation drag the lens across all items and back': { vanish: { 'gpu@owner': '#44 C', gpu: '#44 C', swiftshader: '#44 C' } },
  'navigation tap during a form morph': { seam: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' } },
  'navigation resize bar, rail, sidebar and back': { seam: { 'gpu@owner': '#44 A', gpu: '#44 A', swiftshader: '#44 A' } },
  'navigation click different items 250 ms apart': { converge: { 'gpu@owner': '#44 C', gpu: '#44 C', swiftshader: '#44 C' } },
  'navigation click while the selection is still moving': { converge: { 'gpu@owner': '#44 C', gpu: '#44 C', swiftshader: '#44 C' } },
  'button hover on light': { state: { 'gpu@owner': '#44 B', gpu: '#44 B', swiftshader: '#44 B' } },
  'button hover on mid': { state: { 'gpu@owner': '#44 B', gpu: '#44 B', swiftshader: '#44 B' } },
  'icon button hover on mid': { state: { 'gpu@owner': '#44 B', gpu: '#44 B', swiftshader: '#44 B' } },
  'popover open and close': { seam: { gpu: '#44 A', swiftshader: '#44 A' } },
  'navigation tap each item': { seam: { 'gpu@owner': '#44 A' } },
};
