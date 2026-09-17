import { tsplProgram, type LabelMedia } from 'react-native-xprint';

/**
 * A TSPL text label, sized to whatever stock the printer says is loaded.
 *
 * Demo content: this is the kind of job an app builds for itself with
 * `tsplProgram`, which is why it lives in the example rather than the library.
 */
export function testLabel(deviceName: string, media: LabelMedia): ArrayBuffer {
  return tsplProgram([
    `SIZE ${media.widthMm} mm,${media.heightMm} mm`,
    'DIRECTION 0',
    'CLS',
    'TEXT 24,32,"3",0,1,1,"XPrinter"',
    'TEXT 24,96,"2",0,1,1,"react-native-xprint"',
    `TEXT 24,136,"2",0,1,1,"${deviceName}"`,
    `TEXT 24,176,"2",0,1,1,"${media.widthMm}x${media.heightMm}mm"`,
    'PRINT 1,1',
  ]);
}
