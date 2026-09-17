/**
 * Which way round the mechanism lays content on the paper.
 *
 * A printer that feeds head-down prints upside down unless the output is
 * rotated. Which one a given printer needs is a property of the mechanism, not
 * of the job, so it belongs in calibration.
 */
export type LabelDirection = 'normal' | 'rotated180';
