import { useState, useEffect, useRef, Component, useMemo } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import { restaurantAPI, diningAPI, orderAPI } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import { toast } from "sonner"
import { useAppLocation } from "@food/hooks/useAppLocation"
import {
  ArrowLeft,
  Search,
  MoreVertical,
  MapPin,
  Clock,
  ChevronDown,
  Info,
  Star,
  SlidersHorizontal,
  Utensils,
  Flame,
  Bookmark,
  Share2,
  Plus,
  Minus,
  X,
  RotateCcw,
  Zap,
  Check,
  Lock,
  Percent,
  Eye,
  Users,
  AlertCircle,
  Copy,
  MessageCircle,
  Send,
  Mail,
  Tag,
} from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Badge } from "@food/components/ui/badge"
import { Checkbox } from "@food/components/ui/checkbox"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { useCart } from "@food/context/CartContext"
import { useProfile } from "@food/context/ProfileContext"
import AddToCartAnimation from "@food/components/user/AddToCartAnimation"
import { getCompanyNameAsync } from "@food/utils/businessSettings"
import { isModuleAuthenticated } from "@food/utils/auth"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import { extractImages, normalizeImageUrl } from "@food/utils/common"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import {
  buildCartLineId,
  getDefaultFoodVariant,
  getFoodDisplayPrice,
  getFoodPriceLabel,
  getFoodVariants,
  hasFoodVariants,
} from "@food/utils/foodVariants"
import fssaiLogo from "@food/assets/fssai.png"
import { RestaurantDetailSkeleton } from "@food/components/ui/loading-skeletons"
import MenuScanAnimation from "@food/components/user/MenuScanAnimation"

const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }



const RUPEE_SYMBOL = "\u20B9"
const RESTAURANT_DETAILS_FILTERS_STORAGE_KEY = "food-restaurant-details-filters"

