import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Xprinter,
  type BluetoothDeviceInfo,
  type BluetoothPermissionStatus,
} from 'react-native-xprint';

/**
 * What a pairing screen needs to let a driver find and choose a printer,
 * before any `PrinterSession` exists.
 *
 * This talks to `Xprinter` directly rather than going through
 * `usePrinterSession` because pairing is the one flow that genuinely
 * precedes a session — there is nothing to connect to yet, so there is
 * nothing a `PrinterProvider` could usefully hold. `PrinterSession.setUp`
 * is still the right next step once the driver has picked an address from
 * `devices`; this hook's job ends at "here is a list of nearby devices and
 * whether we're allowed to look for them."
 */
export interface UsePrinterSetupResult {
  isSupported: boolean;
  isEnabled: boolean;
  permission: BluetoothPermissionStatus;
  requestPermissions(): Promise<BluetoothPermissionStatus>;
  isScanning: boolean;
  /** Paired devices first, then those found by scanning. Deduplicated by address. */
  devices: readonly BluetoothDeviceInfo[];
  /** Loads already-paired devices. The fast path — no scan needed. */
  loadPaired(): Promise<void>;
  scan(): Promise<void>;
  stopScan(): Promise<void>;
}

/** Paired devices first — see the interface doc on `devices` for why. */
function orderForDisplay(
  devicesByAddress: Readonly<Record<string, BluetoothDeviceInfo>>
): readonly BluetoothDeviceInfo[] {
  // Array#sort is a stable sort, so devices within the same group (paired,
  // or scanned-only) keep the relative order they were discovered in.
  return Object.values(devicesByAddress).sort((a, b) =>
    a.isBonded === b.isBonded ? 0 : a.isBonded ? -1 : 1
  );
}

/**
 * Drives the pairing screen: permissions, adapter state, and the list of
 * nearby-or-paired printers, kept current for as long as the component
 * using this hook is mounted.
 */
export function usePrinterSetup(): UsePrinterSetupResult {
  const isMounted = useRef(true);
  useEffect(
    () => (): void => {
      isMounted.current = false;
    },
    []
  );

  const [isEnabled, setIsEnabled] = useState<boolean>(Xprinter.isEnabled);
  const [permission, setPermission] = useState<BluetoothPermissionStatus>(
    Xprinter.permissionStatus
  );
  const [isScanning, setIsScanning] = useState<boolean>(Xprinter.isDiscovering);
  const [devicesByAddress, setDevicesByAddress] = useState<
    Readonly<Record<string, BluetoothDeviceInfo>>
  >({});

  useEffect(() => {
    // Leaked listeners keep firing into an unmounted component, so both
    // subscriptions are removed in this effect's cleanup rather than left
    // for garbage collection to eventually catch up with.
    const deviceFound = Xprinter.addDeviceFoundListener((device) => {
      if (!isMounted.current) {
        return;
      }
      // A later report for the same address replaces the earlier one
      // outright rather than merging field-by-field — a fresher scan
      // result's rssi is more useful than a stale one's, and a later
      // report is never less informative than an earlier one.
      setDevicesByAddress((previous) => ({
        ...previous,
        [device.address]: device,
      }));
    });
    const discoveryState = Xprinter.addDiscoveryStateListener((discovering) => {
      if (!isMounted.current) {
        return;
      }
      setIsScanning(discovering);
    });
    return (): void => {
      deviceFound.remove();
      discoveryState.remove();
    };
  }, []);

  const requestPermissions =
    useCallback(async (): Promise<BluetoothPermissionStatus> => {
      const result = await Xprinter.requestPermissions();
      if (isMounted.current) {
        setPermission(result);
        // Granting permission can be the moment the adapter itself becomes
        // usable on some OEM skins, so re-read isEnabled alongside it.
        setIsEnabled(Xprinter.isEnabled);
      }
      return result;
    }, []);

  const loadPaired = useCallback(async (): Promise<void> => {
    const paired = await Xprinter.getBondedDevices();
    if (!isMounted.current) {
      return;
    }
    setDevicesByAddress((previous) => {
      const next = { ...previous };
      for (const device of paired) {
        next[device.address] = device;
      }
      return next;
    });
  }, []);

  const scan = useCallback(async (): Promise<void> => {
    await Xprinter.startDiscovery();
  }, []);

  const stopScan = useCallback(async (): Promise<void> => {
    await Xprinter.stopDiscovery();
  }, []);

  const devices = useMemo(
    () => orderForDisplay(devicesByAddress),
    [devicesByAddress]
  );

  return {
    isSupported: Xprinter.isSupported,
    isEnabled,
    permission,
    requestPermissions,
    isScanning,
    devices,
    loadPaired,
    scan,
    stopScan,
  };
}
