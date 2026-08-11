import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Search, Menu, ChevronRight, MapPin, X, Bell, HelpCircle } from "lucide-react"
import { restaurantAPI } from "@food/api"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"
import useNotificationInbox from "@food/hooks/useNotificationInbox"
import { useRestaurantNotifications } from "@food/hooks/useRestaurantNotifications"
import { Utensils } from "lucide-react"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const extractRestaurantPayload = (response) =>
  response?.data?.data?.restaurant ||
  response?.data?.restaurant ||
  response?.data?.data?.user ||
  response?.data?.user ||
  response?.data?.data ||
  null


export default function RestaurantNavbar({
  restaurantName: propRestaurantName,
  location: propLocation,
  showSearch = true,
  showOfflineOnlineTag = true,
  showNotifications = true,
  onMobileMenuOpen,
}) {
  const navigate = useNavigate()
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [status, setStatus] = useState("Offline")
  const [restaurantData, setRestaurantData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [companyName, setCompanyName] = useState("")
  const [logoUrl, setLogoUrl] = useState(null)
  const searchTimeoutRef = useRef(null)
  const { unreadCount } = useNotificationInbox("restaurant", { limit: 20, pollMs: 5 * 60 * 1000 })
  const { newReservation, clearNewReservation } = useRestaurantNotifications();

  // Global search effect
  useEffect(() => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (searchValue.trim() === "") {
      // Dispatch empty search event
      window.dispatchEvent(
        new CustomEvent("restaurantSearchUpdated", {
          detail: { query: "", results: [], isLoading: false },
        }),
      )
      return
    }

    // Set loading state
    window.dispatchEvent(
      new CustomEvent("restaurantSearchUpdated", {
        detail: { query: searchValue, results: [], isLoading: true },
      }),
    )

    // Debounce search API call
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await restaurantAPI.getOrders({
          page: 1,
          limit: 100,
          search: searchValue,
        })
        
        if (response.data.success) {
          window.dispatchEvent(
            new CustomEvent("restaurantSearchUpdated", {
              detail: {
                query: searchValue,
                results: response.data.data.orders || [],
                isLoading: false,
              },
            }),
          )
        }
      } catch (error) {
        debugError("Search error:", error)
        window.dispatchEvent(
          new CustomEvent("restaurantSearchUpdated", {
            detail: { query: searchValue, results: [], isLoading: false, error },
          }),
        )
      }
    }, 500)

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [searchValue])

  // Load business settings for branding
  useEffect(() => {
    const loadSettings = async () => {
      const cached = getCachedSettings()
      if (cached) {
        if (cached.companyName) setCompanyName(cached.companyName)
        const resLogo = cached.restaurantLogo?.url || cached.logo?.url
        if (resLogo) setLogoUrl(resLogo)
      } else {
        const settings = await loadBusinessSettings()
        if (settings) {
          if (settings.companyName) setCompanyName(settings.companyName)
          const resLogo = settings.restaurantLogo?.url || settings.logo?.url
          if (resLogo) setLogoUrl(resLogo)
        }
      }
    }
    loadSettings()

    const handleSettingsUpdate = () => {
      const cached = getCachedSettings()
      if (cached) {
        if (cached.companyName) setCompanyName(cached.companyName)
        const resLogo = cached.restaurantLogo?.url || cached.logo?.url
        if (resLogo) setLogoUrl(resLogo)
      }
    }
    window.addEventListener('businessSettingsUpdated', handleSettingsUpdate)
    return () => window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate)
  }, [])

  // Fetch restaurant data on mount
  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        setLoading(true)
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = extractRestaurantPayload(response)
        if (data) {
          setRestaurantData(data)
        }
      } catch (error) {
        // Only log error if it's not a network/timeout error (backend might be down/slow)
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching restaurant data:", error)
        }
        // Continue with default values if fetch fails
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()
  }, [])

  // Format full address from location object - using stored data only, no live fetching
  const formatAddress = (location) => {
    if (!location) return ""
    
    // Priority 1: Use formattedAddress if available (stored address from database)
    if (location.formattedAddress && location.formattedAddress.trim() !== "" && location.formattedAddress !== "Select location") {
      // Check if it's just coordinates (latitude, longitude format)
      const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(location.formattedAddress.trim())
      if (!isCoordinates) {
        return location.formattedAddress.trim()
      }
    }
    
    // Priority 2: Use address field if available
    if (location.address && location.address.trim() !== "") {
      return location.address.trim()
    }
    
    // Priority 3: Build from individual components
    const parts = []
    
    // Add street address (addressLine1 or street)
    if (location.addressLine1) {
      parts.push(location.addressLine1.trim())
    } else if (location.street) {
      parts.push(location.street.trim())
    }
    
    // Add addressLine2 if available
    if (location.addressLine2) {
      parts.push(location.addressLine2.trim())
    }
    
    // Add area if available
    if (location.area) {
      parts.push(location.area.trim())
    }
    
    // Add landmark if available
    if (location.landmark) {
      parts.push(location.landmark.trim())
    }
    
    // Add city if available and not already in area
    if (location.city) {
      const city = location.city.trim()
      // Only add city if it's not already included in previous parts
      const cityAlreadyIncluded = parts.some(part => part.toLowerCase().includes(city.toLowerCase()))
      if (!cityAlreadyIncluded) {
        parts.push(city)
      }
    }
    
    // Add state if available
    if (location.state) {
      const state = location.state.trim()
      // Only add state if it's not already included
      const stateAlreadyIncluded = parts.some(part => part.toLowerCase().includes(state.toLowerCase()))
      if (!stateAlreadyIncluded) {
        parts.push(state)
      }
    }
    
    // Add zipCode/pincode if available
    if (location.zipCode || location.pincode || location.postalCode) {
      const zip = (location.zipCode || location.pincode || location.postalCode).trim()
      parts.push(zip)
    }
    
    return parts.length > 0 ? parts.join(", ") : ""
  }

  // Get restaurant name (use prop if provided, otherwise use fetched data)
  const restaurantName = propRestaurantName || restaurantData?.name || "Restaurant"

  const [location, setLocation] = useState("")

  // Update location when restaurantData or propLocation changes
  useEffect(() => {
    let newLocation = ""
    
    // Priority 1: Explicit prop takes highest priority
    if (propLocation && propLocation.trim() !== "") {
      newLocation = propLocation.trim()
    }
    // Priority 2: Check restaurantData location
    else if (restaurantData) {
      debugLog('?? Checking restaurant data for address:', {
        hasLocation: !!restaurantData.location,
        locationKeys: restaurantData.location ? Object.keys(restaurantData.location) : [],
        formattedAddress: restaurantData.location?.formattedAddress,
        address: restaurantData.location?.address,
        directAddress: restaurantData.address,
        fullLocation: restaurantData.location
      })
      
      if (restaurantData.location) {
        // Use stored formattedAddress first (from database)
        if (restaurantData.location.formattedAddress && 
            restaurantData.location.formattedAddress.trim() !== "" && 
            restaurantData.location.formattedAddress !== "Select location") {
          // Check if it's just coordinates (latitude, longitude format)
          const isCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(restaurantData.location.formattedAddress.trim())
          if (!isCoordinates) {
            newLocation = restaurantData.location.formattedAddress.trim()
            debugLog('? Using formattedAddress:', newLocation)
          }
        }
        
        // If formattedAddress is not available or is coordinates, try formatAddress function
        if (!newLocation) {
          const formatted = formatAddress(restaurantData.location)
          if (formatted && formatted.trim() !== "") {
            newLocation = formatted.trim()
            debugLog('? Using formatAddress result:', newLocation)
          }
        }
        
        // Additional fallback: check if address is directly on location
        if (!newLocation && restaurantData.location.address && restaurantData.location.address.trim() !== "") {
          newLocation = restaurantData.location.address.trim()
          debugLog('? Using location.address:', newLocation)
        }
      }
      
      // Priority 3: Fallback - check if address is directly on restaurantData (not in location object)
      if (!newLocation && restaurantData.address && restaurantData.address.trim() !== "") {
        newLocation = restaurantData.address.trim()
        debugLog('? Using restaurantData.address:', newLocation)
      }
    }
    
    setLocation(newLocation)
    
    // Debug log
    if (newLocation) {
      debugLog('?? Restaurant address displayed:', newLocation)
    } else if (restaurantData) {
      debugLog('?? Restaurant data available but no address found')
    }
  }, [restaurantData, propLocation])

  // Load status from localStorage on mount and listen for changes
  useEffect(() => {
    const updateStatus = () => {
      try {
        const savedStatus = localStorage.getItem('restaurant_online_status')
        if (savedStatus !== null) {
          const isOnline = JSON.parse(savedStatus)
          setStatus(isOnline ? "Online" : "Offline")
        } else {
          // If not stored yet, fallback to backend value (when available).
          const isOnline = Boolean(restaurantData?.isAcceptingOrders)
          setStatus(isOnline ? "Online" : "Offline")
        }
      } catch (error) {
        debugError("Error loading restaurant status:", error)
        const isOnline = Boolean(restaurantData?.isAcceptingOrders)
        setStatus(isOnline ? "Online" : "Offline")
      }
    }

    // Load initial status
    updateStatus()

    // Listen for status changes from RestaurantStatus page
  const handleStatusChange = (event) => {
      const isOnline = event.detail?.isOnline || false
      setStatus(isOnline ? "Online" : "Offline")
  }

    window.addEventListener('restaurantStatusChanged', handleStatusChange)
    
    return () => {
      window.removeEventListener('restaurantStatusChanged', handleStatusChange)
    }
  }, [restaurantData])



  const handleSearchClick = () => {
    setIsSearchActive(true)
  }

  const handleSearchClose = () => {
    setIsSearchActive(false)
    setSearchValue("")
  }

  const handleSearchChange = (e) => {
    setSearchValue(e.target.value)
  }

  const handleMenuClick = () => {
    navigate("/food/restaurant/explore")
  }

  const handleNotificationsClick = () => {
    navigate("/food/restaurant/notifications")
  }

  return (
    <div className="w-full bg-gradient-to-r from-[#B80B3D] to-[#66001D] rounded-b-[24px] shadow-lg px-3 pt-4 pb-4 sm:px-4 sm:pt-5 sm:pb-5 flex items-center justify-between gap-2 relative">
      {/* Search Overlay */}
      {isSearchActive && (
        <div className="absolute inset-0 bg-white z-50 flex items-center px-4 gap-3">
          <div className="flex-1 relative flex items-center">
            <Search className="absolute left-0 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchValue}
              onChange={handleSearchChange}
              placeholder="Search by order ID or dish name"
              className="w-full pl-8 pr-4 py-2 text-gray-900 placeholder-gray-500 font-medium focus:outline-none"
              autoFocus
            />
          </div>
          <button
            onClick={handleSearchClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 hover:bg-gray-200 transition-colors shrink-0"
            aria-label="Close search"
          >
            <X className="w-5 h-5 text-gray-700" />
          </button>
        </div>
      )}

      {/* Left Side - Restaurant Info */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 pr-1 sm:pr-4">
        {onMobileMenuOpen && (
          <button
            type="button"
            onClick={onMobileMenuOpen}
            className="shrink-0 rounded-xl bg-white/15 p-2 text-white hover:bg-white/25 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        {logoUrl && (
          <img
            src={logoUrl}
            alt="Logo"
            className="h-9 w-9 shrink-0 rounded-lg object-contain sm:h-10 sm:w-10"
          />
        )}
        <div className="min-w-0 flex-1">
          {/* Restaurant Name */}
          <div className="flex items-baseline min-w-0">
            <h1 className="text-[15px] sm:text-[17px] font-black text-white truncate leading-tight">
              {loading ? "Loading..." : (restaurantName || "Restaurant")}
            </h1>
          </div>
          
          {/* Location & Company */}
          {!loading && (
            <div className="flex items-center gap-1 mt-0.5 opacity-90 min-w-0">
              {location && location.trim() !== "" && (
                <MapPin className="w-3 h-3 text-white/80 shrink-0" />
              )}
              <p className="text-[11px] text-white/80 truncate font-medium">
                {location && location.trim() !== "" ? location : ""}
                {location && location.trim() !== "" && companyName ? " • " : ""}
                {companyName ? <span className="uppercase tracking-wider font-bold">{companyName}</span> : ""}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Right Side - Interactive Elements */}
      <div className="flex shrink-0 items-center">
        {/* Offline/Online Status Tag */}
        {showOfflineOnlineTag && (
          <div
            className={`flex items-center gap-1 px-2 py-1 sm:gap-1.5 sm:px-3 sm:py-1.5 rounded-full shadow-sm ${
              status === "Online" 
                ? "bg-white/20 border border-white/20" 
                : "bg-white/10 border border-white/10"
            }`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              status === "Online" ? "bg-[#00e676]" : "bg-gray-400"
            }`}></span>
            <span className="text-[11px] sm:text-sm font-bold text-white tracking-wide">
              {status}
            </span>
          </div>
        )}

        {/* Search Icon */}
        {showSearch && (
          <button
            onClick={handleSearchClick}
            className="p-2 ml-1 hover:bg-white/10 rounded-full transition-colors"
            aria-label="Search"
          >
            <Search className="w-5 h-5 text-white" />
          </button>
        )}

        {/* Notifications Icon */}
        {showNotifications && (
            <button
              onClick={handleNotificationsClick}
              className="relative p-2 ml-1 hover:bg-white/10 rounded-full transition-colors"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5 text-white" />
              {unreadCount > 0 && (
                <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-red-500 border border-white animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.4)]" />
              )}
            </button>
          )}
      </div>
      
      {/* Real-time Dining Booking Popup */}
      {newReservation && (
        <div className="fixed top-20 left-4 right-4 z-[100] animate-in slide-in-from-top duration-300">
          <div className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-primary/10 overflow-hidden">
            <div className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-purple-50 flex items-center justify-center shrink-0">
                <Utensils className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-black text-slate-900 text-sm">New Table Request!</h4>
                <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
                  {newReservation.user?.name || "A Guest"} has requested a table for {newReservation.guests} people.
                </p>
              </div>
              <button 
                onClick={clearNewReservation}
                className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-slate-50 p-3 flex gap-2">
              <button 
                onClick={() => {
                  clearNewReservation();
                  navigate("/food/restaurant/explore");
                }}
                className="flex-1 h-10 bg-primary text-white text-xs font-bold rounded-xl uppercase tracking-widest shadow-lg shadow-purple-200"
              >
                View Request
              </button>
              <button 
                onClick={clearNewReservation}
                className="px-4 h-10 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-xl uppercase tracking-widest"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

