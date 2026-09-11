import { useMemo } from 'react';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { calculateDistance, parseLatLng } from '@/modules/DeliveryV2/hooks/proximity.utils';

/**
 * useProximityCheck - Professional hook for dynamic range monitoring.
 * Ensures rider can only advance based on Admin-defined ranges.
 *
 * @returns {Object} { distanceToTarget, isWithinRange, actionLimit }
 */
export const useProximityCheck = () => {
  const riderLocation = useDeliveryStore((state) => state.riderLocation);
  const activeOrder = useDeliveryStore((state) => state.activeOrder);
  const tripStatus = useDeliveryStore((state) => state.tripStatus);
  const settings = useDeliveryStore((state) => state.settings);

  const targetLocation = useMemo(() => {
    if (!activeOrder) return null;

    if (['PICKING_UP', 'REACHED_PICKUP'].includes(tripStatus)) {
      return (
        parseLatLng(activeOrder.restaurantLocation) ||
        parseLatLng(activeOrder.restaurant_location) ||
        parseLatLng(activeOrder.restaurantId?.location) ||
        parseLatLng(activeOrder.restaurantId)
      );
    }

    if (['PICKED_UP', 'REACHED_DROP'].includes(tripStatus)) {
      return (
        parseLatLng(activeOrder.customerLocation) ||
        parseLatLng(activeOrder.customer_location) ||
        parseLatLng(activeOrder.deliveryAddress?.location) ||
        parseLatLng(activeOrder.deliveryAddress)
      );
    }

    return null;
  }, [activeOrder, tripStatus]);

  const riderPoint = useMemo(() => parseLatLng(riderLocation), [riderLocation]);

  const actionLimit = useMemo(() => {
    if (tripStatus === 'PICKING_UP') return settings.pickupRangeLimit || 1500;
    if (tripStatus === 'PICKED_UP') return settings.deliveryRangeLimit || 1500;
    return 1500;
  }, [tripStatus, settings]);

  const distanceToTarget = useMemo(() => {
    if (!riderPoint || !targetLocation) return Infinity;

    return calculateDistance(
      riderPoint.lat,
      riderPoint.lng,
      targetLocation.lat,
      targetLocation.lng,
    );
  }, [riderPoint, targetLocation]);

  const isDevMode =
    import.meta.env.VITE_APP_MODE === 'developer' ||
    import.meta.env.VITE_ENABLE_RANGE_BYPASS === 'true' ||
    import.meta.env.DEV;

  const isWithinRange = isDevMode ? true : (!targetLocation ? true : distanceToTarget <= actionLimit);

  return {
    distanceToTarget,
    isWithinRange,
    actionLimit,
  };
};
