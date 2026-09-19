import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Xprinter,
  describePrinterProblem,
  tsplCalibrationLabel,
  usePrinter,
  usePrinterSession,
  type LabelMedia,
  type SavedPrinter,
} from 'react-native-xprint';
import { MEDIA_PRESETS } from '../printer';
import { colors, minTouchTarget, spacing } from '../theme';

export interface PrinterSettingsScreenProps {
  onAddPrinter: () => void;
  onDone: () => void;
}

function isSameMedia(a: LabelMedia | undefined, b: LabelMedia): boolean {
  return (
    a !== undefined && a.widthMm === b.widthMm && a.heightMm === b.heightMm
  );
}

/**
 * Maintenance screen for whoever manages the fleet's printers — switching
 * printers, forgetting one, picking label stock, and calibrating. A daily
 * driver never needs any of this, which is why `PrintScreen` only links to
 * it in small, low-emphasis text.
 */
export function PrinterSettingsScreen({
  onAddPrinter,
  onDone,
}: PrinterSettingsScreenProps): ReactElement {
  const session = usePrinterSession();
  const { printers, active } = usePrinter();
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationNote, setCalibrationNote] = useState<string | null>(null);
  const [busyAddress, setBusyAddress] = useState<string | null>(null);

  const selectPrinter = useCallback(
    async (printer: SavedPrinter): Promise<void> => {
      setBusyAddress(printer.address);
      try {
        await session.select(printer.address);
      } catch {
        // The session's own `problem` state covers this on whichever screen
        // reads it; this screen only needs to stop showing a spinner.
      } finally {
        setBusyAddress(null);
      }
    },
    [session]
  );

  const forgetPrinter = useCallback(
    async (address: string): Promise<void> => {
      setBusyAddress(address);
      try {
        await session.forget(address);
      } catch {
        // Same as above — the failure surfaces through session state.
      } finally {
        setBusyAddress(null);
      }
    },
    [session]
  );

  const pickMedia = useCallback(
    async (media: LabelMedia): Promise<void> => {
      try {
        await session.setMedia(media);
      } catch {
        // Surfaces through session state on the screen that reads `problem`.
      }
    },
    [session]
  );

  const printCalibrationLabel = useCallback(async (): Promise<void> => {
    if (active === undefined) {
      return;
    }
    const media = active.media;
    if (media === undefined) {
      setCalibrationNote('Pick a label size first.');
      return;
    }
    setIsCalibrating(true);
    setCalibrationNote(null);
    try {
      // A short-lived connection of its own, separate from the session's —
      // this is a one-off maintenance write, not a print job, and does not
      // disturb whatever the session is doing with the daily connection.
      const printer = await Xprinter.connect(active.address);
      try {
        printer.calibration = active.calibration;
        printer.media = media;
        await printer.write(
          tsplCalibrationLabel(media, active.calibration.dotsPerMm)
        );
        setCalibrationNote('Calibration label sent.');
      } finally {
        await printer.disconnect();
      }
    } catch (error) {
      setCalibrationNote(describePrinterProblem(error).title);
    } finally {
      setIsCalibrating(false);
    }
  }, [active]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Printer settings</Text>

      <Pressable style={styles.secondaryButton} onPress={onDone}>
        <Text style={styles.secondaryButtonText}>Done</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Printers</Text>
      {printers.length === 0 ? (
        <Text style={styles.bodyMuted}>No printers set up yet.</Text>
      ) : (
        <View style={styles.card}>
          {printers.map((printer) => {
            const isActive = printer.address === active?.address;
            const isBusy = busyAddress === printer.address;
            return (
              <View key={printer.address} style={styles.printerRow}>
                <Pressable
                  style={styles.printerRowMain}
                  disabled={isActive || isBusy}
                  onPress={() => selectPrinter(printer).catch(() => undefined)}
                >
                  <Text style={styles.printerName}>
                    {printer.name ?? 'Printer'}
                    {isActive ? '  ·  Active' : ''}
                  </Text>
                  <Text style={styles.printerAddress}>{printer.address}</Text>
                </Pressable>
                {isBusy ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Pressable
                    onPress={() =>
                      forgetPrinter(printer.address).catch(() => undefined)
                    }
                    hitSlop={8}
                  >
                    <Text style={styles.forgetLink}>Forget</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}

      <Pressable style={styles.secondaryButton} onPress={onAddPrinter}>
        <Text style={styles.secondaryButtonText}>Add another printer</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Label size</Text>
      <View style={styles.card}>
        {MEDIA_PRESETS.map((preset) => {
          const selected = isSameMedia(active?.media, preset.media);
          return (
            <Pressable
              key={preset.label}
              style={styles.mediaRow}
              disabled={active === undefined}
              onPress={() => pickMedia(preset.media).catch(() => undefined)}
            >
              <Text
                style={[
                  styles.mediaLabel,
                  selected && styles.mediaLabelSelected,
                ]}
              >
                {selected ? '● ' : '○ '}
                {preset.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Calibration</Text>
      <View style={styles.card}>
        <Text style={styles.bodyMuted}>
          Prints a target that shows exactly where this printer places the
          canvas on the label, so a misaligned print can be measured and fixed
          rather than guessed at.
        </Text>
        <Pressable
          style={styles.secondaryButton}
          disabled={active === undefined || isCalibrating}
          onPress={() => printCalibrationLabel().catch(() => undefined)}
        >
          {isCalibrating ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.secondaryButtonText}>
              Print calibration label
            </Text>
          )}
        </Pressable>
        {calibrationNote !== null ? (
          <Text style={styles.bodyMuted}>{calibrationNote}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  heading: { fontSize: 24, fontWeight: '700', color: colors.text },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  bodyMuted: { fontSize: 14, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  printerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.sm,
  },
  printerRowMain: { flex: 1, gap: 2 },
  printerName: { fontSize: 16, fontWeight: '600', color: colors.text },
  printerAddress: { fontSize: 11, color: colors.textFaint },
  forgetLink: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  mediaRow: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  mediaLabel: { fontSize: 16, color: colors.text },
  mediaLabelSelected: { color: colors.primary, fontWeight: '700' },
  secondaryButton: {
    minHeight: minTouchTarget,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
});
