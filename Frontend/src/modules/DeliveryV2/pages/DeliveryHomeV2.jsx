import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { useProximityCheck } from '@/modules/DeliveryV2/hooks/useProximityCheck';
import { useOrderManager } from '@/modules/DeliveryV2/hooks/useOrderManager';
import { useDeliveryNotificationContext } from '@food/context/DeliveryNotificationContext';
import { deliveryAPI } from '@food/api';
import {
  getOrderAcceptId,
  getOrderMongoId,
  getPrimaryIncomingOrder,
  isSameOrder,
  normalizeIncomingOrder,
  removeIncomingOrderFromQueue,
  upsertIncomingOrderInQueue,
} from '@food/utils/orderDispatchId';
import { toast } from 'sonner';

const debugDeliveryPopup = (...args) => console.log('[DeliveryPopupTrace]', ...args);

// Components
import LiveMap from '@/modules/DeliveryV2/components/map/LiveMap';
import { NewOrderModal } from '@/modules/DeliveryV2/components/modals/NewOrderModal';
import { PickupActionModal } from '@/modules/DeliveryV2/components/modals/PickupActionModal';
import { DeliveryVerificationModal } from '@/modules/DeliveryV2/components/modals/DeliveryVerificationModal';
import { OrderSummaryModal } from '@/modules/DeliveryV2/components/modals/OrderSummaryModal';
import { PhotoUploadModal } from '@/modules/DeliveryV2/components/modals/PhotoUploadModal';
import ActionSlider from '@/modules/DeliveryV2/components/ui/ActionSlider';

// Sub Pages
import PocketV2 from '@/modules/DeliveryV2/pages/PocketV2';
import HistoryV2 from '@/modules/DeliveryV2/pages/HistoryV2';
import ProfileV2 from '@/modules/DeliveryV2/pages/ProfileV2';

// Icons
import { 
  Bell, HelpCircle, AlertTriangle, 
  Wallet, History, User as UserIcon, LayoutGrid,
  Plus, Minus, Navigation2, Navigation, Target, Play, CheckCircle2, Clock, ChevronDown,
  Contact, Package, Phone, MapPin
} from 'lucide-react';

import { shouldSendLocationUpdate } from "@delivery/utils/trackingInterval";
import { getHaversineDistance, calculateETA, calculateHeading } from '@/modules/DeliveryV2/utils/geo';
import { parseLatLng } from '@/modules/DeliveryV2/hooks/proximity.utils';
import { useCompanyName } from "@food/hooks/useCompanyName";
import { useNavigate } from 'react-router-dom';
import useNotificationInbox from "@food/hooks/useNotificationInbox";
import { writeDeliveryLocation } from "@food/realtimeTracking";
import { registerWebPushForCurrentModule } from "@food/utils/firebaseMessaging";

