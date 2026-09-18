/**
 * A small, restrained palette shared by all three screens, so the app reads
 * as one product rather than three prototypes stitched together.
 */
export const colors = {
  background: '#F5F6F8',
  surface: '#FFFFFF',
  border: '#E2E5EA',
  text: '#14171F',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  primary: '#1F6FEB',
  primaryText: '#FFFFFF',
  success: '#1B8A5A',
  successSurface: '#E6F6EE',
  warning: '#B5690A',
  warningSurface: '#FCEEDB',
  danger: '#C22A2A',
  dangerSurface: '#FBE8E8',
  disabled: '#C7CBD1',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/** Minimum touch target side, in points — a driver wears gloves. */
export const minTouchTarget = 48;
