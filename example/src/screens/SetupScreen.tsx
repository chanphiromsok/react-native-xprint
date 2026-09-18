import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Xprinter,
  XPRINTER_P323B,
  describePrinterProblem,
  usePrinterSession,
  usePrinterSetup,
  type BluetoothDeviceInfo,
  type BluetoothPrinter,
  type CommandLanguage,
} from 'react-native-xprint';
import { printTestText } from '../printTest';
import { DEFAULT_MEDIA } from '../printer';
import { colors, minTouchTarget, spacing } from '../theme';

export interface SetupScreenProps {
  /** Called once a printer has been confirmed working and saved. */
  onDone: () => void;
}

/** The other command language — for the "try the other format" retry. */
function otherLanguage(language: CommandLanguage): CommandLanguage {
  return language === 'tspl' ? 'escpos' : 'tspl';
}

/**
 * What stage of pairing a tapped device is at. Kept separate from the
 * device-discovery state `usePrinterSetup` already manages, since this is
 * about one device at a time rather than the list.
 */
type PairingStage =
  | { kind: 'connecting'; device: BluetoothDeviceInfo }
  | {
      kind: 'confirming';
      device: BluetoothDeviceInfo;
      printer: BluetoothPrinter;
      language: CommandLanguage;
    }
  | { kind: 'saving'; device: BluetoothDeviceInfo }
  | {
      kind: 'error';
      device: BluetoothDeviceInfo;
      title: string;
      action: string;
    };

/**
 * Pairing screen: find a printer, print a test label on it, and only save it
 * once the driver confirms paper actually came out.
 *
 * The test-and-confirm loop talks to a raw `BluetoothPrinter` directly
 * (via `Xprinter.connect`) rather than through `PrinterSession.setUp` —
 * `setUp` commits a printer to storage immediately, but nothing should be
 * saved until the driver has confirmed it actually works. `session.setUp`
 * only runs once, at the very end, after "Did that print? Yes".
 */
