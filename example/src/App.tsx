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
  Xprinter,
  type BluetoothDeviceInfo,
  type BluetoothPrinter,
} from 'react-native-xprinter';
import { testReceipt } from './escpos';
import { printImageAsLabel, printImageAsReceipt } from './printJobs';
import { testLabel, type LabelSize } from './tspl';
import { useBluetoothPrinters } from './useBluetoothPrinters';

/**
 * The command language the printer is currently set to. XPrinter hardware is
 * multi-protocol and silently discards a job written in a language it is not in,
 * so the example lets you pick rather than assuming.
 */
type CommandLanguage = 'escpos' | 'tspl';

/** What to send: generated text, or a rasterized image. */
type Content = 'text' | 'image';

/** The label stock this example was tested against. */
const LABEL_SIZE: LabelSize = { widthMm: 70, heightMm: 80 };

/**
 * The invoice to print in image mode. Drop any PNG/JPEG at this path — on
 * Android in development:
 *
 * ```sh
 * adb push invoice.png /data/local/tmp/invoice.png
 * adb shell run-as <your.package> cp /data/local/tmp/invoice.png files/invoice.png
 * ```
 */
const INVOICE_FILE = new File(Paths.document, 'invoice.png');

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
  const [language, setLanguage] = useState<CommandLanguage>('tspl');
  const [content, setContent] = useState<Content>('text');

  const connectAndPrint = useCallback(
    async (device: BluetoothDeviceInfo) => {
      setConnectingAddress(device.address);
      try {
        if (content === 'image' && !INVOICE_FILE.exists) {
          throw new Error(
            `No image at ${INVOICE_FILE.uri}. Push one there first — see INVOICE_FILE in App.tsx.`
          );
        }

        await printer?.disconnect();
        const connected = await Xprinter.connect(device.address);
        setPrinter(connected);

        const name = device.name ?? device.address;
        if (content === 'image') {
          if (language === 'tspl') {
            await printImageAsLabel(connected, INVOICE_FILE.uri, {
              size: LABEL_SIZE,
              marginMm: 2,
              // DIRECTION 1 plus both flips is just DIRECTION 1 rotated 180°,
              // i.e. DIRECTION 0 — which also uses the standard print origin.
              direction: 0,
              flipHorizontal: false,
              flipVertical: false,
              // Calibration: the printable origin sits right of the paper's left
              // edge on this printer, so the centered bitmap needs nudging back.
              offsetXDots: -16,
              offsetYDots: 0,
            });
          } else {
            await printImageAsReceipt(
              connected,
              INVOICE_FILE.uri,
              LABEL_SIZE.widthMm * 8
            );
          }
        } else {
          await connected.write(
            language === 'tspl'
              ? testLabel(name, LABEL_SIZE)
              : testReceipt(name)
          );
        }

        Alert.alert(
          'Sent',
          `${language === 'tspl' ? 'TSPL' : 'ESC/POS'} ${content} job sent to ${name}. ` +
            'If nothing printed, the printer is probably set to the other command language.'
        );
      } catch (error) {
        onError(error);
      } finally {
        setConnectingAddress(null);
      }
    },
    [content, language, onError, printer]
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
          label="ESC/POS"
          selected={language === 'escpos'}
          onPress={() => setLanguage('escpos')}
        />
        <Action
          label="TSPL"
          selected={language === 'tspl'}
          onPress={() => setLanguage('tspl')}
        />
        <Action
          label="Text"
          selected={content === 'text'}
          onPress={() => setContent('text')}
        />
        <Action
          label="Image"
          selected={content === 'image'}
          onPress={() => setContent('image')}
        />
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
  actions: { flexDirection: 'row', gap: 8, marginVertical: 4 },
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
