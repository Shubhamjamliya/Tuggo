import { useParams, Link, useSearchParams, useNavigate, useLocation } from "react-router-dom"
import React, { useState, useEffect, useMemo, useRef, useCallback, memo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import {
  ArrowLeft,
  Share2,
  Star,
  RefreshCw,
  Phone,
  User,
  ChevronRight,
  MapPin,
  Home as HomeIcon,
  MessageSquare,
  X,
  Check,
  Shield,
  Receipt,
  CircleSlash,
  Loader2,
  Clock,
  Calendar
} from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { Textarea } from "@food/components/ui/textarea"
import { useOrders } from "@food/context/OrdersContext"
import { useProfile } from "@food/context/ProfileContext"
import { useLocation as useUserLocation } from "@food/hooks/useLocation"
import DeliveryTrackingMap from "@food/components/user/DeliveryTrackingMap"
import { orderAPI, restaurantAPI } from "@food/api"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { useUserNotifications } from "@food/hooks/useUserNotifications"
import {
  patchOrderFromSocketPayload,
  socketPayloadNeedsRefetch,
} from "@food/utils/orderSocketPatch"
import { RESTAURANT_PIN_SVG, CUSTOMER_PIN_SVG, RIDER_BIKE_SVG } from "@food/constants/mapIcons"

// Fallback definitions in case imports fail at runtime or are shadowed
const DEFAULT_CUSTOMER_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#10B981"><path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/><circle cx="12" cy="9" r="3" fill="#FFFFFF"/></svg>`;
const SAFE_CUSTOMER_PIN = typeof CUSTOMER_PIN_SVG !== 'undefined' ? CUSTOMER_PIN_SVG : DEFAULT_CUSTOMER_PIN;
const DEFAULT_RESTAURANT_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#FF6B35"><path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/><circle cx="12" cy="9" r="3" fill="#FFFFFF"/></svg>`;
const SAFE_RESTAURANT_PIN = typeof RESTAURANT_PIN_SVG !== 'undefined' ? RESTAURANT_PIN_SVG : DEFAULT_RESTAURANT_PIN;

const debugLog = (...args) => console.log('[OrderTracking]', ...args)
const debugWarn = (...args) => console.warn('[OrderTracking]', ...args)
const debugError = (...args) => console.error('[OrderTracking]', ...args)


// Animated checkmark component
const AnimatedCheckmark = ({ delay = 0 }) => (
  <motion.svg
    width="80"
    height="80"
    viewBox="0 0 80 80"
    initial="hidden"
    animate="visible"
    className="mx-auto"
  >
    <motion.circle
      cx="40"
      cy="40"
      r="36"
      fill="none"
      stroke="#22c55e"
      strokeWidth="4"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
    />
    <motion.path
      d="M24 40 L35 51 L56 30"
      fill="none"
      stroke="#22c55e"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.4, delay: delay + 0.4, ease: "easeOut" }}
    />
  </motion.svg>
)

// Real Delivery Map Component with User Live Location
const DeliveryMap = memo(({ orderId, order, isVisible, fallbackCustomerCoords = null, userLiveCoords = null, userLocationAccuracy = null, onEtaUpdate = null }) => {
  const toPointFromGeoJSON = (coords) => {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };

  // Memoize coordinates to prevent re-calculating on every parent render
  const restaurantCoords = useMemo(() => {
    // Try multiple sources for restaurant coordinates
    let coords = null;

    if (order?.restaurantLocation?.coordinates &&
      Array.isArray(order.restaurantLocation.coordinates) &&
      order.restaurantLocation.coordinates.length >= 2) {
      coords = order.restaurantLocation.coordinates;
    }
    else if (order?.restaurantId?.location?.coordinates &&
      Array.isArray(order.restaurantId.location.coordinates) &&
      order.restaurantId.location.coordinates.length >= 2) {
      coords = order.restaurantId.location.coordinates;
    }
    else if (order?.restaurantId?.location?.latitude && order?.restaurantId?.location?.longitude) {
      coords = [order.restaurantId.location.longitude, order.restaurantId.location.latitude];
    }

    const fromCoords = toPointFromGeoJSON(coords);
    if (fromCoords) return fromCoords;

    const fallbackLat = Number(order?.restaurantId?.location?.latitude || order?.restaurant?.location?.latitude);
    const fallbackLng = Number(order?.restaurantId?.location?.longitude || order?.restaurant?.location?.longitude);
    if (Number.isFinite(fallbackLat) && Number.isFinite(fallbackLng)) {
      return { lat: fallbackLat, lng: fallbackLng };
    }
    return null;
  }, [order?.restaurantId, order?.restaurantLocation, order?.restaurant]);

  const customerCoords = useMemo(() => {
    const coords = order?.address?.coordinates || order?.address?.location?.coordinates;
    const fromCoords = toPointFromGeoJSON(coords);
    if (fromCoords) return fromCoords;

    if (
      fallbackCustomerCoords &&
      Number.isFinite(fallbackCustomerCoords.lat) &&
      Number.isFinite(fallbackCustomerCoords.lng)
    ) {
      return fallbackCustomerCoords;
    }
    return null;
  }, [order?.address, fallbackCustomerCoords]);

  // Delivery boy data
  const deliveryBoyData = useMemo(() => order?.deliveryPartner ? {
    name: order.deliveryPartner.name || 'Delivery Partner',
    avatar: order.deliveryPartner.avatar || null
  } : null, [order?.deliveryPartner]);

  const effectiveCustomerCoords = useMemo(() => {
    if (customerCoords) return customerCoords;
    if (userLiveCoords && Number.isFinite(userLiveCoords.lat) && Number.isFinite(userLiveCoords.lng)) {
      return userLiveCoords;
    }
    if (restaurantCoords) return restaurantCoords;
    return null;
  }, [customerCoords, userLiveCoords, restaurantCoords]);

  const effectiveRestaurantCoords = useMemo(() => {
    if (restaurantCoords) return restaurantCoords;
    if (effectiveCustomerCoords) return effectiveCustomerCoords;
    return null;
  }, [restaurantCoords, effectiveCustomerCoords]);

  // Firebase and backend write tracking under order.orderId (string) or mongoId; subscribe to all so we receive updates
  const orderTrackingIdsList = useMemo(() => [
    order?.orderId,
    order?.mongoId,
    order?._id,
    orderId,
    order?.id
  ].filter(Boolean), [order?.orderId, order?.mongoId, order?._id, orderId, order?.id]);

  if (!isVisible || !orderId || !order || !effectiveRestaurantCoords || !effectiveCustomerCoords) {
    return (
      <div
        className="relative h-[300px] sm:h-[450px] bg-gradient-to-b from-gray-100 to-gray-200 dark:from-[#0a0a0a] dark:to-[#1a1a1a]"
      />
    );
  }

  return (
    <div
      className="relative w-full h-[300px] sm:h-[450px] overflow-visible"
    >
      <DeliveryTrackingMap
        orderId={orderId}
        orderTrackingIds={orderTrackingIdsList}
        restaurantCoords={effectiveRestaurantCoords}
        customerCoords={effectiveCustomerCoords}

        userLiveCoords={userLiveCoords}
        userLocationAccuracy={userLocationAccuracy}
        deliveryBoyData={deliveryBoyData}
        order={order}
        onEtaUpdate={onEtaUpdate}
      />
    </div>
  );
});

// Section item component
const SectionItem = ({ icon: Icon, iconNode, title, subtitle, onClick, showArrow = true, rightContent }) => (
  <motion.button
    onClick={onClick}
    className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left border-b border-dashed border-gray-200 dark:border-gray-800 last:border-0"
    whileTap={{ scale: 0.99 }}
  >
    <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
      {iconNode ? (
        <div
          className="w-6 h-6 flex-shrink-0 flex items-center justify-center [&_svg]:w-full [&_svg]:h-full [&_svg]:block"
        >
          {iconNode}
        </div>
      ) : (
        <Icon className="w-5 h-5 text-gray-600 dark:text-gray-400 flex-shrink-0" />
      )}
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{title}</p>
      {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{subtitle}</p>}
    </div>
    {rightContent || (showArrow && <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />)}
  </motion.button>
)

class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    debugError('OrderTracking map render failed:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="relative h-[300px] sm:h-[450px] bg-gray-100 dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 flex items-center justify-center">
          <p className="text-sm text-gray-600 dark:text-gray-400 px-4 text-center">Live map unavailable right now</p>
        </div>
      )
    }
    return this.props.children
  }
}

const getRestaurantCoordsFromOrder = (apiOrder, fallback = null) => {
  if (
    apiOrder?.restaurantId?.location?.coordinates &&
    Array.isArray(apiOrder.restaurantId.location.coordinates) &&
    apiOrder.restaurantId.location.coordinates.length >= 2
  ) {
    return apiOrder.restaurantId.location.coordinates
  }
  if (apiOrder?.restaurantId?.location?.latitude && apiOrder?.restaurantId?.location?.longitude) {
    return [apiOrder.restaurantId.location.longitude, apiOrder.restaurantId.location.latitude]
  }
  if (
    apiOrder?.restaurant?.location?.coordinates &&
    Array.isArray(apiOrder.restaurant.location.coordinates) &&
    apiOrder.restaurant.location.coordinates.length >= 2
  ) {
    return apiOrder.restaurant.location.coordinates
  }
  return fallback || null
}

const getRestaurantAddressFromOrder = (apiOrder, previousOrder = null, explicitRestaurantAddress = null) => {
  if (explicitRestaurantAddress && String(explicitRestaurantAddress).trim()) {
    return String(explicitRestaurantAddress).trim()
  }

  const location = apiOrder?.restaurantId?.location || apiOrder?.restaurant?.location || {}

  if (location?.formattedAddress && String(location.formattedAddress).trim()) {
    return String(location.formattedAddress).trim()
  }
  if (location?.address && String(location.address).trim()) {
    return String(location.address).trim()
  }
  if (location?.addressLine1 && String(location.addressLine1).trim()) {
    return String(location.addressLine1).trim()
  }

  const parts = [location?.street, location?.area, location?.city, location?.state, location?.zipCode]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean)

  if (parts.length > 0) return parts.join(', ')

  return previousOrder?.restaurantAddress || apiOrder?.restaurantAddress || apiOrder?.restaurant?.address || 'Restaurant location'
}

