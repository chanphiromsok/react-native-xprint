/**
 * How the loaded stock is divided into labels.
 *
 * Getting this wrong misfeeds — a printer told to look for gaps in continuous
 * stock will run paper searching for one — so `'printerDefault'` is the default
 * and emits no media command at all, leaving whatever the printer is already
 * configured for. Set a specific type only when you know the stock.
 */
export type LabelMediaType =
  /** Send no media command; use the printer's own setting. */
  | 'printerDefault'
  /** Unbroken roll, no label separation. */
  | 'continuous'
  /** Die-cut labels separated by a gap. */
  | 'gap'
  /** Labels separated by a printed black registration mark. */
  | 'blackMark';
