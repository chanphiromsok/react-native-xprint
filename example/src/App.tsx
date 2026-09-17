import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import {
  printPdfAsLabel,
  printPdfAsReceipt,
  tsplCalibrationLabel,
  Xprinter,
  XPRINTER_P323B,
  type BluetoothDeviceInfo,
  type BluetoothPrinter,
  type CommandLanguage,
  type LabelMedia,
  type SizeMm,
} from 'react-native-xprint';
import { printTestText, resolveLanguage } from './printTest';
import { useBluetoothPrinters } from './useBluetoothPrinters';

/** What to send: generated text, a rendered document, or a calibration target. */
type Content = 'text' | 'document' | 'calibrate';

/**
 * The command language to use, or `'auto'` to let the printer tell us.
 *
 * XPrinter hardware is multi-protocol and silently discards a job written in a
 * language it is not currently in, so this is never assumed — it is detected on
 * the first connection, and the explicit options are there to override a probe
 * that came back inconclusive.
 */
type LanguageChoice = 'auto' | CommandLanguage;

/**
 * The stock physically loaded in the printer.
 *
 * This is the paper, not a design choice: TSPL anchors its canvas at the
 * printer's origin, so the canvas always matches the paper. Change this when you
 * swap the roll.
 */
const LOADED_MEDIA: LabelMedia = {
  widthMm: 70,
  heightMm: 80,
  type: 'printerDefault',
};

/**
 * Content areas to lay the invoice out in, centred on whatever paper is loaded.
 *
 * `undefined` means the whole paper less the margin. A fixed size prints a
 * smaller design centred on larger stock — which is what shrinking the media
 * size cannot do.
 */
const CONTENT_PRESETS: { label: string; size?: SizeMm }[] = [
  { label: 'Full' },
  { label: '50×30', size: { widthMm: 50, heightMm: 30 } },
];

/**
 * The document to print in image mode. Drop any PNG, JPEG or PDF at this path —
 * on Android in development:
 *
 * ```sh
 * adb push invoice.pdf /data/local/tmp/invoice.pdf
 * adb shell run-as <your.package> cp /data/local/tmp/invoice.pdf files/invoice.pdf
 * ```
 */
