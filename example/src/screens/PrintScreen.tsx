import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { usePrinter } from '../hooks/usePrinter';
import { colors, minTouchTarget, spacing } from '../theme';
import { invoice } from './invoiceFixture';

export interface PrintScreenProps {
  onOpenSettings: () => void;
}

/**
 * The document this reference app prints. A real app builds this however it
 * likes — a PDF from `expo-print`, a server-rendered file, a scanned image —
 * `PrinterSession.print` only needs a URI on disk. This example expects one
 * to already be sitting in the document directory, dropped there for a demo
 * with:
 *
 * ```sh
 * adb push invoice.pdf /data/local/tmp/invoice.pdf
 * adb shell run-as xprinter.example cp /data/local/tmp/invoice.pdf /data/user/0/xprinter.example/files/invoice.pdf
 * ```
 */
const SAMPLE_INVOICE_FILE = new File(Paths.document, 'invoice.pdf');

function connectionLabel(
  state: ReturnType<typeof usePrinter>['state'],
  activeName: string | undefined
): string {
  if (state === 'unconfigured') {
    return 'Not connected';
  }
  if (activeName !== undefined) {
    return state === 'connecting' ? `Connecting to ${activeName}…` : activeName;
  }
  return state === 'connecting' ? 'Connecting…' : 'Not connected';
}

export function PrintScreen({
  onOpenSettings,
}: PrintScreenProps): ReactElement {
  const { state, active, problem, print, connect } = usePrinter();
  const [justPrinted, setJustPrinted] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  const fileExists = SAMPLE_INVOICE_FILE.exists;

  const handlePrint = useCallback(async (): Promise<void> => {
    setJustPrinted(false);
    setIsPrinting(true);
    try {
      await print(SAMPLE_INVOICE_FILE.uri);
      setJustPrinted(true);
    } catch {
      // A thrown failure already lands in `problem` — the banner below
      // renders it. Nothing more to do with the result here.
    } finally {
      setIsPrinting(false);
    }
  }, [print]);

  // TEMPORARY hardware test — expo-print integration, remove after verifying.
  // Generates a real PDF from the actual Khmer invoice HTML at runtime, then
  // prints it through the exact same PrinterSession.print path, so this
  // exercises pdfPageSizeFor-free, default-fit behavior against real content
  // rather than a synthetic PDF.
  const handlePrintExpoPrintTest = useCallback(async (): Promise<void> => {
    setJustPrinted(false);
    setIsPrinting(true);
    try {
      const result = await Print.printToFileAsync({ html: invoice });
      console.log(`[expo-print test] uri=${result.uri}`);
      await print(result.uri);
      setJustPrinted(true);
    } catch {
      // Same rationale as handlePrint above.
    } finally {
      setIsPrinting(false);
    }
  }, [print]);

  const canPrint =
    fileExists && active !== undefined && state !== 'printing' && !isPrinting;
  const canPrintExpoPrintTest =
    active !== undefined && state !== 'printing' && !isPrinting;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Print</Text>
        <Pressable onPress={onOpenSettings} hitSlop={12}>
          <Text style={styles.settingsLink}>Printer settings</Text>
        </Pressable>
      </View>

      <Text style={styles.status}>{connectionLabel(state, active?.name)}</Text>

      {!fileExists ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateTitle}>No document to print</Text>
          <Text style={styles.bodyMuted}>
            This demo prints a sample invoice that isn&apos;t on the device yet.
            Ask whoever set this phone up to load one.
          </Text>
        </View>
      ) : (
        <Pressable
          style={[styles.printButton, !canPrint && styles.printButtonDisabled]}
          disabled={!canPrint}
          onPress={() => handlePrint().catch(() => undefined)}
        >
          {isPrinting || state === 'printing' ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.printButtonText}>Print invoice</Text>
          )}
        </Pressable>
      )}

      <Pressable
        style={[
          styles.secondaryButton,
          !canPrintExpoPrintTest && styles.printButtonDisabled,
        ]}
        disabled={!canPrintExpoPrintTest}
        onPress={() => handlePrintExpoPrintTest().catch(() => undefined)}
      >
        {isPrinting || state === 'printing' ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={styles.secondaryButtonText}>
            Test: print real invoice (expo-print)
          </Text>
        )}
      </Pressable>

      {justPrinted ? (
        <View style={[styles.banner, styles.bannerSuccess]}>
          <Text style={styles.bannerTextSuccess}>Printed</Text>
        </View>
      ) : null}

      {problem !== undefined ? (
        <View style={[styles.banner, styles.bannerDanger]}>
          <Text style={styles.bannerTextDanger}>{problem.title}</Text>
          <Text style={styles.bodyMuted}>{problem.action}</Text>
          {problem.retryable ? (
            <Pressable
              style={styles.secondaryButton}
              onPress={() => connect().catch(() => undefined)}
            >
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { fontSize: 26, fontWeight: '700', color: colors.text },
  settingsLink: { fontSize: 13, color: colors.textMuted },
  status: { fontSize: 16, color: colors.textMuted },
  bodyMuted: { fontSize: 14, color: colors.textMuted },
  printButton: {
    minHeight: minTouchTarget + 16,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  printButtonDisabled: { backgroundColor: colors.disabled },
  printButtonText: {
    color: colors.primaryText,
    fontSize: 20,
    fontWeight: '700',
  },
  emptyState: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  emptyStateTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  banner: { borderRadius: 12, padding: spacing.md, gap: spacing.xs },
  bannerSuccess: { backgroundColor: colors.successSurface },
  bannerTextSuccess: { color: colors.success, fontSize: 17, fontWeight: '700' },
  bannerDanger: { backgroundColor: colors.dangerSurface },
  bannerTextDanger: { color: colors.danger, fontSize: 17, fontWeight: '700' },
  secondaryButton: {
    alignSelf: 'flex-start',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
});
