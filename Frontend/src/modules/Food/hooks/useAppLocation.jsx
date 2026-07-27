import { useLocationContext } from '../context/locationContext';

/**
 * Read centralized location + zone from LocationProvider.
 * Use this in pages/components instead of mounting the geo engine directly.
 */
export function useAppLocation() {
  const ctx = useLocationContext();
  if (!ctx) {
    return {
      isLocationResolved: false,
      location: null,
      effectiveLocation: null,
      zoneId: null,
      address: null,
      zoneStatus: 'loading',
      loading: true,
      isOutOfService: false,
      isOutOfRadius: false,
      isOutOfZone: false,
      serviceUnavailableMessage: '',
      deliveryAddressMode: 'saved',
    };
  }

  return {
    isLocationResolved: ctx.isLocationResolved,
    location: ctx.location,
    effectiveLocation: ctx.effectiveLocation,
    zoneId: ctx.zoneId,
    address: ctx.address,
    zoneStatus: ctx.zoneStatus,
    loading: ctx.loading,
    isOutOfService: ctx.isOutOfService,
    isOutOfRadius: ctx.isOutOfRadius,
    isOutOfZone: ctx.isOutOfZone,
    serviceUnavailableMessage: ctx.serviceUnavailableMessage,
    deliveryAddressMode: ctx.deliveryAddressMode,
    requestLocation: ctx.requestLocation,
    setSavedLocation: ctx.setSavedLocation,
    setDeliveryAddressMode: ctx.setDeliveryAddressMode,
    refreshZone: ctx.refreshZone,
  };
}