const DishImage = ({ src, alt, className = "" }) => {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  if (!src || failed) {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 ${className}`}>
        <span className="text-xs text-gray-400">No image</span>
      </div>
    )
  }

  return (
    <div className={`relative w-full h-full ${className}`}>
      {/* Placeholder / Skeleton */}
      {!loaded && (
        <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700 animate-pulse flex items-center justify-center">
          <Utensils className="h-6 w-6 text-gray-400 dark:text-gray-500 opacity-50" />
        </div>
      )}

      {/* Actual Image */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setFailed(true)
          setLoaded(true)
        }}
      />
    </div>
  )
}

function RestaurantDetailsContent() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const [searchParams] = useSearchParams()
  const showOnlyUnder250 = searchParams.get('under250') === 'true'
  const targetDishId = useMemo(() => String(searchParams.get('dish') || '').trim(), [searchParams])
  const BACKEND_ORIGIN = useMemo(() => API_BASE_URL.replace(/\/api(\/v\d+)?\/?$/, ""), [])
  const { addToCart, updateQuantity, removeFromCart, getCartItem, cart } = useCart()
  const { vegMode, vegModeOption, addDishFavorite, removeDishFavorite, isDishFavorite, getDishFavorites, getFavorites, addFavorite, removeFavorite, isFavorite } = useProfile()
  const { location: userLocation, zoneId, zone, loading: loadingZone, isOutOfService, serviceUnavailableMessage } = useAppLocation()
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [quantities, setQuantities] = useState({})
  const [showManageCollections, setShowManageCollections] = useState(false)
  const [showItemDetail, setShowItemDetail] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [selectedVariantId, setSelectedVariantId] = useState("")
  const [showFilterSheet, setShowFilterSheet] = useState(false)
  const [showLocationSheet, setShowLocationSheet] = useState(false)
  const [showScheduleSheet, setShowScheduleSheet] = useState(false)
  const [showOffersSheet, setShowOffersSheet] = useState(false)
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null)
  const [expandedCoupons, setExpandedCoupons] = useState(new Set())
  const [showMenuSheet, setShowMenuSheet] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [availabilityTick, setAvailabilityTick] = useState(Date.now())
  const [showMenuOptionsSheet, setShowMenuOptionsSheet] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharePayload, setSharePayload] = useState(null)
  const [expandedAddButtons, setExpandedAddButtons] = useState(new Set())
  const [expandedSections, setExpandedSections] = useState(new Set([0])) // Default: Recommended section is expanded
  const [highlightedDishId, setHighlightedDishId] = useState(null)
  const [loadingMenuItems, setLoadingMenuItems] = useState(true)
  const [menuUnavailable, setMenuUnavailable] = useState(false)
  const [selectedMenuCategory, setSelectedMenuCategory] = useState("all")
  const [visibleItemCount, setVisibleItemCount] = useState(20)
  const dishCardRefs = useRef({})
  const [showScanAnimation, setShowScanAnimation] = useState(true)

  const getLineItemIdForDish = (item, variant = null) =>
    buildCartLineId(item?.id || item?._id || "", variant?.id || variant?._id || "")

  const getVariantForDish = (item, preferredVariantId = "") => {
    const variants = getFoodVariants(item)
    if (variants.length === 0) return null
    return variants.find((variant) => String(variant.id) === String(preferredVariantId || "")) || variants[0]
  }

  const getDishQuantity = (item, preferredVariantId = "") => {
    const variant = getVariantForDish(item, preferredVariantId)
    const lineItemId = getLineItemIdForDish(item, variant)
    return quantities[lineItemId] || 0
  }

  // Initialize default filters
  const [filters, setFilters] = useState({
    sortBy: null,
    vegNonVeg: null,
    highlyReordered: false,
    spicy: false,
  })

  // Restaurant data state
  const [restaurant, setRestaurant] = useState(null)
  const [loadingRestaurant, setLoadingRestaurant] = useState(true)
  const [restaurantError, setRestaurantError] = useState(null)
  const fetchedRestaurantRef = useRef(false) // Track if restaurant has been fetched for current slug
  const fetchedSlugRef = useRef(null)
  const fetchedZoneIdRef = useRef(null)

  // Public offers state for dynamic pricing
  const [publicOffers, setPublicOffers] = useState([])
  const publicOffersFetchedRef = useRef(false)

  useEffect(() => {
    if (!publicOffersFetchedRef.current) {
      publicOffersFetchedRef.current = true
      restaurantAPI.getPublicOffers().then(res => {
        const list = res?.data?.data?.allOffers || res?.data?.allOffers || [];
        setPublicOffers(list);
      }).catch(err => {
        debugWarn("Failed to fetch public offers:", err)
      });
    }
  }, [])

  useEffect(() => {
    // Scroll to top when the component mounts (e.g. from search navigation)
    window.scrollTo(0, 0)

    const intervalId = setInterval(() => {
      setAvailabilityTick(Date.now())
    }, 60000)

    return () => clearInterval(intervalId)
  }, [])

  useEffect(() => {
    setSelectedMenuCategory("all")
  }, [slug])

  // Fetch restaurant data from API
  useEffect(() => {
    const fetchRestaurant = async () => {
      if (!slug) return

      // Prevent re-fetching for the same slug and zoneId. Mobile location/zone updates can
      // trigger transient refetch failures that clear already-rendered content.
      if (fetchedRestaurantRef.current && fetchedSlugRef.current === slug && fetchedZoneIdRef.current === zoneId && restaurant) {
        return
      }

      try {
        // Keep the existing page visible on background retries.
        setLoadingRestaurant(!fetchedRestaurantRef.current && !restaurant)
        setRestaurantError(null)

        debugLog('Fetching restaurant with slug:', slug)
        let response = null
        let apiRestaurant = null

        // Create request config with location if available
        const requestConfig = { noCache: true }
        if (Number.isFinite(userLocation?.latitude) && Number.isFinite(userLocation?.longitude)) {
          requestConfig.params = { lat: userLocation.latitude, lng: userLocation.longitude }
        }

        // Try dining API first (if available). If it doesn't return a valid restaurant,
        // always fall back to restaurant API (important when diningAPI is stubbed).
        try {
          response = await diningAPI.getRestaurantBySlug(slug, requestConfig)
          if (response?.data?.success && response?.data?.data) {
            apiRestaurant = response.data.data
            debugLog('? Found restaurant in dining API:', apiRestaurant)
          } else {
            debugLog('? Dining API returned no restaurant, falling back to restaurant API...')
          }
        } catch (diningError) {
          // If dining API errors, we still fall back unless it's a hard network failure handled below.
          if (diningError?.response?.status === 404) {
            debugLog('? Restaurant not found in dining API, trying restaurant API...')
          } else {
            debugWarn('? Dining API failed, trying restaurant API...', diningError?.message)
          }
        }

        // Restaurant API fallback (works for both ObjectId and slug)
        if (!apiRestaurant) {
          try {
            // First, try to get restaurant directly by slug/ID (no zoneId needed)
            try {
              response = await restaurantAPI.getRestaurantById(slug, requestConfig)
              if (response?.data?.success && response?.data?.data) {
                apiRestaurant = response.data.data
                debugLog('? Found restaurant in restaurant API by slug/ID:', apiRestaurant)
              }
            } catch (directLookupError) {
              // If direct lookup fails, try searching by name.
              // Fallback without zoneId so missing live location never blocks this page.
              debugLog('? Direct lookup failed, trying search by name...')

              const searchVariants = zoneId
                ? [{ limit: 100, zoneId: zoneId, _ts: Date.now() }, { limit: 100, _ts: Date.now() }]
                : [{ limit: 100, _ts: Date.now() }]

              for (const searchParams of searchVariants) {
                try {
                  const searchResponse = await restaurantAPI.getRestaurants(searchParams, { noCache: true })
                  const restaurants = searchResponse?.data?.data?.restaurants || searchResponse?.data?.data || []

                  // Try to find by slug match or name match
                  const restaurantName = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                  const matchingRestaurant = restaurants.find(r =>
                    r.slug === slug ||
                    r.name?.toLowerCase().replace(/\s+/g, '-') === slug.toLowerCase() ||
                    r.name?.toLowerCase() === restaurantName.toLowerCase()
                  )

                  if (matchingRestaurant) {
                    // Get full restaurant details by ID
                    const requestConfigFallback = { noCache: true }
                    if (Number.isFinite(userLocation?.latitude) && Number.isFinite(userLocation?.longitude)) {
                      requestConfigFallback.params = { lat: userLocation.latitude, lng: userLocation.longitude }
                    }
                    const fullResponse = await restaurantAPI.getRestaurantById(matchingRestaurant._id || matchingRestaurant.restaurantId, requestConfigFallback)
                    if (fullResponse.data && fullResponse.data.success && fullResponse.data.data) {
                      apiRestaurant = fullResponse.data.data
                      debugLog('? Found restaurant in restaurant API by name search:', apiRestaurant)
                      break
                    }
                  }
                } catch (searchError) {
                  debugWarn('? Search fallback failed for params:', searchParams, searchError?.message)
                }
              }
            }
          } catch (restaurantError) {
            debugError('? Restaurant not found in restaurant API either:', restaurantError)
          }
        }

        if (apiRestaurant) {
          debugLog('? Fetched restaurant from API:', apiRestaurant)
          debugLog('? Restaurant data keys:', Object.keys(apiRestaurant))
          debugLog('? Restaurant name field:', apiRestaurant?.name)
          debugLog('? Restaurant restaurantId:', apiRestaurant?.restaurantId)
          debugLog('? Restaurant _id:', apiRestaurant?._id)
          debugLog('? Restaurant.restaurant:', apiRestaurant?.restaurant)

          // Check if this is a dining restaurant with nested restaurant data
          const actualRestaurant = apiRestaurant?.restaurant || apiRestaurant

          // Helper function to format address with zone and pin code
          const formatRestaurantAddress = (locationObj) => {
            if (!locationObj) return "Location"

            // If location is a string, return it as is
            if (typeof locationObj === 'string') {
              return locationObj
            }

            // PRIORITY 1: Use formattedAddress if it's complete and has pin code
            // formattedAddress usually has the most complete information from Google Maps
            if (locationObj.formattedAddress && locationObj.formattedAddress.trim() !== "" && locationObj.formattedAddress !== "Select location") {
              const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(locationObj.formattedAddress.trim())
              if (!isCoordinates) {
                const formattedAddr = locationObj.formattedAddress.trim()
                // Check if it contains a pin code (6 digit number)
                const hasPinCode = /\b\d{6}\b/.test(formattedAddr)
                // If it has pin code, it's complete - use it directly
                if (hasPinCode) {
                  // Clean up the address - remove Google Plus Code if present (e.g., "PV6X+JXX, ")
                  const cleanedAddr = formattedAddr.replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                  return cleanedAddr
                }
                // If it has multiple parts (3+), it's likely complete
                if (formattedAddr.split(',').length >= 3) {
                  const cleanedAddr = formattedAddr.replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                  return cleanedAddr
                }
              }
            }

            // PRIORITY 2: Build address from location object components (with zone and pin code)
            // This ensures we always show zone and pin code if available
            const addressParts = []

            // Add addressLine1 if available
            if (locationObj.addressLine1 && locationObj.addressLine1.trim() !== "") {
              addressParts.push(locationObj.addressLine1.trim())
            }

            // Add addressLine2 if available
            if (locationObj.addressLine2 && locationObj.addressLine2.trim() !== "") {
              addressParts.push(locationObj.addressLine2.trim())
            }

            // Add area (zone) if available
            if (locationObj.area && locationObj.area.trim() !== "") {
              addressParts.push(locationObj.area.trim())
            }

            // Add city if available
            if (locationObj.city && locationObj.city.trim() !== "") {
              addressParts.push(locationObj.city.trim())
            }

            // Add state if available
            if (locationObj.state && locationObj.state.trim() !== "") {
              addressParts.push(locationObj.state.trim())
            }

            // Add pin code (priority: pincode > zipCode > postalCode)
            const pinCode = locationObj.pincode || locationObj.zipCode || locationObj.postalCode
            if (pinCode && pinCode.toString().trim() !== "") {
              addressParts.push(pinCode.toString().trim())
            }

            // If we have at least 3 parts (complete address), use it
            if (addressParts.length >= 3) {
              return addressParts.join(', ')
            }

            // If we have at least 2 parts, use it
            if (addressParts.length >= 2) {
              return addressParts.join(', ')
            }

            // PRIORITY 3: Fallback to formattedAddress (even if incomplete)
            if (locationObj.formattedAddress && locationObj.formattedAddress.trim() !== "" && locationObj.formattedAddress !== "Select location") {
              const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(locationObj.formattedAddress.trim())
              if (!isCoordinates) {
                const cleanedAddr = locationObj.formattedAddress.trim().replace(/^[A-Z0-9]+\+[A-Z0-9]+,\s*/i, '')
                return cleanedAddr
              }
            }

            // PRIORITY 4: Fallback to address field
            if (locationObj.address && locationObj.address.trim() !== "") {
              return locationObj.address.trim()
            }

            // PRIORITY 5: Last fallback - use area or city
            return locationObj.area || locationObj.city || "Location"
          }

          // Get location object for address formatting
          const locationObj = actualRestaurant?.location || apiRestaurant?.location
          debugLog('? Location Object for formatting:', locationObj)
          debugLog('? formattedAddress field:', locationObj?.formattedAddress)
          const formattedAddress = formatRestaurantAddress(locationObj)
          debugLog('? Final Formatted Address:', formattedAddress)

          // Calculate distance from user to restaurant (with routing multiplier)
          const calculateDistance = (lat1, lng1, lat2, lng2) => {
            const R = 6371 // Earth's radius in kilometers
            const dLat = (lat2 - lat1) * Math.PI / 180
            const dLng = (lng2 - lng1) * Math.PI / 180
            const a =
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2)
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
            return (R * c) * 1.35 // Distance in kilometers with multiplier
          }

          // Get restaurant coordinates
          // Priority: latitude/longitude fields > coordinates array (GeoJSON format: [lng, lat])
          const restaurantLat = locationObj?.latitude || (locationObj?.coordinates && Array.isArray(locationObj.coordinates) ? locationObj.coordinates[1] : null)
          const restaurantLng = locationObj?.longitude || (locationObj?.coordinates && Array.isArray(locationObj.coordinates) ? locationObj.coordinates[0] : null)

          debugLog('? Restaurant coordinates:', { restaurantLat, restaurantLng, locationObj })

          // Get user coordinates
          const userLat = userLocation?.latitude
          const userLng = userLocation?.longitude

          debugLog('? User location:', { userLat, userLng, userLocation })

          // Calculate distance if both coordinates are available
          let calculatedDistance = null
          if (apiRestaurant?.distanceText) {
            calculatedDistance = apiRestaurant.distanceText
          } else if (actualRestaurant?.distanceText) {
            calculatedDistance = actualRestaurant.distanceText
          } else if (userLat && userLng && restaurantLat && restaurantLng &&
            !isNaN(userLat) && !isNaN(userLng) && !isNaN(restaurantLat) && !isNaN(restaurantLng)) {
            const distanceInKm = calculateDistance(userLat, userLng, restaurantLat, restaurantLng)
            // Format distance: show 1 decimal place if >= 1km, otherwise show in meters
            if (distanceInKm >= 1) {
              calculatedDistance = `${distanceInKm.toFixed(1)} km`
            } else {
              const distanceInMeters = Math.round(distanceInKm * 1000)
              calculatedDistance = `${distanceInMeters} m`
            }
            debugLog('? Calculated distance from user to restaurant:', calculatedDistance, 'km:', distanceInKm)
          } else {
            debugWarn('? Cannot calculate distance - missing coordinates:', {
              hasUserLocation: !!(userLat && userLng),
              hasRestaurantLocation: !!(restaurantLat && restaurantLng),
              userLat,
              userLng,
              restaurantLat,
              restaurantLng
            })
          }

          // Resolve display category/cuisine with broad API compatibility
          const categoryFromArray = (list) => {
            if (!Array.isArray(list) || list.length === 0) return null
            const firstEntry = list[0]
            if (typeof firstEntry === "string") return firstEntry
            if (firstEntry && typeof firstEntry === "object") {
              return firstEntry.name || firstEntry.label || firstEntry.title || null
            }
            return null
          }

          const resolvedTopCategory =
            actualRestaurant?.topCategory ||
            apiRestaurant?.topCategory ||
            categoryFromArray(actualRestaurant?.topCategories) ||
            categoryFromArray(apiRestaurant?.topCategories) ||
            categoryFromArray(actualRestaurant?.cuisines) ||
            categoryFromArray(apiRestaurant?.cuisines) ||
            categoryFromArray(actualRestaurant?.categories) ||
            categoryFromArray(apiRestaurant?.categories) ||
            actualRestaurant?.cuisine ||
            apiRestaurant?.cuisine ||
            actualRestaurant?.category ||
            apiRestaurant?.category ||
            "Multi-cuisine"

          const onboardingStep2 = actualRestaurant?.onboarding?.step2 || apiRestaurant?.onboarding?.step2 || {}
          const onboardingStep4 = actualRestaurant?.onboarding?.step4 || apiRestaurant?.onboarding?.step4 || {}
          const normalizedProfileImage = actualRestaurant?.profileImage || apiRestaurant?.profileImage || onboardingStep2?.profileImageUrl || null
          const normalizedCoverImages =
            Array.isArray(actualRestaurant?.coverImages) && actualRestaurant.coverImages.length > 0
              ? actualRestaurant.coverImages
              : Array.isArray(apiRestaurant?.coverImages) && apiRestaurant.coverImages.length > 0
                ? apiRestaurant.coverImages
                : []
          const normalizedMenuImages =
            Array.isArray(actualRestaurant?.menuImages) && actualRestaurant.menuImages.length > 0
              ? actualRestaurant.menuImages
              : Array.isArray(apiRestaurant?.menuImages) && apiRestaurant.menuImages.length > 0
                ? apiRestaurant.menuImages
                : Array.isArray(onboardingStep2?.menuImageUrls)
                  ? onboardingStep2.menuImageUrls
                  : []
          const normalizedRestaurantOffers = actualRestaurant?.restaurantOffers || apiRestaurant?.restaurantOffers || {}

          // Transform API data to match expected format with comprehensive fallbacks
          // Handle both dining restaurant and regular restaurant data structures
          const transformedRestaurant = {
            id: actualRestaurant?.restaurantId || actualRestaurant?._id || actualRestaurant?.id || apiRestaurant?.restaurantId || apiRestaurant?._id || null,
            mongoId: actualRestaurant?._id || apiRestaurant?._id || null,
            name:
              actualRestaurant?.name ||
              actualRestaurant?.restaurantName ||
              apiRestaurant?.name ||
              apiRestaurant?.restaurantName ||
              "Unknown Restaurant",
            cuisine: resolvedTopCategory,
            topCategory: resolvedTopCategory,
            rating: actualRestaurant?.rating || apiRestaurant?.rating || actualRestaurant?.averageRating || apiRestaurant?.averageRating || null,
            reviews: actualRestaurant?.totalRatings || apiRestaurant?.totalRatings || actualRestaurant?.reviewCount || apiRestaurant?.reviewCount || actualRestaurant?.reviews?.length || apiRestaurant?.reviews?.length || 0,
            deliveryTime: actualRestaurant?.estimatedDeliveryTime || apiRestaurant?.estimatedDeliveryTime || actualRestaurant?.deliveryTime || apiRestaurant?.deliveryTime || actualRestaurant?.avgDeliveryTime || apiRestaurant?.avgDeliveryTime || "25-30 mins",
            distance: calculatedDistance || actualRestaurant?.distance || apiRestaurant?.distance || actualRestaurant?.distanceFromUser || apiRestaurant?.distanceFromUser || "1.2 km",
            location: formattedAddress,
            locationObject: locationObj, // Store full location object for reference
            image: normalizedCoverImages?.[0]?.url
              || normalizedCoverImages?.[0]
              || normalizedProfileImage?.url
              || normalizedProfileImage
              || (normalizedMenuImages.length > 0
                ? (normalizedMenuImages[0]?.url || normalizedMenuImages[0])
                : null)
              || actualRestaurant?.image
              || apiRestaurant?.image
              || null,
            priceRange: actualRestaurant?.priceRange || apiRestaurant?.priceRange || onboardingStep4?.priceRange || "$$",
            offers: Array.isArray(actualRestaurant?.offers) ? actualRestaurant.offers : (Array.isArray(apiRestaurant?.offers) ? apiRestaurant.offers : []), // Will be populated from menu/offers API later
            offerText: actualRestaurant?.offer || apiRestaurant?.offer || onboardingStep4?.offer || "",
            offerCount: actualRestaurant?.offerCount || apiRestaurant?.offerCount || 0,
            restaurantOffers: {
              goldOffer: {
                title: normalizedRestaurantOffers?.goldOffer?.title || "Gold exclusive offer",
                description: apiRestaurant?.restaurantOffers?.goldOffer?.description || "Free delivery above ₹99",
                unlockText: normalizedRestaurantOffers?.goldOffer?.unlockText || "join Gold to unlock",
                buttonText: apiRestaurant?.restaurantOffers?.goldOffer?.buttonText || "Add Gold - ₹1",
              },
              coupons: Array.isArray(normalizedRestaurantOffers?.coupons)
                ? normalizedRestaurantOffers.coupons
                : [],
            },
            outlets: Array.isArray(actualRestaurant?.outlets) ? actualRestaurant.outlets : (Array.isArray(apiRestaurant?.outlets) ? apiRestaurant.outlets : []),
            categories: Array.isArray(actualRestaurant?.categories) ? actualRestaurant.categories : (Array.isArray(apiRestaurant?.categories) ? apiRestaurant.categories : []),
            menu: Array.isArray(actualRestaurant?.menu) ? actualRestaurant.menu : (Array.isArray(apiRestaurant?.menu) ? apiRestaurant.menu : []),
            slug: actualRestaurant?.slug || apiRestaurant?.slug || actualRestaurant?.name?.toLowerCase().replace(/\s+/g, '-') || apiRestaurant?.name?.toLowerCase().replace(/\s+/g, '-') || slug || "unknown",
            restaurantId: actualRestaurant?.restaurantId || actualRestaurant?._id || actualRestaurant?.id || apiRestaurant?.restaurantId || apiRestaurant?._id || apiRestaurant?.id || null,
            // Add other fields with defaults
            featuredDish: actualRestaurant?.featuredDish || apiRestaurant?.featuredDish || onboardingStep4?.featuredDish || "Special Dish",
            featuredPrice: actualRestaurant?.featuredPrice || apiRestaurant?.featuredPrice || onboardingStep4?.featuredPrice || 249,
            // Additional safety fields
            openDays: Array.isArray(actualRestaurant?.openDays)
              ? actualRestaurant.openDays
              : (Array.isArray(apiRestaurant?.openDays) ? apiRestaurant.openDays : (Array.isArray(onboardingStep2?.openDays) ? onboardingStep2.openDays : [])),
            deliveryTimings: actualRestaurant?.deliveryTimings || apiRestaurant?.deliveryTimings || {
              openingTime: actualRestaurant?.openingTime || apiRestaurant?.openingTime || onboardingStep2?.deliveryTimings?.openingTime || "09:00",
              closingTime: actualRestaurant?.closingTime || apiRestaurant?.closingTime || onboardingStep2?.deliveryTimings?.closingTime || "22:00",
            },
            outletTimings: actualRestaurant?.outletTimings || apiRestaurant?.outletTimings || null,
            cuisines: Array.isArray(actualRestaurant?.cuisines) ? actualRestaurant.cuisines : (Array.isArray(apiRestaurant?.cuisines) ? apiRestaurant.cuisines : (Array.isArray(onboardingStep2?.cuisines) ? onboardingStep2.cuisines : [])),
            profileImage: normalizedProfileImage,
            coverImages: normalizedCoverImages,
            menuImages: normalizedMenuImages,
            // Menu sections for display (will be populated from menu API)
            menuSections: [],
            // Onboarding data including FSSAI license
            onboarding: actualRestaurant?.onboarding || apiRestaurant?.onboarding || null,
            // Availability fields for grayscale styling
            isActive: actualRestaurant?.isActive !== false, // Default to true if not specified
            isAcceptingOrders: actualRestaurant?.isAcceptingOrders !== false, // Default to true if not specified
            discount: actualRestaurant?.discount || apiRestaurant?.discount || 0,
            itemDiscounts: Array.isArray(actualRestaurant?.itemDiscounts) ? actualRestaurant.itemDiscounts : (Array.isArray(apiRestaurant?.itemDiscounts) ? apiRestaurant.itemDiscounts : []),
            discountRules: Array.isArray(actualRestaurant?.discountRules) ? actualRestaurant.discountRules : (Array.isArray(apiRestaurant?.discountRules) ? apiRestaurant.discountRules : []),
            // Preserve backend-computed road distance so it stays consistent with the Home page listing
            distanceText: apiRestaurant?.distanceText || actualRestaurant?.distanceText || null,
            distanceInfo: apiRestaurant?.distanceInfo || actualRestaurant?.distanceInfo || null,
          }

          debugLog('? Transformed restaurant:', transformedRestaurant)
          debugLog('? Restaurant ID for menu fetch:', transformedRestaurant.id)

          if (!transformedRestaurant.id) {
            debugError('? No restaurant ID found! Cannot fetch menu.')
          }

          setRestaurant(transformedRestaurant)
          fetchedRestaurantRef.current = true // Mark as fetched
          fetchedSlugRef.current = slug
          fetchedZoneIdRef.current = zoneId

          // Load outlet timings asynchronously without blocking the main render flow
          const outletRestaurantId = transformedRestaurant.mongoId || actualRestaurant?._id || apiRestaurant?._id;
          if (outletRestaurantId) {
            restaurantAPI.getOutletTimingsByRestaurantId(outletRestaurantId)
              .then(outletResponse => {
                const outletTimingsData = outletResponse?.data?.data?.outletTimings || outletResponse?.data?.outletTimings;
                if (outletTimingsData) {
                  setRestaurant((prev) => ({ ...prev, outletTimings: outletTimingsData }));
                }
              })
              .catch(outletError => {
                debugWarn("Outlet timings fetch failed, falling back to delivery timings:", outletError?.message);
              });
          }

          // Fetch menu and inventory for this restaurant
          // If no restaurant ID, try to find matching restaurant by name
          let restaurantIdForMenu = transformedRestaurant.id

          if (!restaurantIdForMenu) {
            debugWarn('? No restaurant ID available, searching for restaurant by name...')
            try {
              const searchVariants = zoneId
                ? [{ limit: 100, zoneId: zoneId, _ts: Date.now() }, { limit: 100, _ts: Date.now() }]
                : [{ limit: 100, _ts: Date.now() }]

              for (const searchParams of searchVariants) {
                const searchResponse = await restaurantAPI.getRestaurants(searchParams, { noCache: true })
                const restaurants = searchResponse?.data?.data?.restaurants || searchResponse?.data?.data || []

                // Try to find by exact name match
                const matchingRestaurant = restaurants.find(r =>
                  r.name?.toLowerCase().trim() === transformedRestaurant.name?.toLowerCase().trim()
                )

                if (matchingRestaurant) {
                  restaurantIdForMenu = matchingRestaurant._id || matchingRestaurant.restaurantId || matchingRestaurant.id
                  debugLog('? Found matching restaurant by name, ID:', restaurantIdForMenu)

                  // Update the restaurant ID in state
                  setRestaurant(prev => ({
                    ...prev,
                    id: restaurantIdForMenu,
                    restaurantId: restaurantIdForMenu
                  }))
                  break
                }
              }

              if (!restaurantIdForMenu) {
                debugWarn('? No matching restaurant found by name')
              }
            } catch (searchError) {
              debugError('? Error searching for restaurant:', searchError)
            }
          }

          const normalizedLookupIds = [
            restaurantIdForMenu,
            slug,
            transformedRestaurant.id,
            transformedRestaurant.restaurantId,
            transformedRestaurant.mongoId,
            apiRestaurant?.restaurantId,
            apiRestaurant?._id,
            actualRestaurant?.restaurantId,
            actualRestaurant?._id,
            actualRestaurant?.slug,
          ]
            .filter(Boolean)
            .map((value) => String(value).trim())
            .filter((value, index, arr) => arr.indexOf(value) === index)

          setLoadingMenuItems(true)
          setMenuUnavailable(false)
          if (normalizedLookupIds.length > 0) {
            let hasPreviousOrderForRestaurant = false
            if (isModuleAuthenticated('user')) {
              try {
                const normalize = (value) => (value ? String(value).trim().toLowerCase() : "")
                const targetRestaurantName = normalize(transformedRestaurant.name)
                const targetRestaurantIds = new Set(
                  [
                    ...normalizedLookupIds,
                    transformedRestaurant.id,
                    transformedRestaurant.restaurantId,
                    apiRestaurant?.restaurantId,
                    apiRestaurant?._id,
                    actualRestaurant?.restaurantId,
                    actualRestaurant?._id,
                  ].map(normalize).filter(Boolean)
                )

                const FETCH_LIMIT = 15;
                orderAPI.getOrders({ limit: FETCH_LIMIT, page: 1 }).then((firstResponse) => {
                  let allOrders = [];
                  if (firstResponse?.data?.success && firstResponse?.data?.data?.orders) {
                    allOrders = firstResponse.data.data.orders || [];
                  } else if (firstResponse?.data?.orders) {
                    allOrders = firstResponse.data.orders || [];
                  } else if (Array.isArray(firstResponse?.data?.data)) {
                    allOrders = firstResponse.data.data || [];
                  }

                  hasPreviousOrderForRestaurant = allOrders.some((order) => {
                    const orderRestaurantField = order?.restaurantId;
                    const candidateIds = [
                      order?.restaurantId,
                      orderRestaurantField?._id,
                      orderRestaurantField?.id,
                      orderRestaurantField?.restaurantId,
                      order?.restaurant,
                      order?.restaurant_id,
                    ].map(normalize).filter(Boolean);

                    if (candidateIds.some((id) => targetRestaurantIds.has(id))) {
                      return true;
                    }

                    const candidateNames = [
                      order?.restaurantName,
                      orderRestaurantField?.name,
                      order?.restaurant?.name,
                    ].map(normalize).filter(Boolean);

                    return !!targetRestaurantName && candidateNames.includes(targetRestaurantName);
                  });

                  // Need to update state if component uses this variable to re-render recommendation section
                  // Since the state update might be missing here, the UI won't reflect it if fetched late,
                  // but we at least avoid blocking the main menu load!
                }).catch(err => {
                  debugWarn("Could not fetch previous orders:", err);
                });
              } catch (orderCheckError) {
                debugWarn("Could not verify previous orders for recommendation section:", orderCheckError)
              }
            }

            try {
              debugLog('? Fetching menu for restaurant ID:', restaurantIdForMenu)
              let menuResponse = null
              let resolvedMenuLookupId = null
              for (const lookupId of normalizedLookupIds) {
                try {
                  debugLog('? Fetching menu for restaurant lookup ID:', lookupId)
                  const response = await restaurantAPI.getMenuByRestaurantId(lookupId)
                  if (response?.data?.success) {
                    menuResponse = response
                    resolvedMenuLookupId = lookupId
                    break
                  }
                } catch (lookupError) {
                  if (lookupError?.response?.status !== 404) {
                    throw lookupError
                  }
                }
              }
              if (!menuResponse) {
                throw Object.assign(new Error('Menu not found'), { response: { status: 404 } })
              }
              debugLog('? Menu resolved using lookup ID:', resolvedMenuLookupId)
              if (menuResponse.data && menuResponse.data.success && menuResponse.data.data && menuResponse.data.data.menu) {
                const rawSections = menuResponse.data.data.menu.sections || []
                const toArray = (value) => {
                  if (Array.isArray(value)) return value
                  if (!value || typeof value !== "object") return []
                  return Object.values(value).filter((entry) => entry && typeof entry === "object")
                }
                const resolveItemImage = (item = {}) => {
                  const candidates = [
                    item.image,
                    item.imageUrl,
                    item.photo,
                    item.photoUrl,
                    item.menuImage,
                    item.menuImageUrl,
                    item.images,
                    item.photos,
                    item.gallery,
                    item.image?.url,
                    item.image?.secure_url,
                  ]
                  const resolved = extractImages(candidates, BACKEND_ORIGIN)[0]
                  return resolved || ""
                }

                const normalizeItem = (item = {}) => {
                  const isRecommended = item.isRecommended === true || item.isRecommended === 1 || String(item.isRecommended) === "true"
                  const isSpicy = item.isSpicy === true || item.isSpicy === 1 || String(item.isSpicy) === "true"
                  let foodType = item.foodType || "Non-Veg"
                  if (typeof foodType === 'string') {
                    if (foodType.toLowerCase() === 'veg') foodType = 'Veg'
                    else if (foodType.toLowerCase() === 'non-veg' || foodType.toLowerCase() === 'nonveg') foodType = 'Non-Veg'
                  }

                  // Derive isVeg strictly from foodType
                  const isVeg = foodType === 'Veg'

                  return {
                    ...item,
                    id: String(item.id || item._id || `${Date.now()}-${Math.random()}`),
                    name: item.name || "Unnamed Item",
                    foodType,
                    isVeg, // Explicitly set isVeg
                    price: getFoodDisplayPrice(item),
                    image: resolveItemImage(item) || normalizeImageUrl(item.image || "", BACKEND_ORIGIN),
                    variants: getFoodVariants(item),
                    variations: getFoodVariants(item),
                    isAvailable: item.isAvailable !== false,
                    isRecommended,
                    isSpicy,
                    description: typeof item.description === "string" ? item.description : "",
                  }
                }
                const menuSections = toArray(rawSections).map((section, sectionIndex) => ({
                  ...section,
                  id: String(section.id || section._id || `section-${sectionIndex}`),
                  name: section.name || section.title || "Unnamed Section",
                  items: toArray(section.items).map(normalizeItem),
                  subsections: toArray(section.subsections).map((subsection, subsectionIndex) => ({
                    ...subsection,
                    id: String(subsection.id || subsection._id || `subsection-${sectionIndex}-${subsectionIndex}`),
                    name: subsection.name || "Unnamed Subsection",
                    items: toArray(subsection.items).map(normalizeItem),
                  })),
                }))

                const menuHasItems = menuSections.some((section) => {
                  const directItems = Array.isArray(section.items) && section.items.length > 0
                  const subsectionItems = Array.isArray(section.subsections)
                    ? section.subsections.some((subsection) => Array.isArray(subsection.items) && subsection.items.length > 0)
                    : false
                  return directItems || subsectionItems
                })

                // Collect all recommended items from all sections
                // Only include items that are both recommended (isRecommended === true) AND available (isAvailable !== false)
                const recommendedItems = []
                menuSections.forEach(section => {
                  // Check direct items - only include if isRecommended is explicitly true (strict check) AND item is available
                  if (section.items && Array.isArray(section.items)) {
                    section.items.forEach(item => {
                      // Strict check: isRecommended must be exactly boolean true
                      // This will exclude: false, undefined, null, 0, "", and any other falsy values
                      if (isRecommendedItem(item) && item.isAvailable !== false) {
                        recommendedItems.push(item)
                      }
                    })
                  }
                  // Check subsection items - only include if isRecommended is explicitly true (strict check) AND item is available
                  if (section.subsections && Array.isArray(section.subsections)) {
                    section.subsections.forEach(subsection => {
                      if (subsection.items && Array.isArray(subsection.items)) {
                        subsection.items.forEach(item => {
                          // Strict check: isRecommended must be exactly boolean true
                          // This will exclude: false, undefined, null, 0, "", and any other falsy values
                          if (isRecommendedItem(item) && item.isAvailable !== false) {
                            recommendedItems.push(item)
                          }
                        })
                      }
                    })
                  }
                })

                // Debug log to verify recommended items and their isRecommended values
                debugLog('Recommended items collected:', recommendedItems.map(item => ({
                  name: item.name,
                  isRecommended: item.isRecommended,
                  isRecommendedType: typeof item.isRecommended,
                  preparationTime: item.preparationTime
                })))

                // Debug log to check preparationTime in menu sections
                debugLog('Menu sections with preparationTime:', menuSections.map(section => ({
                  sectionName: section.name,
                  items: section.items?.map(item => ({
                    name: item.name,
                    preparationTime: item.preparationTime
                  })) || []
                })))

                // Dynamically inject the specifically searched dish at the very top if targetDishId is present
                let searchedDishSection = null
                if (targetDishId) {
                  const allItemsInMenu = []
                  menuSections.forEach(s => {
                    if (s.items) allItemsInMenu.push(...s.items)
                    if (s.subsections) {
                      s.subsections.forEach(ss => {
                        if (ss.items) allItemsInMenu.push(...ss.items)
                      })
                    }
                  })
                  const matchedItem = allItemsInMenu.find(item => String(item.id || item._id || "").trim() === targetDishId)
                  if (matchedItem) {
                    searchedDishSection = {
                      name: "Result for your search",
                      items: [matchedItem],
                      subsections: [],
                      isSearchResult: true
                    }
                  }
                }

                let finalMenuSections = [...menuSections]
                if (hasPreviousOrderForRestaurant) {
                  finalMenuSections = [{ name: "Recommended for you", items: recommendedItems, subsections: [] }, ...finalMenuSections]
                }
                if (searchedDishSection) {
                  finalMenuSections = [searchedDishSection, ...finalMenuSections]
                }

                setRestaurant(prev => ({
                  ...prev,
                  menuSections: finalMenuSections,
                }))

                setMenuUnavailable(!menuHasItems)

                // Set all sections and subsections as expanded by default
                const defaultExpandedSections = new Set()
                finalMenuSections.forEach((section, originalIndex) => {
                  defaultExpandedSections.add(originalIndex)
                  if (section.subsections && Array.isArray(section.subsections)) {
                    section.subsections.forEach((_, subIndex) => {
                      defaultExpandedSections.add(`${originalIndex}-${subIndex}`)
                    })
                  }
                })
                setExpandedSections(defaultExpandedSections)

                debugLog('Fetched menu sections with recommended items:', finalMenuSections)
              }
            } catch (menuError) {
              if (menuError.response && menuError.response.status === 404) {
                debugLog('? Menu not found for this restaurant (might be a dining-only listing).')
                setMenuUnavailable(true)
              } else {
                debugError('? Error fetching menu:', menuError)
              }
            } finally {
              setLoadingMenuItems(false)
            }

            try {
              debugLog('? Fetching inventory for restaurant ID:', restaurantIdForMenu)
              let inventoryResponse = null
              let resolvedInventoryLookupId = null
              for (const lookupId of normalizedLookupIds) {
                try {
                  debugLog('? Fetching inventory for restaurant lookup ID:', lookupId)
                  const response = await restaurantAPI.getInventoryByRestaurantId(lookupId)
                  if (response?.data?.success) {
                    inventoryResponse = response
                    resolvedInventoryLookupId = lookupId
                    break
                  }
                } catch (lookupError) {
                  if (lookupError?.response?.status !== 404) {
                    throw lookupError
                  }
                }
              }
              if (!inventoryResponse) {
                throw Object.assign(new Error('Inventory not found'), { response: { status: 404 } })
              }
              debugLog('? Inventory resolved using lookup ID:', resolvedInventoryLookupId)
              if (inventoryResponse.data && inventoryResponse.data.success && inventoryResponse.data.data && inventoryResponse.data.data.inventory) {
                const inventoryCategories = inventoryResponse.data.data.inventory.categories || []

                // Normalize inventory categories to ensure proper structure
                const normalizedInventory = inventoryCategories.map((category, index) => ({
                  id: category.id || `category-${index}`,
                  name: category.name || "Unnamed Category",
                  description: category.description || "",
                  itemCount: category.itemCount || (category.items?.length || 0),
                  inStock: category.inStock !== undefined ? category.inStock : true,
                  items: Array.isArray(category.items) ? category.items.map(item => ({
                    id: String(item.id || Date.now() + Math.random()),
                    name: item.name || "Unnamed Item",
                    inStock: item.inStock !== undefined ? item.inStock : true,
                    isVeg: item.isVeg !== undefined ? item.isVeg : true,
                    stockQuantity: item.stockQuantity || "Unlimited",
                    unit: item.unit || "piece",
                    expiryDate: item.expiryDate || null,
                    lastRestocked: item.lastRestocked || null,
                  })) : [],
                  order: category.order !== undefined ? category.order : index,
                }))

                setRestaurant(prev => ({
                  ...prev,
                  inventory: normalizedInventory,
                }))
                debugLog('? Fetched and normalized inventory categories:', normalizedInventory)
              }
            } catch (inventoryError) {
              if (inventoryError.response && inventoryError.response.status === 404) {
                debugLog('? Inventory not found for this restaurant (might be a dining-only listing).')
              } else {
                debugError('? Error fetching inventory:', inventoryError)
              }
            }
          }
          else {
            setLoadingMenuItems(false)
          }
        } else {
          debugError('? No restaurant data found in API response')
          debugError('? Response:', response)
          debugError('? apiRestaurant:', apiRestaurant)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError('Restaurant not found')
            setRestaurant(null)
          }
        }
      } catch (error) {
        // Check if it's a network error (backend not running)
        const isNetworkError = error.code === 'ERR_NETWORK' || error.message === 'Network Error'

        // Check if it's a 404 error (restaurant doesn't exist)
        const is404Error = error.response?.status === 404

        if (isNetworkError) {
          // Network error - backend is not running
          // Don't show "Restaurant not found" for network errors
          // The axios interceptor will show a toast notification
          debugError('Network error fetching restaurant (backend may not be running):', error)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError('Backend server is not connected. Please make sure the backend is running.')
            setRestaurant(null)
          }
        } else if (is404Error) {
          // 404 error - restaurant doesn't exist in database
          debugLog(`Restaurant "${slug}" not found in database`)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError('Restaurant not found')
            setRestaurant(null)
          }
        } else {
          // Other errors
          debugError('Error fetching restaurant:', error)
          if (!fetchedRestaurantRef.current) {
            setRestaurantError(error.message || 'Failed to load restaurant')
            setRestaurant(null)
          }
        }
      } finally {
        setLoadingRestaurant(false)
        setLoadingMenuItems(false)
      }
    }

    // Reset fetched flag only when URL slug or zoneId changes.
    // Do not compare with restaurant.slug because canonical API slug may differ
    // from route slug (e.g. "restaurant-2513"), causing refetch loops.
    if (fetchedRestaurantRef.current && (fetchedSlugRef.current !== slug || fetchedZoneIdRef.current !== zoneId)) {
      fetchedRestaurantRef.current = false
      fetchedSlugRef.current = null
      fetchedZoneIdRef.current = null
    }

    fetchRestaurant()
  }, [slug, zoneId])

  // Track previous values to prevent unnecessary recalculations
  const prevCoordsRef = useRef({ userLat: null, userLng: null, restaurantLat: null, restaurantLng: null })
  const prevDistanceRef = useRef(null)

  // Extract restaurant coordinates as stable values (not array references)
  const restaurantLat = restaurant?.locationObject?.latitude ||
    (restaurant?.locationObject?.coordinates && Array.isArray(restaurant.locationObject.coordinates)
      ? restaurant.locationObject.coordinates[1]
      : null)
  const restaurantLng = restaurant?.locationObject?.longitude ||
    (restaurant?.locationObject?.coordinates && Array.isArray(restaurant.locationObject.coordinates)
      ? restaurant.locationObject.coordinates[0]
      : null)

  // Recalculate distance when user location updates
  useEffect(() => {
    if (!restaurant || !userLocation?.latitude || !userLocation?.longitude) return
    if (!restaurantLat || !restaurantLng) return

    const userLat = userLocation.latitude
    const userLng = userLocation.longitude

    // Check if coordinates have actually changed (with small threshold to avoid floating point issues)
    const coordsChanged =
      Math.abs(prevCoordsRef.current.userLat - userLat) > 0.0001 ||
      Math.abs(prevCoordsRef.current.userLng - userLng) > 0.0001 ||
      Math.abs(prevCoordsRef.current.restaurantLat - restaurantLat) > 0.0001 ||
      Math.abs(prevCoordsRef.current.restaurantLng - restaurantLng) > 0.0001

    // Skip recalculation if coordinates haven't changed
    if (!coordsChanged && prevDistanceRef.current !== null) {
      return
    }

    // Update refs with current coordinates
    prevCoordsRef.current = { userLat, userLng, restaurantLat, restaurantLng }

    if (userLat && userLng && restaurantLat && restaurantLng &&
      !isNaN(userLat) && !isNaN(userLng) && !isNaN(restaurantLat) && !isNaN(restaurantLng)) {

      // Calculate distance (with routing multiplier)
      const calculateDistance = (lat1, lng1, lat2, lng2) => {
        const R = 6371 // Earth's radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180
        const dLng = (lng2 - lng1) * Math.PI / 180
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return (R * c) * 1.35 // Distance in kilometers with multiplier
      }

      let calculatedDistance = null
      let distanceInKm = null

      if (restaurant?.distanceText) {
        // Prefer backend-computed road distance (Google Distance Matrix) — same source as Home page
        calculatedDistance = restaurant.distanceText
        distanceInKm = restaurant.distanceInfo?.distanceValue ? (restaurant.distanceInfo.distanceValue / 1000) : null
      } else {
        distanceInKm = calculateDistance(userLat, userLng, restaurantLat, restaurantLng)
        // Format distance: show 1 decimal place if >= 1km, otherwise show in meters
        if (distanceInKm >= 1) {
          calculatedDistance = `${distanceInKm.toFixed(1)} km`
        } else {
          const distanceInMeters = Math.round(distanceInKm * 1000)
          calculatedDistance = `${distanceInMeters} m`
        }
      }

      // Only update if distance actually changed
      if (calculatedDistance !== prevDistanceRef.current) {
        debugLog('? Recalculated distance from user to restaurant:', calculatedDistance, 'km:', distanceInKm)
        prevDistanceRef.current = calculatedDistance

        // Update restaurant distance
        setRestaurant(prev => {
          // Only update if distance actually changed to prevent infinite loop
          if (prev?.distance === calculatedDistance) {
            return prev
          }
          return {
            ...prev,
            distance: calculatedDistance
          }
        })
      }
    }
  }, [userLocation?.latitude, userLocation?.longitude, restaurantLat, restaurantLng])

  // Sync quantities from cart on mount and when restaurant changes
  useEffect(() => {
    if (!restaurant || !restaurant.name) return

    const cartQuantities = {}
    cart.forEach((item) => {
      if (item.restaurant === restaurant.name) {
        cartQuantities[item.id] = item.quantity || 0
      }
    })
    setQuantities(cartQuantities)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.name, cart])

  useEffect(() => {
    if (!selectedItem) {
      setSelectedVariantId("")
      return
    }
    const defaultVariant = getDefaultFoodVariant(selectedItem)
    setSelectedVariantId(defaultVariant?.id || "")
  }, [selectedItem])

  // Helper function to update item quantity in both local state and cart
  const updateItemQuantity = (item, newQuantity, event = null, preferredVariant = null) => {
    // Check authentication
    if (!isModuleAuthenticated('user')) {
      toast.error("Please login to add items to cart")
      navigate('/user/auth/login', { state: { from: location.pathname } })
      return
    }

    // CRITICAL: Check if user is in service zone or restaurant is available
    if (isOutOfService) {
      toast.error(serviceUnavailableMessage || 'Service is currently unavailable.');
      return;
    }

    const availability = getRestaurantAvailabilityStatus(restaurant)
    if (!availability.isOpen) {
      toast.error("Restaurant is currently offline. Please try again later.")
      return
    }

    const resolvedVariant = preferredVariant || getDefaultFoodVariant(item)
    const lineItemId = getLineItemIdForDish(item, resolvedVariant)

    // Update local state
    setQuantities((prev) => ({
      ...prev,
      [lineItemId]: newQuantity,
    }))

    // CRITICAL: Validate restaurant data before adding to cart
    if (!restaurant || !restaurant.name) {
      debugError('? Cannot add item to cart: Restaurant data is missing!');
      toast.error('Restaurant information is missing. Please refresh the page.');
      return;
    }

    // Ensure we have a valid restaurantId
    const validRestaurantId = restaurant?.restaurantId || restaurant?._id || restaurant?.id;
    if (!validRestaurantId) {
      debugError('? Cannot add item to cart: Restaurant ID is missing!', {
        restaurant: restaurant,
        restaurantId: restaurant?.restaurantId,
        _id: restaurant?._id,
        id: restaurant?.id
      });
      toast.error('Restaurant ID is missing. Please refresh the page.');
      return;
    }

    // Log for debugging
    debugLog('? Adding item to cart:', {
      itemName: item.name,
      restaurantName: restaurant.name,
      restaurantId: validRestaurantId,
      restaurant_id: restaurant._id,
      restaurant_restaurantId: restaurant.restaurantId
    });

    // Calculate the final discounted price for the cart
    const basePrice = resolvedVariant?.price ?? item.price;
    const priceNum = typeof basePrice === 'number' ? basePrice : parseFloat(String(basePrice).replace(/[^0-9.]/g, '')) || 0;
    // Evaluate Item-Specific and Smart Rules Discounts
    const { discountValue, isFlatDiscount } = calculateBestDiscount(item, priceNum);
    const finalPrice = discountValue > 0 ? Math.round(isFlatDiscount ? Math.max(0, priceNum - discountValue) : priceNum * (1 - discountValue / 100)) : priceNum;

    // Prepare cart item with all required properties
    const cartItem = {
      id: lineItemId,
      lineItemId,
      itemId: item.id,
      name: item.name,
      price: finalPrice, // Use discounted price
      originalPrice: priceNum, // Store original base price
      variantId: resolvedVariant?.id || "",
      variantName: resolvedVariant?.name || "",
      variantPrice: finalPrice, // Use discounted price for variant
      image: item.image,
      restaurant: restaurant.name, // Use restaurant.name directly (already validated)
      restaurantId: validRestaurantId, // Use validated restaurantId
      description: item.description,
      isVeg: item.isVeg === true, // Use strict check
      foodType: item.foodType, // Include foodType for robustness
      preparationTime: item.preparationTime, // Add preparationTime property
      priceOnOtherPlatforms: item.priceOnOtherPlatforms || null, // Include platform pricing for savings display
      otherPlatformGst: item.otherPlatformGst ?? null,
    }

    // Get source position for animation from event target
    // Prefer currentTarget (the button) over target (might be icon inside button)
    let sourcePosition = null
    if (event) {
      // Use currentTarget (the button element) for accurate button position
      // If currentTarget is not available, try to find the button element
      let buttonElement = event.currentTarget
      if (!buttonElement && event.target) {
        // If we clicked on an icon inside, find the closest button
        buttonElement = event.target.closest('button') || event.target
      }

      if (buttonElement) {
        // Store button reference and current viewport position
        // We'll recalculate position right before animation to account for scroll
        const rect = buttonElement.getBoundingClientRect()
        const scrollX = window.pageXOffset || window.scrollX || 0
        const scrollY = window.pageYOffset || window.scrollY || 0

        // Store both viewport position and scroll at capture time
        // This allows us to adjust for scroll changes later
        sourcePosition = {
          // Viewport-relative position at capture time
          viewportX: rect.left + rect.width / 2,
          viewportY: rect.top + rect.height / 2,
          // Scroll position at capture time
          scrollX: scrollX,
          scrollY: scrollY,
          // Store button identifier to potentially find it again
          itemId: lineItemId,
        }
      }
    }

    // Update cart context
    if (newQuantity <= 0) {
      // Pass sourcePosition and product info for removal animation
      const productInfo = {
        id: lineItemId,
        name: item.name,
        imageUrl: item.image,
      }
      removeFromCart(lineItemId, sourcePosition, productInfo)
    } else {
      const existingCartItem = getCartItem(lineItemId)
      if (existingCartItem) {
        // Prepare product info for animation
        const productInfo = {
          id: lineItemId,
          name: item.name,
          imageUrl: item.image,
        }

        // If incrementing quantity, trigger add animation with sourcePosition
        if (newQuantity > existingCartItem.quantity && sourcePosition) {
          const result = addToCart(cartItem, sourcePosition)
          if (result?.ok === false) {
            toast.error(result.error || 'Cannot add item from different restaurant. Please clear cart first.')
            return
          }
          if (newQuantity > existingCartItem.quantity + 1) {
            updateQuantity(lineItemId, newQuantity)
          }
        }
        // If decreasing quantity, trigger removal animation with sourcePosition
        else if (newQuantity < existingCartItem.quantity && sourcePosition) {
          updateQuantity(lineItemId, newQuantity, sourcePosition, productInfo)
        }
        // Otherwise just update quantity without animation
        else {
          updateQuantity(lineItemId, newQuantity)
        }
      } else {
        // Add to cart first (adds with quantity 1), then update to desired quantity
        // Pass sourcePosition when adding a new item
        const result = addToCart(cartItem, sourcePosition)
        if (result?.ok === false) {
          toast.error(result.error || 'Cannot add item from different restaurant. Please clear cart first.')
          return
        }
        if (newQuantity > 1) {
          updateQuantity(lineItemId, newQuantity)
        }
      }
    }
  }

  const isRecommendedSection = (section) => {
    const sectionName = section?.name || section?.title || ""
    if (typeof sectionName !== "string") return false
    const name = sectionName.trim().toLowerCase()
    return name === "recommended for you" || name === "result for your search"
  }

  const isRecommendedItem = (item) => {
    return item.isRecommended === true && typeof item.isRecommended === "boolean"
  }

  const getSectionDisplayName = (section) => {
    if (isRecommendedSection(section)) {
      return "Recommended for you"
    }
    if (section?.name && typeof section.name === "string" && section.name.trim()) {
      return section.name.trim()
    }
    if (section?.title && typeof section.title === "string" && section.title.trim()) {
      return section.title.trim()
    }
    return "Unnamed Section"
  }

  const normalizeMenuCategoryId = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")

  const toRenderableArray = (value) => {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== "object") return []
    return Object.values(value).filter((entry) => entry && typeof entry === "object")
  }

  const getSectionCategoryImage = (section) => {
    const directImage = typeof section?.image === "string" ? section.image.trim() : ""
    if (directImage) return directImage

    const firstSectionItemImage = toRenderableArray(section?.items).find(
      (item) => typeof item?.image === "string" && item.image.trim(),
    )?.image
    if (firstSectionItemImage) return firstSectionItemImage

    const firstSubsectionImage = toRenderableArray(section?.subsections)
      .flatMap((subsection) => toRenderableArray(subsection?.items))
      .find((item) => typeof item?.image === "string" && item.image.trim())?.image

    return firstSubsectionImage || ""
  }

  // Menu categories - dynamically generated from restaurant menu sections
  const menuCategories = useMemo(() => {
    if (!restaurant?.menuSections || !Array.isArray(restaurant.menuSections)) return []

    return restaurant.menuSections
      .map((section, index) => {
        if (isRecommendedSection(section)) return null

        const sectionTitle = getSectionDisplayName(section)
        const itemCount = Array.isArray(section?.items) ? section.items.length : 0
        const subsectionCount = Array.isArray(section?.subsections)
          ? section.subsections.reduce((sum, sub) => sum + (Array.isArray(sub?.items) ? sub.items.length : 0), 0)
          : 0
        const totalCount = itemCount + subsectionCount

        if (totalCount <= 0) return null

        return {
          id: normalizeMenuCategoryId(section?.categoryId || sectionTitle || index) || `section-${index}`,
          name: sectionTitle,
          image: getSectionCategoryImage(section),
          count: totalCount,
          sectionIndex: index,
        }
      })
      .filter(Boolean)
  }, [restaurant?.menuSections])

  // Count active filters
  const getActiveFilterCount = () => {
    let count = 0
    if (filters.sortBy) count++
    if (filters.vegNonVeg) count++
    if (filters.highlyReordered) count++
    if (filters.spicy) count++
    return count
  }

  const activeFilterCount = getActiveFilterCount()



  useEffect(() => {
    if (selectedMenuCategory === "all") return
    const categoryStillVisible = menuCategories.some((category) => category.id === selectedMenuCategory)
    if (!categoryStillVisible) {
      setSelectedMenuCategory("all")
    }
  }, [menuCategories, selectedMenuCategory])

  // Handle bookmark click
  const handleBookmarkClick = (item) => {
    const restaurantId = restaurant?.restaurantId || restaurant?._id || restaurant?.id
    if (!restaurantId) {
      toast.error("Restaurant information is missing")
      return
    }

    const dishId = item.id || item._id
    if (!dishId) {
      toast.error("Dish information is missing")
      return
    }

    const isFavorite = isDishFavorite(dishId, restaurantId)

    if (isFavorite) {
      // If already bookmarked, remove it
      removeDishFavorite(dishId, restaurantId)
      toast.success("Dish removed from favorites")
    } else {
      // Add to favorites
      const dishData = {
        id: dishId,
        name: item.name,
        description: item.description,
        price: item.price,
        originalPrice: item.originalPrice,
        image: item.image,
        restaurantId: restaurantId,
        restaurantName: restaurant?.name || "",
        restaurantSlug: restaurant?.slug || slug || "",
        foodType: item.foodType,
        isSpicy: item.isSpicy,
        customisable: item.customisable,
      }
      addDishFavorite(dishData)
      toast.success("Dish added to favorites")
    }
  }

  // Handle add to collection
  const handleAddToCollection = () => {
    const restaurantSlug = restaurant?.slug || slug || ""

    if (!restaurantSlug) {
      toast.error("Restaurant information is missing")
      return
    }

    if (!restaurant) {
      toast.error("Restaurant data not available")
      return
    }

    const isAlreadyFavorite = isFavorite(restaurantSlug)

    if (isAlreadyFavorite) {
      // Remove from collection
      removeFavorite(restaurantSlug)
      toast.success("Restaurant removed from collection")
    } else {
      // Add to collection
      addFavorite({
        slug: restaurantSlug,
        name: restaurant.name || "",
        cuisine: restaurant.cuisine || "",
        rating: restaurant.rating || 0,
        deliveryTime: restaurant.deliveryTime || restaurant.estimatedDeliveryTime || "",
        distance: restaurant.distance || "",
        priceRange: restaurant.priceRange || "",
        image: restaurant.profileImageUrl?.url || restaurant.image || ""
      })
      toast.success("Restaurant added to collection")
    }

    setShowMenuOptionsSheet(false)
  }

  // Handle share restaurant
  const handleShareRestaurant = async () => {
    const companyName = await getCompanyNameAsync()
    const restaurantSlug = restaurant?.slug || slug || ""
    const restaurantName = restaurant?.name || "this restaurant"

    // Create share URL
    const shareUrl = `${window.location.origin}/user/restaurants/${restaurantSlug}`
    const shareText = `Check out ${restaurantName} on ${companyName}! ${shareUrl}`

    const payload = {
      title: restaurantName,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      setShowMenuOptionsSheet(false)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Restaurant shared successfully")
      setShowMenuOptionsSheet(false)
      return
    }

    openShareModal(payload)
    setShowMenuOptionsSheet(false)
  }



  // Handle share click
  const handleShareClick = async (item) => {
    const dishId = item.id || item._id
    const restaurantSlug = restaurant?.slug || slug || ""

    // Create share URL
    const shareUrl = `${window.location.origin}/user/restaurants/${restaurantSlug}?dish=${dishId}`
    const shareText = `Check out ${item.name} from ${restaurant?.name || "this restaurant"}! ${shareUrl}`

    const payload = {
      title: `${item.name} - ${restaurant?.name || ""}`,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Dish shared successfully")
      return
    }

    openShareModal(payload)
  }

  // Copy to clipboard helper
  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Link copied to clipboard!")
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement("textarea")
      textArea.value = text
      textArea.style.position = "fixed"
      textArea.style.opacity = "0"
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand("copy")
        toast.success("Link copied to clipboard!")
      } catch (err) {
        toast.error("Failed to copy link")
      }
      document.body.removeChild(textArea)
    }
  }

  const isMobileDevice = () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false
    const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|Opera Mini|IEMobile/i.test(navigator.userAgent)
    const smallViewport = window.matchMedia?.("(max-width: 768px)")?.matches
    return Boolean(mobileUA || smallViewport)
  }

  const openShareModal = (payload) => {
    setSharePayload(payload)
    setShowShareModal(true)
  }

  const tryNativeShare = async (payload) => {
    if (typeof navigator === "undefined" || !navigator.share) return false
    try {
      await navigator.share(payload)
      return true
    } catch (error) {
      if (error?.name === "AbortError") return true
      return false
    }
  }

  const openShareTarget = (target) => {
    if (!sharePayload?.url) return

    const text = sharePayload.text || ""
    const url = sharePayload.url
    const encodedText = encodeURIComponent(text)
    const encodedUrl = encodeURIComponent(url)

    let shareLink = ""

    if (target === "whatsapp") {
      shareLink = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
    } else if (target === "telegram") {
      shareLink = `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
    } else if (target === "email") {
      shareLink = `mailto:?subject=${encodeURIComponent(sharePayload.title || "Check this out")}&body=${encodeURIComponent(`${text}\n\n${url}`)}`
    }

    if (shareLink) {
      window.open(shareLink, "_blank", "noopener,noreferrer")
      setShowShareModal(false)
    }
  }

  const copyShareLink = async () => {
    if (!sharePayload?.url) return
    await copyToClipboard(sharePayload.url)
    setShowShareModal(false)
  }

  const handleSystemShareFromModal = async () => {
    if (!sharePayload) return
    const shared = await tryNativeShare(sharePayload)
    if (shared) {
      setShowShareModal(false)
      toast.success("Shared successfully")
    }
  }

  // Handle item card click
  const handleItemClick = (item) => {
    setSelectedItem(item)
    setShowItemDetail(true)
  }

  // Helper function to calculate the best discount considering minOrderValue
  const calculateBestDiscount = (item, priceNum) => {
    let bestDiscountAmount = 0;
    let bestDiscountValue = 0;
    let bestIsFlatDiscount = false;

    // 1. Check item specific discount
    const itemDiscount = (restaurant?.itemDiscounts || []).find(d => String(d.itemId) === String(item.id || item._id));
    if (itemDiscount) {
      const discountValue = itemDiscount.discountValue || 0;
      const isFlatDiscount = String(itemDiscount.discountType || '').toUpperCase() === 'FLAT';
      const discountAmount = isFlatDiscount ? discountValue : (priceNum * discountValue) / 100;
      if (discountAmount > bestDiscountAmount) {
        bestDiscountAmount = discountAmount;
        bestDiscountValue = discountValue;
        bestIsFlatDiscount = isFlatDiscount;
      }
    }

    // 2. Check restaurant discount rules
    const matchingRule = (restaurant?.discountRules || []).find(rule => {
      const val = Number(rule.conditionValue);
      if (rule.conditionType === 'PRICE_ABOVE' && priceNum > val) return true;
      if (rule.conditionType === 'PRICE_BELOW' && priceNum < val) return true;
      return false;
    });
    if (matchingRule) {
      const discountValue = matchingRule.discountValue || 0;
      // Default to percentage for rules
      const discountAmount = (priceNum * discountValue) / 100;
      if (discountAmount > bestDiscountAmount) {
        bestDiscountAmount = discountAmount;
        bestDiscountValue = discountValue;
        bestIsFlatDiscount = false;
      }
    }

    // 3. Check global restaurant discount
    const globalDiscount = Number(restaurant?.discount || 0);
    if (globalDiscount > 0) {
      const discountAmount = (priceNum * globalDiscount) / 100;
      if (discountAmount > bestDiscountAmount) {
        bestDiscountAmount = discountAmount;
        bestDiscountValue = globalDiscount;
        bestIsFlatDiscount = false;
      }
    }

    return {
      discountValue: bestDiscountValue,
      isFlatDiscount: bestIsFlatDiscount,
      discountAmount: bestDiscountAmount
    };
  };

  // Helper function to calculate final price after discount
  const getFinalPrice = (item) => {
    let priceNum = item.price || 0;

    // Attempt to parse price if it's a string like "Starting from ₹199"
    if (typeof priceNum === 'string') {
      const parsed = parseFloat(priceNum.replace(/[^0-9.]/g, ''));
      if (!isNaN(parsed)) priceNum = parsed;
    }

    const { discountAmount } = calculateBestDiscount(item, priceNum);

    if (discountAmount > 0) {
      return Math.max(0, priceNum - discountAmount);
    }

    return Math.max(0, priceNum);
  };

  // Filter menu items based on active filters
  const filterMenuItems = (items) => {
    if (!items) return items

    return items.filter((item) => {
      // Under 250 filter (when coming from Under 250 page)
      if (showOnlyUnder250) {
        const finalPrice = getFinalPrice(item);
        if (finalPrice > 250) return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const itemName = item.name?.toLowerCase() || ""
        if (!itemName.includes(query)) return false
      }

      // VegMode filter - when vegMode is ON, show only Veg items
      // When vegMode is false/null/undefined, show all items (Veg and Non-Veg)
      if (vegMode === true) {
        if (item.foodType !== "Veg") return false
      }

      // Veg/Non-veg filter (local filter override)
      if (filters.vegNonVeg === "veg") {
        // Show only veg items
        if (item.foodType !== "Veg") return false
      }
      if (filters.vegNonVeg === "non-veg") {
        // Show only non-veg items
        if (item.foodType !== "Non-Veg") return false
      }

      if (filters.highlyReordered && !isRecommendedItem(item)) return false
      if (filters.spicy && item.isSpicy !== true) return false

      return true
    })
  }

  // Sort items based on sortBy filter
  const sortMenuItems = (items) => {
    if (!items) return items
    if (!filters.sortBy) return items

    const sorted = [...items]
    if (filters.sortBy === "low-to-high") {
      return sorted.sort((a, b) => getFinalPrice(a) - getFinalPrice(b))
    } else if (filters.sortBy === "high-to-low") {
      return sorted.sort((a, b) => getFinalPrice(b) - getFinalPrice(a))
    }
    return sorted
  }

  const getSectionSortValue = (section) => {
    const allItems = [
      ...toRenderableArray(section?.items),
      ...toRenderableArray(section?.subsections).flatMap((subsection) => toRenderableArray(subsection?.items)),
    ]

    if (allItems.length === 0) return null

    const prices = allItems
      .map((item) => getFinalPrice(item))
      .filter((price) => Number.isFinite(price))

    if (prices.length === 0) return null

    if (filters.sortBy === "low-to-high") {
      return Math.min(...prices)
    }

    if (filters.sortBy === "high-to-low") {
      return Math.max(...prices)
    }

    return null
  }

  // Helper function to check if a section has any items under Rs 250
  const sectionHasItemsUnder250 = (section) => {
    if (!showOnlyUnder250) return true; // If not filtering, show all sections

    // Check direct items
    if (section.items && section.items.length > 0) {
      const hasUnder250Items = section.items.some(item => {
        if (item.isAvailable === false) return false;
        const finalPrice = getFinalPrice(item);
        return finalPrice <= 250;
      });
      if (hasUnder250Items) return true;
    }

    // Check subsection items
    if (section.subsections && section.subsections.length > 0) {
      for (const subsection of section.subsections) {
        if (subsection.items && subsection.items.length > 0) {
          const hasUnder250Items = subsection.items.some(item => {
            if (item.isAvailable === false) return false;
            const finalPrice = getFinalPrice(item);
            return finalPrice <= 250;
          });
          if (hasUnder250Items) return true;
        }
      }
    }

    return false;
  }

  // Build renderable sections from the current filter state so section/subsection visibility
  // stays in sync with the actual filtered items shown on screen.
  const getFilteredSections = () => {
    if (!restaurant?.menuSections) return []

    const visibleSections = restaurant.menuSections
      .map((section, index) => {
        const filteredItems = sortMenuItems(
          filterMenuItems(
            toRenderableArray(section?.items).filter((item) => item?.isAvailable !== false)
          )
        )

        const filteredSubsections = toRenderableArray(section?.subsections)
          .map((subsection) => ({
            ...subsection,
            items: sortMenuItems(
              filterMenuItems(
                toRenderableArray(subsection?.items).filter((item) => item?.isAvailable !== false)
              )
            ),
          }))
          .filter((subsection) => subsection.items.length > 0)

        return {
          section: {
            ...section,
            items: filteredItems,
            subsections: filteredSubsections,
          },
          originalIndex: index,
        }
      })
      .filter(({ section }) => {
        if (selectedMenuCategory !== "all") {
          if (isRecommendedSection(section)) return false
          const sectionCategoryId = normalizeMenuCategoryId(section?.categoryId || getSectionDisplayName(section))
          if (sectionCategoryId !== selectedMenuCategory) {
            return false
          }
        }

        const hasVisibleItems = toRenderableArray(section?.items).length > 0
        const hasVisibleSubsections = toRenderableArray(section?.subsections).length > 0
        return hasVisibleItems || hasVisibleSubsections
      })

    if (!filters.sortBy) {
      return visibleSections
    }

    return [...visibleSections].sort((left, right) => {
      const leftValue = getSectionSortValue(left.section)
      const rightValue = getSectionSortValue(right.section)

      if (leftValue == null && rightValue == null) return 0
      if (leftValue == null) return 1
      if (rightValue == null) return -1

      return filters.sortBy === "low-to-high"
        ? leftValue - rightValue
        : rightValue - leftValue
    })
  }

  const hasActiveMenuFilters = Boolean(
    showOnlyUnder250 ||
    searchQuery.trim() ||
    vegMode === true ||
    filters.sortBy ||
    filters.vegNonVeg ||
    filters.highlyReordered ||
    filters.spicy
  )

  const filteredSections = useMemo(
    () => getFilteredSections(),
    [restaurant?.menuSections, showOnlyUnder250, searchQuery, vegMode, filters, selectedMenuCategory]
  )

  const totalFilteredItems = useMemo(() => {
    return filteredSections.reduce((count, { section }) => {
      const directItems = Array.isArray(section?.items) ? section.items.length : 0
      const subsectionItems = Array.isArray(section?.subsections)
        ? section.subsections.reduce(
          (sum, subsection) => sum + (Array.isArray(subsection?.items) ? subsection.items.length : 0),
          0
        )
        : 0
      return count + directItems + subsectionItems
    }, 0)
  }, [filteredSections])

  // Compute paginated sections based on visibleItemCount
  const paginatedSections = useMemo(() => {
    if (visibleItemCount >= totalFilteredItems) {
      return filteredSections
    }

    let currentCount = 0
    return filteredSections.map(({ section, originalIndex }) => {
      if (currentCount >= visibleItemCount) return { section: { ...section, items: [], subsections: [] }, originalIndex }

      const newSection = { ...section, items: [], subsections: [] }

      if (section.subsections && section.subsections.length > 0) {
        for (const sub of section.subsections) {
          if (currentCount >= visibleItemCount) break
          const suTuggoms = sub.items || []
          const remaining = visibleItemCount - currentCount
          const itemsToTake = suTuggoms.slice(0, remaining)
          currentCount += itemsToTake.length
          newSection.subsections.push({ ...sub, items: itemsToTake })
        }
      } else {
        const items = section.items || []
        const remaining = visibleItemCount - currentCount
        const itemsToTake = items.slice(0, remaining)
        currentCount += itemsToTake.length
        newSection.items = itemsToTake
      }
      return { section: newSection, originalIndex }
    }).filter(s => s.section.items?.length > 0 || s.section.subsections?.some(sub => sub.items?.length > 0))
  }, [filteredSections, visibleItemCount, totalFilteredItems])

  // Reset pagination when filters change
  useEffect(() => {
    setVisibleItemCount(20) // Start with 20 items
  }, [filteredSections]) // Re-run when sections/filters change

  // Implement infinite scrolling on window scroll
  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (window.innerHeight + window.scrollY >= document.documentElement.offsetHeight - 800) {
            setVisibleItemCount((prevCount) => {
              if (prevCount >= totalFilteredItems) return prevCount
              return prevCount + 20
            })
          }
          ticking = false;
        });
        ticking = true;
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true })

    // Check initially in case screen is very large and 20 items don't trigger scroll
    handleScroll()

    return () => window.removeEventListener("scroll", handleScroll)
  }, [totalFilteredItems])



  useEffect(() => {
    if (!hasActiveMenuFilters) return

    setExpandedSections(prev => {
      const nextExpanded = new Set(prev)
      filteredSections.forEach(({ section, originalIndex }) => {
        nextExpanded.add(originalIndex)
        toRenderableArray(section?.subsections).forEach((_, subIndex) => {
          nextExpanded.add(`${originalIndex}-${subIndex}`)
        })
      })
      return nextExpanded
    })
  }, [filteredSections, hasActiveMenuFilters])

  useEffect(() => {
    if (!restaurant?.menuSections || !targetDishId) return

    let matchedItem = null
    const sectionKeysToExpand = new Set()

    restaurant.menuSections.forEach((section, originalIndex) => {
      const sectionItems = toRenderableArray(section?.items)
      const matchedSectionItem = sectionItems.find(
        (item) => String(item?.id || item?._id || "").trim() === targetDishId,
      )

      if (matchedSectionItem && !matchedItem) {
        matchedItem = matchedSectionItem
        sectionKeysToExpand.add(originalIndex)
      }

      const sectionSubsections = toRenderableArray(section?.subsections)
      sectionSubsections.forEach((subsection, subIndex) => {
        const subsectionItems = toRenderableArray(subsection?.items)
        const matchedSubsectionItem = subsectionItems.find(
          (item) => String(item?.id || item?._id || "").trim() === targetDishId,
        )

        if (matchedSubsectionItem && !matchedItem) {
          matchedItem = matchedSubsectionItem
          sectionKeysToExpand.add(originalIndex)
          sectionKeysToExpand.add(`${originalIndex}-${subIndex}`)
        }
      })
    })

    if (!matchedItem) return

    setExpandedSections((prev) => {
      const next = new Set(prev)
      sectionKeysToExpand.forEach((key) => next.add(key))
      return next
    })
    setHighlightedDishId(targetDishId)

    const scrollTimer = window.setTimeout(() => {
      const targetNode = dishCardRefs.current[targetDishId]
      if (targetNode) {
        targetNode.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }, 250)

    const highlightTimer = window.setTimeout(() => {
      setHighlightedDishId((current) => (current === targetDishId ? null : current))
    }, 2600)

    return () => {
      window.clearTimeout(scrollTimer)
      window.clearTimeout(highlightTimer)
    }
  }, [restaurant, targetDishId])

  // Highlight offers/texts for the blue offer line
  const offersList = Array.isArray(restaurant?.offers) ? restaurant.offers : []
  const currentOfferIndex = offersList.length > 0 ? (highlightIndex % offersList.length) : 0
  const activeOffer = offersList.length > 0 ? offersList[currentOfferIndex] : null

  const offerIndicatorCount = Math.min(offersList.length > 0 ? offersList.length : 1, 5)
  const activeOfferIndicator = offerIndicatorCount > 0 ? highlightIndex % offerIndicatorCount : 0

  const offerHeadline = activeOffer?.title || restaurant?.offerText || "No offers currently available"
  const offerSubline =
    activeOffer?.description ||
    activeOffer?.subtitle ||
    (activeOffer?.code ? `Use code ${activeOffer.code}` : "Tap to view all offers")

  // Auto-rotate images every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => {
        const offersLength = Array.isArray(restaurant?.offers) && restaurant.offers.length > 0
          ? restaurant.offers.length
          : 1
        return (prev + 1) % offersLength
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [restaurant?.offers?.length || 0])

  // Auto-rotate highlight offer text every 3 seconds
  useEffect(() => {
    const offersCount = Array.isArray(restaurant?.offers) ? restaurant.offers.length : 0;
    if (offersCount <= 1) return; // No need to rotate if 0 or 1 offer

    const interval = setInterval(() => {
      setHighlightIndex((prev) => (prev + 1) % offersCount)
    }, 3000)

    return () => clearInterval(interval)
  }, [restaurant?.offers])

  // Render a single dish card with layout and performance optimizations
  const renderDishCard = (item, isRecommendedSection) => {
    const quantity = getDishQuantity(item)
    const isVeg = item.foodType === "Veg"
    const isHighlighted = highlightedDishId === (item.id || item._id)

    const cardContent = (
      <>
        {/* Left Side - Details */}
        <div className="flex-1 min-w-0">
          {/* Veg Icon & Spicy Indicator */}
          <div className="flex items-center gap-2 mb-1">
            {isVeg ? (
              <div className="w-4 h-4 border-2 border-green-600 flex items-center justify-center rounded-sm flex-shrink-0">
                <div className="w-2 h-2 bg-green-600 rounded-full"></div>
              </div>
            ) : (
              <div className="w-4 h-4 border-2 border-red-600 flex items-center justify-center rounded-sm flex-shrink-0">
                <div className="w-2 h-2 bg-red-600 rounded-full"></div>
              </div>
            )}
            {item.isSpicy && <span className="text-xs font-semibold text-red-500">Spicy</span>}
          </div>

          <h3 className="font-bold text-gray-800 dark:text-white text-lg leading-tight">{item.name}</h3>

          {/* Highly Reordered Progress Bar - Show if recommended */}
          {isRecommendedItem(item) && (
            <div className="flex items-center gap-2 mt-1">
              <div className="h-1.5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-primary w-3/4"></div>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Highly reordered</span>
            </div>
          )}

          <div className="flex items-center gap-3 mt-1">
            {(() => {
              const priceStr = getFoodPriceLabel(item);
              const isStartingFrom = priceStr.includes('Starting from');
              const priceNum = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
              if (isNaN(priceNum)) return <p className="font-semibold text-gray-900 dark:text-white">{priceStr}</p>;

              const { discountValue, isFlatDiscount, discountAmount } = calculateBestDiscount(item, priceNum);

              if (discountAmount > 0) {

                const discountedPrice = Math.max(0, Math.round(priceNum - discountAmount));

                // Calculate effective percentage for badge
                const effectivePercentage = Math.round(((priceNum - discountedPrice) / priceNum) * 100);
                const discountLabel = isFlatDiscount ? `₹${discountValue} OFF` : `${effectivePercentage}% OFF`;

                return (
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 dark:text-white text-[15px]">
                        {isStartingFrom ? <span className="text-[11px] font-medium text-gray-500 mr-1">Starting from</span> : ''}
                        ₹{discountedPrice}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-[1px]">
                      <span className="text-[11px] text-gray-500 line-through">₹{priceNum}</span>
                      <span className="text-[9px] font-bold text-green-600 bg-green-50 border border-green-200 px-1 py-[1px] rounded uppercase flex items-center">
                        <Tag size={8} className="mr-[2px]" />
                        {discountLabel}
                      </span>
                    </div>
                  </div>
                );
              }

              if (isStartingFrom) {
                return (
                  <div className="flex flex-col leading-tight">
                    <span className="text-[11px] text-gray-500 font-medium">Starting from</span>
                    <span className="font-semibold text-gray-900 dark:text-white">₹{priceNum}</span>
                  </div>
                );
              }

              return <p className="font-semibold text-gray-900 dark:text-white">{priceStr}</p>;
            })()}
            {/* Preparation Time - Show if available */}
            {item.preparationTime && String(item.preparationTime).trim() && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                <Clock size={12} className="text-gray-500" />
                <span>{String(item.preparationTime).trim()}</span>
              </div>
            )}
          </div>

          {/* Description - Show if available */}
          {item.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{item.description}</p>
          )}

          {/* Mobile-only action buttons */}
          <div className="flex gap-4 mt-3 md:hidden">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleBookmarkClick(item)
              }}
              className={`p-1.5 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${isDishFavorite(item.id || item._id, restaurant?.restaurantId || restaurant?._id || restaurant?.id)
                ? "border-red-500 text-red-500 bg-red-50 dark:bg-red-900/20"
                : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400"
                }`}
            >
              <Bookmark
                size={18}
                className={isDishFavorite(item.id || item._id, restaurant?.restaurantId || restaurant?._id || restaurant?.id) ? "fill-red-500 text-red-500" : ""}
              />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (isRecommendedSection) {
                  handleSystemShare(item)
                } else {
                  handleShareClick(item)
                }
              }}
              className="p-1.5 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Share2 size={18} />
            </button>
          </div>
        </div>

        {/* Right Side - Image and Add Button Wrapper */}
        <div className="relative w-32 h-32 flex-shrink-0">
          {/* Image Container with rounded-2xl overflow-hidden */}
          <div className="w-full h-full bg-gray-100 dark:bg-gray-800 rounded-2xl overflow-hidden shadow-sm">
            <DishImage src={item.image} alt={item.name} className="w-full h-full object-cover" />
          </div>
          {/* Button overlay - rendered outside of overflow-hidden image container to prevent clipping */}
          {quantity > 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`absolute -bottom-3 sm:-bottom-4 left-1/2 -translate-x-1/2 rounded-full h-8 sm:h-9 md:h-10 px-3 sm:px-4 flex items-center justify-between gap-3 min-w-[90px] md:min-w-[100px] z-10 transition-all duration-300 ${shouldShowGrayscale || isRestaurantOffline
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed opacity-50 shadow-none border border-gray-300'
                  : 'shadow-[0_4px_14px_0_rgba(0,183,97,0.39)] bg-[#00B761] hover:bg-[#00A055] text-white'
                }`}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (!shouldShowGrayscale && !isRestaurantOffline) {
                    updateItemQuantity(item, Math.max(0, quantity - 1), e)
                  }
                }}
                disabled={shouldShowGrayscale || isRestaurantOffline}
                className={shouldShowGrayscale || isRestaurantOffline ? 'text-gray-500 cursor-not-allowed' : 'text-white hover:text-white/80 active:scale-90 transition-transform'}
              >
                <Minus size={16} className="stroke-[3px]" />
              </button>
              <span className="text-[13px] sm:text-[15px] font-black">{quantity}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (!shouldShowGrayscale && !isRestaurantOffline) {
                    updateItemQuantity(item, quantity + 1, e)
                  }
                }}
                disabled={shouldShowGrayscale || isRestaurantOffline}
                className={shouldShowGrayscale || isRestaurantOffline ? 'text-gray-500 cursor-not-allowed' : 'text-white hover:text-white/80 active:scale-90 transition-transform'}
              >
                <Plus size={16} className="stroke-[3px]" />
              </button>
            </motion.div>
          ) : (
            <motion.button
              whileTap={shouldShowGrayscale || isRestaurantOffline ? {} : { scale: 0.95 }}
              onClick={(e) => {
                e.stopPropagation()
                if (!shouldShowGrayscale && !isRestaurantOffline) {
                  updateItemQuantity(item, 1, e)
                }
              }}
              disabled={shouldShowGrayscale || isRestaurantOffline}
              className={`absolute -bottom-3 sm:-bottom-4 left-1/2 -translate-x-1/2 rounded-full h-8 sm:h-9 md:h-10 px-5 sm:px-7 text-[12px] sm:text-[14px] md:text-[16px] font-black uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-1 sm:gap-1.5 whitespace-nowrap min-w-[90px] md:min-w-[100px] z-10 ${shouldShowGrayscale || isRestaurantOffline
                ? 'bg-gray-400 dark:bg-gray-700 text-white cursor-not-allowed shadow-none border border-gray-400/20'
                : 'bg-[var(--primary)] hover:opacity-90 text-white shadow-md border border-[var(--primary)]/20'
                }`}
            >
              {isRestaurantOffline ? "OFFLINE" : (
                <>ADD <span className="text-[16px] sm:text-[18px] md:text-[20px] font-medium leading-none mt-[-2px]">+</span></>
              )}
            </motion.button>
          )}
        </div>
      </>
    )

    if (isHighlighted) {
      return (
        <motion.div
          key={item.id || item._id}
          ref={(node) => {
            const itemId = item.id || item._id;
            if (node) {
              dishCardRefs.current[itemId] = node
            } else {
              delete dishCardRefs.current[itemId]
            }
          }}
          initial={{ scale: 0.98, opacity: 0.95 }}
          animate={{
            scale: [1, 1.02, 1.01],
            opacity: 1,
            boxShadow: [
              "0 4px 12px rgba(126,56,102,0.1)",
              "0 16px 36px rgba(126,56,102,0.3)",
              "0 12px 28px rgba(126,56,102,0.22)"
            ]
          }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex gap-4 p-4 border-b border-gray-100 dark:border-gray-800 last:border-none relative cursor-pointer transition-all duration-500 rounded-2xl bg-gradient-to-r from-[#7e38660a] to-[#7e386615] dark:from-[#7e386618] dark:to-[#7e386622] ring-2 ring-primary z-10 mx-1 my-2"
          onClick={() => handleItemClick(item)}
        >
          {cardContent}
        </motion.div>
      )
    }

    return (
      <div
        key={item.id || item._id}
        ref={(node) => {
          const itemId = item.id || item._id;
          if (node) {
            dishCardRefs.current[itemId] = node
          } else {
            delete dishCardRefs.current[itemId]
          }
        }}
        className="flex gap-4 p-4 border-b border-gray-100 dark:border-gray-800 last:border-none relative cursor-pointer rounded-2xl hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors duration-200"
        onClick={() => handleItemClick(item)}
      >
        {cardContent}
      </div>
    )
  }

  const availabilityStatus = restaurant ? getRestaurantAvailabilityStatus(restaurant, new Date(availabilityTick)) : { isOpen: false }
  const isRestaurantOffline = !availabilityStatus.isOpen
  const shouldShowGrayscale = isOutOfService || isRestaurantOffline
  const ratingValue = Number(restaurant?.rating || 0)
  const hasRating = Number.isFinite(ratingValue) && ratingValue > 0
  const ratingLabel = hasRating ? ratingValue.toFixed(1) : "New"
  const reviewsCount = Number(restaurant?.reviews || 0)
  const reviewsLabel = hasRating && Number.isFinite(reviewsCount) && reviewsCount > 0
    ? `${reviewsCount.toLocaleString()}+ ratings`
    : "New"

  if (loadingRestaurant && !restaurant) {
    return (
      <>
        {showScanAnimation && (
          <MenuScanAnimation
            duration={2200}
            onComplete={() => setShowScanAnimation(false)}
          />
        )}
        <RestaurantDetailSkeleton />
      </>
    )
  }

  if (restaurantError && !restaurant) {
    return (
      <AnimatedPage>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className={`h-12 w-12 ${restaurantError.includes('Backend server is not connected') ? 'text-primary' : 'text-red-500'}`} />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                {restaurantError.includes('Backend server is not connected') ? 'Connection Error' : restaurantError === 'Restaurant not found' ? 'Restaurant not found' : 'Error'}
              </h2>
              <p className="text-sm text-gray-600 mb-4 max-w-md">{restaurantError}</p>
              {restaurantError.includes('Backend server is not connected') && (
                <p className="text-xs text-gray-500 mb-4">
                  Make sure the backend server is running at {API_BASE_URL.replace('/api', '')}
                </p>
              )}
              <Button onClick={goBack} variant="outline">
                Go Back
              </Button>
            </div>
          </div>
        </div>
      </AnimatedPage>
    )
  }

  if (!restaurant) {
    return (
      <AnimatedPage>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <span className="text-sm text-gray-600">Restaurant not found</span>
            <Button onClick={goBack} variant="outline">
              Go Back
            </Button>
          </div>
        </div>
      </AnimatedPage>
    )
  }

  return (
    <AnimatedPage
      id="scrollingelement"
      className={`min-h-screen bg-white dark:bg-[#0a0a0a] flex flex-col transition-all duration-300 ${shouldShowGrayscale ? 'grayscale opacity-75' : ''
        }`}
    >
      {/* ── Menu Scan Intro Animation ── */}
      {showScanAnimation && (
        <MenuScanAnimation
          duration={2200}
          onComplete={() => setShowScanAnimation(false)}
        />
      )}

      {/* Header - Back, Search, Menu (like reference image) */}
      <div className="px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 pt-3 md:pt-4 lg:pt-5 pb-2 md:pb-3 bg-white dark:bg-[#0a0a0a]">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Back Button */}
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-10 w-10 border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-[#1a1a1a]"
            onClick={goBack}
          >
            <ArrowLeft className="h-5 w-5 text-gray-900 dark:text-white" />
          </Button>

          {/* Right side: Search pill + menu */}
          <div className="flex items-center gap-3">
            {!showSearch ? (
              <Button
                variant="outline"
                className="rounded-full h-10 px-4 border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-[#1a1a1a] flex items-center gap-2 text-gray-900 dark:text-white"
                onClick={() => setShowSearch(true)}
              >
                <Search className="h-4 w-4" />
                <span className="text-sm font-medium">Search</span>
              </Button>
            ) : (
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search for dishes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-9 md:h-10 pl-10 pr-10 rounded-full border border-primary dark:border-primary/80 shadow-sm bg-white dark:bg-[#1a1a1a] text-xs md:text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    autoFocus
                    onBlur={() => {
                      if (!searchQuery) {
                        setShowSearch(false)
                      }
                    }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery("")
                        setShowSearch(false)
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
            <Button
              variant="outline"
              size="icon"
              className="rounded-full h-10 w-10 border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-[#1a1a1a]"
              onClick={() => setShowMenuOptionsSheet(true)}
            >
              <MoreVertical className="h-5 w-5 text-gray-900 dark:text-white" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="bg-white dark:bg-[#0a0a0a] rounded-t-3xl relative z-10 min-h-[40vh]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-4 sm:py-5 md:py-6 lg:py-8 space-y-3 md:space-y-4 lg:space-y-5 pb-0">
          {/* Restaurant Summary */}
          <div className="relative">
            <div className="relative rounded-3xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] shadow-[0_16px_40px_rgba(15,23,42,0.08)] p-4 sm:p-5 space-y-4 overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-primary via-[#8a4b77] to-[#b36b8f]" />
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white truncate">
                      {restaurant?.name || "Unknown Restaurant"}
                    </h1>
                    {isRestaurantOffline && (
                      <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest shadow-sm bg-gray-400 text-white whitespace-nowrap flex-shrink-0">
                        Offline Menu
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <Utensils className="h-4 w-4" />
                    <span>{restaurant?.topCategory || restaurant?.cuisine || "Multi-cuisine"}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <div className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
                    <Star className="h-3 w-3 fill-white" />
                    {ratingLabel}
                  </div>
                  <span className="mt-1 text-xs text-gray-500">
                    {reviewsLabel}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div
                  className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300 min-w-0"
                >
                  <MapPin className="h-4 w-4" />
                  <span className="truncate">
                    {restaurant?.distance || "1.2 km"} | {restaurant?.location || "Location"}
                  </span>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold text-white ${isRestaurantOffline ? "bg-rose-600" : "bg-emerald-600"
                    }`}
                >
                  {isRestaurantOffline ? "Offline" : "Open now"}
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <Clock className="h-4 w-4" />
                <span>{restaurant?.deliveryTime || "25-30 mins"}</span>
              </div>
            </div>
          </div>

          {isRestaurantOffline && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              This restaurant is currently offline. Orders are unavailable right now.
            </div>
          )}

          {/* Offers & Discounts */}
          <div className="flex flex-col gap-3">
            {/* Global Discount standalone card */}
            {restaurant?.discount > 0 && (
              <div className="w-full rounded-2xl border border-green-200 dark:border-green-900/30 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 px-4 py-3 flex items-center justify-between shadow-[0_4px_12px_rgba(16,185,129,0.05)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 shadow-sm">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.864 2.227l8.909 8.91a2.182 2.182 0 010 3.085l-7.364 7.364a2.182 2.182 0 01-3.085 0l-8.91-8.91A2.182 2.182 0 012 11.137V4.41A2.182 2.182 0 014.182 2.23h6.727a2.182 2.182 0 011.955-.003z" /></svg>
                  </div>
                  <div>
                    <p className="text-sm font-black text-green-800 dark:text-green-400 uppercase tracking-wide">
                      FLAT {restaurant.discount}% OFF
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-500 font-medium mt-0.5">
                      Applied automatically on all items
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Coupons Card */}
            <button
              type="button"
              onClick={() => setShowOffersSheet(true)}
              className="w-full rounded-2xl border border-gray-900/20 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] px-4 py-3 text-left shadow-[0_8px_20px_rgba(15,23,42,0.08)] transition-all hover:shadow-[0_12px_24px_rgba(15,23,42,0.12)]"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
                  <Percent className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 flex flex-col justify-center">
                  <div className="relative h-5 overflow-hidden">
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={highlightIndex}
                        initial={{ y: 16, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -16, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="text-sm font-semibold text-gray-900 dark:text-white"
                      >
                        {offerHeadline}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate">{offerSubline}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <Star className="h-3 w-3 fill-emerald-700 dark:fill-emerald-400 text-emerald-700 dark:text-emerald-400" />
                    {ratingLabel}
                  </span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    {reviewsLabel}
                  </span>
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5 pl-[56px]">
                {Array.from({ length: offerIndicatorCount }).map((_, index) => (
                  <span
                    key={`offer-dot-${index}`}
                    className={`h-1.5 w-1.5 rounded-full ${index === activeOfferIndicator ? "bg-orange-500" : "bg-gray-200 dark:bg-gray-700"
                      }`}
                  />
                ))}
              </div>
            </button>
          </div>

          {/* Filter/Category Buttons */}
          <div className="border-y border-gray-200 py-3 -mx-4 px-4">
            <div className="flex flex-col gap-3">
              {/* Row 1: Filters (scrollable independently) */}
              <div className="overflow-x-auto scrollbar-hide pt-2 pb-2.5 border-b border-gray-100 dark:border-gray-900">
                <div className="flex items-center gap-2 w-max">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-1.5 whitespace-nowrap border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] dark:text-white relative overflow-visible"
                    onClick={() => setShowFilterSheet(true)}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-semibold z-10">
                        {activeFilterCount}
                      </span>
                    )}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  {vegModeOption !== "pure-veg" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className={`flex items-center gap-1.5 whitespace-nowrap border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] dark:text-white rounded-full ${filters.vegNonVeg === "veg" ? "border-green-600 bg-green-50 text-green-700 font-bold dark:border-green-500 dark:bg-green-900/20 dark:text-green-400" : ""
                        }`}
                      onClick={() =>
                        setFilters((prev) => ({
                          ...prev,
                          vegNonVeg: prev.vegNonVeg === "veg" ? null : "veg",
                        }))
                      }
                    >
                      <div className="h-3 w-3 rounded-full bg-green-600" />
                      Veg
                      {filters.vegNonVeg === "veg" && (
                        <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                      )}
                    </Button>
                  )}
                  {vegModeOption !== "pure-veg" && !vegMode && (
                    <Button
                      variant="outline"
                      size="sm"
                      className={`flex items-center gap-1.5 whitespace-nowrap border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] dark:text-white rounded-full ${filters.vegNonVeg === "non-veg" ? "border-red-600 bg-red-50 text-red-600 dark:border-red-500 dark:bg-red-900/20 dark:text-red-400" : ""
                        }`}
                      onClick={() =>
                        setFilters((prev) => ({
                          ...prev,
                          vegNonVeg: prev.vegNonVeg === "non-veg" ? null : "non-veg",
                        }))
                      }
                    >
                      <div className="h-3 w-3 rounded-full bg-red-600" />
                      Non-veg
                      {filters.vegNonVeg === "non-veg" && (
                        <X className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                      )}
                    </Button>
                  )}
                  <Button
                    className="bg-orange-500 hover:bg-orange-600 text-white flex items-center gap-1.5 shadow-[0_4px_12px_rgba(255,102,0,0.4)] border border-white/20 rounded-full font-bold transform transition-all duration-300 active:scale-95 group ml-1"
                    size="sm"
                    onClick={() => setShowMenuSheet(true)}
                  >
                    <Utensils className="h-3.5 w-3.5 text-white group-hover:rotate-12 transition-transform" />
                    <span className="tracking-widest text-xs uppercase">MENU</span>
                  </Button>
                </div>
              </div>

              {/* Row 2: Categories (scrollable independently) */}
              {menuCategories.length > 0 && (
                <div className="overflow-x-auto scrollbar-hide pt-0.5">
                  <div className="flex items-center gap-2 w-max">
                    <button
                      type="button"
                      onClick={() => setSelectedMenuCategory("all")}
                      className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${selectedMenuCategory === "all"
                          ? "border-primary bg-[#7e386615] text-primary"
                          : "border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] text-gray-700 dark:text-gray-300"
                        }`}
                    >
                      All
                    </button>
                    {menuCategories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setSelectedMenuCategory(category.id)}
                        className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${selectedMenuCategory === category.id
                            ? "border-primary bg-[#7e386615] text-primary"
                            : "border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] text-gray-700 dark:text-gray-300"
                          }`}
                      >
                        {category.image ? (
                          <img
                            src={category.image}
                            alt={category.name}
                            className="h-6 w-6 rounded-full object-cover border border-white/70 shadow-sm"
                            onError={(event) => {
                              event.currentTarget.style.display = "none"
                            }}
                          />
                        ) : (
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold uppercase text-gray-500">
                            {category.name?.charAt(0) || "C"}
                          </span>
                        )}
                        {category.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {loadingMenuItems && (!restaurant?.menuSections || restaurant.menuSections.length === 0) && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-6 sm:py-8 md:py-10 lg:py-12">
            <div className="space-y-4 animate-pulse">
              <div className="h-6 w-40 rounded-full bg-gray-100 dark:bg-gray-800" />
              <div className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800" />
              <div className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800" />
              <div className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800" />
            </div>
          </div>
        )}

        {/* Menu Items Section */}
        {restaurant?.menuSections && Array.isArray(restaurant.menuSections) && restaurant.menuSections.length > 0 && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-6 sm:py-8 md:py-10 lg:py-12 space-y-6 md:space-y-8 lg:space-y-10">
            {filteredSections.length === 0 && hasActiveMenuFilters && (
              <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-5 py-8 text-center">
                <p className="text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">
                  No dishes match the selected filters.
                </p>
                <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Clear filters or try a different combination.
                </p>
              </div>
            )}
            {filteredSections.length === 0 && (
              <div className="rounded-3xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                No dishes match the current filters.
              </div>
            )}

            {paginatedSections.map(({ section, originalIndex }, sectionIndex) => {
              // Handle section name - check for valid non-empty string
              const isRecommended = isRecommendedSection(section)
              const sectionId = `menu-section-${originalIndex}`
              const sectionItems = toRenderableArray(section?.items)
              const sectionSubsections = toRenderableArray(section?.subsections)

              const isExpanded = expandedSections.has(originalIndex)

              return (
                <div key={sectionIndex} id={sectionId} className="space-y-1 scroll-mt-20">
                  {/* Section Header */}
                  {isRecommended && (
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                        Recommended for you
                      </h2>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpandedSections(prev => {
                            const newSet = new Set(prev)
                            if (newSet.has(originalIndex)) {
                              newSet.delete(originalIndex)
                            } else {
                              newSet.add(originalIndex)
                            }
                            return newSet
                          })
                        }}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                      >
                        <ChevronDown
                          className={`h-5 w-5 text-gray-600 dark:text-gray-400 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'
                            }`}
                        />
                      </button>
                    </div>
                  )}
                  {!isRecommended && (
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                          {(section?.name && typeof section.name === 'string' && section.name.trim())
                            ? section.name.trim()
                            : (section?.title && typeof section.title === 'string' && section.title.trim())
                              ? section.title.trim()
                              : "Unnamed Section"}
                        </h2>
                        {section.subtitle && (
                          <button className="text-sm text-blue-600 dark:text-blue-400 underline">
                            {section.subtitle}
                          </button>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setExpandedSections(prev => {
                            const newSet = new Set(prev)
                            if (newSet.has(originalIndex)) {
                              newSet.delete(originalIndex)
                            } else {
                              newSet.add(originalIndex)
                            }
                            return newSet
                          })
                        }}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                      >
                        <ChevronDown
                          className={`h-5 w-5 text-gray-600 dark:text-gray-400 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'
                            }`}
                        />
                      </button>
                    </div>
                  )}

                  {/* Direct Items */}
                  {isExpanded && isRecommended && !loadingMenuItems && sectionItems.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-gray-500 dark:text-gray-400 text-sm md:text-base">
                        No dish recommended
                      </p>
                    </div>
                  )}
                  {isExpanded && loadingMenuItems && (
                    <div className="space-y-3 px-1 py-2 animate-pulse">
                      <div className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800" />
                      <div className="h-24 rounded-2xl bg-gray-100 dark:bg-gray-800" />
                    </div>
                  )}
                  {isExpanded && sectionItems.length > 0 && (
                    <div className="space-y-0">
                      {sectionItems.map((item) => renderDishCard(item, isRecommended))}
                    </div>
                  )}

                  {/* Subsections */}
                  {isExpanded && sectionSubsections.length > 0 && (
                    <div className="space-y-4">
                      {sectionSubsections.map((subsection, subIndex) => {
                        const subsectionKey = `${originalIndex}-${subIndex}`
                        const isSubsectionExpanded = expandedSections.has(subsectionKey)
                        const subsectionItems = toRenderableArray(subsection?.items)

                        return (
                          <div key={subIndex} className="space-y-4">
                            {/* Subsection Header */}
                            <div className="flex items-center justify-between">
                              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                                {subsection?.name || subsection?.title || "Subsection"}
                              </h3>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setExpandedSections(prev => {
                                    const newSet = new Set(prev)
                                    if (newSet.has(subsectionKey)) {
                                      newSet.delete(subsectionKey)
                                    } else {
                                      newSet.add(subsectionKey)
                                    }
                                    return newSet
                                  })
                                }}
                                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                              >
                                <ChevronDown
                                  className={`h-4 w-4 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isSubsectionExpanded ? '' : '-rotate-90'
                                    }`}
                                />
                              </button>
                            </div>

                            {/* Subsection Items */}
                            {isSubsectionExpanded && subsectionItems.length > 0 && (
                              <div className="space-y-0">
                                {subsectionItems.map((item) => renderDishCard(item, isRecommended))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!loadingMenuItems && menuUnavailable && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-6 sm:py-8 md:py-10 lg:py-12">
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-6 py-10 text-center">
              <p className="text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">
                Menu is not available yet.
              </p>
              <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-2">
                The restaurant has not uploaded its menu.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* FSSAI License Information - Bottom of page */}
      {restaurant?.onboarding?.step3?.fssai?.registrationNumber && (
        <div className="px-4 py-4 mt-2 mb-24 border-t border-dashed border-gray-200 dark:border-gray-800 bg-gray-50/30 dark:bg-white/5 mx-4 rounded-xl">
          <div className="flex items-center gap-4">
            <div className="h-12 w-20 flex items-center justify-center bg-white rounded-lg p-1.5 shadow-sm border border-gray-100">
              <img
                src={fssaiLogo}
                alt="FSSAI"
                className="h-full w-auto object-contain"
              />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-widest font-bold mb-1">
                License No.
              </p>
              <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 font-mono tracking-wide">
                {restaurant?.onboarding?.step3?.fssai?.registrationNumber}
              </p>
            </div>
          </div>
        </div>
      )}



      {/* Menu Categories Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showMenuSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowMenuSheet(false)}
                />

                {/* Menu Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[85vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-6">
                    <div className="space-y-1">
                      {menuCategories.map((category, index) => (
                        <button
                          key={index}
                          className="w-full flex items-center justify-between py-3 px-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                          onClick={() => {
                            setShowMenuSheet(false)
                            // Expand the section so items are visible
                            setExpandedSections(prev => {
                              const newSet = new Set(prev)
                              newSet.add(category.sectionIndex)
                              return newSet
                            })
                            // Bypass virtual scrolling to ensure the target section is rendered in the DOM
                            setVisibleItemCount(totalFilteredItems)

                            // Scroll to category section
                            setTimeout(() => {
                              const sectionId = `menu-section-${category.sectionIndex}`
                              const sectionElement = document.getElementById(sectionId)
                              if (sectionElement) {
                                sectionElement.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'start'
                                })
                              }
                            }, 400) // Delay to allow sheet to close and React to render all items
                          }}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {category.image ? (
                              <img
                                src={category.image}
                                alt={category.name}
                                className="h-10 w-10 rounded-xl object-cover border border-gray-200"
                                onError={(event) => {
                                  event.currentTarget.style.display = "none"
                                }}
                              />
                            ) : (
                              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-sm font-bold uppercase text-gray-500">
                                {category.name?.charAt(0) || "C"}
                              </span>
                            )}
                            <span className="text-base font-medium text-gray-900 dark:text-white truncate">
                              {category.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              {category.count}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Close Button */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4 bg-white dark:bg-[#1a1a1a]">
                    <Button
                      className="w-full bg-primary hover:bg-secondary text-white border-0 flex items-center justify-center gap-2 py-6 rounded-xl font-bold transition-all shadow-lg text-sm"
                      onClick={() => setShowMenuSheet(false)}
                    >
                      <X className="h-4 w-4" />
                      Close
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Filters and Sorting Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showFilterSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowFilterSheet(false)}
                />

                {/* Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[80vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Header with X button */}
                  <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Filters and Sorting</h2>
                    <button
                      onClick={() => setShowFilterSheet(false)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                    >
                      <X className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                    </button>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                    {/* Sort by */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Sort by:</h3>
                      <div className="flex flex-col gap-1.5">
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              sortBy: prev.sortBy === "low-to-high" ? null : "low-to-high",
                            }))
                          }
                          className={`text-left px-4 py-2.5 rounded-lg border-2 transition-all ${filters.sortBy === "low-to-high"
                            ? "border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          Price - low to high
                        </button>
                        <button
                          onClick={() =>
                            setFilters((prev) => ({
                              ...prev,
                              sortBy: prev.sortBy === "high-to-low" ? null : "high-to-low",
                            }))
                          }
                          className={`text-left px-4 py-2.5 rounded-lg border-2 transition-all ${filters.sortBy === "high-to-low"
                            ? "border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                            }`}
                        >
                          Price - high to low
                        </button>
                      </div>
                    </div>

                    {/* Veg/Non-veg preference */}
                    {vegModeOption !== "pure-veg" && (
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Veg/Non-veg preference:</h3>
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              setFilters((prev) => ({
                                ...prev,
                                vegNonVeg: prev.vegNonVeg === "veg" ? null : "veg",
                              }))
                            }
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all flex-1 ${filters.vegNonVeg === "veg"
                              ? "border-green-600 dark:border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                              }`}
                          >
                            <div className="h-4 w-4 rounded-full bg-green-600 dark:bg-green-500" />
                            <span className="font-medium">Veg</span>
                          </button>
                          {!vegMode && (
                            <button
                              onClick={() =>
                                setFilters((prev) => ({
                                  ...prev,
                                  vegNonVeg: prev.vegNonVeg === "non-veg" ? null : "non-veg",
                                }))
                              }
                              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all flex-1 ${filters.vegNonVeg === "non-veg"
                                ? "border-red-600 dark:border-red-600 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-gray-300"
                                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                                }`}
                            >
                              <div className="h-4 w-4 rounded-full bg-red-600" />
                              <span className="font-medium">Non-veg</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}


                  </div>

                  {/* Bottom Action Bar */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between bg-white dark:bg-[#1a1a1a]">
                    <button
                      onClick={() => {
                        setFilters({
                          sortBy: null,
                          vegNonVeg: null,
                          highlyReordered: false,
                          spicy: false,
                        })
                      }}
                      className="text-red-600 dark:text-red-400 font-medium text-sm hover:text-red-700 dark:hover:text-red-500"
                    >
                      Clear All
                    </button>
                    <Button
                      className="bg-primary hover:bg-secondary text-white px-6 py-2.5 rounded-lg font-bold"
                      onClick={() => setShowFilterSheet(false)}
                    >
                      Apply {activeFilterCount > 0 && `(${activeFilterCount})`}
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Location Outlets Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showLocationSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowLocationSheet(false)}
                />

                {/* Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl h-[75vh] md:h-auto md:max-h-[90vh] md:max-w-xl w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Header */}
                  <div className="px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">All delivery outlets for</p>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-red-600 dark:bg-red-500 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-base">{(restaurant.name || "R").charAt(0).toUpperCase()}</span>
                      </div>
                      <h2 className="text-lg font-bold text-gray-900 dark:text-white">{restaurant?.name || "Unknown Restaurant"}</h2>
                    </div>
                  </div>

                  {/* Outlets List */}
                  <div className="flex-1 overflow-y-auto px-4 py-3">
                    {restaurant?.outlets && Array.isArray(restaurant.outlets) && restaurant.outlets.length > 0 ? (
                      <div className="space-y-2">
                        {restaurant.outlets.map((outlet) => (
                          <div
                            key={outlet?.id || Math.random()}
                            className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#2a2a2a]"
                          >
                            {outlet?.isNearest && (
                              <div className="flex items-center gap-1.5 mb-2 px-2 py-1 bg-[#F9F9FB] dark:bg-primary/20 rounded-md">
                                <Zap className="h-3.5 w-3.5 text-primary dark:text-primary fill-primary dark:fill-primary" />
                                <span className="text-xs font-semibold text-primary dark:text-primary">
                                  Nearest available outlet
                                </span>
                              </div>
                            )}
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                              {outlet?.location || "Location"}
                            </h3>
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  <span>{outlet?.deliveryTime || "25-30 mins"}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5" />
                                  <span>{outlet?.distance || "1.2 km"}</span>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="flex items-center gap-1">
                                  <Star className="h-3.5 w-3.5 text-[#8CC63F] dark:text-green-500 fill-[#8CC63F] dark:fill-green-500" />
                                  <span className="text-xs font-medium text-gray-900 dark:text-white">
                                    {(() => {
                                      const outletRating = Number(outlet?.rating)
                                      return Number.isFinite(outletRating) && outletRating > 0
                                        ? outletRating.toFixed(1)
                                        : "New"
                                    })()}
                                  </span>
                                </div>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {(() => {
                                    const outletReviews = Number(outlet?.reviews)
                                    if (!Number.isFinite(outletReviews) || outletReviews <= 0) {
                                      return "New"
                                    }
                                    return outletReviews >= 1000
                                      ? `By ${(outletReviews / 1000).toFixed(1)}K+`
                                      : `By ${outletReviews}+`
                                  })()}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        No outlets available
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  {restaurant?.outlets && Array.isArray(restaurant.outlets) && restaurant.outlets.length > 5 && (
                    <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-3 bg-white dark:bg-[#1a1a1a]">
                      <button className="flex items-center justify-center gap-2 text-red-600 dark:text-red-400 font-medium text-sm w-full">
                        <span>See all {restaurant.outlets.length} outlets</span>
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Manage Collections Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showManageCollections && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowManageCollections(false)}
                />

                {/* Manage Collections Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl md:max-w-lg w-full md:w-auto"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Manage Collections</h2>
                    <button
                      onClick={() => setShowManageCollections(false)}
                      className="h-8 w-8 rounded-full bg-gray-700 dark:bg-gray-600 flex items-center justify-center hover:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>

                  {/* Collections List */}
                  <div className="px-4 py-4 space-y-2">
                    {/* Bookmarks Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        // Don't close modal on click, let checkbox handle it
                      }}
                    >
                      <div className="h-12 w-12 rounded-lg bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center flex-shrink-0">
                        <Bookmark className="h-6 w-6 text-red-500 dark:text-red-400 fill-red-500 dark:fill-red-400" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-medium text-gray-900 dark:text-white">Bookmarks</span>
                          {selectedItem && (
                            <Checkbox
                              checked={isDishFavorite(selectedItem.id || selectedItem._id, restaurant?.restaurantId || restaurant?._id || restaurant?.id)}
                              onCheckedChange={(checked) => {
                                if (!checked && selectedItem) {
                                  const restaurantId = restaurant?.restaurantId || restaurant?._id || restaurant?.id
                                  removeDishFavorite(selectedItem.id, restaurantId)
                                  setShowManageCollections(false)
                                }
                              }}
                              className="h-5 w-5 rounded border-2 border-red-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          {!selectedItem && (
                            <div className="h-5 w-5 rounded border-2 border-red-500 bg-red-500 flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          {getDishFavorites().length} dishes � {getFavorites().length} restaurant
                        </p>
                      </div>
                    </button>

                    {/* Create new Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                      onClick={() => setShowManageCollections(false)}
                    >
                      <div className="h-12 w-12 rounded-lg bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center flex-shrink-0">
                        <Plus className="h-6 w-6 text-red-500 dark:text-red-400" />
                      </div>
                      <div className="flex-1 text-left">
                        <span className="text-base font-medium text-gray-900 dark:text-white">
                          Create new Collection
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Done Button */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4">
                    <Button
                      className="w-full bg-primary hover:bg-secondary text-white py-3 rounded-lg font-bold"
                      onClick={() => {
                        setShowManageCollections(false)
                      }}
                    >
                      Done
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Item Detail Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showItemDetail && selectedItem && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowItemDetail(false)}
                />

                {/* Item Detail Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[90vh] md:max-w-2xl lg:max-w-3xl w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.15, type: "spring", damping: 30, stiffness: 400 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Close Button - Top Center Above Popup with 4px gap */}
                  <div className="absolute -top-[44px] left-1/2 -translate-x-1/2 z-[10001]">
                    <motion.button
                      onClick={() => setShowItemDetail(false)}
                      className="h-10 w-10 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-900 transition-colors shadow-lg"
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <X className="h-5 w-5 text-white" />
                    </motion.button>
                  </div>

                  {/* Image Section */}
                  <div className="relative w-full h-64 overflow-hidden rounded-t-3xl bg-gray-100 dark:bg-gray-800">
                    {selectedItem.image ? (
                      <DishImage
                        src={selectedItem.image}
                        alt={selectedItem.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-sm text-gray-400">No image available</span>
                      </div>
                    )}
                    {/* Bookmark and Share Icons Overlay */}
                    <div className="absolute bottom-4 right-4 flex items-center gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleBookmarkClick(selectedItem)
                        }}
                        className={`h-10 w-10 rounded-full border flex items-center justify-center transition-all duration-300 ${isDishFavorite(selectedItem.id || selectedItem._id, restaurant?.restaurantId || restaurant?._id || restaurant?.id)
                          ? "border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400"
                          : "border-white dark:border-gray-800 bg-white/90 dark:bg-[#1a1a1a]/90 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-[#2a2a2a]"
                          }`}
                      >
                        <Bookmark
                          className={`h-5 w-5 transition-all duration-300 ${isDishFavorite(selectedItem.id || selectedItem._id, restaurant?.restaurantId || restaurant?._id || restaurant?.id) ? "fill-red-500 dark:fill-red-400" : ""
                            }`}
                        />
                      </button>
                      <button className="h-10 w-10 rounded-full border border-white dark:border-gray-800 bg-white/90 dark:bg-[#1a1a1a]/90 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-[#2a2a2a] flex items-center justify-center transition-colors">
                        <Share2 className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  {/* Content Section */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {/* Item Name and Indicator */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2 flex-1">
                        <div className={`h-5 w-5 rounded border-2 ${selectedItem.foodType === "Veg" ? "border-green-600 bg-green-50" : "border-red-600 bg-red-50"} dark:border-gray-600 dark:bg-gray-900/30 flex items-center justify-center flex-shrink-0`}>
                          <div className={`h-2.5 w-2.5 rounded-full ${selectedItem.foodType === "Veg" ? "bg-green-600" : "bg-red-600"}`} />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                          {selectedItem.name}
                        </h2>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                      {selectedItem.description}
                    </p>

                    {/* Highly Reordered Progress Bar */}
                    {isRecommendedItem(selectedItem) && (
                      <div className="flex items-center gap-2 mb-4">
                        <div className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 dark:bg-green-400 rounded-full" style={{ width: '50%' }} />
                        </div>
                        <span className="text-xs text-gray-600 dark:text-gray-400 font-medium whitespace-nowrap">
                          highly reordered
                        </span>
                      </div>
                    )}

                    {/* Not Eligible for Coupons */}
                    {selectedItem.notEligibleForCoupons && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-4">
                        NOT ELIGIBLE FOR COUPONS
                      </p>
                    )}

                    {hasFoodVariants(selectedItem) && (
                      <div className="mb-4">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Choose a variant</p>
                        <div className="flex flex-wrap gap-2">
                          {getFoodVariants(selectedItem).map((variant) => (
                            <button
                              key={variant.id}
                              type="button"
                              onClick={() => setSelectedVariantId(variant.id)}
                              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${String(selectedVariantId || "") === String(variant.id)
                                  ? "border-red-500 bg-red-50 text-red-600 dark:border-red-400 dark:bg-red-900/30 dark:text-red-200"
                                  : "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-[#2a2a2a] dark:text-gray-300"
                                }`}
                            >
                              {variant.name} · {RUPEE_SYMBOL}{Math.round(variant.price)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4 bg-white dark:bg-[#1a1a1a]">
                    <div className="flex items-center gap-4">
                      {/* Quantity Selector */}
                      <div className={`flex items-center gap-3 border-2 rounded-lg px-3 h-[44px] bg-white dark:bg-[#2a2a2a] ${shouldShowGrayscale
                        ? 'border-gray-300 dark:border-gray-700 opacity-50'
                        : 'border-gray-300 dark:border-gray-700'
                        }`}>
                        <button
                          onClick={(e) => {
                            if (!shouldShowGrayscale) {
                              updateItemQuantity(
                                selectedItem,
                                Math.max(0, getDishQuantity(selectedItem, selectedVariantId) - 1),
                                e,
                                getVariantForDish(selectedItem, selectedVariantId),
                              )
                            }
                          }}
                          disabled={getDishQuantity(selectedItem, selectedVariantId) === 0 || shouldShowGrayscale}
                          className={`${shouldShowGrayscale
                            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed'
                            }`}
                        >
                          <Minus className="h-5 w-5" />
                        </button>
                        <span className={`text-lg font-semibold min-w-[2rem] text-center ${shouldShowGrayscale
                          ? 'text-gray-400 dark:text-gray-600'
                          : 'text-gray-900 dark:text-white'
                          }`}>
                          {getDishQuantity(selectedItem, selectedVariantId)}
                        </span>
                        <button
                          onClick={(e) => {
                            if (!shouldShowGrayscale) {
                              updateItemQuantity(
                                selectedItem,
                                getDishQuantity(selectedItem, selectedVariantId) + 1,
                                e,
                                getVariantForDish(selectedItem, selectedVariantId),
                              )
                            }
                          }}
                          disabled={shouldShowGrayscale}
                          className={shouldShowGrayscale
                            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                          }
                        >
                          <Plus className="h-5 w-5" />
                        </button>
                      </div>

                      {/* Add Item Button */}
                      <Button
                        className={`flex-1 h-[44px] rounded-lg font-semibold flex items-center justify-center gap-2 ${shouldShowGrayscale
                          ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-600 cursor-not-allowed opacity-50'
                          : 'bg-[var(--primary)] hover:opacity-90 text-white'
                          }`}
                        onClick={(e) => {
                          if (!shouldShowGrayscale) {
                            updateItemQuantity(
                              selectedItem,
                              getDishQuantity(selectedItem, selectedVariantId) + 1,
                              e,
                              getVariantForDish(selectedItem, selectedVariantId),
                            )
                            setShowItemDetail(false)
                          }
                        }}
                        disabled={shouldShowGrayscale}
                      >
                        <span>Add item</span>
                        <div className="flex items-center gap-1">
                          {(() => {
                            const variant = getVariantForDish(selectedItem, selectedVariantId);
                            const basePrice = hasFoodVariants(selectedItem) ? (variant?.price || selectedItem.price) : selectedItem.price;

                            if (restaurant?.discount > 0) {
                              const discountedPrice = basePrice * (1 - restaurant.discount / 100);
                              return (
                                <>
                                  <span className="text-sm line-through text-red-200">
                                    {RUPEE_SYMBOL}{Math.round(basePrice)}
                                  </span>
                                  <span className="text-base font-bold">
                                    {hasFoodVariants(selectedItem) ? `${variant?.name || "Default"} · ` : ""}{RUPEE_SYMBOL}{Math.round(discountedPrice)}
                                  </span>
                                </>
                              );
                            } else if (selectedItem.originalPrice && selectedItem.originalPrice > basePrice) {
                              return (
                                <>
                                  <span className="text-sm line-through text-red-200">
                                    {RUPEE_SYMBOL}{Math.round(selectedItem.originalPrice)}
                                  </span>
                                  <span className="text-base font-bold">
                                    {hasFoodVariants(selectedItem) ? `${variant?.name || "Default"} · ` : ""}{RUPEE_SYMBOL}{Math.round(basePrice)}
                                  </span>
                                </>
                              );
                            }
                            return (
                              <span className="text-base font-bold">
                                {hasFoodVariants(selectedItem) ? `${variant?.name || "Default"} · ` : ""}{RUPEE_SYMBOL}{Math.round(basePrice)}
                              </span>
                            );
                          })()}
                        </div>
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Schedule Delivery Time Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showScheduleSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowScheduleSheet(false)}
                />

                {/* Schedule Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[60vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.15, type: "spring", damping: 30, stiffness: 400 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Close Button - Centered Overlapping */}
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-10">
                    <button
                      onClick={() => setShowScheduleSheet(false)}
                      className="h-10 w-10 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-900 transition-colors shadow-lg"
                    >
                      <X className="h-5 w-5 text-white" />
                    </button>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 pt-10 pb-4">
                    {/* Title */}
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
                      Select your delivery time
                    </h2>

                    {/* Date Selection */}
                    <div className="flex items-center gap-3 mb-4 overflow-x-auto pb-2 scrollbar-hide">
                      {(() => {
                        const today = new Date()
                        const tomorrow = new Date(today)
                        tomorrow.setDate(tomorrow.getDate() + 1)
                        const dayAfter = new Date(today)
                        dayAfter.setDate(dayAfter.getDate() + 2)

                        const dates = [
                          { date: today, label: "Today" },
                          { date: tomorrow, label: "Tomorrow" },
                          { date: dayAfter, label: dayAfter.toLocaleDateString('en-US', { weekday: 'short' }) }
                        ]

                        return dates.map((item, index) => {
                          const dateStr = item.date.toISOString().split('T')[0]
                          const day = String(item.date.getDate()).padStart(2, '0')
                          const month = item.date.toLocaleDateString('en-US', { month: 'short' })
                          const isSelected = selectedDate === dateStr

                          return (
                            <button
                              key={index}
                              onClick={() => setSelectedDate(dateStr)}
                              className="flex flex-col items-center gap-0.5 flex-shrink-0 pb-1"
                            >
                              <span className={`text-sm font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                                {day} {month} {item.label}
                              </span>
                              {isSelected && (
                                <div className="h-0.5 w-full bg-red-500 mt-0.5" />
                              )}
                            </button>
                          )
                        })
                      })()}
                    </div>

                    {/* Time Slot Selection */}
                    <div className="space-y-2 mb-4">
                      {["6:30 - 7 PM", "7 - 7:30 PM", "7:30 - 8 PM", "8 - 8:30 PM"].map((slot, index) => {
                        const isSelected = selectedTimeSlot === slot
                        return (
                          <button
                            key={index}
                            onClick={() => setSelectedTimeSlot(slot)}
                            className={`w-full text-left px-4 py-2.5 rounded-lg transition-all ${isSelected
                              ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600"
                              : "bg-white dark:bg-[#2a2a2a] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent"
                              }`}
                          >
                            <span className="text-sm font-medium">{slot}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Confirm Button - Fixed at bottom */}
                  <div className="px-4 pb-4 pt-2 border-t border-gray-100">
                    <Button
                      className="w-full bg-[var(--primary)] hover:opacity-90 text-white py-3 rounded-lg font-semibold"
                      onClick={() => {
                        setShowScheduleSheet(false)
                        // Handle schedule confirmation
                      }}
                    >
                      Confirm
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Offers Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showOffersSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowOffersSheet(false)}
                />

                {/* Offers Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[85vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                >
                  {/* Header */}
                  <div className="px-4 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      Offers at {restaurant?.name || "Unknown Restaurant"}
                    </h2>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">


                    {/* Restaurant Coupons Section */}
                    {restaurant?.restaurantOffers?.coupons && Array.isArray(restaurant.restaurantOffers.coupons) && restaurant.restaurantOffers.coupons.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                          Restaurant coupons
                        </h3>
                        <div className="space-y-3">
                          {restaurant.restaurantOffers.coupons.map((coupon, couponIndex) => {
                            const couponKey = coupon?.id || coupon?.code || `coupon-${couponIndex}`
                            const isExpanded = expandedCoupons.has(couponKey)
                            return (
                              <div
                                key={couponKey}
                                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden shadow-sm"
                              >
                                <button
                                  className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                  onClick={() => {
                                    setExpandedCoupons((prev) => {
                                      const newSet = new Set(prev)
                                      if (newSet.has(couponKey)) {
                                        newSet.delete(couponKey)
                                      } else {
                                        newSet.add(couponKey)
                                      }
                                      return newSet
                                    })
                                  }}
                                >
                                  <Percent className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                                  <div className="flex-1 text-left">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                                      {coupon?.title || "Restaurant coupon"}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                      Use code {coupon?.code || "N/A"}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      className="px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium rounded"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        // Copy code to clipboard
                                        if (coupon?.code) {
                                          navigator.clipboard.writeText(coupon.code)
                                        }
                                      }}
                                    >
                                      {coupon?.code || "Copy"}
                                    </button>
                                    <ChevronDown
                                      className={`h-4 w-4 text-gray-500 dark:text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""
                                        }`}
                                    />
                                  </div>
                                </button>
                                {isExpanded && (
                                  <div className="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                                    <p className="text-xs text-gray-600 dark:text-gray-400">
                                      Terms and conditions apply
                                    </p>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Close Button */}
                  <div className="border-t border-gray-200 dark:border-gray-800 px-4 py-4 bg-white dark:bg-[#1a1a1a]">
                    <Button
                      className="w-full bg-primary hover:bg-secondary text-white border-0 flex items-center justify-center gap-2 py-6 rounded-xl font-bold transition-all shadow-lg text-sm"
                      onClick={() => setShowOffersSheet(false)}
                    >
                      <X className="h-4 w-4" />
                      Close
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Menu Options Bottom Sheet - Rendered via Portal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showMenuOptionsSheet && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowMenuOptionsSheet(false)}
                />

                {/* Menu Options Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[70vh] md:max-h-[90vh] md:max-w-lg w-full md:w-auto flex flex-col"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.2, type: "spring", damping: 30, stiffness: 400 }}
                  style={{ willChange: "transform" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="px-4 pt-6 pb-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      {restaurant?.name || "Unknown Restaurant"}
                    </h2>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto px-4 py-4">
                    {/* Menu Options List */}
                    <div className="space-y-1">
                      {/* Add to Collection */}
                      <button
                        className="w-full flex items-center gap-4 px-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                        onClick={handleAddToCollection}
                      >
                        <Bookmark className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-base text-gray-900 dark:text-white">
                          {isFavorite(restaurant?.slug || slug || "") ? "Remove from Collection" : "Add to Collection"}
                        </span>
                      </button>

                      {/* Share this restaurant */}
                      <button
                        className="w-full flex items-center gap-4 px-2 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
                        onClick={handleShareRestaurant}
                      >
                        <Share2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-base text-gray-900 dark:text-white">Share this restaurant</span>
                      </button>

                    </div>

                    {/* Disclaimer Text */}
                    <div className="mt-6 px-2">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Menu items, prices, photos and descriptions are set directly by the restaurant. In case you see any incorrect information, please report it to us.
                      </p>
                    </div>

                    {/* FSSAI License Information */}
                    {restaurant?.onboarding?.step3?.fssai?.registrationNumber && (
                      <div className="mt-4 px-2 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3 opacity-80 mb-2">
                        <div className="h-8 w-14 flex items-center justify-center bg-white rounded p-1 border border-gray-100">
                          <img
                            src={fssaiLogo}
                            alt="FSSAI"
                            className="h-full w-auto object-contain"
                          />
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">
                            Lic. No.
                          </p>
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            {restaurant?.onboarding?.step3?.fssai?.registrationNumber}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom Handle */}
                  <div className="px-4 pb-2 pt-2 flex justify-center">
                    <div className="h-1 w-12 bg-gray-300 rounded-full" />
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Share Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showShareModal && sharePayload && (
              <>
                <motion.div
                  className="fixed inset-0 bg-black/50 z-[10020]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowShareModal(false)}
                />
                <motion.div
                  className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10021] w-[92vw] max-w-md bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.16 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">Share</h3>
                    <button
                      className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => setShowShareModal(false)}
                      aria-label="Close share modal"
                    >
                      <X className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                    </button>
                  </div>

                  <div className="px-5 py-4 space-y-2">
                    {typeof navigator !== "undefined" && navigator.share && (
                      <button
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                        onClick={handleSystemShareFromModal}
                      >
                        <Share2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">Share via system apps</span>
                      </button>
                    )}
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("whatsapp")}
                    >
                      <MessageCircle className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">WhatsApp</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("telegram")}
                    >
                      <Send className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Telegram</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("email")}
                    >
                      <Mail className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Email</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={copyShareLink}
                    >
                      <Copy className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Copy link</span>
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Add to Cart Animation Component - Rendered via Portal to prevent transform interference */}
      {typeof window !== "undefined" && !showScanAnimation &&
        createPortal(
          <AddToCartAnimation
            bottomOffset={80}
            linkTo="/food/user/cart"
            hideOnPages={true}
          />,
          document.body
        )}
    </AnimatedPage>
  )
}

class RestaurantDetailsErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    debugError("RestaurantDetails crashed:", error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <AnimatedPage>
          <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <div className="flex flex-col items-center gap-4 text-center">
              <AlertCircle className="h-12 w-12 text-red-500" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                  Something went wrong
                </h2>
                <p className="text-sm text-gray-600 mb-4 max-w-md">
                  We could not load this restaurant page right now.
                </p>
                <Button onClick={() => window.location.reload()} variant="outline">
                  Reload Page
                </Button>
              </div>
            </div>
          </div>
        </AnimatedPage>
      )
    }

    return this.props.children
  }
}

export default function RestaurantDetails() {
  return (
    <RestaurantDetailsErrorBoundary>
      <RestaurantDetailsContent />
    </RestaurantDetailsErrorBoundary>
  )
}