const INVOICE_FILE = new File(Paths.document, 'invoice.pdf');

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const onError = useCallback((error: unknown) => {
    Alert.alert('Printer error', describeError(error));
  }, []);

  const {
    permissionStatus,
    isDiscovering,
    devices,
    requestPermissions,
    refreshBondedDevices,
    startDiscovery,
    stopDiscovery,
  } = useBluetoothPrinters(onError);

  const [connectingAddress, setConnectingAddress] = useState<string | null>(
    null
  );
  const [printer, setPrinter] = useState<BluetoothPrinter | null>(null);
  const [choice, setChoice] = useState<LanguageChoice>('auto');
  const [content, setContent] = useState<Content>('text');
  /** What the last connection turned out to be speaking. */
  const [resolved, setResolved] = useState<CommandLanguage | null>(null);
  const [contentIndex, setContentIndex] = useState(0);

  const connectAndPrint = useCallback(
    async (device: BluetoothDeviceInfo) => {
      setConnectingAddress(device.address);
      try {
        if (content === 'document' && !INVOICE_FILE.exists) {
          throw new Error(
            `No image at ${INVOICE_FILE.uri}. Push one there first — see INVOICE_FILE in App.tsx.`
          );
        }

        await printer?.disconnect();
        const connected = await Xprinter.connect(device.address);
        setPrinter(connected);

        // Everything geometric is configured once, here. No print call below
        // takes a size, an offset or an orientation.
        connected.calibration = XPRINTER_P323B;
        connected.media = LOADED_MEDIA;

        // An explicit choice is authoritative; otherwise ask the printer.
        if (choice !== 'auto') {
          connected.declareLanguage(choice);
        }
        const { language, detected } = await resolveLanguage(connected);
        setResolved(language);

        const name = device.name ?? device.address;
        if (content === 'calibrate') {
          const media = connected.media;
          if (media == null) {
            throw new Error('Set a media size before calibrating.');
          }
          await connected.write(
            tsplCalibrationLabel(media, connected.calibration.dotsPerMm)
          );
          Alert.alert(
            'Calibration target sent',
            'Check which frame edges printed and where the centre cross landed.'
          );
          return;
        }
        if (content === 'document') {
          // Works for PNG, JPEG and PDF alike — a non-PDF counts as one page, so
          // there is nothing to branch on. Layout is left to the defaults:
          // centred with a 2 mm edge, geometry from media and calibration.
          if (language === 'tspl') {
            await printPdfAsLabel(connected, INVOICE_FILE.uri, {
              contentSizeMm: CONTENT_PRESETS[contentIndex]!.size,
            });
          } else {
            await printPdfAsReceipt(connected, INVOICE_FILE.uri);
          }
        } else {
          await printTestText(connected, language, name);
        }

        Alert.alert(
          'Sent',
          `${language === 'tspl' ? 'TSPL' : 'ESC/POS'} ${content} job sent to ${name}` +
            `${detected ? ' (language detected)' : ''}.`
        );
      } catch (error) {
        onError(error);
      } finally {
        setConnectingAddress(null);
      }
    },
    [choice, content, contentIndex, onError, printer]
  );

  if (!Xprinter.isSupported) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.heading}>Not supported</Text>
        <Text style={styles.subtle}>
          Bluetooth Classic printing is available on Android only.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.heading}>Bluetooth printers</Text>
      <Text style={styles.subtle}>
        Adapter {Xprinter.isEnabled ? 'on' : 'off'} · permissions{' '}
        {permissionStatus}
        {resolved == null ? '' : ` · speaking ${resolved}`}
        {` · paper ${LOADED_MEDIA.widthMm}×${LOADED_MEDIA.heightMm}mm`}
      </Text>

      <View style={styles.actions}>
        <Action label="Permissions" onPress={requestPermissions} />
        <Action label="Paired" onPress={refreshBondedDevices} />
        <Action
          label={isDiscovering ? 'Stop scan' : 'Scan'}
          onPress={isDiscovering ? stopDiscovery : startDiscovery}
        />
      </View>

      <View style={styles.actions}>
        <Action
          label="Auto"
          selected={choice === 'auto'}
          onPress={() => setChoice('auto')}
        />
        <Action
          label="ESC/POS"
          selected={choice === 'escpos'}
          onPress={() => setChoice('escpos')}
        />
        <Action
          label="TSPL"
          selected={choice === 'tspl'}
          onPress={() => setChoice('tspl')}
        />
        <Action
          label="Text"
          selected={content === 'text'}
          onPress={() => setContent('text')}
        />
        <Action
          label="Doc"
          selected={content === 'document'}
          onPress={() => setContent('document')}
        />
        <Action
          label="Calib"
          selected={content === 'calibrate'}
          onPress={() => setContent('calibrate')}
        />
      </View>

      <View style={styles.actions}>
        {CONTENT_PRESETS.map((preset, index) => (
          <Action
            key={preset.label}
            label={preset.label}
            selected={contentIndex === index}
            onPress={() => setContentIndex(index)}
          />
        ))}
      </View>

      {isDiscovering ? <ActivityIndicator style={styles.spinner} /> : null}

      <FlatList
        data={devices}
        keyExtractor={(device) => device.address}
        ListEmptyComponent={
          <Text style={styles.subtle}>
            No devices yet. Grant permissions, then load paired devices or scan.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => connectAndPrint(item)}>
            <View style={styles.rowText}>
              <Text style={styles.deviceName}>
                {item.name ?? 'Unnamed device'}
              </Text>
              <Text style={styles.subtle}>
                {item.address} · {item.majorDeviceClass}
                {item.isBonded ? ' · paired' : ''}
                {item.rssi == null ? '' : ` · ${item.rssi} dBm`}
              </Text>
            </View>
            {connectingAddress === item.address ? <ActivityIndicator /> : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function Action({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
}) {
  return (
    <Pressable
      style={[styles.action, selected === false && styles.actionUnselected]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.actionLabel,
          selected === false && styles.actionLabelUnselected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  heading: { fontSize: 22, fontWeight: '600' },
  subtle: { color: '#666' },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 4,
  },
  action: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1f6feb',
  },
  actionUnselected: { backgroundColor: '#e7edf5' },
  actionLabel: { color: 'white', fontWeight: '600' },
  actionLabelUnselected: { color: '#1f6feb' },
  spinner: { marginVertical: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  rowText: { flex: 1, gap: 2 },
  deviceName: { fontSize: 16, fontWeight: '500' },
});
