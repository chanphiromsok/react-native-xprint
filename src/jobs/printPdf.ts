import { PrinterImages } from '../PrinterImages';
import type { BluetoothPrinter } from '../specs/BluetoothPrinter.nitro';
import type { ImageJobOptions } from './ImageJobOptions';
import { printImageAsLabel, printImageAsReceipt } from './printImage';

/**
 * Prints every page of a PDF as a separate label, in page order.
 *
 * A label job has no notion of "next page" — each call rasterizes and writes
 * one bitmap — so a multi-page PDF has to be driven page by page from here.
 * Pages are awaited one at a time rather than run concurrently: they share
 * one `printer.write`, and a printer reads its input as a single ordered
 * stream, so overlapping writes would interleave two pages into one garbled
 * label.
 *
 * Works for a plain image too, since {@linkcode PrinterImageFactory.countPages}
 * reports 1 page for anything that is not a PDF.
 */
export async function printPdfAsLabel(
  printer: BluetoothPrinter,
  source: string,
  overrides: Partial<ImageJobOptions> = {},
  copies: number = 1
): Promise<void> {
  const pageCount = await PrinterImages.countPages(source);
  for (let page = 0; page < pageCount; page++) {
    await printImageAsLabel(
      printer,
      source,
      { ...overrides, pageIndex: page },
      copies
    );
  }
}

/**
 * Prints every page of a PDF as a separate receipt, in page order, `copies`
 * times.
 *
 * Same sequencing rationale as {@linkcode printPdfAsLabel}: pages are awaited
 * one at a time so writes to the printer stay in order, and a single-page
 * source — including a plain image — prints once per copy.
 *
 * `copies` exists here, rather than being left to a caller's own loop, so
 * this has the same shape as {@linkcode printPdfAsLabel}: a receipt printer
 * has no native copy count the way TSPL's `PRINT` command does — ESC/POS
 * just streams whatever bytes it is given — so a copy is produced by
 * sending the whole job again, once per copy, instead of by adding a count
 * to a single command.
 */
export async function printPdfAsReceipt(
  printer: BluetoothPrinter,
  source: string,
  overrides: Partial<ImageJobOptions> = {},
  copies: number = 1
): Promise<void> {
  const pageCount = await PrinterImages.countPages(source);
  for (let copy = 0; copy < copies; copy++) {
    for (let page = 0; page < pageCount; page++) {
      await printImageAsReceipt(printer, source, {
        ...overrides,
        pageIndex: page,
      });
    }
  }
}