export function SetupScreen({ onDone }: SetupScreenProps): ReactElement {
  const session = usePrinterSession();
  const {
    isSupported,
    isEnabled,
    permission,
    requestPermissions,
    isScanning,
    devices,
    loadPaired,
    scan,
    stopScan,
  } = usePrinterSetup();

  const [stage, setStage] = useState<PairingStage | null>(null);
  // Holds the raw connection across renders so a "No, try the other format"
  // tap can reuse it instead of reconnecting from scratch.
  const activePrinter = useRef<BluetoothPrinter | null>(null);

  useEffect(() => {
    if (isSupported && permission === 'granted' && isEnabled) {
      loadPaired().catch(() => undefined);
    }
  }, [isSupported, permission, isEnabled, loadPaired]);

  // A printer left open when the driver backs out mid-test, or the
  // component unmounts, has no reason to stay connected.
  useEffect(
    () => (): void => {
      activePrinter.current?.disconnect().catch(() => undefined);
    },
    []
  );

  const runTest = useCallback(
    async (
      device: BluetoothDeviceInfo,
      printer: BluetoothPrinter,
      language: CommandLanguage
    ): Promise<void> => {
      printer.declareLanguage(language);
      await printTestText(printer, language, device.name ?? 'this printer');
      setStage({ kind: 'confirming', device, printer, language });
    },
    []
  );

  const beginPairing = useCallback(
    async (device: BluetoothDeviceInfo): Promise<void> => {
      setStage({ kind: 'connecting', device });
      try {
        const printer = await Xprinter.connect(device.address);
        activePrinter.current = printer;
        printer.calibration = XPRINTER_P323B;
        printer.media = DEFAULT_MEDIA;

        const probe = await printer.detectLanguage();
        // No evidence either way: 'tspl' is only a starting guess for the
        // test print, not a claim — the driver's own eyes settle it.
        const language = probe.likely ?? 'tspl';
        await runTest(device, printer, language);
      } catch (error) {
        const problem = describePrinterProblem(error);
        setStage({
          kind: 'error',
          device,
          title: problem.title,
          action: problem.action,
        });
      }
    },
    [runTest]
  );

  const retryOtherFormat = useCallback(async (): Promise<void> => {
    if (stage?.kind !== 'confirming') {
      return;
    }
    const { device, printer, language } = stage;
    setStage({ kind: 'connecting', device });
    try {
      await runTest(device, printer, otherLanguage(language));
    } catch (error) {
      const problem = describePrinterProblem(error);
      setStage({
        kind: 'error',
        device,
        title: problem.title,
        action: problem.action,
      });
    }
  }, [stage, runTest]);

  const confirmWorking = useCallback(async (): Promise<void> => {
    if (stage?.kind !== 'confirming') {
      return;
    }
    const { device } = stage;
    setStage({ kind: 'saving', device });
    try {
      await stage.printer.disconnect();
      activePrinter.current = null;
      await session.setUp(device.address, device.name);
      setStage(null);
      onDone();
    } catch (error) {
      const problem = describePrinterProblem(error);
      setStage({
        kind: 'error',
        device,
        title: problem.title,
        action: problem.action,
      });
    }
  }, [stage, session, onDone]);

  const cancelPairing = useCallback((): void => {
    activePrinter.current?.disconnect().catch(() => undefined);
    activePrinter.current = null;
    setStage(null);
  }, []);

  if (!isSupported) {
    return (
      <View style={styles.centered}>
        <Text style={styles.heading}>This phone can&apos;t print</Text>
        <Text style={styles.body}>
          Bluetooth printing needs an Android phone with Bluetooth. This device
          doesn&apos;t support it.
        </Text>
      </View>
    );
  }

  if (permission !== 'granted') {
    return (
      <View style={styles.centered}>
        <Text style={styles.heading}>Allow Bluetooth</Text>
        <Text style={styles.body}>
          {permission === 'blocked'
            ? 'Bluetooth access was turned off for this app. Open Settings to allow it.'
            : 'This app needs Bluetooth access to find and print to your printer.'}
        </Text>
        <Pressable
          style={styles.primaryButton}
          onPress={() => {
            if (permission === 'blocked') {
              Linking.openSettings().catch(() => undefined);
              return;
            }
            requestPermissions().catch(() => undefined);
          }}
        >
          <Text style={styles.primaryButtonText}>
            {permission === 'blocked' ? 'Open Settings' : 'Allow Bluetooth'}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!isEnabled) {
    return (
      <View style={styles.centered}>
        <Text style={styles.heading}>Bluetooth is off</Text>
        <Text style={styles.body}>Turn on Bluetooth, then try again.</Text>
        <Pressable
          style={styles.primaryButton}
          onPress={() => requestPermissions().catch(() => undefined)}
        >
          <Text style={styles.primaryButtonText}>I turned it on</Text>
        </Pressable>
      </View>
    );
  }

  if (stage !== null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.heading}>{stage.device.name ?? 'Printer'}</Text>
        {stage.kind === 'connecting' ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.body}>Printing a test label…</Text>
          </>
        ) : null}
        {stage.kind === 'confirming' ? (
          <>
            <Text style={styles.body}>Did that print?</Text>
            <View style={styles.row}>
              <Pressable
                style={styles.primaryButton}
                onPress={() => confirmWorking().catch(() => undefined)}
              >
                <Text style={styles.primaryButtonText}>Yes</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => retryOtherFormat().catch(() => undefined)}
              >
                <Text style={styles.secondaryButtonText}>No</Text>
              </Pressable>
            </View>
          </>
        ) : null}
        {stage.kind === 'saving' ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.body}>Saving…</Text>
          </>
        ) : null}
        {stage.kind === 'error' ? (
          <>
            <Text style={styles.body}>{stage.title}</Text>
            <Text style={styles.bodyMuted}>{stage.action}</Text>
            <Pressable style={styles.primaryButton} onPress={cancelPairing}>
              <Text style={styles.primaryButtonText}>Back to list</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Set up printer</Text>
      <Text style={styles.bodyMuted}>Pick your printer from the list.</Text>

      <Pressable
        style={styles.secondaryButton}
        onPress={() =>
          (isScanning ? stopScan() : scan()).catch(() => undefined)
        }
      >
        {isScanning ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.secondaryButtonText}>Searching…</Text>
          </View>
        ) : (
          <Text style={styles.secondaryButtonText}>Search for printers</Text>
        )}
      </Pressable>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
      >
        {devices.length === 0 ? (
          <Text style={styles.bodyMuted}>
            No printers found yet. Make sure the printer is switched on and
            nearby, then search.
          </Text>
        ) : (
          devices.map((device) => (
            <Pressable
              key={device.address}
              style={styles.deviceRow}
              onPress={() => beginPairing(device).catch(() => undefined)}
            >
              <View style={styles.deviceText}>
                <Text style={styles.deviceName}>
                  {device.name ?? 'Unnamed printer'}
                </Text>
                <Text style={styles.bodyMuted}>
                  {device.isBonded ? 'Paired' : 'Nearby'}
                  {device.rssi === undefined
                    ? ''
                    : ` · signal ${signalLabel(device.rssi)}`}
                </Text>
                <Text style={styles.deviceAddress}>{device.address}</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

/** A plain-language signal strength, since a raw dBm number means nothing to a driver. */
function signalLabel(rssi: number): string {
  if (rssi >= -60) {
    return 'strong';
  }
  if (rssi >= -80) {
    return 'fair';
  }
  return 'weak';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.md,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  body: { fontSize: 16, color: colors.text, textAlign: 'center' },
  bodyMuted: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  primaryButton: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget * 2,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.primaryText,
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  list: { flex: 1 },
  listContent: { gap: spacing.sm, paddingVertical: spacing.sm },
  deviceRow: {
    minHeight: minTouchTarget,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  deviceText: { gap: 2 },
  deviceName: { fontSize: 17, fontWeight: '600', color: colors.text },
  deviceAddress: { fontSize: 11, color: colors.textFaint },
});
