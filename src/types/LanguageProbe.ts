import type { CommandLanguage } from './CommandLanguage';

/**
 * What a language probe observed.
 *
 * A conclusive probe also sets `language` on the printer, so the detection is
 * paid for once per connection.
 *
 * This reports evidence rather than a verdict on purpose: a printer staying
 * silent does not prove the language is inactive — it may be busy, may not
 * implement the status command, or may buffer the reply. Treat `likely` as a
 * strong hint to default to, and always let the user override it.
 */
export interface LanguageProbe {
  /**
   * The language the evidence points to, or `undefined` when the probe was
   * inconclusive — either both replied or neither did.
   */
  likely?: CommandLanguage;
  /** Whether the ESC/POS real-time status query was answered. */
  escPosReplied: boolean;
  /** Whether the TSPL model-name query was answered. */
  tsplReplied: boolean;
  /**
   * The model name TSPL reported, when it answered. TSPL's `~!T` returns this as
   * ASCII; ESC/POS has no equivalent that is portable across vendors.
   */
  model?: string;
  /** The raw ESC/POS reply, for diagnosing a printer this library does not model. */
  escPosReply: ArrayBuffer;
  /** The raw TSPL reply. */
  tsplReply: ArrayBuffer;
}
