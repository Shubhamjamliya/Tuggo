import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * @typedef {Object} Location
 * @property {number} lat
 * @property {number} lng
 */

/**
 * @typedef {Object} ActiveOrder
 * @property {string} orderId
 * @property {string} status
 * @property {Location} restaurantLocation
 * @property {Location} customerLocation
 * @property {number} orderAmount
 */

/**
 * useDeliveryStore - Professional Zustand store for Delivery V2
 * Handles Trip Lifecycle, Rider Status, and Admin Settings.
 */
export const useDeliveryStore = create(
  persist(
    (set, get) => ({
      // --- Rider Status ---
      isOnline: false,
      riderLocation: null, // { lat, lng }
      
      // --- Trip State ---
      activeOrder: null, // ActiveOrder | null
      acceptedOrders: [],
      orderCapacity: { enabled: false, maxConcurrentOrders: 1, effectiveLimit: 1, activeOrderCount: 0, remainingSlots: 1, canAcceptMore: true },
      tripStatus: 'IDLE', // 'IDLE' | 'PICKING_UP' | 'REACHED_PICKUP' | 'PICKED_UP' | 'DELIVERING' | 'REACHED_DROP' | 'COMPLETED'
      
      // --- Admin / Business Settings ---
      settings: {
        pickupRangeLimit: 500, // meters, fallback default
        deliveryRangeLimit: 500, // meters, fallback default
      },

      // --- Actions ---
      toggleOnline: () => set((state) => ({ isOnline: !state.isOnline })),
      
      setOnline: (online) => set({ isOnline: online }),
      
      setRiderLocation: (location) => set({ riderLocation: location }),
      
      setSettings: (newSettings) => set((state) => ({
        settings: { ...state.settings, ...newSettings }
      })),

      setActiveOrder: (order) => set((state) => ({ 
        activeOrder: order, 
        acceptedOrders: order
          ? [...state.acceptedOrders.filter((item) => String(item?._id || item?.orderId) !== String(order?._id || order?.orderId)), order]
          : state.acceptedOrders,
        tripStatus: order 
          ? (state.tripStatus === 'IDLE' ? 'PICKING_UP' : state.tripStatus) 
          : 'IDLE' 
      })),

      updateTripStatus: (status) => set({ tripStatus: status }),

      setAcceptedOrders: (orders = []) => set((state) => {
        const acceptedOrders = Array.isArray(orders) ? orders : [];
        const selectedId = String(state.activeOrder?._id || state.activeOrder?.orderId || '');
        const activeOrder = acceptedOrders.find((item) => String(item?._id || item?.orderId || '') === selectedId)
          || acceptedOrders[0]
          || null;
        return { acceptedOrders, activeOrder };
      }),

      removeAcceptedOrder: (orderId) => set((state) => {
        const id = String(orderId || '');
        const acceptedOrders = state.acceptedOrders.filter((item) => String(item?._id || item?.orderId || '') !== id);
        const wasSelected = String(state.activeOrder?._id || state.activeOrder?.orderId || '') === id;
        return {
          acceptedOrders,
          activeOrder: wasSelected ? null : state.activeOrder,
          tripStatus: wasSelected ? 'IDLE' : state.tripStatus,
          orderCapacity: {
            ...state.orderCapacity,
            activeOrderCount: Math.max(0, Number(state.orderCapacity.activeOrderCount || state.acceptedOrders.length) - 1),
            remainingSlots: Math.max(0, Number(state.orderCapacity.effectiveLimit || 1) - acceptedOrders.length),
            canAcceptMore: acceptedOrders.length < Number(state.orderCapacity.effectiveLimit || 1),
          },
        };
      }),

      setOrderCapacity: (capacity = {}) => set((state) => ({
        orderCapacity: { ...state.orderCapacity, ...capacity },
      })),

      clearActiveOrder: () => set({ 
        activeOrder: null, 
        tripStatus: 'IDLE' 
      }),

      // --- Selectors / Computed Helper ---
      canAdvanceToPickup: () => {
        const { activeOrder, tripStatus } = get();
        return activeOrder && tripStatus === 'PICKING_UP';
      },

      canAdvanceToDeliver: () => {
        const { activeOrder, tripStatus } = get();
        return activeOrder && tripStatus === 'PICKED_UP';
      }
    }),
    {
      name: 'delivery-v2-online-pref',
      // ONLY persist the 'isOnline' state, ignoring orders/location to prevent dummy order bugs
      partialize: (state) => ({ isOnline: state.isOnline }),
    }
  )
);
