import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PrinterProvider } from './hooks/PrinterProvider';
import { usePrinter } from './hooks/usePrinter';
import { printerSession } from './printer';
import { PrintScreen } from './screens/PrintScreen';
// import { PrinterSettingsScreen } from './screens/PrinterSettingsScreen';
import { SetupScreen } from './screens/SetupScreen';
import { colors } from './theme';

type Screen = 'print' | 'settings' | 'setup';

/**
 * Reads `session.state` (only available once inside `PrinterProvider`) to
 * decide the screen, so this is split out from `App` rather than doing the
 * same check above the provider.
 */
function Navigator(): ReactElement {
  const { state } = usePrinter();
  const [screen, setScreen] = useState<Screen>('settings');

  // No printer set up yet always wins, regardless of which screen was last
  // chosen — there is nothing for Print or Settings to show without one.
  if (state === 'unconfigured' || screen === 'setup') {
    return <SetupScreen onDone={() => setScreen('print')} />;
  }
  // PrinterSettingsScreen's route is disabled for now — re-enable both this
  // and its import above once the issue on that screen is sorted out.
  // if (screen === 'settings') {
  //   return (
  //     <PrinterSettingsScreen
  //       onAddPrinter={() => setScreen('setup')}
  //       onDone={() => setScreen('print')}
  //     />
  //   );
  // }
  return <PrintScreen onOpenSettings={() => setScreen('settings')} />;
}

export default function App(): ReactElement {
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    // `restore()` never throws for an out-of-range printer — see its own
    // doc comment — but a genuinely broken storage adapter still can, and
    // this screen has nothing better to do about that than move on and let
    // `session.problem` carry it from there.
    printerSession
      .restore()
      .catch(() => undefined)
      .finally(() => setIsRestoring(false));
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="auto" />
      {isRestoring ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <PrinterProvider session={printerSession}>
          <Navigator />
        </PrinterProvider>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
