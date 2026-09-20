import type { ImageJobOptions } from 'react-native-xprint';

/**
 * Everything optional about one print request.
 *
 * An options object rather than trailing positional parameters: naming a job
 * without changing its layout is the common case, and positionally that reads
 * `print(uri, undefined, 1, 'Order #4821')` — three arguments of noise around
 * the one that was meant.
 */
export interface PrintOptions {
  /** Layout overrides. Defaults are centred, 2 mm edge, thresholded. */
  overrides?: Partial<ImageJobOptions>;
  /** How many copies. Defaults to one. */
  copies?: number;
}
