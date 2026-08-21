import { useRef } from 'react';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { deliveryAPI } from '@food/api';
import { getOrderAcceptId } from '@food/utils/orderDispatchId';
import { toast } from 'sonner';

/**
 * useOrderManager - Professional hook for real-world trip lifecycle actions.
 * Connects directly to the backend API services.
 */
export const useOrderManager = () => {
  const { 
    activeOrder, tripStatus, updateTripStatus, clearActiveOrder, setActiveOrder, riderLocation 
  } = useDeliveryStore();

  const resolveOrderId = (orderLike = activeOrder) => getOrderAcceptId(orderLike);

  const acceptOrderInFlight = useRef(false);

  const acceptOrder = async (order) => {
    // Client-side guard: prevent duplicate API calls if already processing
    if (acceptOrderInFlight.current) {
      toast.info('Already processing this order...');
      return;
    }
    const orderId = resolveOrderId(order);
    if (!orderId) {
      toast.error('Invalid order data');
      return;
    }

    acceptOrderInFlight.current = true;
    try {
      const response = await deliveryAPI.acceptOrder(orderId);
      
      if (response?.data?.success) {
        const fullOrder = response.data.data?.order || order;
        
        // Robustly determine locations from multiple possible formats (Populated API vs Socket)
        const getLoc = (ref, keysLat, keysLng) => {
          if (!ref) return null;
          // Handle nested populated objects
          if (ref.location) {
            // Handle GeoJSON format: location: { type: 'Point', coordinates: [lng, lat] }
            if (Array.isArray(ref.location.coordinates) && ref.location.coordinates.length >= 2) {
              return {
                lat: ref.location.coordinates[1], // Latitude is second in GeoJSON [lng, lat]
                lng: ref.location.coordinates[0]  // Longitude is first
              };
            }
            // Handle standard object format: location: { latitude: 12.3, longitude: 45.6 }
            return {
              lat: ref.location.latitude || ref.location.lat,
              lng: ref.location.longitude || ref.location.lng
            };
          }
          // Handle flat objects or direct lat/lng keys
          for (const k of keysLat) { if (ref[k] != null) return { lat: ref[k], lng: ref[keysLng[keysLat.indexOf(k)]] }; }
          return null;
        };

        console.log('[OrderManager] Raw Full Order Data:', fullOrder);

        const resLoc = getLoc(fullOrder.restaurantId, ['latitude', 'lat'], ['longitude', 'lng']) || 
                       getLoc(fullOrder, ['restaurant_lat', 'restaurantLat', 'latitude'], ['restaurant_lng', 'restaurantLng', 'longitude']);
                       
        const cusLoc = getLoc(fullOrder.deliveryAddress, ['latitude', 'lat'], ['longitude', 'lng']) || 
                       getLoc(fullOrder, ['customer_lat', 'customerLat', 'latitude'], ['customer_lng', 'customerLng', 'longitude']);

        console.log('[OrderManager] Locations Mapped Result:', { resLoc, cusLoc });

        setActiveOrder({
          ...fullOrder,
          orderId: orderId,
          restaurantLocation: resLoc,
          customerLocation: cusLoc
        });

        updateTripStatus('PICKING_UP');
        // toast.success('Order Accepted! Opening Map...');
      } else {
        toast.error(response?.data?.message || 'Order already taken or unavailable');
        throw new Error('Accept failed');
      }
    } catch (error) {
      console.error('Accept Order Error:', error);
      const msg = error?.response?.data?.error || error?.response?.data?.message || 'Network error. Please try again.';
      // If the backend says already accepted by another — show friendly message
      if (error?.response?.status === 403 || msg.toLowerCase().includes('already accepted')) {
        toast.error('This order was just taken by another delivery partner.', { duration: 4000 });
      } else {
        toast.error(msg);
      }
      throw error;
    } finally {
      acceptOrderInFlight.current = false;
    }
  };


  /**
   * Mark "Reached Pickup" (Arrival at restaurant)
   */
  const reachPickup = async () => {
    const orderId = resolveOrderId();
    if (!orderId) {
      toast.error('Order id not found. Please refresh current trip.');
      throw new Error('Missing order id');
    }
    try {
      const response = await deliveryAPI.confirmReachedPickup(orderId);
      if (response?.data?.success) {
        updateTripStatus('REACHED_PICKUP');
        // toast.info('Arrived at Restaurant');
      } else {
        throw new Error('Confirm pickup failed');
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to update status');
      throw error;
    }
  };

  /**
   * Mark "Picked Up" (Confirm order ID & start delivery)
   */
  const pickUpOrder = async (billImageUrl, otp) => {
    const orderId = resolveOrderId();
    if (!orderId) {
      toast.error('Order id not found. Please refresh current trip.');
      throw new Error('Missing order id');
    }
    try {
      // confirmOrderId(orderId, confirmedOrderId, location, data)
      const response = await deliveryAPI.confirmOrderId(
        orderId, 
        activeOrder.displayOrderId || orderId, 
        riderLocation || {},
        { billImageUrl, otp }
      );
      
      if (response?.data?.success) {
        updateTripStatus('PICKED_UP');
        // toast.success('Order Collected! Heading to Drop-off');
      } else {
        throw new Error('Confirm order ID failed');
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Error confirming pickup');
      throw error;
    }
  };

  /**
   * Mark "Reached Drop" (Arrival at customer)
   */
  const reachDrop = async () => {
    const orderId = resolveOrderId();
    if (!orderId) {
      toast.error('Order id not found. Please refresh current trip.');
      throw new Error('Missing order id');
    }
    try {
      const response = await deliveryAPI.confirmReachedDrop(orderId);
      if (response?.data?.success) {
        updateTripStatus('REACHED_DROP');
        // toast.info('Arrived at Customer Location');
      } else {
        throw new Error('Confirm drop failed');
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to notify arrival');
      throw error;
    }
  };

  /**
   * Finalize Delivery with OTP Check
   */
  const completeDelivery = async (otp) => {
    const orderId = resolveOrderId();
    if (!orderId) {
      toast.error('Order id not found. Please refresh current trip.');
      throw new Error('Missing order id');
    }
    try {
      const isAlreadyVerified = activeOrder?.deliveryVerification?.dropOtp?.verified;
      
      // 1. Verify OTP first (only if not already verified by modal or previous action)
      if (!isAlreadyVerified) {
        const verifyRes = await deliveryAPI.verifyDropOtp(orderId, otp);
        if (!verifyRes?.data?.success) {
          toast.error('Invalid OTP. Please check with customer.');
          throw new Error('Invalid OTP');
        }
      }
      
      const otpToUse = otp || activeOrder?.deliveryVerification?.dropOtp?.code;
      
      // 2. Proceed to mark as complete
      let finalOrder = activeOrder;
      try {
        const completeRes = await deliveryAPI.completeDelivery(orderId, { 
          otp: otpToUse, 
          rating: 5,
        });
        if (completeRes.data?.success && completeRes.data?.data?.order) {
          finalOrder = completeRes.data.data.order;
        }
      } catch (completeErr) {
        console.warn('Complete call failed, but OTP was verified.', completeErr);
        const errMsg = String(completeErr?.response?.data?.error || completeErr?.response?.data?.message || '').toLowerCase();
        if (!errMsg.includes('already at status') && !errMsg.includes('delivered')) {
          throw completeErr;
        }
      }
      
      // Update local order state so Summary Modal shows 'delivered' status
      if (finalOrder) setActiveOrder(finalOrder);
      updateTripStatus('COMPLETED');
      // toast.success('Delivery Success!');
    } catch (error) {
      console.error('Completion Error:', error);
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          'Verification failed',
      );
      throw error;
    }
  };

  const resetTrip = () => {
    clearActiveOrder();
  };

  return {
    acceptOrder,
    reachPickup,
    pickUpOrder,
    reachDrop,
    completeDelivery,
    resetTrip,
  };
};
