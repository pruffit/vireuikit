// Window classes: every threshold in one place. Width from the window, never from the device.
import type { Size } from '../geometry';

export type WidthClass = 'compact' | 'medium' | 'expanded' | 'large' | 'xlarge';
export type HeightClass = 'compact' | 'medium' | 'expanded';

export const WIDTH_CLASSES: readonly WidthClass[] = ['compact', 'medium', 'expanded', 'large', 'xlarge'];
export const HEIGHT_CLASSES: readonly HeightClass[] = ['compact', 'medium', 'expanded'];

/** The lower bound of each class in dp; compact starts at 0. */
export const WIDTH_BREAKPOINTS = { medium: 600, expanded: 840, large: 1200, xlarge: 1600 } as const;
export const HEIGHT_BREAKPOINTS = { medium: 480, expanded: 900 } as const;

export type WindowClass = { width: WidthClass; height: HeightClass };

export function widthClass(width: number): WidthClass {
  if (!(width >= WIDTH_BREAKPOINTS.medium)) return 'compact';
  if (width < WIDTH_BREAKPOINTS.expanded) return 'medium';
  if (width < WIDTH_BREAKPOINTS.large) return 'expanded';
  return width < WIDTH_BREAKPOINTS.xlarge ? 'large' : 'xlarge';
}

export function heightClass(height: number): HeightClass {
  if (!(height >= HEIGHT_BREAKPOINTS.medium)) return 'compact';
  return height < HEIGHT_BREAKPOINTS.expanded ? 'medium' : 'expanded';
}

export function classifyWindow(size: Size): WindowClass {
  return { width: widthClass(size.width), height: heightClass(size.height) };
}

export function widthAtLeast(value: WidthClass, minimum: WidthClass): boolean {
  return WIDTH_CLASSES.indexOf(value) >= WIDTH_CLASSES.indexOf(minimum);
}
