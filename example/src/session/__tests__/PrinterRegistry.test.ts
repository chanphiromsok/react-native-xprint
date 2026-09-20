import { describe, expect, it } from '@jest/globals';
import { removePrinter, upsertPrinter } from '../PrinterRegistry';
import type { SavedPrinter } from '../SavedPrinter';

const CALIBRATION: SavedPrinter['calibration'] = {
  dotsPerMm: 8,
  printableWidthMm: 72,
  originOffsetMm: { x: 0, y: 0 },
  direction: 'normal',
  flipHorizontal: false,
  flipVertical: false,
};

function printer(address: string): SavedPrinter {
  return { address, calibration: CALIBRATION };
}

describe('upsertPrinter', () => {
  it('adding a printer puts it first', () => {
    const printers = upsertPrinter([printer('AA:AA')], printer('BB:BB'));

    expect(printers.map((p) => p.address)).toEqual(['BB:BB', 'AA:AA']);
  });

  it('adding an address that already exists replaces it rather than duplicating, and it moves to first', () => {
    const existing = [printer('AA:AA'), printer('BB:BB')];
    const replacement: SavedPrinter = {
      address: 'BB:BB',
      name: 'Depot printer',
      calibration: CALIBRATION,
    };

    const printers = upsertPrinter(existing, replacement);

    expect(printers).toEqual([replacement, printer('AA:AA')]);
  });
});

describe('removePrinter', () => {
  it('removing a non-active printer leaves the active one alone', () => {
    const registry = {
      printers: [printer('AA:AA'), printer('BB:BB')],
      activeAddress: 'AA:AA',
    };

    const next = removePrinter(registry, 'BB:BB');

    expect(next.activeAddress).toBe('AA:AA');
    expect(next.printers.map((p) => p.address)).toEqual(['AA:AA']);
  });

  it('removing the active printer promotes the most recent remaining one', () => {
    const registry = {
      printers: [printer('AA:AA'), printer('BB:BB'), printer('CC:CC')],
      activeAddress: 'AA:AA',
    };

    const next = removePrinter(registry, 'AA:AA');

    expect(next.activeAddress).toBe('BB:BB');
    expect(next.printers.map((p) => p.address)).toEqual(['BB:BB', 'CC:CC']);
  });

  it('removing the last printer leaves no active address', () => {
    const registry = {
      printers: [printer('AA:AA')],
      activeAddress: 'AA:AA',
    };

    const next = removePrinter(registry, 'AA:AA');

    expect(next.activeAddress).toBeUndefined();
    expect(next.printers).toEqual([]);
  });
});