function getDeliveryPartnerId() {
  try {
    const userRaw = localStorage.getItem("delivery_user");
    if (userRaw) {
      const user = JSON.parse(userRaw);
      const id = user?._id || user?.id || user?.deliveryPartnerId;
      if (id) return String(id);
    }
    const token = localStorage.getItem("delivery_accessToken") || "";
    if (token) {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload?.userId) return String(payload.userId);
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

function extractOrderLocation(ref, keysLat = [], keysLng = []) {
  if (!ref) return null;

  const nestedLocation = ref.location && typeof ref.location === 'object' ? ref.location : null;
  const locationCandidate = nestedLocation || ref;

  const coords = Array.isArray(locationCandidate?.coordinates)
    ? locationCandidate.coordinates
    : Array.isArray(locationCandidate?.location?.coordinates)
      ? locationCandidate.location.coordinates
      : null;

  if (coords?.length >= 2) {
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  const lat = Number(
    locationCandidate?.latitude ??
    locationCandidate?.lat ??
    locationCandidate?.location?.latitude ??
    locationCandidate?.location?.lat
  );
  const lng = Number(
    locationCandidate?.longitude ??
    locationCandidate?.lng ??
    locationCandidate?.location?.longitude ??
    locationCandidate?.location?.lng
  );

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  for (const [index, key] of keysLat.entries()) {
    if (ref[key] != null) {
      const parsedLat = Number(ref[key]);
      const parsedLng = Number(ref[keysLng[index]]);
      if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
        return { lat: parsedLat, lng: parsedLng };
      }
    }
  }

  return null;
}

function normalizeDeliveryActiveOrder(rawOrder) {
  if (!rawOrder) return null;

  const restaurantLocation =
    extractOrderLocation(rawOrder.restaurantLocation) ||
    extractOrderLocation(rawOrder.restaurantId, ['latitude', 'lat'], ['longitude', 'lng']) ||
    extractOrderLocation(rawOrder.restaurant, ['latitude', 'lat'], ['longitude', 'lng']) ||
    extractOrderLocation(rawOrder, ['restaurant_lat', 'restaurantLat'], ['restaurant_lng', 'restaurantLng']);

  const customerLocation =
    extractOrderLocation(rawOrder.customerLocation) ||
    extractOrderLocation(rawOrder.deliveryAddress, ['latitude', 'lat'], ['longitude', 'lng']) ||
    extractOrderLocation(rawOrder.customer_address, ['latitude', 'lat'], ['longitude', 'lng']) ||
    extractOrderLocation(rawOrder.user, ['latitude', 'lat'], ['longitude', 'lng']) ||
    extractOrderLocation(rawOrder, ['customer_lat', 'customerLat'], ['customer_lng', 'customerLng']);

  return {
    ...rawOrder,
    _id: rawOrder._id || rawOrder.orderMongoId || rawOrder.orderId,
    orderId: rawOrder.orderId || rawOrder.order_id || rawOrder._id || rawOrder.orderMongoId,
    restaurantLocation,
    customerLocation,
  };
}

/** Minimal bottom-sheet popup (Restored from legacy FeedNavbar) */
function BottomPopup({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[600] flex items-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative w-full bg-white rounded-t-3xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-black text-gray-900 uppercase tracking-tight">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
             <AlertTriangle className="w-4 h-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

/**
 * DeliveryHomeV2 - Premium 1:1 Match with Original App UI.
 * Featuring logical tab switching for Feed, Pocket, History, and Profile.
 */
export default function DeliveryHomeV2({ tab = 'feed' }) {
  const navigate = useNavigate();
  const { isOnline, toggleOnline, riderLocation, activeOrder, tripStatus, setRiderLocation, setActiveOrder, updateTripStatus, clearActiveOrder } = useDeliveryStore();
  const { isWithinRange, distanceToTarget } = useProximityCheck();
  const { acceptOrder, reachPickup, pickUpOrder, reachDrop, completeDelivery, resetTrip } = useOrderManager();
  const { newOrder, clearNewOrder, orderStatusUpdate, clearOrderStatusUpdate, claimedOrderId, clearClaimedOrderId, autoKilledOrder, clearAutoKilledOrder, adminNotification, clearAdminNotification, isConnected: isSocketConnected, emitLocation, playNotificationSound } = useDeliveryNotificationContext();
  const companyName = useCompanyName();
  const { items: broadcastItems, unreadCount: notificationUnreadCount, markAsRead: markBroadcastAsRead, dismissAll: dismissAllBroadcast } = useNotificationInbox("delivery", { limit: 20 });

  const [incomingOrders, setIncomingOrders] = useState([]);
  const [selectedIncomingId, setSelectedIncomingId] = useState(null);
  const lockedIncomingOrderIdRef = useRef(null);

  useEffect(() => {
    registerWebPushForCurrentModule("/food/delivery").catch((err) => {
      console.error("Failed to register push notifications in DeliveryHomeV2:", err);
    });
  }, []);

  const incomingOrder = useMemo(
    () => getPrimaryIncomingOrder(incomingOrders, selectedIncomingId),
    [incomingOrders, selectedIncomingId],
  );

  const selectIncomingOrder = useCallback((order) => {
    const normalized = normalizeIncomingOrder(order);
    const id = getOrderMongoId(normalized) || getOrderAcceptId(normalized);
    if (!id) {
      debugDeliveryPopup('selectIncomingOrder skipped: missing usable id', normalized);
      return;
    }
    debugDeliveryPopup('selectIncomingOrder', {
      selectedId: id,
      displayId: getOrderAcceptId(normalized),
    });
    lockedIncomingOrderIdRef.current = id;
    setSelectedIncomingId(id);
  }, []);

  const syncSelectionAfterQueueChange = useCallback((nextQueue) => {
    setSelectedIncomingId((currentSelected) => {
      const stillExists = (nextQueue || []).some(
        (item) =>
          currentSelected &&
          ((getOrderMongoId(item) || getOrderAcceptId(item)) === currentSelected ||
            isSameOrder(item, { orderMongoId: currentSelected, _id: currentSelected, orderId: currentSelected })),
      );
      if (stillExists) {
        debugDeliveryPopup('syncSelectionAfterQueueChange keeping current selection', {
          currentSelected,
          queueSize: nextQueue?.length || 0,
        });
        return currentSelected;
      }
      const nextId = nextQueue?.[0] ? (getOrderMongoId(nextQueue[0]) || getOrderAcceptId(nextQueue[0])) : null;
      debugDeliveryPopup('syncSelectionAfterQueueChange switching selection', {
        previousSelected: currentSelected,
        nextSelected: nextId,
        queueSize: nextQueue?.length || 0,
      });
      lockedIncomingOrderIdRef.current = nextId;
      return nextId;
    });
  }, []);
  const [cashLimitNotice, setCashLimitNotice] = useState(null);
  const [currentTab, setCurrentTab] = useState(tab);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  
  // Track URL changes (Prop changes) to update sub-page content
  useEffect(() => {
    setCurrentTab(tab);
  }, [tab]);

  const [showVerification, setShowVerification] = useState(false);
  const [showEmergencyPopup, setShowEmergencyPopup] = useState(false);
  const [profileImage, setProfileImage] = useState(null);
  const [emergencyNumbers, setEmergencyNumbers] = useState({
    medicalEmergency: "",
    accidentHelpline: "",
    contactPolice: "",
    insurance: "",
    teamLeader: "",
  });
  
  const [isModalMinimized, setIsModalMinimized] = useState(false);
  const [eta, setEta] = useState(null);
  const lastLocationSentAt = useRef(0);
  const lastHttpSyncAt = useRef(0);
  const lastCoordRef = useRef(null);
  const rollingSpeedRef = useRef([]);
  const lastAutoArrivalRef = useRef({ PICKING_UP: false, PICKED_UP: false });

  const [zoom, setZoom] = useState(14);
  const [isSimMode, setIsSimMode] = useState(false);
  const [simPath, setSimPath] = useState([]);
  const [simIndex, setSimIndex] = useState(0);
  const [simProgress, setSimProgress] = useState(0); // 0 to 1 between points
  const [activePolyline, setActivePolyline] = useState(null);
  const lastEmittedPolylineRef = useRef('');
  const mapRef = useRef(null);
  const simInitializedRef = useRef(false);

  const resolveActiveOrderMeta = useCallback(() => {
    if (!activeOrder) return null;
    return {
      orderId: getOrderMongoId(activeOrder) || getOrderAcceptId(activeOrder),
      userId:
        activeOrder.userId?._id?.toString?.() ||
        activeOrder.userId?.toString?.() ||
        activeOrder.user?._id?.toString?.() ||
        activeOrder.user?.id ||
        activeOrder.userId,
      restaurantId:
        activeOrder.restaurantId?._id?.toString?.() ||
        activeOrder.restaurantId?.toString?.() ||
        activeOrder.restaurantId,
    };
  }, [activeOrder]);

  const pushRoutePolylineToCustomer = useCallback((polyline) => {
    const encoded = typeof polyline === 'string' ? polyline : polyline?.points || '';
    if (!encoded) return;

    const meta = resolveActiveOrderMeta();
    if (!meta?.orderId) return;

    if (encoded === lastEmittedPolylineRef.current) return;
    lastEmittedPolylineRef.current = encoded;

    const coords = lastCoordRef.current || riderLocation;
    if (!coords || coords.lat == null || coords.lng == null) return;

    emitLocation({
      ...meta,
      lat: coords.lat,
      lng: coords.lng,
      heading: coords.heading || 0,
      polyline: encoded,
      status: tripStatus,
      eta,
    });
  }, [resolveActiveOrderMeta, riderLocation, emitLocation, tripStatus, eta]);

  useEffect(() => {
    lastEmittedPolylineRef.current = '';
  }, [activeOrder?._id, tripStatus]);

  const isLoggingOut = useRef(false);
  const handleLogout = useCallback(() => {
    if (isLoggingOut.current) return;
    isLoggingOut.current = true;
    
    // 1. Clear tokens and state
    localStorage.removeItem('delivery_accessToken');
    localStorage.removeItem('delivery_refreshToken');
    localStorage.removeItem('delivery_authenticated');
    localStorage.removeItem('delivery_user');
    
    // 2. Alert user and redirect
    toast.error("Session Expired", { description: "Please log in again." });
    navigate("/food/delivery/login", { replace: true });

    // Optional: Full refresh after delay ONLY if we're not already on login
    setTimeout(() => {
       if (!window.location.pathname.includes('/login')) {
          window.location.reload();
       }
    }, 1500);
  }, [navigate]);

  useEffect(() => {
    const onAuthFailure = (e) => {
      if (e.detail?.module === 'delivery') {
        handleLogout();
      }
    };
    window.addEventListener('authRefreshFailed', onAuthFailure);
    return () => window.removeEventListener('authRefreshFailed', onAuthFailure);
  }, [handleLogout]);

  // 0. Auto-Simulation Effect (High-Precision Smooth Glide)
  const lastSimUpdateSentAt = useRef(0);
  useEffect(() => {
    let interval;
    if (isSimMode && simPath.length > 1 && simIndex < simPath.length - 1) {
      console.log('[SimAuto] Glide Active âˆš');
      
      interval = setInterval(() => {
        setSimProgress(prev => {
          const nextProgress = prev + 0.08; // 8% movement per tick
          
          if (nextProgress >= 1) {
            setSimIndex(idx => idx + 1);
            return 0; // Move to next segment
          }

          const currentPoint = simPath[simIndex];
          const nextPoint = simPath[simIndex + 1];

          if (currentPoint && nextPoint) {
            // Linear Interpolation (LERP)
            const lat = currentPoint.lat + (nextPoint.lat - currentPoint.lat) * nextProgress;
            const lng = currentPoint.lng + (nextPoint.lng - currentPoint.lng) * nextProgress;
            const heading = calculateHeading(currentPoint.lat, currentPoint.lng, nextPoint.lat, nextPoint.lng);

            setRiderLocation({ lat, lng, heading });

            if (mapRef.current) {
              mapRef.current.panTo({ lat, lng });
            }

            // Sync with backend every 2.5 seconds during simulation so customer sees it
            const now = Date.now();
            if (now - lastSimUpdateSentAt.current >= 2000) { // Reduced to 2s to match backend throttle
              lastSimUpdateSentAt.current = now;
              const payload = { 
                lat, 
                lng, 
                heading, 
                ...(resolveActiveOrderMeta() || {}),
                status: 'on_the_way',
                polyline: activePolyline,
                eta,
              };
              if (payload.orderId) emitLocation(payload);
            }
          }
          return nextProgress;
        });
      }, 50); // 20 FPS movement
    }
    return () => clearInterval(interval);
  }, [isSimMode, simPath, simIndex, activeOrder, emitLocation, activePolyline, eta, tripStatus, resolveActiveOrderMeta]);

  // Fetch Emergency numbers and Profile (Restored logic)
  useEffect(() => {
    (async () => {
      try {
        const [emergencyRes, profileRes] = await Promise.all([
          deliveryAPI.getEmergencyHelp(),
          deliveryAPI.getProfile()
        ]);
        if (emergencyRes?.data?.success && emergencyRes.data.data) {
          setEmergencyNumbers(emergencyRes.data.data);
        }
        if (profileRes?.data?.success && profileRes.data.data?.profile) {
          const profile = profileRes.data.data.profile;
          setProfileImage(profile.profileImage?.url || profile.documents?.photo || null);
        }
      } catch (err) { console.warn('Navbar Data Fetch Error:', err); }
    })();
  }, []);

  const emergencyOptions = [
    { title: "Medical Emergency", subtitle: "Call an ambulance", icon: <AlertTriangle className="text-red-600" />, phone: emergencyNumbers.medicalEmergency },
    { title: "Accident Helpline", subtitle: "Report an accident", icon: <AlertTriangle className="text-orange-600" />, phone: emergencyNumbers.accidentHelpline },
    { title: "Contact Police", subtitle: "Nearest police support", icon: <AlertTriangle className="text-blue-600" />, phone: emergencyNumbers.contactPolice },
    { title: "Insurance", subtitle: "Policy & claim help", icon: <AlertTriangle className="text-green-600" />, phone: emergencyNumbers.insurance },
    { title: "Team Leader", subtitle: "Contact your assigned team leader", icon: <UserIcon className="text-purple-600" />, phone: emergencyNumbers.teamLeader },
  ];

  // Reset simulation when trip phase/order/mode changes.
  // Do not reset on each route refresh, otherwise marker appears frozen.
  useEffect(() => {
    if (isSimMode) {
      console.log('[SimAuto] Resetting simulation playhead...');
      setSimIndex(0);
      setSimProgress(0);
      simInitializedRef.current = false;
    } else {
      simInitializedRef.current = false;
    }
  }, [tripStatus, isSimMode, activeOrder?._id]);

  // Ensure simulation starts from the first route point once route is ready.
  useEffect(() => {
    if (!isSimMode || simInitializedRef.current || simPath.length < 2) return;
    const start = simPath[0];
    if (
      start &&
      Number.isFinite(Number(start.lat)) &&
      Number.isFinite(Number(start.lng))
    ) {
      setRiderLocation({ lat: Number(start.lat), lng: Number(start.lng), heading: 0 });
      simInitializedRef.current = true;
    }
  }, [isSimMode, simPath, setRiderLocation]);

  // Fallback path for simulation when Directions API doesn't return a usable path.
  useEffect(() => {
    if (!isSimMode || simPath.length > 1 || !activeOrder) return;

    const parsePoint = (raw) => {
      if (!raw) return null;
      const lat = Number(raw.lat ?? raw.latitude);
      const lng = Number(raw.lng ?? raw.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    };

    const rider = useDeliveryStore.getState().riderLocation;
    const riderPoint = parsePoint(rider);
    const targetPoint =
      tripStatus === 'PICKED_UP' || tripStatus === 'REACHED_DROP'
        ? parsePoint(activeOrder.customerLocation)
        : parsePoint(activeOrder.restaurantLocation);

    if (!riderPoint || !targetPoint) return;

    const distance = getHaversineDistance(
      riderPoint.lat,
      riderPoint.lng,
      targetPoint.lat,
      targetPoint.lng,
    );
    if (!Number.isFinite(distance) || distance < 10) return;

    const steps = 60;
    const fallbackPath = Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps;
      return {
        lat: riderPoint.lat + (targetPoint.lat - riderPoint.lat) * t,
        lng: riderPoint.lng + (targetPoint.lng - riderPoint.lng) * t,
      };
    });

    setSimPath(fallbackPath);
  }, [isSimMode, simPath, activeOrder, tripStatus]);

  const openCustomerDropInMaps = useCallback((order) => {
    if (!order) return;

    const customerCoords =
      parseLatLng(order.customerLocation) ||
      parseLatLng(order.customer_location) ||
      parseLatLng(order.deliveryAddress?.location) ||
      parseLatLng(order.deliveryAddress);

    const restaurantCoords =
      parseLatLng(order.restaurantLocation) ||
      parseLatLng(order.restaurant_location) ||
      parseLatLng(order.restaurantId?.location) ||
      parseLatLng(order.restaurantId);

    if (customerCoords && restaurantCoords) {
      const { lat: rLat, lng: rLng } = restaurantCoords;
      const { lat: cLat, lng: cLng } = customerCoords;
      window.open(
        `https://www.google.com/maps/dir/?api=1&origin=${rLat},${rLng}&destination=${cLat},${cLng}&travelmode=driving`,
        '_blank',
      );
      return;
    }

    if (customerCoords) {
      const { lat, lng } = customerCoords;
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
        '_blank',
      );
      return;
    }

    const address =
      order.customerAddress ||
      order.deliveryAddress?.street ||
      [
        order.deliveryAddress?.street,
        order.deliveryAddress?.additionalDetails,
        order.deliveryAddress?.city,
        order.deliveryAddress?.state,
      ]
        .filter(Boolean)
        .join(', ') ||
      'Customer Location';

    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
      '_blank',
    );
  }, []);

  // Auto-restore modal when status or content changes
  useEffect(() => {
    debugDeliveryPopup('auto-restoring modal state', {
      tripStatus,
      showVerification,
      incomingOrderId: getOrderMongoId(incomingOrder) || getOrderAcceptId(incomingOrder),
    });
    setIsModalMinimized(false);
  }, [tripStatus, showVerification, incomingOrder]);

  // 1. Initial Sync (Force sync with server to avoid 'stuck' persistent state)
  useEffect(() => {
    const syncWithServer = async () => {
      try {
        const response = await deliveryAPI.getCurrentDelivery();
        const rawData = response?.data?.data?.activeOrder || response?.data?.data;
        const serverData = (rawData && (rawData._id || rawData.orderId)) ? rawData : null;
        
        if (serverData) {
          setActiveOrder(normalizeDeliveryActiveOrder(serverData));
          
          const backendStatus = serverData.deliveryStatus || serverData.orderState?.status || serverData.orderStatus || serverData.status;
          const currentPhase = serverData.deliveryState?.currentPhase;

          if (['delivered', 'completed', 'DELIVERED'].includes(backendStatus)) {
            updateTripStatus('COMPLETED');
          } else if (currentPhase === 'at_drop' || ['reached_drop', 'REACHED_DROP'].includes(backendStatus)) {
            updateTripStatus('REACHED_DROP');
          } else if (['picked_up', 'PICKED_UP', 'delivering'].includes(backendStatus)) {
            updateTripStatus('PICKED_UP');
          } else if (currentPhase === 'at_pickup' || ['reached_pickup', 'REACHED_PICKUP'].includes(backendStatus)) {
            updateTripStatus('REACHED_PICKUP');
          } else if (['confirmed', 'preparing', 'ready_for_pickup'].includes(backendStatus)) {
            updateTripStatus('PICKING_UP');
          }
        } else {
          clearActiveOrder();
        }
      } catch (err) { 
        console.error('Order Sync Failed:', err); 
        clearActiveOrder();
      }
    };
    syncWithServer();
  }, []); // Only on mount to stabilize state
  
  // 1.5 Professional Unified ETA Calculation Hook
  useEffect(() => {
    // If we have distance, calculate ETA. Fallback to 8m/s (28km/h) avg if GPS speed is unknown.
    if (distanceToTarget != null && distanceToTarget !== Infinity) {
      const avgSpeed = rollingSpeedRef.current.length > 0 
        ? rollingSpeedRef.current.reduce((a, b) => a + b, 0) / rollingSpeedRef.current.length 
        : 8;
      
      setEta(calculateETA(distanceToTarget, avgSpeed));
    } else {
      setEta(null);
    }
  }, [distanceToTarget]);

  // 2. Online/Offline Status Sync (Low Frequency)
  useEffect(() => {
    deliveryAPI.updateOnlineStatus(isOnline).catch(() => {});

    const partnerId = getDeliveryPartnerId();
    if (!partnerId) return;

    const coords = lastCoordRef.current || riderLocation;
    void writeDeliveryLocation({
      deliveryId: partnerId,
      lat: coords?.lat,
      lng: coords?.lng,
      heading: coords?.heading || 0,
      isOnline,
      status: isOnline ? "online" : "offline",
      activeOrderId: activeOrder?._id || activeOrder?.orderId || null,
    });
  }, [isOnline, riderLocation, activeOrder?._id, activeOrder?.orderId]);

  // 3. Location logic (Smart Frequency Tracking)
  useEffect(() => {
    if (!isOnline) {
      return;
    }
    
    const watchId = navigator.geolocation.watchPosition((pos) => {
      // CRITICAL: In Simulation Mode, we disable actual GPS to prevent overwriting our test position
      if (isSimMode) return;
      
      const { latitude: lat, longitude: lng, heading, speed } = pos.coords;
      const now = Date.now();
      
      const currentRiderPos = { lat, lng, heading: heading || 0 };
      setRiderLocation(currentRiderPos);
      
      // Calculate Rolling Average Speed for Smart ETA
      if (speed && speed > 0) {
        rollingSpeedRef.current = [...rollingSpeedRef.current.slice(-4), speed]; // keep last 5 points
      }

      const avgSpeed = rollingSpeedRef.current.length > 0 
        ? rollingSpeedRef.current.reduce((a, b) => a + b, 0) / rollingSpeedRef.current.length 
        : speed || 0;

      // Phase 11: Geo-fencing Auto-arrival (within 100m) - Disabled in DEV so UI steps can be tested manually
      if (!isSimMode && !import.meta.env.DEV && distanceToTarget && distanceToTarget <= 100 && !lastAutoArrivalRef.current[tripStatus]) {
        if (tripStatus === 'PICKING_UP') {
          lastAutoArrivalRef.current[tripStatus] = true;
          reachPickup().catch(() => { lastAutoArrivalRef.current[tripStatus] = false; });
        } else if (tripStatus === 'PICKED_UP') {
          lastAutoArrivalRef.current[tripStatus] = true;
          reachDrop().catch(() => { lastAutoArrivalRef.current[tripStatus] = false; });
        }
      }

      if (distanceToTarget > 200) {
        lastAutoArrivalRef.current[tripStatus] = false;
      }

      // Check threshold for Socket Sync (distance-based or 10s time-based)
      // NOTE: Customer tracking UI uses 60 FPS interpolation (Glide), so 10s intervals
      // still appear perfectly smooth on the map. This reduces server load by ~70%.
      const distMoved = lastCoordRef.current 
        ? getHaversineDistance(lat, lng, lastCoordRef.current.lat, lastCoordRef.current.lng) 
        : 1000;

      if (distMoved >= 50 || (now - lastLocationSentAt.current >= 10000)) {
        lastLocationSentAt.current = now;
        lastCoordRef.current = { lat, lng };
        
        const payload = { 
          lat, 
          lng, 
          heading: heading || 0,
          speed: speed || 0,
          accuracy: pos.coords.accuracy,
          ...(resolveActiveOrderMeta() || {}),
          status: 'on_the_way',
          polyline:
            typeof activePolyline === 'string'
              ? activePolyline
              : activePolyline?.points || activePolyline || null,
          eta,
        };

        if (payload.orderId) emitLocation(payload);

        const partnerId = getDeliveryPartnerId();
        if (partnerId) {
          void writeDeliveryLocation({
            deliveryId: partnerId,
            lat,
            lng,
            heading: heading || 0,
            speed: speed || 0,
            accuracy: pos.coords.accuracy,
            isOnline: true,
            status: "online",
            activeOrderId: payload.orderId || null,
          });
        }
      }

      if (now - lastHttpSyncAt.current >= 45000) {
        lastHttpSyncAt.current = now;
        deliveryAPI.updateLocation(lat, lng, true, { heading: heading || 0, speed: speed || 0, accuracy: pos.coords.accuracy }).catch(() => {});
      }
    }, () => {
      // IF GPS FAILS/DENIED: Use Indore as a fallback for testing
      console.warn('GPS Denied - Falling back to Indore for testing');
      const fallbackPos = { lat: 22.7196, lng: 75.8577, heading: 0 };
      if (!riderLocation) {
        setRiderLocation(fallbackPos);
      }
      toast.error('GPS Blocked!', { description: 'Showing test location in Indore.' });
    }, { 
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 10000
    });
    
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isOnline, setRiderLocation, isSimMode]);

  // Refresh GPS when returning from external apps (e.g. Google Maps)
  useEffect(() => {
    if (!isOnline || isSimMode) return;

    const refreshLocation = () => {
      if (document.hidden) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng, heading } = pos.coords;
          setRiderLocation({ lat, lng, heading: heading || 0 });
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
      );
    };

    document.addEventListener('visibilitychange', refreshLocation);
    window.addEventListener('focus', refreshLocation);
    return () => {
      document.removeEventListener('visibilitychange', refreshLocation);
      window.removeEventListener('focus', refreshLocation);
    };
  }, [isOnline, isSimMode, setRiderLocation]);

  // Online heartbeat: keep rider visible in admin map / availability without per-tick HTTP.
  useEffect(() => {
    if (!isOnline) return;
    
    const pingInterval = setInterval(() => {
      const now = Date.now();
      if (now - lastHttpSyncAt.current >= 45000 && lastCoordRef.current) {
        lastHttpSyncAt.current = now;
        deliveryAPI.updateLocation(
          lastCoordRef.current.lat, 
          lastCoordRef.current.lng, 
          true, 
          { heading: 0, speed: 0, accuracy: null }
        ).catch(() => {});

        const partnerId = getDeliveryPartnerId();
        if (partnerId) {
          void writeDeliveryLocation({
            deliveryId: partnerId,
            lat: lastCoordRef.current.lat,
            lng: lastCoordRef.current.lng,
            isOnline: true,
            status: "online",
          });
        }
      }
    }, 45000);
    
    return () => clearInterval(pingInterval);
  }, [isOnline]);


  // GHOST-ASSIGNMENT FIX: When a new socket/FCM order arrives:
  // - If no popup is currently showing â†’ display it immediately.
  // - If a popup IS already showing (lock is set) â†’ queue it as pending. DO NOT overwrite the visible popup.
  //   This ensures the rider always accepts the order whose details are physically visible on screen.
  useEffect(() => {
    const onPendingOffers = (event) => {
      const offers = event.detail?.offers || [];
      if (!offers.length) return;

      debugDeliveryPopup('deliveryPendingOffers received', {
        offerIds: offers.map((offer) => getOrderMongoId(offer) || getOrderAcceptId(offer)),
        count: offers.length,
      });

      setIncomingOrders((prev) => {
        let next = prev;
        offers.forEach((offer) => {
          next = upsertIncomingOrderInQueue(next, offer);
        });
        debugDeliveryPopup('deliveryPendingOffers queue updated', {
          previousQueueIds: prev.map((item) => getOrderMongoId(item) || getOrderAcceptId(item)),
          nextQueueIds: next.map((item) => getOrderMongoId(item) || getOrderAcceptId(item)),
        });
        return next;
      });

      setSelectedIncomingId((prev) => {
        if (prev) {
          debugDeliveryPopup('deliveryPendingOffers keeping existing selectedIncomingId', { selectedIncomingId: prev });
          return prev;
        }
        const firstId = getOrderMongoId(offers[0]) || getOrderAcceptId(offers[0]);
        debugDeliveryPopup('deliveryPendingOffers selecting first offer', { firstId });
        lockedIncomingOrderIdRef.current = firstId || null;
        return firstId;
      });
    };

    window.addEventListener('deliveryPendingOffers', onPendingOffers);
    return () => window.removeEventListener('deliveryPendingOffers', onPendingOffers);
  }, []);

  useEffect(() => {
    if (newOrder === undefined || newOrder === null) return;

    const normalized = normalizeIncomingOrder(newOrder);
    const newId = getOrderMongoId(normalized) || getOrderAcceptId(normalized);
    debugDeliveryPopup('newOrder effect triggered', {
      newId,
      displayId: getOrderAcceptId(normalized),
      hasMongoId: Boolean(getOrderMongoId(normalized)),
    });
    if (!newId) {
      debugDeliveryPopup('newOrder ignored because usable id is missing', normalized);
      return;
    }

    setIncomingOrders((prev) => {
      const wasInQueue = prev.some((item) => isSameOrder(item, normalized));
      const next = upsertIncomingOrderInQueue(prev, normalized);
      debugDeliveryPopup('newOrder queue updated', {
        wasInQueue,
        previousQueueIds: prev.map((item) => getOrderMongoId(item) || getOrderAcceptId(item)),
        nextQueueIds: next.map((item) => getOrderMongoId(item) || getOrderAcceptId(item)),
      });
      return next;
    });

    setSelectedIncomingId((prev) => {
      if (prev) {
        debugDeliveryPopup('newOrder keeping existing selectedIncomingId', { selectedIncomingId: prev, incomingId: newId });
        return prev;
      }
      debugDeliveryPopup('newOrder selecting incoming order', { selectedIncomingId: newId });
      lockedIncomingOrderIdRef.current = newId;
      return newId;
    });
  }, [newOrder]);

  const prevIncomingOrderRef = useRef(null);
  useEffect(() => {
    prevIncomingOrderRef.current = incomingOrder;
  }, [incomingOrder]);

  useEffect(() => {
    const popupOrderId = getOrderMongoId(incomingOrder) || getOrderAcceptId(incomingOrder) || null;
    const popupVisible = Boolean(!isModalMinimized && incomingOrder);
    debugDeliveryPopup('popup state snapshot', {
      popupVisible,
      isModalMinimized,
      popupOrderId,
      selectedIncomingId,
      queueSize: incomingOrders.length,
      queueIds: incomingOrders.map((item) => getOrderMongoId(item) || getOrderAcceptId(item)),
      hasActiveOrder: Boolean(activeOrder),
      showVerification,
      socketConnected: isSocketConnected,
      riderOnline: isOnline,
    });
  }, [incomingOrder, incomingOrders, selectedIncomingId, isModalMinimized, activeOrder, showVerification, isSocketConnected, isOnline]);

  useEffect(() => {
    if (!incomingOrder) {
      debugDeliveryPopup('popup closed - no incoming order available', {
        isModalMinimized,
        selectedIncomingId,
        queueSize: incomingOrders.length,
      });
      return;
    }

    debugDeliveryPopup('popup order ready for modal render', {
      popupOrderId: getOrderMongoId(incomingOrder) || getOrderAcceptId(incomingOrder),
      displayId: getOrderAcceptId(incomingOrder),
      isModalMinimized,
      queueSize: incomingOrders.length,
      selectedIncomingId,
    });
  }, [incomingOrder, isModalMinimized, incomingOrders.length, selectedIncomingId]);

  const dismissCurrentIncomingOrder = useCallback(() => {
    if (!incomingOrder) {
      setIncomingOrders([]);
      setSelectedIncomingId(null);
      lockedIncomingOrderIdRef.current = null;
      clearNewOrder();
      return;
    }

    setIncomingOrders((prev) => {
      const next = removeIncomingOrderFromQueue(prev, incomingOrder);
      syncSelectionAfterQueueChange(next);
      return next;
    });
    clearNewOrder();
  }, [incomingOrder, clearNewOrder, syncSelectionAfterQueueChange]);

  const clearAllIncomingOrders = useCallback(() => {
    setIncomingOrders([]);
    setSelectedIncomingId(null);
    lockedIncomingOrderIdRef.current = null;
    clearNewOrder();
  }, [clearNewOrder]);

  const removeClaimedOrderFromQueue = useCallback(
    (claimedRef, { notify = true } = {}) => {
      const claimedTarget = {
        orderMongoId: claimedRef?.orderMongoId || claimedRef?.orderId || claimedRef?._id,
        orderId: claimedRef?.orderId,
        _id: claimedRef?._id,
      };

      const wasVisible =
        incomingOrder && isSameOrder(incomingOrder, claimedTarget);
      const wasQueued = incomingOrders.some(
        (item) =>
          isSameOrder(item, claimedTarget) &&
          incomingOrder &&
          !isSameOrder(item, incomingOrder),
      );

      setIncomingOrders((prev) => {
        const next = removeIncomingOrderFromQueue(prev, claimedTarget);
        syncSelectionAfterQueueChange(next);
        return next;
      });

      if (notify && wasVisible) {
        if (claimedRef?.claimedBy === 'cancelled') {
          toast.error('Order was cancelled.', { duration: 4000 });
        } else {
          toast.info('Order was taken by another delivery partner.', { duration: 4000 });
        }
      } else if (notify && wasQueued) {
        toast.info('One of your queued orders was taken.', { duration: 3000 });
      }

      clearNewOrder();
    },
    [incomingOrder, incomingOrders, syncSelectionAfterQueueChange, clearNewOrder],
  );

  useEffect(() => {
    if (selectedIncomingId) {
      debugDeliveryPopup('selectedIncomingId updated', { selectedIncomingId });
      lockedIncomingOrderIdRef.current = selectedIncomingId;
    } else {
      debugDeliveryPopup('selectedIncomingId cleared');
    }
  }, [selectedIncomingId]);

  useEffect(() => {
    if (activeOrder && incomingOrders.length > 0) {
      clearAllIncomingOrders();
    }
  }, [activeOrder, incomingOrders.length, clearAllIncomingOrders]);

  useEffect(() => {
    if (!claimedOrderId?.orderId && !claimedOrderId?.orderMongoId) return;

    const token = localStorage.getItem('delivery_accessToken') || '';
    let myUserId = null;
    try {
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        myUserId = payload.userId;
      }
    } catch (e) {}

    const claimedRef = {
      orderId: claimedOrderId.orderId,
      orderMongoId: claimedOrderId.orderMongoId || claimedOrderId.orderId,
      _id: claimedOrderId.orderMongoId || claimedOrderId.orderId,
      claimedBy: claimedOrderId.claimedBy,
    };

    if (claimedOrderId.claimedBy && String(claimedOrderId.claimedBy) === String(myUserId)) {
      removeClaimedOrderFromQueue(claimedRef, { notify: false });
      clearClaimedOrderId();
      return;
    }

    const inQueue = incomingOrders.some((item) => isSameOrder(item, claimedRef));
    if (inQueue) {
      removeClaimedOrderFromQueue(claimedRef, { notify: true });
    }

    clearClaimedOrderId();
  }, [claimedOrderId, incomingOrders, removeClaimedOrderFromQueue, clearClaimedOrderId]);

  useEffect(() => {
    if (!isOnline) return;
    if (currentTab !== 'feed') return;
    if (activeOrder) return;

    let cancelled = false;

    const hydrateAvailableOrder = async () => {
      try {
        const currentResponse = await deliveryAPI.getCurrentDelivery();
        const currentPayload =
          currentResponse?.data?.data?.activeOrder ||
          currentResponse?.data?.data ||
          null;

        if (!cancelled && currentPayload && (currentPayload._id || currentPayload.orderId)) {
          setActiveOrder(normalizeDeliveryActiveOrder(currentPayload));

          // Sync status with server
          const backendStatus = String(currentPayload.deliveryStatus || currentPayload.orderState?.status || currentPayload.orderStatus || currentPayload.status || "").toLowerCase();
          const currentPhase = currentPayload.deliveryState?.currentPhase;

          if (['delivered', 'completed'].includes(backendStatus)) {
            updateTripStatus('COMPLETED');
          } else if (currentPhase === 'at_drop' || backendStatus === 'reached_drop') {
            updateTripStatus('REACHED_DROP');
          } else if (['picked_up', 'delivering'].includes(backendStatus)) {
            updateTripStatus('PICKED_UP');
          } else if (currentPhase === 'at_pickup' || backendStatus === 'reached_pickup') {
            updateTripStatus('REACHED_PICKUP');
          } else if (['confirmed', 'preparing', 'ready_for_pickup'].includes(backendStatus)) {
             // Only set to PICKING_UP if we aren't already further ahead
             if (tripStatus === 'IDLE') updateTripStatus('PICKING_UP');
          }
          return;
        }

        const availableResponse = await deliveryAPI.getOrders({ limit: 20, page: 1 });
        const availablePayload =
          availableResponse?.data?.data ||
          availableResponse?.data ||
          {};
        const availableOrders = Array.isArray(availablePayload?.docs)
          ? availablePayload.docs
          : Array.isArray(availablePayload?.items)
            ? availablePayload.items
            : Array.isArray(availablePayload)
              ? availablePayload
              : [];

        const nextCashLimitNotice =
          availablePayload?.cashLimit?.blocked ? availablePayload.cashLimit : null;
        if (!cancelled) setCashLimitNotice(nextCashLimitNotice);

        const availableIncoming = availableOrders
          .map((order) => normalizeIncomingOrder(order))
          .filter((order) => {
            const dispatchStatus = String(order?.dispatch?.status || '').toLowerCase();
            const orderStatus = String(order?.orderStatus || order?.status || '').toLowerCase();
            return (
              ['unassigned', 'assigned'].includes(dispatchStatus) &&
              ['confirmed', 'preparing', 'ready_for_pickup'].includes(orderStatus)
            );
          });

        if (!cancelled && availableIncoming.length > 0) {
          setCashLimitNotice(null);
          setIncomingOrders((prev) => {
            let next = prev;
            availableIncoming.forEach((order) => {
              next = upsertIncomingOrderInQueue(next, order);
            });
            return next;
          });
          setSelectedIncomingId((prev) => {
            if (prev) return prev;
            const firstId = getOrderMongoId(availableIncoming[0]);
            lockedIncomingOrderIdRef.current = firstId || null;
            return firstId;
          });
        }
      } catch (error) {
        console.warn('[DeliveryHomeV2] Available order fallback sync failed:', error?.message || error);
      }
    };

    void hydrateAvailableOrder();
    const poller = window.setInterval(() => {
      if (!document.hidden) {
        void hydrateAvailableOrder();
      }
    }, isSocketConnected ? 45000 : 15000);

    return () => {
      cancelled = true;
      window.clearInterval(poller);
    };
  }, [activeOrder, currentTab, isOnline, isSocketConnected, setActiveOrder, tripStatus, updateTripStatus]);

  useEffect(() => {
    if (!orderStatusUpdate) return;

    if (orderStatusUpdate.status === 'cancelled') {
      toast.error('Order cancelled');
      resetTrip();
      clearOrderStatusUpdate();
      return;
    }

    if (
      orderStatusUpdate.recoverySource === 'socket_resync' ||
      orderStatusUpdate.recoverySource === 'delivery_reconnect'
    ) {
      const payload = orderStatusUpdate;
      if (payload && (payload._id || payload.orderId || payload.orderMongoId)) {
        setActiveOrder(normalizeDeliveryActiveOrder(payload));
        const backendStatus = String(
          payload.deliveryStatus || payload.orderStatus || payload.status || '',
        ).toLowerCase();
        if (['delivered', 'completed'].includes(backendStatus)) {
          updateTripStatus('COMPLETED');
        } else if (['picked_up', 'delivering'].includes(backendStatus)) {
          updateTripStatus('PICKED_UP');
        } else if (backendStatus === 'reached_pickup' || payload.deliveryState?.currentPhase === 'at_pickup') {
          updateTripStatus('REACHED_PICKUP');
        } else {
          updateTripStatus('PICKING_UP');
        }
      }
    }

    clearOrderStatusUpdate();
  }, [orderStatusUpdate, resetTrip, clearOrderStatusUpdate, setActiveOrder, updateTripStatus]);

  // Handle auto-killed order reasoning
  useEffect(() => {
    if (autoKilledOrder) {
      setTimeout(() => {
        const reason = window.prompt("Your order exceeded the 1 hour limit and was cancelled by the system. Please provide a reason for the failure/delay:");
        if (reason && reason.trim() !== "") {
          deliveryAPI.rejectOrder(autoKilledOrder.orderId || autoKilledOrder.orderMongoId || autoKilledOrder._id, { reason })
            .then(() => toast.success("Reason saved successfully."))
            .catch(() => toast.error("Failed to save reason."));
        } else {
          toast.error("You must provide a reason for the delayed delivery.");
        }
        clearAutoKilledOrder();
      }, 500); // small delay to ensure UI doesn't block the unmount of previous modals
    }
  }, [autoKilledOrder, clearAutoKilledOrder]);

  // Handle Real-time Admin Notifications
  useEffect(() => {
    if (adminNotification) {
      toast.info(adminNotification.title || "New Notification", {
        description: adminNotification.message || adminNotification.body || "",
        duration: 8000,
        action: {
          label: "View",
          onClick: () => setShowNotifications(true)
        }
      });
      clearAdminNotification();
    }
  }, [adminNotification, clearAdminNotification]);


  const handleCenterMap = () => {
    if (mapRef.current && useDeliveryStore.getState().riderLocation) {
      const loc = useDeliveryStore.getState().riderLocation;
      mapRef.current.panTo({ 
        lat: parseFloat(loc.lat || loc.latitude), 
        lng: parseFloat(loc.lng || loc.longitude) 
      });
    }
  };

  const handleMapClick = (lat, lng) => {
    if (activeOrder || incomingOrder || showVerification) {
      setIsModalMinimized(true);
    }
  };

  return (
    <div className="relative h-screen w-full bg-white text-gray-900 overflow-hidden flex flex-col">
      {/* â”€â”€â”€ 1. TOP HEADER (Dynamic Theme Gradient) â”€â”€â”€ */}
      {currentTab !== 'history' && currentTab !== 'profile' && currentTab !== 'pocket' && (
      <div 
        className="absolute top-0 inset-x-0 backdrop-blur-2xl shadow-2xl z-[200] safe-top pb-2 border-b border-white/10"
        style={{ backgroundColor: 'var(--dv-primary)' }}
      >
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-4">
             <div 
                onClick={() => navigate('/food/delivery/profile')}
                className="w-10 h-10 rounded-full border border-white/20 p-0.5 shadow-xl overflow-hidden bg-white/5 cursor-pointer active:scale-95 transition-all"
             >
                <img src={profileImage || "/delivery_avatar.png"} alt="Profile" className="w-full h-full object-cover rounded-full" />
             </div>
              <button 
                onClick={async () => {
                  const nextState = !isOnline;
                  if (nextState) {
                      if (!navigator.geolocation) {
                          toast.error("Geolocation is not supported by your browser.");
                          return;
                      }
                      
                      // Show a small loading state if needed, but since it's fast we just request
                      navigator.geolocation.getCurrentPosition(
                        () => {
                            // GPS is enabled and accessible
                            setShowPhotoModal(true);
                        },
                        (err) => {
                            // GPS is blocked or disabled
                            toast.error("Please enable your GPS for current location");
                        },
                        { timeout: 10000, enableHighAccuracy: true }
                      );
                  } else {
                      toggleOnline(); // Store action
                      deliveryAPI.updateOnlineStatus(false).catch(() => {});
                  }
                }}
                className={`delivery-online-toggle relative w-[92px] h-8 rounded-full p-1 transition-all duration-500 flex items-center ${isOnline ? 'is-online bg-green-500 shadow-lg shadow-green-500/20' : 'is-offline bg-green-400 shadow-lg shadow-green-400/20'}`}
              >
                <div className={`flex items-center justify-between w-full px-2 text-[8.5px] font-black uppercase tracking-widest text-white`}>
                  <span>{isOnline ? 'Online' : ''}</span>
                  <span>{!isOnline ? 'Offline' : ''}</span>
                </div>
                <motion.div animate={{ x: isOnline ? 59 : 0 }} className="absolute left-1 w-6 h-6 bg-white rounded-full shadow-sm" />
              </button>

              {/* DEV SIMULATION TOGGLE */}
              {import.meta.env.DEV && (
                 <button 
                   onClick={() => setIsSimMode(!isSimMode)}
                   className={`px-3 h-8 rounded-lg text-[9px] font-black border transition-all ${isSimMode ? 'bg-orange-500 border-orange-400 text-white animate-pulse' : 'bg-white/10 border-white/20 text-white/40'}`}
                 >
                   SIM
                 </button>
              )}
           </div>
          <div className="flex items-center gap-3">
             <button onClick={() => setShowEmergencyPopup(true)} className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 border border-red-500/20 active:scale-95 transition-all shadow-lg"><AlertTriangle className="w-4 h-4" /></button>
             <button onClick={() => navigate('/food/delivery/help/id-card')} className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20 active:scale-95 transition-all shadow-lg"><Contact className="w-4 h-4" /></button>
             <button onClick={() => setShowNotifications(true)} className="relative w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white border border-white/10 active:scale-95 transition-all shadow-lg">
                <Bell className="w-4 h-4" />
                {notificationUnreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-600 flex items-center justify-center text-[9px] font-black text-white border-2 border-[#121212] shadow-xl animate-in zoom-in duration-300">
                    {notificationUnreadCount > 9 ? '9+' : notificationUnreadCount}
                  </span>
                )}
             </button>
          </div>
        </div>

        {/* â”€â”€â”€ LIVE STATUS / PROGRESS BADGE (MATCHED PRO) â”€â”€â”€ */}
        <AnimatePresence>
          {currentTab === 'feed' && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="px-3 md:px-4 mt-1"
            >
              {activeOrder ? (
                <div className="grid grid-cols-2 gap-3 w-full">
                  {/* LEFT: DISTANCE (Vibrant Orange Card) */}
                  <div className="bg-primary rounded-2xl p-3.5 shadow-xl shadow-orange-500/20 border border-orange-400/50 flex items-center justify-between overflow-hidden relative">
                    <div className="flex flex-col z-10">
                      <span className="text-[9px] text-white/70 font-black uppercase tracking-[0.15em] mb-1">Distance</span>
                      <div className="flex items-end gap-1">
                        <span className="text-2xl font-black text-white leading-none tracking-tighter">
                          {distanceToTarget && distanceToTarget !== Infinity ? (distanceToTarget / 1000).toFixed(1) : '--'}
                        </span>
                        <span className="text-[11px] text-white/80 font-bold mb-0.5">KM</span>
                      </div>
                    </div>
                    <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center z-10 shadow-lg">
                      <Navigation2 className="w-4 h-4 text-primary rotate-45" />
                    </div>
                  </div>

                  {/* RIGHT: TIME (Emerald PRO Content) */}
                  <div className="bg-[#10B981] rounded-2xl p-3.5 shadow-xl shadow-green-500/20 border border-green-400/50 flex items-center justify-between relative overflow-hidden group">
                    <div className="flex flex-col z-10">
                      <span className="text-[9px] text-white/70 font-black uppercase tracking-[0.15em] mb-1">Arrival</span>
                      <div className="flex items-end gap-1">
                        <span className="text-2xl font-black text-white leading-none tracking-tighter">
                          {eta ? String(eta) : '--'}
                        </span>
                        <span className="text-[11px] text-white/80 font-bold mb-0.5">MIN</span>
                      </div>
                    </div>
                    <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center z-10 shadow-lg">
                       <Clock className="w-4 h-4 text-[#10B981]" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white/5 rounded-2xl p-4 flex items-center justify-between border border-white/5 shadow-sm backdrop-blur-md">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-green-500/10 rounded-full flex items-center justify-center shrink-0">
                      <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-white font-black text-[11px] uppercase tracking-widest leading-none mb-1">{isOnline ? 'System Online' : 'System Offline'}</h3>
                      <p className="text-gray-400 text-[10px] font-bold uppercase tracking-tight">{isOnline ? 'Waiting for order requests' : 'Go online to receive orders'}</p>
                    </div>
                  </div>
                  {emergencyNumbers.teamLeader && (
                    <div className="flex flex-col items-center justify-center ml-3 shrink-0">
                      <button 
                        onClick={() => window.location.href = `tel:${emergencyNumbers.teamLeader.replace(/\D/g, '')}`}
                        className="w-10 h-10 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 active:scale-95 transition-all shadow-lg"
                        title="Call Team Leader"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                      <span className="text-[8px] font-bold text-blue-300/80 uppercase mt-1 tracking-wider text-center">
                        Team Leader
                      </span>
                    </div>
                  )}
                </div>
              )}

              {!activeOrder && cashLimitNotice?.blocked && (
                <div className="mt-3 rounded-2xl border border-amber-300/40 bg-amber-500/10 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">
                    Cash Limit Alert
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-amber-100">
                    {cashLimitNotice?.message || 'Please deposit your amount to get orders.'}
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      )}

      <PhotoUploadModal 
        isOpen={showPhotoModal}
        onClose={() => setShowPhotoModal(false)}
        onUpload={async (base64Data, address) => {
          try {
            await deliveryAPI.updateOnlineStatus(true, base64Data, address);
            toggleOnline(); // update local store
            setShowPhotoModal(false);
            
            // Sync location immediately
            navigator.geolocation.getCurrentPosition((pos) => {
               deliveryAPI.updateLocation(pos.coords.latitude, pos.coords.longitude, true).catch(() => {});
            }, () => {}, { enableHighAccuracy: true });
            
            toast.success("Shift started successfully!");
          } catch (error) {
            console.error("Failed to start shift:", error);
            toast.error("Failed to start shift. Please try again.");
          }
        }}
      />

      {/* â”€â”€â”€ 2. MAIN CONTENT â”€â”€â”€ */}
      <div className={`flex-1 relative overflow-y-auto ${currentTab === 'history' || currentTab === 'profile' || currentTab === 'pocket' ? 'pt-0' : 'pt-[120px]'} no-scrollbar`}>
         {currentTab === 'feed' ? (
           <div className="absolute inset-0 top-[-120px]">
             {isOnline ? (
               <>
                 <LiveMap 
               onMapLoad={(m) => mapRef.current = m}
               onMapClick={handleMapClick}
               onPathReceived={setSimPath}
               onPolylineReceived={(poly) => {
                 setActivePolyline(poly);
                 pushRoutePolylineToCustomer(poly);
               }}
               zoom={zoom}
             />
             
             {/* SIMULATION INDICATOR */}
             {isSimMode && (
               <div className="absolute top-[180px] left-4 right-4 z-[100] bg-black/80 backdrop-blur-md rounded-xl p-4 border border-white/20 flex items-center justify-between shadow-2xl">
                  <div className="flex items-center gap-4">
                     <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center animate-pulse">
                        <Play className="w-4 h-4 text-white fill-current" />
                     </div>
                     <div className="flex flex-col">
                        <span className="text-orange-500 text-[10px] font-bold uppercase tracking-widest">Auto Navigation Active</span>
                        <span className="text-white text-[11px] font-medium">Following actual road path...</span>
                     </div>
                  </div>
                  <button onClick={() => setIsSimMode(false)} className="bg-white/10 text-white/50 hover:text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-white/10">Stop</button>
               </div>
             )}

             <div className="absolute right-4 bottom-28 md:bottom-32 flex flex-col gap-4 z-[120]">
                <div className="flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
                   <button onClick={() => setZoom(z => Math.min(22, z + 1))} className="p-3 hover:bg-gray-50 border-b border-gray-100 text-gray-900 active:scale-90 transition-all" aria-label="Zoom in"><Plus className="w-5 h-5 stroke-[2.75]" /></button>
                   <button onClick={() => setZoom(z => Math.max(8, z - 1))} className="p-3 hover:bg-gray-50 text-gray-900 active:scale-90 transition-all" aria-label="Zoom out"><Minus className="w-5 h-5 stroke-[2.75]" /></button>
                </div>
                <button 
                  onClick={() => {
                    const nextSimState = !isSimMode;
                    setIsSimMode(nextSimState);

                    if (nextSimState) {
                      toast.warning('Simulation Mode Active');

                      const parsePoint = (raw) => {
                        if (!raw) return null;
                        const lat = Number(raw.lat ?? raw.latitude);
                        const lng = Number(raw.lng ?? raw.longitude);
                        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                        return { lat, lng };
                      };

                      const target =
                        tripStatus === 'PICKED_UP' || tripStatus === 'REACHED_DROP'
                          ? parsePoint(activeOrder?.customerLocation)
                          : parsePoint(activeOrder?.restaurantLocation);

                      const currentRider = useDeliveryStore.getState().riderLocation;
                      const riderPoint = parsePoint(currentRider) || (target
                        ? { lat: target.lat + 0.001, lng: target.lng + 0.001 }
                        : null);

                      if (riderPoint) {
                        setRiderLocation({ lat: riderPoint.lat, lng: riderPoint.lng, heading: 0 });
                      }

                      if (riderPoint && target && (!simPath || simPath.length < 2)) {
                        const steps = 60;
                        const fallbackPath = Array.from({ length: steps + 1 }, (_, i) => {
                          const t = i / steps;
                          return {
                            lat: riderPoint.lat + (target.lat - riderPoint.lat) * t,
                            lng: riderPoint.lng + (target.lng - riderPoint.lng) * t,
                          };
                        });
                        setSimPath(fallbackPath);
                      }
                    }
                  }}
                  className={`w-14 h-14 rounded-full shadow-2xl flex items-center justify-center border border-gray-100 transition-all ${isSimMode ? 'bg-orange-500 text-white' : 'bg-white text-green-500'}`}
                >
                  <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${isSimMode ? 'border-white' : 'border-green-500'}`}>
                    <Play className={`w-4 h-4 fill-current ml-0.5 ${isSimMode ? 'animate-pulse' : ''}`} />
                  </div>
                </button>
                <button 
                   onClick={() => mapRef.current?.setOptions({ gestureHandling: 'greedy' })} 
                   className="w-14 h-14 bg-white rounded-full shadow-2xl flex items-center justify-center text-blue-600 border border-gray-100 active:scale-90 transition-all"
                >
                  <div className="w-8 h-8 rounded-full border-2 border-blue-600 flex items-center justify-center"><Navigation2 className="w-4 h-4" /></div>
                </button>
                <button 
                  onClick={handleCenterMap}
                  className="w-14 h-14 bg-white rounded-full shadow-2xl flex items-center justify-center text-gray-900 border border-gray-100 group active:scale-90 transition-all"
                >
                  <Target className="w-7 h-7" />
                </button>
             </div>
             </>
            ) : (
              <div className="w-full h-full bg-[#f8f9fa] flex flex-col items-center justify-center relative overflow-hidden">
                {/* CSS Static Map Background Pattern */}
                <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
                  backgroundImage: `radial-gradient(#000 2px, transparent 2px)`,
                  backgroundSize: '24px 24px'
                }}></div>
                {/* Fake Roads to simulate map */}
                <div className="absolute inset-0 opacity-[0.06] pointer-events-none">
                   <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                     <path d="M -100,200 Q 150,250 300,100 T 800,300" stroke="#000" strokeWidth="8" fill="none" />
                     <path d="M 200,-100 Q 250,150 100,300 T 300,800" stroke="#000" strokeWidth="6" fill="none" />
                     <path d="M 400,-100 Q 350,150 500,400 T 200,800" stroke="#000" strokeWidth="10" fill="none" />
                   </svg>
                </div>
                
                {/* Avatar / Offline State */}
                <div className="z-10 flex flex-col items-center mt-32 relative">
                   <div className="relative z-10 mt-10">
                     <div className="absolute inset-0 bg-blue-500/20 blur-[60px] rounded-full scale-150 pointer-events-none"></div>
                     <img 
                       src="/delivery_avatar.png" 
                       alt="Offline Rider" 
                       className="relative w-56 h-56 md:w-64 md:h-64 rounded-full object-cover object-top border-[8px] border-white shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
                       onError={(e) => {
                          e.target.src = 'https://cdn-icons-png.flaticon.com/512/2950/2950150.png';
                       }}
                     />
                   </div>
                   <div className="mt-8 bg-white/90 backdrop-blur-md px-8 py-5 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] text-center border border-gray-100/50">
                      <h2 className="text-gray-900 font-black uppercase tracking-widest text-lg">You are Offline</h2>
                      <p className="text-gray-500 font-bold text-xs uppercase tracking-wider mt-1.5">Go online to receive orders</p>
                   </div>
                </div>
              </div>
            )}
           </div>
         ) : currentTab === 'pocket' ? (
           <PocketV2 />
         ) : currentTab === 'history' ? (
           <HistoryV2 />
         ) : (
           <ProfileV2 />
         )}

         {/* OVERLAYS (Persistent if active) */}
      </div>

      {/* OVERLAYS (Persistent if active) - Outside flex container to avoid clipping and z-index issues */}
      {(currentTab === 'feed' || activeOrder || incomingOrder || showVerification || isModalMinimized) && (
        <AnimatePresence>
          {!isModalMinimized && (
            <motion.div
              key="modal-container"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-x-0 top-0 bottom-[92px] z-[300] pointer-events-none flex items-end"
            >
              <div className="w-full pointer-events-auto relative">
                {incomingOrder && (
                  <NewOrderModal 
                    key={getOrderMongoId(incomingOrder) || getOrderAcceptId(incomingOrder)}
                    order={incomingOrder}
                    queuedOrders={incomingOrders}
                    onSelectOrder={selectIncomingOrder}
                    onAccept={async (orderFromModal) => {
                      const acceptTarget = normalizeIncomingOrder(orderFromModal || incomingOrder);
                      const lockedId = lockedIncomingOrderIdRef.current;

                      if (
                        lockedId &&
                        acceptTarget &&
                        !isSameOrder({ orderMongoId: lockedId, _id: lockedId }, acceptTarget)
                      ) {
                        console.error(
                          `[GhostAssignFix] BLOCKED: locked ${lockedId} but accept target is ${getOrderMongoId(acceptTarget) || getOrderAcceptId(acceptTarget)}`,
                        );
                        toast.error('Order changed while accepting. Please try again.', { duration: 4000 });
                        return;
                      }

                      if (
                        incomingOrder &&
                        acceptTarget &&
                        !isSameOrder(incomingOrder, acceptTarget)
                      ) {
                        console.error('[GhostAssignFix] BLOCKED: modal order does not match visible popup.');
                        toast.error('Order mismatch detected. Please try again.', { duration: 4000 });
                        return;
                      }

                      try {
                        await acceptOrder(acceptTarget);
                        clearAllIncomingOrders();
                      } catch (err) {
                        const msg = String(err?.response?.data?.message || err?.message || '');
                        const isTaken = msg.toLowerCase().includes('already accepted') || 
                                        msg.toLowerCase().includes('another partner') ||
                                        (err?.response?.status === 403);
                        if (isTaken) {
                          removeClaimedOrderFromQueue(acceptTarget, { notify: false });
                        }
                      }
                    }}
                    onReject={dismissCurrentIncomingOrder}
                    onMinimize={() => setIsModalMinimized(true)}
                  />
                )}
                {(tripStatus === 'PICKING_UP' || tripStatus === 'REACHED_PICKUP') && (
                  <PickupActionModal 
                    order={activeOrder} 
                    status={tripStatus} 
                    isWithinRange={isWithinRange} 
                    distanceToTarget={distanceToTarget}
                    eta={eta}
                    onReachedPickup={reachPickup} 
                    onPickedUp={(billImageUrl, otp) => pickUpOrder(billImageUrl, otp)} 
                    onMinimize={() => setIsModalMinimized(true)}
                  />
                )}
                {(tripStatus === 'PICKED_UP' || tripStatus === 'REACHED_DROP') && (
                  <div className="absolute inset-x-0 z-[120] px-4" style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
                    {tripStatus === 'PICKED_UP' ? (
                      <div className="bg-white rounded-[3rem] p-8 shadow-[0_-20px_80px_rgba(0,0,0,0.4)] border border-gray-100 flex flex-col items-center">
                        {/* Handle / Minimize */}
                        <div className="w-full flex justify-center pb-4 pt-0 -mt-2">
                          <button onClick={() => setIsModalMinimized(true)} className="p-1 hover:bg-gray-100 active:scale-95 transition-all rounded-full flex flex-col items-center">
                             <ChevronDown className="w-6 h-6 text-gray-400 stroke-[3]" />
                          </button>
                        </div>
                        <div className="w-full flex flex-col mb-8 text-left px-2">
                           <div className="flex items-center gap-2 mb-2 font-bold text-[10px] uppercase tracking-widest text-blue-600">
                              <MapPin className="w-4 h-4" />
                              <span>Handover Drop</span>
                           </div>
                           <div className="flex justify-between items-start gap-4">
                              <div>
                                 <p className="text-gray-950 font-bold text-base sm:text-xl leading-tight">
                                    {activeOrder?.user?.name || activeOrder?.deliveryAddress?.name || "Customer"}
                                 </p>
                                 <p className="text-gray-500 text-sm font-medium leading-relaxed mt-1 line-clamp-2">
                                    {activeOrder?.deliveryAddress?.address || activeOrder?.deliveryAddress?.street || "Customer Location"}
                                 </p>
                              </div>
                              <div className="flex gap-2 shrink-0 mt-1">
                                {(activeOrder?.userPhone || activeOrder?.deliveryAddress?.phone || activeOrder?.user?.phone) && (
                                  <button
                                    onClick={() => {
                                      const num = activeOrder?.userPhone || activeOrder?.deliveryAddress?.phone || activeOrder?.user?.phone;
                                      if (num) window.location.href = `tel:${num}`;
                                    }}
                                    className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 border border-blue-100 active:scale-95 transition-all shadow-sm"
                                  >
                                    <Phone className="w-4 h-4 fill-current" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openCustomerDropInMaps(activeOrder)}
                                  className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-lg active:scale-95 transition-all"
                                  title="Navigate to customer"
                                >
                                  <Navigation className="w-5 h-5" />
                                </button>
                              </div>
                           </div>

                           {activeOrder?.items && activeOrder.items.length > 0 && (
                             <div className="mt-4 p-3 bg-gray-50 rounded-xl border border-gray-100">
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1.5">Order Items</p>
                                <p className="text-sm font-bold text-gray-800 line-clamp-2 leading-snug">
                                  {activeOrder.items.map(item => `${item.quantity}x ${item.menuItem?.name || item.name || 'Item'}`).join(', ')}
                                </p>
                             </div>
                           )}

                           <div className="grid grid-cols-2 gap-2.5 sm:gap-4 mt-4">
                             <div className="p-3 sm:p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-2.5 sm:gap-3">
                               <Clock className="w-5 h-5 text-orange-500" />
                               <div className="flex flex-col">
                                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Time</span>
                                  <span className={`text-sm font-bold ${isWithinRange ? 'text-green-600' : 'text-gray-900'}`}>{isWithinRange ? 'Ready' : `${eta || '--'} MINS`}</span>
                               </div>
                             </div>
                             <div className="p-3 sm:p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-2.5 sm:gap-3">
                               <MapPin className="w-5 h-5 text-gray-400" />
                               <div className="flex flex-col">
                                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Distance</span>
                                  <span className={`text-sm font-bold ${isWithinRange ? 'text-green-600' : 'text-gray-900'}`}>{isWithinRange ? '0 KM' : `${(distanceToTarget / 1000).toFixed(1)} KM`}</span>
                               </div>
                             </div>
                           </div>

                           {activeOrder?.note && (
                             <div className="w-full bg-orange-50 border border-orange-100 rounded-2xl p-4 mt-4 flex gap-3 items-start shadow-sm">
                                <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center text-orange-500 shadow-sm shrink-0 border border-orange-50">
                                   <Package className="w-4 h-4" />
                                </div>
                                <div className="flex-1">
                                   <p className="text-[10px] font-black text-orange-600 uppercase tracking-[0.2em] mb-1 opacity-80">Drop Message</p>
                                   <p className="text-sm font-bold text-gray-950 leading-relaxed capitalize">"{activeOrder.note}"</p>
                                </div>
                             </div>
                           )}
                        </div>
                        <ActionSlider label="Slide to Arrive" successLabel="Arrived âœ“" disabled={!isWithinRange} onConfirm={reachDrop} color="bg-blue-600" />
                      </div>
                    ) : (
                      <button 
                        onClick={() => setShowVerification(true)} 
                        className="w-full text-white rounded-2xl py-4 sm:py-5 px-4 font-bold text-xs sm:text-sm tracking-[0.14em] transform transition-all active:scale-95 flex items-center justify-center gap-2.5 sm:gap-3 border border-white/20"
                        style={{
                          background: 'linear-gradient(33deg, #15498b 0%, #000000 100%)',
                          boxShadow: '0 14px 34px rgba(21, 73, 139, 0.42)',
                        }}
                      >
                        <CheckCircle2 className="w-6 h-6" /> VERIFY & COMPLETE
                      </button>
                    )}


                  </div>
                )}
                {showVerification && tripStatus !== 'COMPLETED' && (
                  <DeliveryVerificationModal 
                    order={activeOrder} 
                    onComplete={async (otp, paymentOverride) => {
                      const res = await completeDelivery(otp, paymentOverride);
                      setShowVerification(false);
                      return res;
                    }}
                    onClose={() => setShowVerification(false)}
                  />
                )}
                {tripStatus === 'COMPLETED' && <OrderSummaryModal order={activeOrder} onDone={resetTrip} />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* â”€â”€â”€ MODALS RESTORED FROM OLD UI â”€â”€â”€ */}
      <BottomPopup isOpen={showEmergencyPopup} title="Emergency Help" onClose={() => setShowEmergencyPopup(false)}>
         <div className="grid gap-4 py-2">
           {emergencyOptions.map((opt, i) => (
             <button 
               key={i} 
               onClick={() => {
                 const num = opt.phone?.replace(/\D/g, '');
                 if (num) window.location.href = `tel:${num}`;
                 else toast.error('Number not configured');
               }}
               className="flex items-center gap-5 p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 active:scale-95 transition-all text-left"
             >
               <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm text-xl">{opt.icon}</div>
               <div>
                 <h4 className="font-bold text-gray-900">{opt.title}</h4>
                 <p className="text-xs text-gray-500 font-medium">{opt.subtitle}</p>
               </div>
             </button>
           ))}
         </div>
      </BottomPopup>

      <BottomPopup 
        isOpen={showNotifications} 
        title="Notifications" 
        onClose={() => {
           setShowNotifications(false);
           // Optional: refresh count if needed
        }}
      >
         <div className="flex flex-col gap-3 -mt-2 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
            {broadcastItems && broadcastItems.length > 0 ? (
               <>
                  <div className="flex justify-end mb-1">
                     <button 
                        onClick={() => {
                           dismissAllBroadcast();
                           toast.success("All notifications cleared");
                        }}
                        className="text-[10px] font-black uppercase tracking-widest text-red-500 bg-red-50 px-3 py-1.5 rounded-full"
                     >
                        Clear All
                     </button>
                  </div>
                  <div className="grid gap-2.5">
                     {broadcastItems.map((item) => (
                        <div 
                           key={item.id} 
                           onClick={() => {
                              markBroadcastAsRead(item.id);
                              if (item.link) {
                                 // Handle link if present
                                 const path = item.link.startsWith('/') ? item.link : `/${item.link}`;
                                 navigate(path);
                                 setShowNotifications(false);
                              }
                           }}
                           className={`p-4 rounded-2xl border transition-all active:scale-[0.98] cursor-pointer ${item.read ? 'bg-gray-50 border-gray-100' : 'bg-orange-50 border-orange-100 shadow-sm shadow-orange-500/5'}`}
                        >
                           <div className="flex gap-3 items-start">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.read ? 'bg-gray-200 text-gray-500' : 'bg-[#EB590E] text-white shadow-lg'}`}>
                                 <Bell className="w-4 h-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                 <div className="flex justify-between items-start gap-2">
                                    <h4 className={`text-sm font-bold truncate ${item.read ? 'text-gray-600' : 'text-gray-950'}`}>
                                       {item.title}
                                    </h4>
                                    <span className="text-[9px] font-black uppercase text-gray-400 shrink-0 whitespace-nowrap pt-0.5">
                                       {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                 </div>
                                 <p className={`text-[12px] leading-relaxed mt-0.5 break-words ${item.read ? 'text-gray-500 line-clamp-2' : 'text-gray-700'}`}>
                                    {item.message}
                                 </p>
                              </div>
                           </div>
                        </div>
                     ))}
                  </div>
               </>
            ) : (
               <div className="py-20 flex flex-col items-center justify-center text-center px-10">
                  <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center mb-4 border border-gray-100/50">
                     <Bell className="w-7 h-7 text-gray-300" />
                  </div>
                  <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest leading-none mb-2">No Notifications</h3>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-tight leading-relaxed">System notifications for order requests and updates will appear here.</p>
               </div>
            )}
         </div>
         <div className="mt-8 mb-2">
            <button 
               onClick={() => {
                  setShowNotifications(false);
                  navigate('/food/delivery/notifications');
               }}
               className="w-full py-4 rounded-2xl bg-gray-950 text-white text-xs font-black uppercase tracking-[0.2em] shadow-xl shadow-gray-950/20 active:scale-95 transition-all"
            >
               View Notification History
            </button>
         </div>
      </BottomPopup>

      {/* Floating Minimize/Restore Toggle - Above navbar */}
      {isModalMinimized && (activeOrder || incomingOrder || showVerification) && (
        <motion.div 
           initial={{ y: 100, opacity: 0 }}
           animate={{ y: 0, opacity: 1 }}
           className="fixed bottom-[100px] inset-x-0 z-[300] px-6"
        >
           <button 
             onClick={() => setIsModalMinimized(false)}
             className="w-full bg-gray-900/90 text-white rounded-2xl py-4 flex items-center justify-between px-6 shadow-2xl backdrop-blur-md border border-white/10"
           >
              <div className="flex flex-col items-start gap-0.5">
                 <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                   {incomingOrders.length > 1
                     ? `${incomingOrders.length} orders waiting`
                     : 'Order Action Pending'}
                 </span>
                 <span className="text-xs font-bold uppercase tracking-wider">
                   {incomingOrders.length > 1
                     ? 'Tap to choose and accept'
                     : 'Tap to open delivery panel'}
                 </span>
              </div>
              <div className="bg-orange-500 p-2 rounded-xl text-white">
                 <Plus className="w-5 h-5" />
              </div>
           </button>
        </motion.div>
      )}

      {/* â”€â”€â”€ 3. BOTTOM NAV (Fixed - Compact Pro) â”€â”€â”€ */}
      <div className="bg-white border-t border-gray-100 px-8 py-3 pb-6 flex justify-between items-center z-[200] shadow-[0_-5px_20px_rgba(0,0,0,0.05)]">
         <button onClick={() => navigate('/food/delivery/feed')} className={`flex flex-col items-center gap-1 transition-all ${currentTab === 'feed' ? 'text-gray-950 scale-110' : 'text-gray-400 opacity-70'}`}>
            <LayoutGrid className="w-6 h-6" /><span className="text-[11px] font-medium font-sans">Feed</span>
         </button>
         <button onClick={() => navigate('/food/delivery/pocket')} className={`flex flex-col items-center gap-1 transition-all ${currentTab === 'pocket' ? 'text-gray-950 scale-110' : 'text-gray-400 opacity-70'}`}>
            <Wallet className="w-6 h-6" /><span className="text-[11px] font-medium font-sans">Pocket</span>
         </button>
         <button onClick={() => navigate('/food/delivery/history')} className={`flex flex-col items-center gap-1 transition-all ${currentTab === 'history' ? 'text-gray-950 scale-110' : 'text-gray-400 opacity-70'}`}>
            <History className="w-6 h-6" /><span className="text-[11px] font-medium font-sans">Trip History</span>
         </button>
         <button onClick={() => navigate('/food/delivery/profile')} className={`flex flex-col items-center gap-1 transition-all ${currentTab === 'profile' ? 'text-gray-950 scale-110' : 'text-gray-400 opacity-70'}`}>
            <UserIcon className="w-6 h-6" /><span className="text-[11px] font-medium font-sans">Profile</span>
         </button>
      </div>
    </div>
  );
}