const getCustomerCoordsFromApiOrder = (apiOrder, previousOrder = null) => {
  const addr = apiOrder?.address || apiOrder?.deliveryAddress || {}
  const fromLoc = addr?.location?.coordinates
  if (Array.isArray(fromLoc) && fromLoc.length >= 2) return fromLoc
  const flat = addr?.coordinates
  if (Array.isArray(flat) && flat.length >= 2) return flat

  // Some payloads provide plain object coordinates instead of GeoJSON arrays.
  const objectCoord = addr?.location || addr
  const objLat = Number(objectCoord?.lat ?? objectCoord?.latitude)
  const objLng = Number(objectCoord?.lng ?? objectCoord?.longitude)
  if (Number.isFinite(objLat) && Number.isFinite(objLng)) return [objLng, objLat]

  const prev = previousOrder?.address?.coordinates || previousOrder?.address?.location?.coordinates
  if (Array.isArray(prev) && prev.length >= 2) return prev
  return null
}

const transformOrderForTracking = (apiOrder, previousOrder = null, explicitRestaurantCoords = null, explicitRestaurantAddress = null) => {
  const restaurantCoords = explicitRestaurantCoords || getRestaurantCoordsFromOrder(apiOrder, previousOrder?.restaurantLocation?.coordinates)
  const restaurantAddress = getRestaurantAddressFromOrder(apiOrder, previousOrder, explicitRestaurantAddress)
  // API returns `deliveryAddress`; some paths use `address`
  const addr = apiOrder?.address || apiOrder?.deliveryAddress || {}
  const customerCoordsResolved = getCustomerCoordsFromApiOrder(apiOrder, previousOrder)

  return {
    id: apiOrder?.orderId || apiOrder?._id,
    mongoId: apiOrder?._id || null,
    orderId: apiOrder?.orderId || apiOrder?._id,
    restaurant: apiOrder?.restaurantName || apiOrder?.restaurantId?.restaurantName || apiOrder?.restaurantId?.name || apiOrder?.restaurant?.restaurantName || apiOrder?.restaurant?.name || previousOrder?.restaurant || 'Restaurant',
    restaurantPhone:
      apiOrder?.restaurantPhone ||
      apiOrder?.restaurantId?.phone ||
      apiOrder?.restaurantId?.ownerPhone ||
      apiOrder?.restaurant?.phone ||
      apiOrder?.restaurant?.ownerPhone ||
      previousOrder?.restaurantPhone ||
      '',
    restaurantAddress,
    restaurantId: apiOrder?.restaurantId || previousOrder?.restaurantId || null,
    userId: apiOrder?.userId || previousOrder?.userId || null,
    userName: apiOrder?.userName || apiOrder?.userId?.name || apiOrder?.userId?.fullName || previousOrder?.userName || '',
    userPhone: apiOrder?.userPhone || apiOrder?.userId?.phone || previousOrder?.userPhone || '',
    address: {
      street: addr?.street || previousOrder?.address?.street || '',
      city: addr?.city || previousOrder?.address?.city || '',
      state: addr?.state || previousOrder?.address?.state || '',
      zipCode: addr?.zipCode || previousOrder?.address?.zipCode || '',
      additionalDetails: addr?.additionalDetails || previousOrder?.address?.additionalDetails || '',
      formattedAddress: addr?.formattedAddress ||
        (addr?.street && addr?.city
          ? `${addr.street}${addr.additionalDetails ? `, ${addr.additionalDetails}` : ''}, ${addr.city}${addr.state ? `, ${addr.state}` : ''}${addr.zipCode ? ` ${addr.zipCode}` : ''}`
          : previousOrder?.address?.formattedAddress || addr?.city || ''),
      coordinates: customerCoordsResolved || addr?.location?.coordinates || previousOrder?.address?.coordinates || null
    },
    restaurantLocation: {
      coordinates: restaurantCoords
    },
    items: apiOrder?.items?.map(item => ({
      name: item.name,
      variantName: item.variantName || '',
      quantity: item.quantity,
      price: item.price,
      originalPrice: item.originalPrice ?? item.price
    })) || previousOrder?.items || [],
    total: apiOrder?.pricing?.total || previousOrder?.total || 0,
    // Backend canonical field is orderStatus; keep legacy `status` for UI compatibility.
    status: apiOrder?.orderStatus || apiOrder?.status || previousOrder?.status || 'pending',
    deliveryPartner: apiOrder?.deliveryPartnerId ? {
      name: apiOrder.deliveryPartnerId.name || apiOrder.deliveryPartnerId.fullName || 'Delivery Partner',
      phone: apiOrder.deliveryPartnerId.phone || apiOrder.deliveryPartnerId.phoneNumber || '',
      avatar: apiOrder.deliveryPartnerId.avatar || apiOrder.deliveryPartnerId.profilePicture || null
    } : (previousOrder?.deliveryPartner || null),
    deliveryPartnerId: apiOrder?.deliveryPartnerId?._id || apiOrder?.deliveryPartnerId || apiOrder?.dispatch?.deliveryPartnerId?._id || apiOrder?.dispatch?.deliveryPartnerId || apiOrder?.assignmentInfo?.deliveryPartnerId || null,
    dispatch: apiOrder?.dispatch || previousOrder?.dispatch || null,
    assignmentInfo: apiOrder?.assignmentInfo || previousOrder?.assignmentInfo || null,
    tracking: apiOrder?.tracking || previousOrder?.tracking || {},
    deliveryState: apiOrder?.deliveryState || previousOrder?.deliveryState || null,
    scheduledAt: apiOrder?.scheduledAt || previousOrder?.scheduledAt || null,
    createdAt: apiOrder?.createdAt || previousOrder?.createdAt || null,
    totalAmount: apiOrder?.pricing?.total || apiOrder?.totalAmount || previousOrder?.totalAmount || 0,
    deliveryFee: apiOrder?.pricing?.deliveryFee || apiOrder?.deliveryFee || previousOrder?.deliveryFee || 0,
    gst: apiOrder?.pricing?.tax || apiOrder?.pricing?.gst || apiOrder?.gst || apiOrder?.tax || previousOrder?.gst || 0,
    packagingFee: apiOrder?.pricing?.packagingFee || apiOrder?.packagingFee || 0,
    platformFee: apiOrder?.pricing?.platformFee || apiOrder?.platformFee || 0,
    discount: apiOrder?.pricing?.discount || apiOrder?.discount || 0,
    subtotal: apiOrder?.pricing?.subtotal || apiOrder?.subtotal || 0,
    paymentMethod: apiOrder?.paymentMethod || apiOrder?.payment?.method || previousOrder?.paymentMethod || null,
    payment: apiOrder?.payment || previousOrder?.payment || null,
    // Preserve delivery OTP code received via socket event.
    // API responses intentionally strip the secret code for security,
    // so without preserving it the UI would lose the OTP on each poll refresh.
    deliveryVerification: (() => {
      const prevDV = previousOrder?.deliveryVerification || null
      const apiDV = apiOrder?.deliveryVerification || null
      const handoverOtp = apiOrder?.handoverOtp || null
      
      if (!prevDV && !apiDV && !handoverOtp) return null

      const prevDropOtp = prevDV?.dropOtp || null
      const apiDropOtp = apiDV?.dropOtp || null
      
      const merged = {
        ...(prevDV || {}),
        ...(apiDV || {})
      }

      // Prioritize: 1. Real-time handoverOtp from current API response
      // 2. Previously preserved code in local state (from socket or earlier poll)
      // 3. Nested code field in API response (if ever present)
      const finalCode = handoverOtp || prevDropOtp?.code || apiDropOtp?.code

      if (finalCode || prevDropOtp?.required || apiDropOtp?.required) {
        merged.dropOtp = {
          ...(prevDropOtp || {}),
          ...(apiDropOtp || {}),
          code: finalCode
        }
      }
      return merged
    })(),
    cancellationReason: apiOrder?.cancellationReason || previousOrder?.cancellationReason || null,
    ratings: apiOrder?.ratings || previousOrder?.ratings || {},
    restaurantRating: apiOrder?.ratings?.restaurant?.rating || apiOrder?.restaurantRating || previousOrder?.restaurantRating || null,
    deliveryPartnerRating: apiOrder?.ratings?.deliveryPartner?.rating || apiOrder?.deliveryPartnerRating || previousOrder?.deliveryPartnerRating || null,
  }
}

/**
 * Backend uses `orderStatus` (created, confirmed, preparing, ready_for_pickup, picked_up, delivered, cancelled_*).
 * This page used to read legacy `status` only — so UI never updated. Map canonical + legacy values to tracking steps.
 */
function mapBackendOrderStatusToUi(raw) {
  const s = String(raw || "").toLowerCase()
  if (!s || s === "pending" || s === "created") return "placed"
  if (s === "confirmed" || s === "accepted") return "confirmed"
  if (s === "preparing" || s === "processed") return "preparing"
  if (s === "ready" || s === "ready_for_pickup" || s === "reached_pickup" || s === "order_confirmed") return "ready"
  if (s === "picked_up" || s === "out_for_delivery" || s === "en_route_to_delivery") return "on_way"
  if (s === "reached_drop" || s === "at_drop" || s === "at_delivery") return "at_drop"
  if (s === "delivered" || s === "completed") return "delivered"
  if (s.includes("cancelled") || s === "cancelled") return "cancelled"
  if (s === "dead") return "dead"
  return "placed"
}

function mapOrderToTrackingUiStatus(orderLike) {
  if (!orderLike) return "placed"
  const statusRaw = orderLike.status || orderLike.orderStatus
  const phase = orderLike.deliveryState?.currentPhase

  // Terminal states handled first
  if (isFoodOrderCancelledStatus(statusRaw)) return "cancelled"
  if (statusRaw === "delivered" || statusRaw === "completed") return "delivered"

  // Live Ride / Phase-based mapping (Highest priority for precision)
  const isRiderAccepted = orderLike.dispatch?.status === "accepted" || orderLike.assignmentInfo?.status === "accepted" || orderLike.deliveryPartner?.status === "accepted";
  
  if (phase === "reached_drop" || phase === "at_drop" || statusRaw === "at_drop") return "at_drop"
  if (phase === "en_route_to_delivery" || statusRaw === "picked_up" || statusRaw === "out_for_delivery") return "on_way"
  if (phase === "at_pickup" && orderLike.deliveryPartnerId && isRiderAccepted) return "at_pickup"
  if (phase === "en_route_to_pickup" && orderLike.deliveryPartnerId && isRiderAccepted) return "assigned"

  // Fallback to basic status mapping
  return mapBackendOrderStatusToUi(statusRaw)
}

