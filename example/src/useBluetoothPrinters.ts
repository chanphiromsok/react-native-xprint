import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Xprinter,
  type BluetoothDeviceInfo,
  type BluetoothPermissionStatus,
} from 'react-native-xprinter';

interface BluetoothPrinters {
  permissionStatus: BluetoothPermissionStatus;
  isDiscovering: boolean;
  devices: BluetoothDeviceInfo[];
  requestPermissions: () => Promise<void>;
  refreshBondedDevices: () => Promise<void>;
  startDiscovery: () => Promise<void>;
  stopDiscovery: () => Promise<void>;
}

/** Merges a newly seen device into the list, keyed by its MAC address. */
function mergeDevice(
  devices: BluetoothDeviceInfo[],
  device: BluetoothDeviceInfo
): BluetoothDeviceInfo[] {
  const index = devices.findIndex((known) => known.address === device.address);
  if (index === -1) {
    return [...devices, device];
  }
  const merged = [...devices];
  merged[index] = { ...devices[index], ...device };
  return merged;
}

export function useBluetoothPrinters(
  onError: (error: unknown) => void
): BluetoothPrinters {
  const [permissionStatus, setPermissionStatus] =
    useState<BluetoothPermissionStatus>(() => Xprinter.permissionStatus);
  const [isDiscovering, setIsDiscovering] = useState(Xprinter.isDiscovering);
  const [devices, setDevices] = useState<BluetoothDeviceInfo[]>([]);

  useEffect(() => {
    const foundSubscription = Xprinter.addDeviceFoundListener((device) => {
      setDevices((current) => mergeDevice(current, device));
    });
    const stateSubscription =
      Xprinter.addDiscoveryStateListener(setIsDiscovering);

    return () => {
      foundSubscription.remove();
      stateSubscription.remove();
    };
  }, []);

  const refreshBondedDevices = useCallback(async () => {
    try {
      const bonded = await Xprinter.getBondedDevices();
      setDevices((current) => bonded.reduce(mergeDevice, current));
    } catch (error) {
      onError(error);
    }
  }, [onError]);

  const requestPermissions = useCallback(async () => {
    try {
      setPermissionStatus(await Xprinter.requestPermissions());
    } catch (error) {
      onError(error);
    }
  }, [onError]);

  const startDiscovery = useCallback(async () => {
    try {
      await Xprinter.startDiscovery();
    } catch (error) {
      onError(error);
    }
  }, [onError]);

  const stopDiscovery = useCallback(async () => {
    try {
      await Xprinter.stopDiscovery();
    } catch (error) {
      onError(error);
    }
  }, [onError]);

  return useMemo(
    () => ({
      permissionStatus,
      isDiscovering,
      devices,
      requestPermissions,
      refreshBondedDevices,
      startDiscovery,
      stopDiscovery,
    }),
    [
      permissionStatus,
      isDiscovering,
      devices,
      requestPermissions,
      refreshBondedDevices,
      startDiscovery,
      stopDiscovery,
    ]
  );
}