/** Prefer live delivery phase when present (socket / polling include deliveryState). */
function isFoodOrderCancelledStatus(statusRaw) {
  const s = String(statusRaw || "").toLowerCase()
  return s === "cancelled" || s.includes("cancelled") || s === "dead"
}

function normalizeLookupId(value) {
  if (value == null) return ""
  const raw = String(value).trim()
  if (!raw || raw === "undefined" || raw === "null") return ""
  return raw
}

export default function OrderTracking() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const location = useLocation()
  const { orderId } = useParams()
  const [searchParams] = useSearchParams()
  const lookupIdFromQuery = searchParams.get("id") || searchParams.get("orderId")
  const confirmed = searchParams.get("confirmed") === "true"
  const { getOrderById } = useOrders()
  const { profile, getDefaultAddress } = useProfile()
  const { location: userLiveLocation } = useUserLocation()

  const { isConnected: isSocketConnected } = useUserNotifications()

  const checkoutOrderSeedRef = useRef(location.state?.order ?? null)
  
  // State for order data — hydrate from checkout navigation for instant map render
  const [order, setOrder] = useState(() => {
    const seed = checkoutOrderSeedRef.current
    return seed ? transformOrderForTracking(seed) : null
  })
  const [loading, setLoading] = useState(() => !checkoutOrderSeedRef.current)
  const [error, setError] = useState(null)

  const [showConfirmation, setShowConfirmation] = useState(confirmed)
  const [orderStatus, setOrderStatus] = useState('placed')
  const [estimatedTime, setEstimatedTime] = useState(29)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [showOrderDetails, setShowOrderDetails] = useState(false)
  const [cancellationReason, setCancellationReason] = useState("")
  const [refundDestination, setRefundDestination] = useState("source")
  const [isCancelling, setIsCancelling] = useState(false)
  const [isInstructionsModalOpen, setIsInstructionsModalOpen] = useState(false)
  const [deliveryInstructions, setDeliveryInstructions] = useState("")
  const [isUpdatingInstructions, setIsUpdatingInstructions] = useState(false)
  const [resolvedLookupId, setResolvedLookupId] = useState("")
  const [timerNow, setTimerNow] = useState(Date.now())
  const [cancelSecondsRemaining, setCancelSecondsRemaining] = useState(0)

  useEffect(() => {
    if (!order?.createdAt) return;
    
    const calculateRemaining = () => {
      const createdTime = new Date(order.createdAt).getTime();
      const now = Date.now();
      const diffInSeconds = Math.floor((65000 - (now - createdTime)) / 1000); // 65 second window matching backend
      return Math.max(0, diffInSeconds);
    };

    setCancelSecondsRemaining(calculateRemaining());

    const timer = setInterval(() => {
      const remaining = calculateRemaining();
      setCancelSecondsRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [order?.createdAt]);
  
  // Rating states
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [selectedRestaurantRating, setSelectedRestaurantRating] = useState(null)
  const [selectedDeliveryRating, setSelectedDeliveryRating] = useState(null)
  const [restaurantFeedbackText, setRestaurantFeedbackText] = useState("")
  const [deliveryFeedbackText, setDeliveryFeedbackText] = useState("")
  const [submittingRating, setSubmittingRating] = useState(false)

  // Check if order is already rated
  const hasRestaurantRating = Number.isFinite(Number(order?.ratings?.restaurant?.rating || order?.restaurantRating))
  const hasDeliveryPartner = !!(order?.deliveryPartnerId || order?.deliveryPartnerName)
  const hasDeliveryRating = Number.isFinite(Number(order?.ratings?.deliveryPartner?.rating || order?.deliveryPartnerRating))
  const isOrderRated = hasRestaurantRating && (!hasDeliveryPartner || hasDeliveryRating)

  const handleOpenRating = () => {
    setSelectedRestaurantRating(order?.ratings?.restaurant?.rating || order?.restaurantRating || null)
    setSelectedDeliveryRating(order?.ratings?.deliveryPartner?.rating || order?.deliveryPartnerRating || null)
    setRestaurantFeedbackText(order?.ratings?.restaurant?.comment || "")
    setDeliveryFeedbackText(order?.ratings?.deliveryPartner?.comment || "")
    setShowRatingModal(true)
  }

  const handleSubmitRating = async () => {
    const deliveryPartnerCheck = !!(order?.deliveryPartnerId || order?.deliveryPartnerName)
    const isMissingDeliveryRating = deliveryPartnerCheck && selectedDeliveryRating === null
    if (!order || selectedRestaurantRating === null || isMissingDeliveryRating) {
      toast.error("Please select all required ratings first")
      return
    }

    try {
      setSubmittingRating(true)
      const response = await orderAPI.submitOrderRatings(order.mongoId || order._id || order.id, {
        restaurantRating: selectedRestaurantRating,
        deliveryPartnerRating: deliveryPartnerCheck ? selectedDeliveryRating : undefined,
        restaurantComment: restaurantFeedbackText || undefined,
        deliveryPartnerComment: deliveryPartnerCheck ? (deliveryFeedbackText || undefined) : undefined,
      })
      
      const updatedOrderData = response?.data?.data?.order || response?.data?.order
      if (updatedOrderData) {
        setOrder(prev => ({
          ...prev,
          ...updatedOrderData,
          ratings: updatedOrderData.ratings,
          restaurantRating: updatedOrderData.ratings?.restaurant?.rating,
          deliveryPartnerRating: updatedOrderData.ratings?.deliveryPartner?.rating
        }))
      }

      toast.success("Thanks for your feedback!")
      setShowRatingModal(false)
    } catch (error) {
      debugError("Error submitting order ratings:", error)
      toast.error(error?.response?.data?.message || "Failed to submit ratings")
    } finally {
      setSubmittingRating(false)
    }
  }

  const handleEtaUpdate = useCallback((newEta) => {
    if (typeof newEta === 'string') {
      const match = newEta.match(/(\d+)/);
      if (match) {
        setEstimatedTime(parseInt(match[1], 10));
        return;
      }
    }
    if (typeof newEta === 'number' && !isNaN(newEta)) {
      setEstimatedTime(newEta);
    }
  }, [])
  const lastRealtimeRefreshRef = useRef(0)
  const trackingOrderIdsRef = useRef(new Set())
  const terminalPollStopRef = useRef(false)
  const lookupIdsRef = useRef([])
  const lastStatusToastRef = useRef({ key: '', at: 0 })

  const ORDER_STATUS_TOAST_ID = 'order-tracking-status-update'
  const ORDER_STATUS_TOAST_DEDUPE_MS = 4000

  // Delivery handover OTP received via socket event.
  // Kept separately so UI still renders even if the event arrives
  // before the order API poll populates `order` state.
  const [socketDropOtpCode, setSocketDropOtpCode] = useState(null)


  // OTP received via socket event (deliveryDropOtp)
  useEffect(() => {
    const handleDeliveryDropOtp = (event) => {
      const detail = event?.detail || {}
      const otp = detail?.otp != null ? String(detail.otp) : null
      const evtOrderId = detail?.orderId != null ? String(detail.orderId) : null
      const evtOrderMongoId =
        detail?.orderMongoId != null ? String(detail.orderMongoId) : null

      if (!otp) return

      // If the order is already loaded, match by either orderId or mongoId.
      // Otherwise, match against the current URL param.
      const currentIds = [String(orderId)]
      if (order?.orderId) currentIds.push(String(order.orderId))
      if (order?.mongoId) currentIds.push(String(order.mongoId))
      if (order?._id) currentIds.push(String(order._id))

      const matches =
        (evtOrderId && currentIds.includes(evtOrderId)) ||
        (evtOrderMongoId && currentIds.includes(evtOrderMongoId))

      if (!matches) return

      // Always store so UI can render even if `order` hasn't loaded yet.
      setSocketDropOtpCode(otp)

      setOrder((prev) => {
        if (!prev) return prev
        const prevDV = prev.deliveryVerification || {}
        const prevDropOtp = prevDV.dropOtp || {}
        
        // Only update if code actually changed to avoid render loops
        if (prevDropOtp.code === otp) return prev;
        
        return {
          ...prev,
          deliveryVerification: {
            ...prevDV,
            dropOtp: {
              ...prevDropOtp,
              required: true,
              verified: false,
              code: otp
            }
          }
        }
      })
    }

    window.addEventListener('deliveryDropOtp', handleDeliveryDropOtp)
    return () => window.removeEventListener('deliveryDropOtp', handleDeliveryDropOtp)
  }, [orderId, order])

  // --- Start: Sync arrival time with Home Page logic ---
  const getTimeRemaining = useCallback((orderData) => {
    if (!orderData) return null;

    // Use scheduled time if available, fallback to creation time
    const orderTime = new Date(
      orderData.scheduledAt || orderData.createdAt || orderData.orderDate || orderData.created_at || orderData.date || Date.now(),
    );

    // For non-scheduled orders, we add the estimated delivery time to the creation time.
    // For scheduled orders, scheduledAt is already the target time.
    const isScheduled = !!orderData.scheduledAt;
    const estimatedMinutes = isScheduled 
      ? 0 
      : (orderData.estimatedDeliveryTime || orderData.estimatedTime || orderData.estimated_delivery_time || 35);

    const deliveryTime = new Date(orderTime.getTime() + estimatedMinutes * 60000);
    return Math.max(0, Math.floor((deliveryTime - new Date()) / 60000));
  }, []);

  // Sync estimatedTime state with order data and periodic updates
  useEffect(() => {
    if (!order) return;

    const tick = () => {
      const remaining = getTimeRemaining(order);
      // Only prefer static calculation if no realtime ETA is provided by the map/driver
      // But user said "should be same" as Home page, which uses static calculation.
      // So we use static calculation as the base/sync source.
      if (remaining !== null) {
        setEstimatedTime(remaining);
      }
    };

    tick();
    const interval = setInterval(tick, 30000); // 30s sync matches home page logic
    return () => clearInterval(interval);
  }, [order, getTimeRemaining]);
  // --- End: Sync arrival time ---

  // --------------------------------------------------------------------------
  // DATA FETCHING & POLLING STABILITY (FIXED FOR HAMMERING)
  // --------------------------------------------------------------------------

  // Socket notifications include order ids — keep a set so events match this page.
  useEffect(() => {
    const s = trackingOrderIdsRef.current
    s.add(String(orderId))
    if (order?.orderId) s.add(String(order.orderId))
    if (order?.mongoId) s.add(String(order.mongoId))
    if (order?.id) s.add(String(order.id))
  }, [orderId, order?.orderId, order?.mongoId, order?.id])

  useEffect(() => {
    const ids = [
      resolvedLookupId,
      orderId,
      order?.orderId,
      order?.mongoId,
      order?._id,
      order?.id,
    ]
      .map(normalizeLookupId)
      .filter(Boolean)
    lookupIdsRef.current = Array.from(new Set(ids))
  }, [orderId, resolvedLookupId, order?.orderId, order?.mongoId, order?._id, order?.id])

  // Stability Nuke: Move function bodies into a ref-protected execute flow
  const stableOpsRef = useRef({
    resolveOrderFromList: async (rawLookupId) => {
      const needle = normalizeLookupId(rawLookupId)
      if (!needle) return null
      const maxPages = 3
      const limit = 50

      for (let page = 1; page <= maxPages; page += 1) {
        const listResponse = await orderAPI.getOrders({ page, limit })
        let orders = []
        if (listResponse?.data?.success && listResponse?.data?.data?.orders) {
          orders = listResponse.data.data.orders || []
        } else if (listResponse?.data?.orders) {
          orders = listResponse.data.orders || []
        } else if (Array.isArray(listResponse?.data?.data?.data)) {
          orders = listResponse.data.data.data || []
        } else if (Array.isArray(listResponse?.data?.data)) {
          orders = listResponse.data.data || []
        }

        const matched = (orders || []).find((o) => {
          const candidates = [o?._id, o?.id, o?.orderId, o?.mongoId].map(normalizeLookupId)
          return candidates.includes(needle)
        })
        if (matched) return matched
        const totalPages = Number(listResponse?.data?.data?.pagination?.pages) || Number(listResponse?.data?.data?.totalPages) || 1
        if (page >= totalPages) break
      }
      return null
    },
    fetchOrderDetailsWithFallback: async (options = {}) => {
      const lookupIds = lookupIdsRef.current
      if (lookupIds.length === 0) throw new Error("Order id required")
      let lastError = null
      for (const id of lookupIds) {
        try {
          // Double guard against hammer
          return await orderAPI.getOrderDetails(id, options)
        } catch (err) {
          lastError = err
          if (err?.response?.status === 400 || err?.response?.status === 404) continue
          throw err
        }
      }
      throw lastError || new Error("Failed to fetch order details")
    }
  });

  const resolveOrderFromList = useCallback((id) => stableOpsRef.current.resolveOrderFromList(id), [])
  const fetchOrderDetailsWithFallback = useCallback((opts) => stableOpsRef.current.fetchOrderDetailsWithFallback(opts), [])

  // Clear OTP when order is finalized.
  useEffect(() => {
    if (!order) return
    const status = mapOrderToTrackingUiStatus(order)
    if (status === 'delivered' || status === 'cancelled') {
      setSocketDropOtpCode(null)


      setOrder((prev) => {
        if (!prev?.deliveryVerification?.dropOtp?.code) return prev
        return {
          ...prev,
          deliveryVerification: {
            ...(prev.deliveryVerification || {}),
            dropOtp: {
              ...(prev.deliveryVerification?.dropOtp || {}),
              code: null
            }
          }
        }
      })
    }
  }, [orderStatus, order])

  const defaultAddress = getDefaultAddress()
  const fallbackCustomerCoords = useMemo(() => {
    const orderCoords = order?.address?.coordinates || order?.address?.location?.coordinates
    if (Array.isArray(orderCoords) && orderCoords.length >= 2) {
      const lng = Number(orderCoords[0])
      const lat = Number(orderCoords[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng }
      }
    }

    const orderLocObj = order?.address?.location || order?.address
    const orderObjLat = Number(orderLocObj?.lat ?? orderLocObj?.latitude)
    const orderObjLng = Number(orderLocObj?.lng ?? orderLocObj?.longitude)
    if (Number.isFinite(orderObjLat) && Number.isFinite(orderObjLng)) {
      return { lat: orderObjLat, lng: orderObjLng }
    }

    const defaultCoords = defaultAddress?.location?.coordinates
    if (Array.isArray(defaultCoords) && defaultCoords.length >= 2) {
      const lng = Number(defaultCoords[0])
      const lat = Number(defaultCoords[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng }
      }
    }

    const defaultLocObj = defaultAddress?.location || defaultAddress
    const defaultObjLat = Number(defaultLocObj?.lat ?? defaultLocObj?.latitude)
    const defaultObjLng = Number(defaultLocObj?.lng ?? defaultLocObj?.longitude)
    if (Number.isFinite(defaultObjLat) && Number.isFinite(defaultObjLng)) {
      return { lat: defaultObjLat, lng: defaultObjLng }
    }

    const liveLat = Number(userLiveLocation?.latitude)
    const liveLng = Number(userLiveLocation?.longitude)
    if (Number.isFinite(liveLat) && Number.isFinite(liveLng)) {
      return { lat: liveLat, lng: liveLng }
    }

    return null
  }, [
    order?.address?.coordinates,
    order?.address?.location?.coordinates,
    defaultAddress?.location?.coordinates,
    userLiveLocation?.latitude,
    userLiveLocation?.longitude
  ])

  const userLiveCoords = useMemo(() => {
    const lat = Number(userLiveLocation?.latitude)
    const lng = Number(userLiveLocation?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  }, [userLiveLocation?.latitude, userLiveLocation?.longitude])

  const isAdminAccepted = useMemo(() => {
    const status = order?.status
    return [
      "confirmed",
      "preparing",
      "ready",
      "ready_for_pickup",
      "picked_up",
    ].includes(status)
  }, [order?.status])

  // Single source of truth: backend order.status (+ deliveryState phase for live ride)
  useEffect(() => {
    if (!order) return
    setOrderStatus(mapOrderToTrackingUiStatus(order))
  }, [
    order?.status,
    order?.deliveryState?.currentPhase,
    order?.deliveryState?.status,
  ])

  const acceptedAtMs = useMemo(() => {
    const timestamp =
      order?.tracking?.confirmed?.timestamp ||
      order?.tracking?.preparing?.timestamp ||
      order?.updatedAt ||
      order?.createdAt

    const parsed = timestamp ? new Date(timestamp).getTime() : NaN
    return Number.isFinite(parsed) ? parsed : null
  }, [order?.tracking?.confirmed?.timestamp, order?.tracking?.preparing?.timestamp, order?.updatedAt, order?.createdAt])

  const editWindowRemainingMs = useMemo(() => {
    if (!isAdminAccepted || !acceptedAtMs) return 0
    const remaining = 60000 - (timerNow - acceptedAtMs)
    return Math.max(0, remaining)
  }, [isAdminAccepted, acceptedAtMs, timerNow])

  const isEditWindowOpen = editWindowRemainingMs > 0

  const editWindowText = useMemo(() => {
    const totalSeconds = Math.ceil(editWindowRemainingMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }, [editWindowRemainingMs])

  const handleCallRestaurant = (e) => {
    // Prevent event bubbling if necessary
    if (e && e.stopPropagation) e.stopPropagation();

    const rawPhone =
      order?.restaurantPhone ||
      order?.restaurantId?.phone ||
      order?.restaurantId?.ownerPhone ||
      order?.restaurantId?.contact?.phone ||
      order?.restaurant?.phone ||
      order?.restaurant?.ownerPhone ||
      order?.restaurantId?.location?.phone ||
      '';

    const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '');
    
    if (!cleanPhone || cleanPhone.length < 5) {
      toast.error('Restaurant phone number not available');
      return;
    }

    debugLog('?? Attempting to call restaurant:', cleanPhone);
    
    // Most compatible way to trigger dialer on overall mobile/web environments:
    // Create a temporary hidden anchor and programmatically click it.
    try {
      const link = document.createElement('a');
      link.href = `tel:${cleanPhone}`;
      link.setAttribute('target', '_self');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      debugError('Call failed via link click:', err);
      // Last-ditch fallback
      window.location.assign(`tel:${cleanPhone}`);
    }
  };

  const handleCallRider = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    
    const rawPhone = order?.deliveryPartner?.phone || '';
    const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '');

    if (!cleanPhone || cleanPhone.length < 5) {
      toast.error('Rider phone number not available');
      return;
    }

    debugLog('?? Attempting to call rider:', cleanPhone);
    
    try {
      const link = document.createElement('a');
      link.href = `tel:${cleanPhone}`;
      link.setAttribute('target', '_self');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      debugError('Call failed via link click:', err);
      window.location.assign(`tel:${cleanPhone}`);
    }
  };

  const customerDeliveryOtp = useMemo(() => {
    const codeFromOrder = order?.deliveryVerification?.dropOtp?.code
    const code = codeFromOrder ?? socketDropOtpCode
    return code ? String(code) : null
  }, [order?.deliveryVerification?.dropOtp?.code, socketDropOtpCode])

  useEffect(() => {
    if (!isEditWindowOpen) return
    const interval = setInterval(() => {
      setTimerNow(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [isEditWindowOpen])

  // Poll for order updates (especially when delivery partner accepts)

  const pollRef = useRef(null);

  // Main fetch & polling core logic. (Isolated from socket connection stat-changes)
  useEffect(() => {
    if (!orderId) return;

    let isSubscribed = true;
    let requestInProgress = false;

    const poll = async (isInitial = false) => {
      if (!isSubscribed || requestInProgress) return;
      if (terminalPollStopRef.current && !isInitial) return;

      // Use cached order from checkout / order-placed event before network round-trip
      if (isInitial) {
        const rawContext = checkoutOrderSeedRef.current || getOrderById(orderId);
        if (rawContext) {
          setOrder((prev) => transformOrderForTracking(rawContext, prev));
          setLoading(false);
        }
      }

      requestInProgress = true;
      try {
        const response = await fetchOrderDetailsWithFallback({ force: isInitial });
        if (!isSubscribed) return;

        let finalOrderData = null;

        if (response.data?.success && response.data.data?.order) {
          finalOrderData = response.data.data.order;
        } else if (response.data?.success && response.data?.data && (response.data.data._id || response.data.data.orderId || response.data.data.id)) {
          finalOrderData = response.data.data;
        } else if (response.data?.success && response.data?.order) {
          finalOrderData = response.data.order;
        } else if (isInitial) {
          const matchedOrder = await resolveOrderFromList(orderId);
          if (matchedOrder) finalOrderData = matchedOrder;
        }

        if (finalOrderData) {
          setOrder(prev => {
            const transformedOrder = transformOrderForTracking(finalOrderData, prev);
            const ui = mapOrderToTrackingUiStatus(transformedOrder);
            terminalPollStopRef.current = ui === 'delivered' || ui === 'cancelled';
            return transformedOrder;
          });
          setError(null);
          setLoading(false);
          return;
        }

        if (isInitial && !order) {
          setError(response.data?.message || 'Order not found');
          terminalPollStopRef.current = true;
        }
      } catch (err) {
        if (isInitial && !order) {
          try {
            const matchedOrder = await resolveOrderFromList(orderId);
            if (matchedOrder) {
              if (!isSubscribed) return;
              setOrder(prev => transformOrderForTracking(matchedOrder, prev));
              setError(null);
              setLoading(false);
              return;
            }
          } catch {}
          if (!isSubscribed) return;
          setError(err.response?.data?.message || 'Failed to fetch order details');
          terminalPollStopRef.current = true;
        } else if (err.response?.status === 404) {
          // If the order is deleted or not found on subsequent polls, stop polling
          terminalPollStopRef.current = true;
          if (!isSubscribed) return;
          setError(err.response?.data?.message || 'Order not found');
        }
      } finally {
        requestInProgress = false;
        if (isInitial && isSubscribed) setLoading(false);
      }
    };

    pollRef.current = poll;
    terminalPollStopRef.current = false;
    poll(true);

    return () => {
      isSubscribed = false;
    };
  }, [orderId, fetchOrderDetailsWithFallback, resolveOrderFromList, getOrderById]);

  // Interval Manager (dynamically adapts based on socket connection state independently)
  useEffect(() => {
    if (!orderId) return;

    const tick = () => {
      if (terminalPollStopRef.current) return;
      if (document.hidden) return;
      // Delegate to the latest instance of our polling function capturing current state
      if (pollRef.current) pollRef.current(false);
    };
    
    const pollInterval = (isSocketConnected || window.orderSocketConnected) ? 75000 : 12000;
    const interval = setInterval(tick, pollInterval);

    return () => clearInterval(interval);
  }, [orderId, isSocketConnected]);

  useEffect(() => {
    if (!order) return
    const ui = mapOrderToTrackingUiStatus(order)
    terminalPollStopRef.current = ui === 'delivered' || ui === 'cancelled'
  }, [order])

  // Post-checkout splash — dismiss quickly once order data is ready
  useEffect(() => {
    if (!confirmed) return

    if (order) {
      const timer = setTimeout(() => setShowConfirmation(false), 700)
      return () => clearTimeout(timer)
    }

    const fallback = setTimeout(() => setShowConfirmation(false), 1800)
    return () => clearTimeout(fallback)
  }, [confirmed, order])

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setEstimatedTime((prev) => Math.max(0, prev - 1))
    }, 60000)
    return () => clearInterval(timer)
  }, [])

  // Listen for order status updates from socket (e.g., "Delivery partner on the way")
  useEffect(() => {
    const handleOrderStatusNotification = (event) => {
      const payload = event?.detail || {};
      const { message, status, estimatedDeliveryTime, orderId: evtOrderId, orderMongoId } = payload;

      const evtKeys = [evtOrderId, orderMongoId, payload?._id].filter(Boolean).map(String)
      const idMatches =
        evtKeys.length === 0 ||
        evtKeys.some((k) => String(k) === String(orderId)) ||
        evtKeys.some((k) => trackingOrderIdsRef.current.has(k))

      debugLog('?? Order status notification received:', { message, status, idMatches });

      if (idMatches) {
        const next = mapOrderToTrackingUiStatus({
          status,
          orderStatus: payload.orderStatus || status,
          deliveryState: payload.deliveryState,
        });
        setOrderStatus(next);

        setOrder((prev) => {
          if (!prev) return prev;
          return transformOrderForTracking(patchOrderFromSocketPayload(prev, payload), prev);
        });

        const needsRefetch = socketPayloadNeedsRefetch(
          payload,
          payload.orderStatus || status,
        );
        const now = Date.now();
        if (needsRefetch && now - lastRealtimeRefreshRef.current > 30000 && !isRefreshing) {
          lastRealtimeRefreshRef.current = now;
          handleRefresh();
        } else if (!order && now - lastRealtimeRefreshRef.current > 2000) {
          lastRealtimeRefreshRef.current = now;
          handleRefresh();
        }
      }

      // Show a single deduped notification toast
      if (message && idMatches) {
        const toastKey = `${String(evtOrderId || orderMongoId || orderId)}:${String(status || payload.orderStatus || '')}`
        const now = Date.now()
        const isDuplicateToast =
          toastKey &&
          toastKey === lastStatusToastRef.current.key &&
          now - lastStatusToastRef.current.at < ORDER_STATUS_TOAST_DEDUPE_MS

        if (isDuplicateToast) return

        lastStatusToastRef.current = { key: toastKey, at: now }
        toast.dismiss(ORDER_STATUS_TOAST_ID)
        toast.success(message, {
          id: ORDER_STATUS_TOAST_ID,
          duration: 5000,
          position: 'top-center',
          description: estimatedDeliveryTime
            ? `Estimated delivery in ${Math.round(estimatedDeliveryTime / 60)} minutes`
            : undefined
        });

        // Optional: Vibrate device if supported
        if (navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
      }
    };

    // Listen for custom event from DeliveryTrackingMap
    window.addEventListener('orderStatusNotification', handleOrderStatusNotification);

    return () => {
      window.removeEventListener('orderStatusNotification', handleOrderStatusNotification);
    };
  }, [orderId])

  const handleCancelOrder = () => {
    // Check if order can be cancelled (only Razorpay orders that aren't delivered/cancelled)
    if (!order) return;

    if (isAdminAccepted && !isEditWindowOpen) {
      toast.error('Cancellation window ended. You can no longer cancel this order.');
      return;
    }

    if (order.status === 'cancelled') {
      toast.error('Order is already cancelled');
      return;
    }

    if (order.status === 'delivered') {
      toast.error('Cannot cancel a delivered order');
      return;
    }

    // Allow cancellation for all payment methods (Razorpay, COD, Wallet)
    // Only restrict if order is already cancelled or delivered (checked above)

    const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
    const status = String(order?.payment?.status || "").toLowerCase()
    const isRazorpayPaid =
      method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

    setRefundDestination(isRazorpayPaid ? "source" : "wallet")

    setShowCancelDialog(true);
  };

  const handleConfirmCancel = async () => {
    if (!cancellationReason.trim()) {
      toast.error('Please provide a reason for cancellation');
      return;
    }

    setIsCancelling(true);
    try {
      const cancelLookupId =
        lookupIdsRef.current[0] || normalizeLookupId(orderId)
      const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
      const status = String(order?.payment?.status || "").toLowerCase()
      const isRazorpayPaid =
        method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

      const payload = {
        reason: cancellationReason.trim(),
        ...(isRazorpayPaid ? { refundDestination } : {}),
      }

      const response = await orderAPI.cancelOrder(cancelLookupId, payload);
      if (response.data?.success) {
        const paymentMethod = order?.payment?.method || order?.paymentMethod;
        const successMessage = response.data?.message ||
          (paymentMethod === 'cash' || paymentMethod === 'cod'
            ? 'Order cancelled successfully. No refund required as payment was not made.'
            : refundDestination === 'wallet'
              ? 'Order cancelled successfully. Refund has been added to your wallet.'
              : 'Order cancelled successfully. Refund will be processed to your original payment method.');
        toast.success(successMessage);
        setShowCancelDialog(false);
        setCancellationReason("");
        setRefundDestination("source");
        // Refresh order data
        const orderResponse = await fetchOrderDetailsWithFallback({ force: true });
        if (orderResponse.data?.success && orderResponse.data.data?.order) {
          const apiOrder = orderResponse.data.data.order;
          setOrder(transformOrderForTracking(apiOrder, order));
        }
      } else {
        toast.error(response.data?.message || 'Failed to cancel order');
      }
    } catch (error) {
      debugError('Error cancelling order:', error);
      toast.error(error.response?.data?.message || 'Failed to cancel order');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleUpdateInstructions = async () => {
    try {
      setIsUpdatingInstructions(true);
      const response = await orderAPI.updateOrderInstructions(resolvedLookupId || orderId, deliveryInstructions);
      if (response.data?.success) {
        toast.success("Delivery instructions updated");
        setIsInstructionsModalOpen(false);
        const updatedOrder = response.data.data?.order;
        if (updatedOrder) {
          setOrder(prev => transformOrderForTracking(updatedOrder, prev));
        } else {
          setOrder(prev => ({ ...prev, note: deliveryInstructions }));
        }
      } else {
        toast.error(response.data?.message || "Failed to update instructions");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update instructions");
    } finally {
      setIsUpdatingInstructions(false);
    }
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Track my order from ${order?.restaurant || companyName}`,
          text: `Hey! Track my order from ${order?.restaurant || companyName} with ID #${order?.orderId || order?.id}.`,
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        toast.success("Tracking link copied to clipboard!");
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        debugError('Error sharing:', error);
        toast.error("Failed to share link");
      }
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const response = await fetchOrderDetailsWithFallback({ force: true })
      let apiOrder = null;
      if (response.data?.success && response.data.data?.order) {
        apiOrder = response.data.data.order;
      } else if (response.data?.success && response.data?.data && (response.data.data._id || response.data.data.orderId || response.data.data.id)) {
        apiOrder = response.data.data;
      } else if (response.data?.success && response.data?.order) {
        apiOrder = response.data.order;
      }

      if (apiOrder) {

        // Extract restaurant location coordinates with multiple fallbacks
        let restaurantCoords = null;
        let restaurantAddress = null;

        // Priority 1: restaurantId.location.coordinates (GeoJSON format: [lng, lat])
        if (apiOrder.restaurantId?.location?.coordinates &&
          Array.isArray(apiOrder.restaurantId.location.coordinates) &&
          apiOrder.restaurantId.location.coordinates.length >= 2) {
          restaurantCoords = apiOrder.restaurantId.location.coordinates;
        }
        // Priority 2: restaurantId.location with latitude/longitude properties
        else if (apiOrder.restaurantId?.location?.latitude && apiOrder.restaurantId?.location?.longitude) {
          restaurantCoords = [apiOrder.restaurantId.location.longitude, apiOrder.restaurantId.location.latitude];
        }
        // Priority 3: Check nested restaurant data
        else if (apiOrder.restaurant?.location?.coordinates) {
          restaurantCoords = apiOrder.restaurant.location.coordinates;
        }
        // Priority 4: Check if restaurantId is a string ID and fetch restaurant details
        else if (typeof apiOrder.restaurantId === 'string') {
          debugLog('?? restaurantId is a string ID, fetching restaurant details...', apiOrder.restaurantId);
          try {
            const restaurantResponse = await restaurantAPI.getRestaurantById(apiOrder.restaurantId);
            if (restaurantResponse?.data?.success && restaurantResponse.data.data?.restaurant) {
              const restaurant = restaurantResponse.data.data.restaurant;
              if (restaurant.location?.coordinates && Array.isArray(restaurant.location.coordinates) && restaurant.location.coordinates.length >= 2) {
                restaurantCoords = restaurant.location.coordinates;
                debugLog('? Fetched restaurant coordinates from API:', restaurantCoords);
              }
              restaurantAddress =
                restaurant?.location?.formattedAddress ||
                restaurant?.location?.address ||
                restaurant?.address ||
                null;
            }
          } catch (err) {
            debugError('? Error fetching restaurant details:', err);
          }
        }

        setOrder(transformOrderForTracking(apiOrder, order, restaurantCoords, restaurantAddress))
      }
    } catch (err) {
      debugError('Error refreshing order:', err)
    } finally {
      setIsRefreshing(false)
    }
  }

  // --------------------------------------------------------------------------
  // RENDER (Final JSX)
  // --------------------------------------------------------------------------

  // Loading state (moved after hooks)
  if (loading) {
    return (
      <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] p-4">
        <div className="max-w-lg mx-auto text-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-gray-600 dark:text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading order details...</p>
        </div>
      </AnimatedPage>
    )
  }

  // Error state (moved after hooks)
  if (error || !order) {
    return (
      <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] p-4">
        <div className="max-w-lg mx-auto text-center py-20">
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold mb-4 dark:text-gray-100">Order Not Found</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{error || 'The order you\'re looking for doesn\'t exist.'}</p>
          <Link to="/user/orders">
            <Button>Back to Orders</Button>
          </Link>
        </div>
      </AnimatedPage>
    )
  }

  const statusConfig = {
    placed: {
      title: "Order Placed",
      subtitle: "Waiting for restaurant to accept",
      color: "bg-green-600",
      iconType: 'food'
    },
    confirmed: {
      title: "Order Confirmed",
      subtitle: "Restaurant has accepted your order",
      color: "bg-green-600",
      iconType: 'food'
    },
    preparing: {
      title: "Food is being prepared",
      subtitle: typeof estimatedTime === 'number' ? `Arriving in ${estimatedTime} mins` : "Cooking your meal",
      color: "bg-green-600",
      iconType: 'food'
    },
    assigned: {
      title: "Rider is arriving",
      subtitle: "A delivery partner is arriving at the restaurant",
      color: "bg-green-600",
      iconType: 'rider'
    },
    at_pickup: {
      title: "Rider at restaurant",
      subtitle: "Rider is waiting for your order",
      color: "bg-green-600",
      iconType: 'rider'
    },
    ready: {
      title: "Handover in progress",
      subtitle: "Rider is picking up your order",
      color: "bg-green-600",
      iconType: 'rider'
    },
    on_way: {
      title: "Out for delivery",
      subtitle: typeof estimatedTime === 'number' ? `Arriving in ${estimatedTime} mins` : "Rider is out for delivery",
      color: "bg-green-600",
      iconType: 'rider'
    },
    at_drop: {
      title: "Arrived at location",
      subtitle: "Please come to the door",
      color: "bg-green-600",
      iconType: 'rider'
    },
    delivered: {
      title: "Order delivered",
      subtitle: "Enjoy your meal!",
      color: "bg-green-600",
      iconType: 'delivered'
    },
    cancelled: {
      title: "Order cancelled",
      subtitle: order?.cancellationReason || "This order has been cancelled",
      color: "bg-red-600",
      iconType: 'cancelled'
    },
    dead: {
      title: "Order Delivery Failed",
      subtitle: "We're extremely sorry for the inconvenience. Your order could not be completed.",
      color: "bg-red-600",
      iconType: 'cancelled'
    }
  }

  const currentStatus = statusConfig[orderStatus] || statusConfig.placed
  const isScheduledOrder = Boolean(order?.scheduledAt) && !['delivered', 'cancelled'].includes(orderStatus)
  const scheduledDateFormatted = order?.scheduledAt
    ? new Date(order.scheduledAt).toLocaleString("en-IN", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null
  const isDeliveredOrder =
    orderStatus === "delivered" ||
    order?.status === "delivered" ||
    Boolean(order?.deliveredAt)

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-[#0a0a0a]">
      {/* Order Confirmed Modal */}
      <AnimatePresence>
        {showConfirmation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-white dark:bg-[#1a1a1a] flex flex-col items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="text-center px-8"
            >
              <AnimatedCheckmark delay={0.1} />
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }}
                className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-6"
              >
                {isScheduledOrder ? "Order Scheduled!" : "Order Confirmed!"}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 }}
                className="text-gray-600 dark:text-gray-300 mt-2"
              >
                {isScheduledOrder
                  ? `Scheduled for ${scheduledDateFormatted}`
                  : "Your order has been placed successfully"}
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Green Header */}
      <motion.div
        className={`${currentStatus.color} text-white sticky top-0 z-40`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {/* Navigation bar */}
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/user/orders">
            <motion.button
              className="w-10 h-10 flex items-center justify-center"
              whileTap={{ scale: 0.9 }}
            >
              <ArrowLeft className="w-6 h-6" />
            </motion.button>
          </Link>
          <h2 className="font-semibold text-lg">{order.restaurant}</h2>
          <motion.button
            className="w-10 h-10 flex items-center justify-center cursor-pointer"
            whileTap={{ scale: 0.9 }}
            onClick={handleShare}
          >
            <Share2 className="w-5 h-5" />
          </motion.button>
        </div>

        {/* Status section - hidden for success milestones as requested */}
        {isScheduledOrder && ['placed', 'confirmed'].includes(orderStatus) ? (
          <div className="px-4 pb-5 text-center">
            <motion.div
              className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-1.5 mb-3"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              <Clock className="w-4 h-4" />
              <span className="text-sm font-semibold">Scheduled Order</span>
            </motion.div>
            <motion.h1
              className="text-2xl font-bold mb-2"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              Order Scheduled
            </motion.h1>
            <motion.div
              className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-5 py-2.5"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <Calendar className="w-4 h-4" />
              <span className="text-sm font-medium">{scheduledDateFormatted}</span>
              <span className="w-1 h-1 rounded-full bg-white/60" />
              <motion.button
                onClick={handleRefresh}
                className="ml-1"
                animate={{ rotate: isRefreshing ? 360 : 0 }}
                transition={{ duration: 0.5 }}
              >
                <RefreshCw className="w-4 h-4" />
              </motion.button>
            </motion.div>
            <motion.p
              className="text-xs mt-3 text-white/80"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              The restaurant will start preparing your order closer to the scheduled time
            </motion.p>
          </div>
        ) : !['at_pickup', 'ready', 'on_way', 'at_drop', 'delivered'].includes(orderStatus) && (
          <div className="px-4 pb-4 text-center">
            <motion.h1
              className="text-2xl font-bold mb-3"
              key={currentStatus.title}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {currentStatus.title}
            </motion.h1>

            {/* Status pill */}
            <motion.div
              className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <span className="text-sm">{currentStatus.subtitle}</span>
              {orderStatus === 'preparing' && (
                <>
                  <span className="w-1 h-1 rounded-full bg-white" />
                  <span className="text-sm text-orange-200">On time</span>
                </>
              )}
              <motion.button
                onClick={handleRefresh}
                className="ml-1"
                animate={{ rotate: isRefreshing ? 360 : 0 }}
                transition={{ duration: 0.5 }}
              >
              <RefreshCw className="w-4 h-4" />
            </motion.button>
          </motion.div>
        </div>
      )}
      </motion.div>

      {/* Map Section */}
      {!isDeliveredOrder && orderStatus !== 'cancelled' && orderStatus !== 'dead' && !(isScheduledOrder && ['placed', 'confirmed'].includes(orderStatus)) && (
        <MapErrorBoundary>
          <DeliveryMap
            orderId={orderId}
            order={order}
            isVisible={order !== null}
            fallbackCustomerCoords={fallbackCustomerCoords}
            userLiveCoords={userLiveCoords}
            userLocationAccuracy={userLiveLocation?.accuracy ?? null}
            onEtaUpdate={handleEtaUpdate}
          />
        </MapErrorBoundary>
      )}

      {/* Scrollable Content */}
      <div className="max-w-4xl mx-auto px-4 md:px-6 lg:px-8 py-4 md:py-6 space-y-4 md:space-y-6 pb-24 md:pb-32">
        {/* Cancellation window removed as per user request to hide immediately after acceptance */}

        {customerDeliveryOtp && orderStatus !== 'delivered' && orderStatus !== 'cancelled' && orderStatus !== 'dead' && (
          <motion.div
            className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-4 shadow-sm border border-blue-100 dark:border-blue-900/30"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28 }}
          >
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">Delivery OTP</p>
            <p className="text-2xl font-extrabold text-blue-900 dark:text-blue-200 mt-1 tracking-widest">{customerDeliveryOtp}</p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">Share this 4-digit OTP with your delivery partner at drop-off.</p>
          </motion.div>
        )}

        {/* Dynamic Status Card */}
        <motion.div
          className="bg-white dark:bg-[#1a1a1a] rounded-xl p-3 sm:p-4 shadow-sm"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          {isScheduledOrder && ['placed', 'confirmed'].includes(orderStatus) ? (
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm border border-blue-100 bg-blue-50">
                <Clock className="w-7 h-7 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100 leading-tight">Order Scheduled</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-snug">
                  {scheduledDateFormatted}
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  We'll notify you when the restaurant starts preparing
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm border border-gray-100 dark:border-gray-800 ${
                currentStatus.iconType === 'rider' ? 'bg-blue-50 dark:bg-blue-900/20' : 
                currentStatus.iconType === 'cancelled' ? 'bg-red-50 dark:bg-red-900/20' : 
                currentStatus.iconType === 'delivered' ? 'bg-green-50 dark:bg-green-900/20' : 
                'bg-orange-50 dark:bg-orange-900/20'
              }`}>
                {currentStatus.iconType === 'rider' ? (
                  <div 
                    dangerouslySetInnerHTML={{ __html: RIDER_BIKE_SVG.replace(/width="\d+"/, 'width="100%"').replace(/height="\d+"/, 'height="100%"') }} 
                    className="w-full h-full" 
                  />
                ) : currentStatus.iconType === 'cancelled' ? (
                  <div className="w-full h-full flex items-center justify-center p-2 text-red-500">
                    <X className="w-full h-full" />
                  </div>
                ) : currentStatus.iconType === 'delivered' ? (
                  <div className="w-full h-full flex items-center justify-center p-2 text-green-500">
                    <Check className="w-full h-full" />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center p-2 text-orange-500">
                    <Receipt className="w-full h-full" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100 leading-tight">{currentStatus.title}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-snug">{currentStatus.subtitle}</p>
                {orderStatus === 'dead' && (
                  <div className="mt-3 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-900/30">
                    <p className="text-sm text-red-700 dark:text-red-300 font-medium mb-2">
                      If your money was deducted, it will be automatically refunded. Please reach out to support for instant help.
                    </p>
                    <a 
                      href="tel:+919755633147" 
                      className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-2 px-4 rounded-full transition-colors shadow-sm"
                    >
                      <Phone className="w-3 h-3" />
                      Contact Admin Support
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>

        {/* Rating Logic: Show rating card after delivery */}
        {orderStatus === 'delivered' && !isOrderRated && (
          <motion.div
            className="bg-white dark:bg-[#1a1a1a] rounded-xl p-6 shadow-sm border-2 border-primary/10 relative overflow-hidden group"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
          >
            {/* Background pattern decoration */}
            <div className="absolute -top-4 -right-4 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors" />
            
            <div className="flex flex-col items-center text-center relative z-10">
              <div className="w-16 h-16 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center mb-4 transition-transform group-hover:scale-110 duration-300">
                <Star className="w-8 h-8 text-primary fill-primary" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Enjoyed your food?</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 mb-6 max-w-[280px]">
                Rate your experience with <span className="font-semibold text-gray-700 dark:text-gray-300">{order?.restaurant}</span> and help us improve!
              </p>
              
              <Button 
                onClick={handleOpenRating}
                className="w-full max-w-[200px] bg-primary hover:bg-secondary text-white font-bold h-12 rounded-xl border-none shadow-lg shadow-primary/20"
              >
                Rate Order
              </Button>
            </div>
          </motion.div>
        )}

        {/* Rating Summary: Show what the user rated */}
        {orderStatus === 'delivered' && isOrderRated && (
          <motion.div
            className="bg-white dark:bg-[#1a1a1a] rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-50 dark:border-gray-800/50">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Your Feedback
              </h3>
              <button 
                onClick={handleOpenRating}
                className="text-[10px] font-bold text-primary dark:text-orange-400 uppercase tracking-widest hover:opacity-80 transition-opacity"
              >
                Edit Rating
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Food & Restaurant</span>
                  {order?.ratings?.restaurant?.comment && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 italic mt-0.5 line-clamp-1">"{order.ratings.restaurant.comment}"</span>
                  )}
                </div>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={`res-rated-${star}`}
                      className={`w-3.5 h-3.5 ${
                        star <= (order?.ratings?.restaurant?.rating || order?.restaurantRating)
                          ? "text-yellow-400 fill-yellow-400"
                          : "text-gray-200 dark:text-gray-800"
                      }`}
                    />
                  ))}
                </div>
              </div>
              
              {hasDeliveryPartner && (
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Delivery Service</span>
                    {order?.ratings?.deliveryPartner?.comment && (
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 italic mt-0.5 line-clamp-1">"{order.ratings.deliveryPartner.comment}"</span>
                    )}
                  </div>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={`del-rated-${star}`}
                        className={`w-3.5 h-3.5 ${
                          star <= (order?.ratings?.deliveryPartner?.rating || order?.deliveryPartnerRating)
                            ? "text-yellow-400 fill-yellow-400"
                            : "text-gray-200 dark:text-gray-800"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Delivery Partner Info */}
        {order?.deliveryPartnerId && (
          <motion.div
            className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm overflow-hidden"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
          >
            <div className="flex items-center gap-3 p-4 border-b border-dashed border-gray-200 dark:border-gray-800">
              <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 overflow-hidden flex items-center justify-center flex-shrink-0 border border-blue-100 dark:border-blue-900/30 p-1">
                {order.deliveryPartner?.avatar ? (
                  <img src={order.deliveryPartner.avatar} alt="Rider" className="w-full h-full object-cover" />
                ) : (
                  <div 
                    dangerouslySetInnerHTML={{ __html: RIDER_BIKE_SVG.replace(/width="\d+"/, 'width="100%"').replace(/height="\d+"/, 'height="100%"') }} 
                    className="w-full h-full p-1" 
                  />
                )}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100">{order.deliveryPartner?.name || 'Delivery Partner'}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {orderStatus === 'delivered' ? 'Delivered your order' : 'Your delivery partner is arriving'}
                </p>
              </div>
              <motion.button
                className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center"
                onClick={handleCallRider}
                whileTap={{ scale: 0.9 }}
              >
                <Phone className="w-5 h-5 text-blue-600" />
              </motion.button>
            </div>
            {order?.note && (
              <div className="bg-blue-50/50 dark:bg-blue-900/10 p-3 mx-4 mb-4 rounded-lg flex items-start gap-2 border border-blue-100 dark:border-blue-900/20">
                <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-0.5">Instruction for Rider</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed font-medium">"{order.note}"</p>
                </div>
              </div>
            )}
          </motion.div>
        )}



        {/* Delivery Details Banner */}
        {orderStatus !== 'delivered' && orderStatus !== 'cancelled' && (
          <motion.div
            className="bg-yellow-50 dark:bg-yellow-900/10 rounded-xl p-4 text-center border dark:border-yellow-900/30"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65 }}
          >
            <p className="text-yellow-800 dark:text-yellow-400 font-medium text-sm">
              All your delivery details in one place 🥡
            </p>
          </motion.div>
        )}

        {/* Contact & Address Section */}
        <motion.div
          className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm overflow-hidden"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
        >
          <SectionItem
            icon={User}
            title={
              order?.userName ||
              order?.userId?.fullName ||
              order?.userId?.name ||
              profile?.fullName ||
              profile?.name ||
              'Customer'
            }
            subtitle={
              order?.userPhone ||
              order?.userId?.phone ||
              profile?.phone ||
              defaultAddress?.phone ||
              'Phone number not available'
            }
            showArrow={false}
          />
          <SectionItem
            iconNode={
              <div
                dangerouslySetInnerHTML={{ __html: SAFE_CUSTOMER_PIN }}
                className="w-6 h-6 [&_svg]:w-full [&_svg]:h-full [&_svg]:block"
              />
            }
            title="Delivery at Location"
            subtitle={(() => {
              // Priority 1: Use order address formattedAddress (live location address)
              if (order?.address?.formattedAddress && order.address.formattedAddress !== "Select location") {
                return order.address.formattedAddress
              }

              // Priority 2: Build full address from order address parts
              if (order?.address) {
                const orderAddressParts = []
                if (order.address.street) orderAddressParts.push(order.address.street)
                if (order.address.additionalDetails) orderAddressParts.push(order.address.additionalDetails)
                if (order.address.city) orderAddressParts.push(order.address.city)
                if (order.address.state) orderAddressParts.push(order.address.state)
                if (order.address.zipCode) orderAddressParts.push(order.address.zipCode)
                if (orderAddressParts.length > 0) {
                  return orderAddressParts.join(', ')
                }
              }

              // Priority 3: Use defaultAddress formattedAddress (live location address)
              if (defaultAddress?.formattedAddress && defaultAddress.formattedAddress !== "Select location") {
                return defaultAddress.formattedAddress
              }

              // Priority 4: Build full address from defaultAddress parts
              if (defaultAddress) {
                const defaultAddressParts = []
                if (defaultAddress.street) defaultAddressParts.push(defaultAddress.street)
                if (defaultAddress.additionalDetails) defaultAddressParts.push(defaultAddress.additionalDetails)
                if (defaultAddress.city) defaultAddressParts.push(defaultAddress.city)
                if (defaultAddress.state) defaultAddressParts.push(defaultAddress.state)
                if (defaultAddress.zipCode) defaultAddressParts.push(defaultAddress.zipCode)
                if (defaultAddressParts.length > 0) {
                  return defaultAddressParts.join(', ')
                }
              }

              return 'Add delivery address'
            })()}
            showArrow={false}
          />
          {!isAdminAccepted && orderStatus !== 'cancelled' && orderStatus !== 'delivered' && (
            <SectionItem
              icon={MessageSquare}
              title={order?.note ? "Edit delivery instructions" : "Add delivery instructions"}
              subtitle={order?.note ? order.note.substring(0, 35) + (order.note.length > 35 ? "..." : "") : ""}
              onClick={() => {
                setDeliveryInstructions(order?.note || "");
                setIsInstructionsModalOpen(true);
              }}
            />
          )}
        </motion.div>

        {/* Restaurant Section */}
        <motion.div
          className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm overflow-hidden"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75 }}
        >
          <div className="flex items-center gap-3 p-4 border-b border-dashed border-gray-200 dark:border-gray-800">
            <div className="w-12 h-12 rounded-full bg-orange-100 overflow-hidden flex items-center justify-center flex-shrink-0">
              <div
                dangerouslySetInnerHTML={{ __html: SAFE_RESTAURANT_PIN }}
                className="w-7 h-7 [&_svg]:w-full [&_svg]:h-full [&_svg]:block"
              />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900 dark:text-gray-100">{order.restaurant}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{order.restaurantAddress || 'Restaurant location'}</p>
            </div>
            <motion.button
              className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center"
              onClick={handleCallRestaurant}
              whileTap={{ scale: 0.9 }}
            >
              <Phone className="w-5 h-5 text-primary" />
            </motion.button>
          </div>

          {/* Order Items */}
          <div
            className="p-4 border-b border-dashed border-gray-200 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            onClick={() => setShowOrderDetails(true)}
          >
            <div className="flex items-start gap-3">
              <Receipt className="w-5 h-5 text-gray-500 mt-0.5" />
              <div className="flex-1">
                <div className="mt-2 space-y-1">
                  {order?.items?.map((item, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="w-4 h-4 rounded border border-green-600 flex items-center justify-center">
                        <span className="w-2 h-2 rounded-full bg-green-600" />
                      </span>
                      <span>{item.quantity} x {item.name}{item.variantName ? ` (${item.variantName})` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        </motion.div>

        {cancelSecondsRemaining > 0 && orderStatus !== 'cancelled' && orderStatus !== 'delivered' && orderStatus !== 'picked_up' && (
          <motion.div
            className="flex flex-col gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
          >
            <Button
              variant="outline"
              className="w-full text-red-600 border-red-100 hover:bg-red-50 h-12 rounded-xl font-semibold"
              onClick={handleCancelOrder}
            >
              Cancel Order ({cancelSecondsRemaining}s)
            </Button>
            <p className="text-[10px] text-gray-400 text-center px-4">
              You can cancel your order for free within the next {cancelSecondsRemaining} seconds.
            </p>
          </motion.div>
        )}

      </div>

      {/* Cancel Order Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="sm:max-w-xl w-[95%] max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              Cancel Order
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-6 px-2">
            {(() => {
              const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
              const status = String(order?.payment?.status || "").toLowerCase()
              const isRazorpayPaid =
                method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

              if (!isRazorpayPaid) return null

              return (
                <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-900">Refund preference</p>
                  <div className="space-y-2">
                    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                      <input
                        type="radio"
                        name="refund-destination"
                        value="source"
                        checked={refundDestination === "source"}
                        onChange={() => setRefundDestination("source")}
                        disabled={isCancelling}
                        className="mt-0.5"
                      />
                      <span className="text-sm text-gray-700">Refund to original payment method (5-7 working days)</span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                      <input
                        type="radio"
                        name="refund-destination"
                        value="wallet"
                        checked={refundDestination === "wallet"}
                        onChange={() => setRefundDestination("wallet")}
                        disabled={isCancelling}
                        className="mt-0.5"
                      />
                      <span className="text-sm text-gray-700">Refund to wallet (instant credit)</span>
                    </label>
                  </div>
                </div>
              )
            })()}

            <div className="space-y-2 w-full">
              <Textarea
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                placeholder="e.g., Changed my mind, Wrong address, etc."
                className="w-full min-h-[100px] resize-none border-2 border-gray-300 rounded-lg px-4 py-3 text-sm focus:border-red-500 focus:ring-2 focus:ring-red-200 focus:outline-none transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed disabled:border-gray-200"
                disabled={isCancelling}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCancelDialog(false);
                  setCancellationReason("");
                  setRefundDestination("source");
                }}
                disabled={isCancelling}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmCancel}
                disabled={isCancelling || !cancellationReason.trim()}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  'Confirm Cancellation'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Details Dialog */}
      <Dialog open={showOrderDetails} onOpenChange={setShowOrderDetails}>
        <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md bg-white dark:bg-[#1a1a1a] rounded-2xl p-0 overflow-hidden border-none outline-none">
          <DialogHeader className="p-6 pb-4 border-b border-gray-100 dark:border-gray-800 pr-12">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-bold text-gray-900">Order Details</DialogTitle>
            </div>
          </DialogHeader>

          <div className="p-6 pt-4 space-y-6 max-h-[70vh] overflow-y-auto">
            {/* Order Meta Info */}
            <div className="flex flex-col gap-1 b">
              <div className="flex items-center gap-4 mt-2">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Date & Time</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {order?.createdAt ? new Date(order.createdAt).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true
                    }) : 'N/A'}
                  </p>
                </div>
                <div className="h-8 w-px bg-gray-100" />
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Status</p>
                  <span className="text-sm font-bold text-green-600 uppercase">
                    {order?.status?.replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>

            {/* Delivery Instructions Section */}
            {order?.note && (
              <div className="bg-orange-50/50 rounded-xl p-4 border border-orange-100 flex gap-3">
                <MessageSquare className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-#55254b font-bold uppercase tracking-wider mb-1">Delivery Instructions</p>
                  <p className="text-sm text-gray-800 leading-relaxed font-medium capitalize">
                    {order.note}
                  </p>
                </div>
              </div>
            )}

            {/* Items Section */}
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Order Items</p>
              <div className="space-y-4">
                {order?.items?.map((item, index) => (
                  <div key={index} className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-5 h-5 rounded border border-green-600 flex items-center justify-center mt-0.5 shrink-0">
                        <div className="w-2.5 h-2.5 rounded-full bg-green-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900 leading-tight">{item.name}</p>
                        {item.variantName ? (
                          <p className="text-sm text-gray-500 mt-0.5">{item.variantName}</p>
                        ) : null}
                        <p className="text-sm text-gray-500 mt-0.5">Quantity: {item.quantity}</p>
                      </div>
                    </div>
                    <p className="font-semibold text-gray-900">₹{((item?.price || 0) * (item?.quantity || 0)).toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Bill Summary */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-1">Bill Summary</p>
              
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Item Total</span>
                <span className="text-gray-900 font-medium">₹{Number(order?.subtotal || 0).toFixed(2)}</span>
              </div>

              {Number(order?.packagingFee) > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Packaging Charges</span>
                  <span className="text-gray-900 font-medium">₹{Number(order.packagingFee).toFixed(2)}</span>
                </div>
              )}

              {Number(order?.platformFee) > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Platform Fee</span>
                  <span className="text-gray-900 font-medium">₹{Number(order.platformFee).toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Delivery Fee</span>
                <span className="text-gray-900 font-medium">₹{Number(order?.deliveryFee || 0).toFixed(2)}</span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">GST</span>
                <span className="text-gray-900 font-medium">₹{Number(order?.gst || 0).toFixed(2)}</span>
              </div>

              {Number(order?.discount) > 0 && (
                <div className="flex justify-between items-center text-sm text-green-600 font-medium">
                  <span>Discount Applied</span>
                  <span>-₹{Number(order.discount).toFixed(2)}</span>
                </div>
              )}

              <div className="pt-2 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center">
                <span className="text-base font-bold text-gray-900 dark:text-white">Total Amount</span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">₹{Number(order?.totalAmount || 0).toFixed(2)}</span>
              </div>
            </div>

            {/* Payment Method */}
            {order?.paymentMethod && (
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-gray-600">
                  <Shield className="w-4 h-4" />
                  <span className="text-sm font-medium">Payment Method</span>
                </div>
                <span className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                  {order.paymentMethod}
                </span>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-gray-100">
            <Button
              onClick={() => setShowOrderDetails(false)}
              className="w-full bg-gray-900 text-white font-bold h-12 rounded-xl"
            >
              Okay
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delivery Instructions Modal */}
      <Dialog open={isInstructionsModalOpen} onOpenChange={setIsInstructionsModalOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-3xl p-6 border-0 shadow-2xl bg-white dark:bg-[#1a1a1a] max-h-[90vh] overflow-y-auto z-[200]">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-xl font-bold bg-gradient-to-r from-#55254b to-orange-400 bg-clip-text text-transparent">
              Delivery Instructions
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Add instructions for the delivery partner to help them find your address or know where to leave your order.
            </p>
            <Textarea
              value={deliveryInstructions}
              onChange={(e) => setDeliveryInstructions(e.target.value)}
              placeholder="E.g. Ring the doorbell, leave at the front desk..."
              className="min-h-[120px] resize-none border-gray-200 focus:ring-primary rounded-xl bg-gray-50 text-base"
            />
            <Button 
              onClick={handleUpdateInstructions} 
              disabled={isUpdatingInstructions}
              className="w-full bg-gradient-to-r from-primary to-amber-500 hover:from-#55254b hover:to-amber-600 text-white font-bold h-12 rounded-xl border-none"
            >
              {isUpdatingInstructions ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Save Instructions"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rating & Feedback Modal */}
      <Dialog open={showRatingModal} onOpenChange={setShowRatingModal}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-3xl p-6 border-0 shadow-2xl bg-white dark:bg-[#1a1a1a] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Star className="w-6 h-6 text-primary fill-primary" />
              Rate your Experience
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Restaurant Rating */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-800 dark:text-gray-200">How was the food?</p>
                <span className="text-xs px-2 py-0.5 bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400 rounded-full font-medium">Restaurant</span>
              </div>
              <div className="flex justify-center gap-3">
                {[1, 2, 3, 4, 5].map((star) => (
                  <motion.button
                    key={`res-star-${star}`}
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setSelectedRestaurantRating(star)}
                    className="p-1"
                  >
                    <Star
                      className={`w-10 h-10 transition-all duration-300 ${
                        star <= selectedRestaurantRating
                          ? "text-yellow-400 fill-yellow-400 drop-shadow-sm"
                          : "text-gray-200 dark:text-gray-800"
                      }`}
                    />
                  </motion.button>
                ))}
              </div>
              <Textarea
                placeholder="Write a quick review for the food (optional)"
                value={restaurantFeedbackText}
                onChange={(e) => setRestaurantFeedbackText(e.target.value)}
                className="min-h-[80px] text-sm bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800 resize-none rounded-xl"
              />
            </div>

            {/* Delivery Rating */}
            {hasDeliveryPartner && (
              <div className="space-y-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gray-800 dark:text-gray-200">How was the delivery?</p>
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400 rounded-full font-medium">Delivery</span>
                </div>
                <div className="flex justify-center gap-3">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <motion.button
                      key={`del-star-${star}`}
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setSelectedDeliveryRating(star)}
                      className="p-1"
                    >
                      <Star
                        className={`w-10 h-10 transition-all duration-300 ${
                          star <= selectedDeliveryRating
                            ? "text-yellow-400 fill-yellow-400 drop-shadow-sm"
                            : "text-gray-200 dark:text-gray-800"
                        }`}
                      />
                    </motion.button>
                  ))}
                </div>
                <Textarea
                  placeholder={`How was ${order?.deliveryPartnerName || 'the rider'}? (optional)`}
                  value={deliveryFeedbackText}
                  onChange={(e) => setDeliveryFeedbackText(e.target.value)}
                  className="min-h-[80px] text-sm bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800 resize-none rounded-xl"
                />
              </div>
            )}

            <Button
              onClick={handleSubmitRating}
              disabled={submittingRating || selectedRestaurantRating === null || (hasDeliveryPartner && selectedDeliveryRating === null)}
              className="w-full bg-primary hover:bg-secondary text-white font-bold h-14 rounded-2xl shadow-lg mt-4"
            >
              {submittingRating ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit Feedback"}
            </Button>
            
            <button
              onClick={() => setShowRatingModal(false)}
              className="w-full text-sm text-gray-400 dark:text-gray-500 font-medium hover:text-gray-600 dark:hover:text-gray-400 transition-colors py-2"
            >
              Maybe later
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

