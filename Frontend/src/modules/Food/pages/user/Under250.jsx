import { Link, useNavigate } from "react-router-dom"
import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { Star, Clock, MapPin, ArrowDownUp, Timer, ArrowRight, ChevronDown, Bookmark, Share2, Plus, Minus, X, UtensilsCrossed, ArrowLeft, Search } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import AnimatedPage from "@food/components/user/AnimatedPage"
import MenuScanAnimation from "@food/components/user/MenuScanAnimation"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { useLocationSelector } from "@food/components/user/UserLayout"
import { useAppLocation } from "@food/hooks/useAppLocation"
import { useCart } from "@food/context/CartContext"
import PageNavbar from "@food/components/user/PageNavbar"
import offerImage from "@food/assets/offerimage.png"
import AddToCartAnimation from "@food/components/user/AddToCartAnimation"
import OptimizedImage from "@food/components/OptimizedImage"
import api, { restaurantAPI, adminAPI, getPublicLandingSettings } from "@food/api"
import { isModuleAuthenticated } from "@food/utils/auth"
import { flattenMenuItems, getMenuFromResponse } from "@food/utils/menuItems"
import { calculateDistance, formatDistance } from "@food/utils/common"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import { readScopedValue, removeScopedValue, writeScopedValue } from "@food/utils/appStorage"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}
const RUPEE_SYMBOL = "\u20B9"
const UNDER_250_FILTERS_STORAGE_KEY = "food-under-250-filters"
const UNDER_250_FILTERS_SCOPE = "ui"
const UNDER_250_FILTERS_NAME = "under250-filters"

const readLegacyUnder250Filters = () => {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const raw = window.localStorage.getItem(UNDER_250_FILTERS_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const normalizeUnder250Filters = (parsed) => ({
  selectedSort: typeof parsed?.selectedSort === "string" ? parsed.selectedSort : null,
  activeCategory: typeof parsed?.activeCategory === "string" ? parsed.activeCategory : null,
  under30MinsFilter: parsed?.under30MinsFilter === true,
})

const readUnder250Filters = () => {
  const fallback = {
    selectedSort: null,
    activeCategory: null,
    under30MinsFilter: false,
  }

  if (typeof window === "undefined") {
    return fallback
  }

  const scoped = readScopedValue(UNDER_250_FILTERS_SCOPE, UNDER_250_FILTERS_NAME, {
    storage: "session",
    fallback: null,
  })
  if (scoped) {
    return normalizeUnder250Filters(scoped)
  }

  const legacy = readLegacyUnder250Filters()
  if (legacy) {
    const normalized = normalizeUnder250Filters(legacy)
    writeScopedValue(UNDER_250_FILTERS_SCOPE, UNDER_250_FILTERS_NAME, normalized, { storage: "session" })
    window.localStorage.removeItem(UNDER_250_FILTERS_STORAGE_KEY)
    return normalized
  }

  return fallback
}

const ScrollAwareAddToCartAnimation = () => {
  const [viewCartButtonBottom, setViewCartButtonBottom] = useState("bottom-[92px]")
  const lastScrollY = useRef(0)

  useEffect(() => {
    let scrollTimeout = null;
    const handleScroll = () => {
      if (scrollTimeout) return;
      scrollTimeout = setTimeout(() => {
        const currentScrollY = window.scrollY
        const scrollDifference = Math.abs(currentScrollY - lastScrollY.current)

        if (scrollDifference >= 5) {
          if (currentScrollY > lastScrollY.current) {
            setViewCartButtonBottom("bottom-[72px]")
          } else if (currentScrollY < lastScrollY.current) {
            setViewCartButtonBottom("bottom-[92px]")
          }
          lastScrollY.current = currentScrollY
        }
        scrollTimeout = null;
      }, 50);
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", handleScroll)
      if (scrollTimeout) clearTimeout(scrollTimeout)
    }
  }, [])

  return <AddToCartAnimation dynamicBottom={viewCartButtonBottom} />
}

const HorizontalMenuScroller = ({ restaurant, quantities, isClosed, handleItemClick, RUPEE_SYMBOL }) => {
  const [visibleCount, setVisibleCount] = useState(8);
  const observerTarget = useRef(null);

  useEffect(() => {
    if (visibleCount >= restaurant.menuItems.length) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((prev) => Math.min(prev + 8, restaurant.menuItems.length));
      }
    }, { rootMargin: "200px", threshold: 0.1 });

    const currentTarget = observerTarget.current;
    if (currentTarget) observer.observe(currentTarget);

    return () => {
      if (currentTarget) observer.unobserve(currentTarget);
      observer.disconnect();
    };
  }, [visibleCount, restaurant.menuItems.length]);

  const visibleItems = restaurant.menuItems.slice(0, visibleCount);

  return (
    <div
      className="flex md:grid gap-3 sm:gap-4 md:gap-5 lg:gap-6 overflow-x-auto md:overflow-x-visible overflow-y-visible scrollbar-hide scroll-smooth pb-2 md:pb-0 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      style={{
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        touchAction: "pan-x pan-y pinch-zoom",
        overflowY: "hidden",
      }}
    >
      {visibleItems.map((item, itemIndex) => {
        const quantity = quantities[item.id] || 0
        return (
          <motion.div
            key={item.id}
            className="flex-shrink-0 w-[140px] sm:w-[160px] md:w-[180px] bg-transparent cursor-pointer relative"
            onClick={() => !isClosed && handleItemClick(item, restaurant)}
            whileHover={{ scale: 1.02 }}
          >
            {/* Item Image */}
            <div className="relative w-full aspect-square rounded-2xl overflow-hidden mb-3">
              <motion.div
                className="absolute inset-0"
                whileHover={{ scale: 1.1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              >
                <OptimizedImage
                  src={item.image}
                  alt={item.name}
                  className="w-full h-full"
                  objectFit="cover"
                  sizes="(max-width: 640px) 200px, (max-width: 768px) 220px, 100vw"
                  placeholder="blur"
                  priority={itemIndex < 4}
                />
              </motion.div>
              {/* Gradient Overlay on Hover */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent"
                initial={{ opacity: 0 }}
                whileHover={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
              />
              {isClosed && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-20">
                  <div className="bg-gray-400/90 px-3 py-1.5 rounded-lg border border-white/20">
                    <span className="text-white font-black uppercase tracking-widest text-xs">OFFLINE</span>
                  </div>
                </div>
              )}
              {/* Veg indicator moved below */}
            </div>

            {/* Item Details */}
            <div className="flex flex-col">
              <div className="flex items-center gap-1 md:gap-1.5 mb-1">
                {item.isVeg ? (
                  <div className="flex-shrink-0 h-3.5 w-3.5 md:h-4 md:w-4 rounded border border-green-600 flex items-center justify-center">
                    <div className="h-2 w-2 md:h-2 md:w-2 rounded-full bg-green-600" />
                  </div>
                ) : (
                  <div className="flex-shrink-0 h-3.5 w-3.5 md:h-4 md:w-4 rounded border border-red-600 flex items-center justify-center">
                    <div className="h-2 w-2 md:h-2 md:w-2 rounded-full bg-red-600" />
                  </div>
                )}
                <span className="text-sm md:text-base font-semibold text-gray-900 dark:text-white truncate">
                  {item.name}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  {(() => {
                    let discountPercentage = restaurant?.discount || 0;
                    const specificItemDiscount = (restaurant?.itemDiscounts || []).find(d => String(d.itemId) === String(item.id || item._id));
                    if (specificItemDiscount) {
                      discountPercentage = specificItemDiscount.discountValue || 0;
                    } else {
                      const matchingRule = (restaurant?.discountRules || []).find(rule => {
                        const val = Number(rule.conditionValue);
                        if (rule.conditionType === 'PRICE_ABOVE' && item.price > val) return true;
                        if (rule.conditionType === 'PRICE_BELOW' && item.price < val) return true;
                        return false;
                      });
                      if (matchingRule) discountPercentage = matchingRule.discountValue || 0;
                    }

                    if (discountPercentage > 0) {
                      return (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <p className="text-base md:text-lg lg:text-xl xl:text-2xl font-bold text-gray-900 dark:text-white">
                              {RUPEE_SYMBOL}{Math.round(item.price * (1 - discountPercentage / 100))}
                            </p>
                            <p className="text-xs md:text-sm text-gray-500 line-through">
                              {RUPEE_SYMBOL}{Math.round(item.price)}
                            </p>
                          </div>
                          <div className="inline-flex">
                            <span className="text-[10px] font-bold text-green-600 bg-green-50 border border-green-200 px-1 py-0.5 rounded uppercase">
                              {discountPercentage}% OFF
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <p className="text-base md:text-lg lg:text-xl xl:text-2xl font-bold text-gray-900 dark:text-white">
                        {RUPEE_SYMBOL}{Math.round(item.price)}
                      </p>
                    );
                  })()}
                  {item.bestPrice && (
                    <p className="text-xs md:text-sm lg:text-base text-gray-500 dark:text-gray-400">Best price</p>
                  )}
                </div>
                {isClosed ? (
                  <Button
                    variant={"ghost"}
                    size="sm"
                    disabled={true}
                    className="rounded-xl h-8 sm:h-9 md:h-10 px-4 sm:px-6 md:px-8 text-[12px] sm:text-[14px] md:text-[16px] font-bold uppercase tracking-wide bg-gray-400 dark:bg-gray-700 text-white cursor-not-allowed shadow-none"
                  >
                    OFFLINE
                  </Button>
                ) : quantity > 0 ? (
                  <Link to="/user/cart" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant={"outline"}
                      size="sm"
                      className="rounded-xl h-8 sm:h-9 px-4 sm:px-5 text-[12px] sm:text-[14px] font-bold uppercase tracking-wide transition-all duration-300 active:scale-95 flex items-center gap-1 border-primary text-primary hover:bg-primary/5"
                    >
                      VIEW CART
                    </Button>
                  </Link>
                ) : (
                  <Button
                    variant={"outline"}
                    size="sm"
                    className="rounded-xl h-8 sm:h-9 md:h-10 px-6 sm:px-8 text-[14px] sm:text-[15px] font-bold uppercase transition-all duration-300 active:scale-95 flex items-center justify-center bg-white dark:bg-black border-primary text-primary hover:bg-primary/5 shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleItemClick(item, restaurant)
                    }}
                  >
                    ADD
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )
      })}

      {/* Infinite Scroll Trigger for Horizontal List */}
      {visibleCount < restaurant.menuItems.length && (
        <div ref={observerTarget} className="flex-shrink-0 w-16 md:w-full h-32 sm:h-36 md:h-40 lg:h-48 xl:h-52 flex items-center justify-center">
           <div className="w-6 h-6 rounded-full border-[3px] border-gray-200 border-t-primary animate-spin" />
        </div>
      )}
    </div>
  );
};

const pageCache = {
  zoneId: null,
  categories: null,
  bannerImages: null,
  under250Restaurants: null,
  allRawRestaurants: null,
  visibleRestaurantCount: 0,
  hasMore: true,
  fetchedIds: null,
};

export default function Under250() {
  const initialFiltersRef = useRef(readUnder250Filters())
  const { location, zoneId, zoneStatus, isInService, isOutOfService, serviceUnavailableMessage } = useAppLocation()
  // Initialize state from cache if zoneId matches
  const isCacheValid = pageCache.zoneId === zoneId;
  // Always show scan animation on page load, even if cached, because user likes the animation
  const [showScanAnimation, setShowScanAnimation] = useState(true)
  const navigate = useNavigate()
  const { addToCart, updateQuantity, removeFromCart, getCartItem, cart } = useCart()
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState(initialFiltersRef.current.activeCategory)
  const [isSwitchingCategory, setIsSwitchingCategory] = useState(false)
  const [showSortPopup, setShowSortPopup] = useState(false)
  const [selectedSort, setSelectedSort] = useState(initialFiltersRef.current.selectedSort)
  const [draftSelectedSort, setDraftSelectedSort] = useState(initialFiltersRef.current.selectedSort)
  const [under30MinsFilter, setUnder30MinsFilter] = useState(initialFiltersRef.current.under30MinsFilter)
  const [showItemDetail, setShowItemDetail] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [itemDetailQuantity, setItemDetailQuantity] = useState(1)
  const [showShareOptions, setShowShareOptions] = useState(false)
  const [quantities, setQuantities] = useState({})
  const [bookmarkedItems, setBookmarkedItems] = useState(new Set())
  const scrollLockYRef = useRef(0)
  const itemDetailContentRef = useRef(null)
  const itemDetailGestureRef = useRef({
    startY: 0,
    dragging: false,
  })
  const [categories, setCategories] = useState(() => isCacheValid ? (pageCache.categories || []) : [])
  const [loadingCategories, setLoadingCategories] = useState(() => !(isCacheValid && pageCache.categories))
  const [bannerImages, setBannerImages] = useState(() => isCacheValid ? (pageCache.bannerImages || []) : [])
  const [loadingBanner, setLoadingBanner] = useState(() => !(isCacheValid && pageCache.bannerImages))
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0)
  const [under250Restaurants, setUnder250Restaurants] = useState(() => isCacheValid ? (pageCache.under250Restaurants || []) : [])
  const [loadingRestaurants, setLoadingRestaurants] = useState(() => !(isCacheValid && pageCache.allRawRestaurants))
  const [under250PriceLimit, setUnder250PriceLimit] = useState(250)
  const [allRawRestaurants, setAllRawRestaurants] = useState(() => isCacheValid ? (pageCache.allRawRestaurants || []) : [])
  const [visibleRestaurantCount, setVisibleRestaurantCount] = useState(() => isCacheValid ? (pageCache.visibleRestaurantCount || 0) : 0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(() => isCacheValid ? (pageCache.hasMore !== undefined ? pageCache.hasMore : true) : true)
  const observerTarget = useRef(null)
  const fetchedIdsRef = useRef(isCacheValid && pageCache.fetchedIds ? new Set(pageCache.fetchedIds) : new Set())
  const bannerShellRef = useRef(null)
  const stickyHeaderRef = useRef(null)
  const autoSlideIntervalRef = useRef(null)
  const touchStartXRef = useRef(0)
  const touchStartYRef = useRef(0)
  const touchEndXRef = useRef(0)
  const touchEndYRef = useRef(0)
  const isBannerSwipingRef = useRef(false)

  const [isHeaderVisible, setIsHeaderVisible] = useState(true)
  const lastScrollYRef = useRef(0)

  useEffect(() => {
    let scrollTimeout = null
    const handleScroll = () => {
      if (scrollTimeout) return
      scrollTimeout = setTimeout(() => {
        const currentScrollY = window.scrollY
        if (currentScrollY > lastScrollYRef.current && currentScrollY > 100) {
          setIsHeaderVisible(false)
        } else if (currentScrollY < lastScrollYRef.current) {
          setIsHeaderVisible(true)
        }
        lastScrollYRef.current = currentScrollY
        scrollTimeout = null
      }, 50)
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", handleScroll)
      if (scrollTimeout) clearTimeout(scrollTimeout)
    }
  }, [])

  const sortOptions = [
    { id: null, label: 'Relevance' },
    { id: 'rating-high', label: 'Rating: High to Low' },
    { id: 'delivery-time-low', label: 'Estimated Time: Low to High' },
    { id: 'distance-low', label: 'Distance: Low to High' },
  ]

  const handleClearAll = () => {
    setSelectedSort(null)
    setDraftSelectedSort(null)
    setUnder30MinsFilter(false)
    setActiveCategory(null)
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(UNDER_250_FILTERS_STORAGE_KEY)
    }
  }

  const handleApply = () => {
    setSelectedSort(draftSelectedSort)
    setShowSortPopup(false)
  }

  // Helper function to parse delivery time (e.g., "12-15 mins" -> 12 or average)
  const parseDeliveryTime = (deliveryTime) => {
    if (typeof deliveryTime === "number" && Number.isFinite(deliveryTime)) return deliveryTime
    if (!deliveryTime) return 999 // Default high value for sorting
    const value = String(deliveryTime)
    const rangeMatch = value.match(/(\d+)\s*-\s*(\d+)/)
    if (rangeMatch) {
      return (parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2 // Average
    }
    const match = value.match(/(\d+)/)
    if (match) {
      return parseInt(match[1])
    }
    return 999
  }

  const handleCategorySwitch = useCallback((categoryId) => {
    setIsSwitchingCategory(true)
    setActiveCategory(categoryId)
    // Small artificial delay to show skeleton and allow images to load gracefully
    setTimeout(() => {
      setIsSwitchingCategory(false)
    }, 400)
  }, [])

  // Helper function to parse distance (e.g., "0.4 km" -> 0.4)
  const parseDistance = (distance) => {
    if (typeof distance === "number" && Number.isFinite(distance)) return distance
    if (!distance) return 999 // Default high value for sorting
    const value = String(distance)
    const match = value.match(/(\d+\.?\d*)/)
    if (match) {
      const numericValue = parseFloat(match[1])
      return value.toLowerCase().includes("m") && !value.toLowerCase().includes("km")
        ? numericValue / 1000
        : numericValue
    }
    return 999
  }

  // Sort and filter restaurants based on selected sort and filters
  const sortedAndFilteredRestaurants = useMemo(() => {
    let filtered = under250Restaurants.map(r => ({ ...r, menuItems: [...(r.menuItems || [])] }))

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.map(restaurant => {
        const matchRestaurant = restaurant.name.toLowerCase().includes(query)
        const matchingDishes = restaurant.menuItems.filter(item => 
          item.name.toLowerCase().includes(query) ||
          (item.description && item.description.toLowerCase().includes(query)) ||
          (item.category && item.category.toLowerCase().includes(query))
        )

        if (matchRestaurant) {
          return restaurant
        } else if (matchingDishes.length > 0) {
          return { ...restaurant, menuItems: matchingDishes }
        }
        return null
      }).filter(Boolean)
    }

    // Apply category filter
    if (activeCategory) {
      const selectedCat = categories.find(cat => cat.id === activeCategory)
      if (selectedCat) {
        const catNameLower = selectedCat.name.toLowerCase()
        filtered = filtered.map(restaurant => {
          const matches = restaurant.menuItems.filter(item => 
            (item.category || "").toLowerCase() === catNameLower ||
            (item.sectionName || "").toLowerCase() === catNameLower ||
            (item.subsectionName || "").toLowerCase() === catNameLower
          )
          if (matches.length > 0) {
            return { ...restaurant, menuItems: matches }
          }
          return null
        }).filter(Boolean)
      }
    }

    // Apply "Under 30 mins" filter
    if (under30MinsFilter) {
      filtered = filtered.filter(restaurant => {
        const deliveryTime = parseDeliveryTime(restaurant.deliveryTime)
        return deliveryTime <= 30
      })
    }

    // Apply sorting
    if (selectedSort === 'rating-high') {
      filtered.sort((a, b) => {
        const ratingA = a.rating || 0
        const ratingB = b.rating || 0
        if (ratingB !== ratingA) {
          return ratingB - ratingA
        }
        // Secondary sort by number of dishes
        return (b.menuItems?.length || 0) - (a.menuItems?.length || 0)
      })
    } else if (selectedSort === 'delivery-time-low') {
      filtered.sort((a, b) => {
        const timeA = parseDeliveryTime(a.deliveryTime)
        const timeB = parseDeliveryTime(b.deliveryTime)
        if (timeA !== timeB) {
          return timeA - timeB
        }
        if ((b.rating || 0) !== (a.rating || 0)) {
          return (b.rating || 0) - (a.rating || 0)
        }
        return (a.originalIndex || 0) - (b.originalIndex || 0)
      })
    } else if (selectedSort === 'distance-low') {
      filtered.sort((a, b) => {
        const distA = Number.isFinite(a.distanceInKm) ? a.distanceInKm : parseDistance(a.distance)
        const distB = Number.isFinite(b.distanceInKm) ? b.distanceInKm : parseDistance(b.distance)
        if (distA !== distB) {
          return distA - distB
        }
        if ((b.rating || 0) !== (a.rating || 0)) {
          return (b.rating || 0) - (a.rating || 0)
        }
        return (a.originalIndex || 0) - (b.originalIndex || 0)
      })
    } else {
      // Default: Relevance (keep original order from backend - already sorted by rating)
      // No additional sorting needed
    }

    return filtered
  }, [under250Restaurants, selectedSort, under30MinsFilter, activeCategory, categories, searchQuery])

  // Fetch under-50 banner from public API
  useEffect(() => {
    if (pageCache.zoneId === zoneId && pageCache.bannerImages?.length > 0) {
      setBannerImages(pageCache.bannerImages);
      setLoadingBanner(false);
      return;
    }
    let cancelled = false
    setLoadingBanner(true)
    api.get('/food/hero-banners/under-250/public', { params: { zoneId } })
      .then((res) => {
        if (cancelled) return
        const data = res?.data?.data
        const list = Array.isArray(data?.banners) ? data.banners : (Array.isArray(data) ? data : [])
        const images = list
          .map((banner) => (typeof banner?.imageUrl === "string" ? banner.imageUrl.trim() : ""))
          .filter(Boolean)
        setBannerImages(images)
        pageCache.bannerImages = images
        pageCache.zoneId = zoneId
      })
      .catch(() => {
        if (!cancelled) setBannerImages([])
      })
      .finally(() => {
        if (!cancelled) setLoadingBanner(false)
      })
    return () => { cancelled = true }
  }, [zoneId])

  // Fetch landing settings to get dynamic price limit
  useEffect(() => {
    let cancelled = false
    getPublicLandingSettings(zoneId)
      .then((settings) => {
        if (cancelled || !settings) return
        if (typeof settings.under250PriceLimit === 'number') {
          setUnder250PriceLimit(settings.under250PriceLimit)
        }
      })
      .catch(() => {
        setUnder250PriceLimit(250)
      })
    return () => { cancelled = true }
  }, [zoneId])

  useEffect(() => {
    setCurrentBannerIndex((prev) => {
      if (bannerImages.length === 0) return 0
      return Math.min(prev, bannerImages.length - 1)
    })
  }, [bannerImages.length])

  useEffect(() => {
    if (typeof window === "undefined") return

    bannerImages.forEach((src) => {
      if (!src) return
      const img = new window.Image()
      img.src = src
    })
  }, [bannerImages])

  const startBannerAutoSlide = useCallback(() => {
    if (autoSlideIntervalRef.current) {
      clearInterval(autoSlideIntervalRef.current)
    }

    if (bannerImages.length <= 1) return

    autoSlideIntervalRef.current = setInterval(() => {
      if (!isBannerSwipingRef.current) {
        setCurrentBannerIndex((prev) => (prev + 1) % bannerImages.length)
      }
    }, 3500)
  }, [bannerImages.length])

  const resetBannerAutoSlide = useCallback(() => {
    startBannerAutoSlide()
  }, [startBannerAutoSlide])

  useEffect(() => {
    startBannerAutoSlide()

    return () => {
      if (autoSlideIntervalRef.current) {
        clearInterval(autoSlideIntervalRef.current)
      }
    }
  }, [startBannerAutoSlide])

  const handleBannerTouchStart = useCallback((event) => {
    if (bannerImages.length <= 1) return
    touchStartXRef.current = event.touches[0].clientX
    touchStartYRef.current = event.touches[0].clientY
    touchEndXRef.current = event.touches[0].clientX
    touchEndYRef.current = event.touches[0].clientY
    isBannerSwipingRef.current = true
  }, [bannerImages.length])

  const handleBannerTouchMove = useCallback((event) => {
    if (!isBannerSwipingRef.current) return
    touchEndXRef.current = event.touches[0].clientX
    touchEndYRef.current = event.touches[0].clientY
  }, [])

  const handleBannerTouchEnd = useCallback(() => {
    if (!isBannerSwipingRef.current || bannerImages.length <= 1) {
      isBannerSwipingRef.current = false
      return
    }

    const deltaX = touchEndXRef.current - touchStartXRef.current
    const deltaY = Math.abs(touchEndYRef.current - touchStartYRef.current)
    const minSwipeDistance = 40

    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      setCurrentBannerIndex((prev) => {
        if (deltaX > 0) {
          return (prev - 1 + bannerImages.length) % bannerImages.length
        }
        return (prev + 1) % bannerImages.length
      })
      resetBannerAutoSlide()
    }

    isBannerSwipingRef.current = false
  }, [bannerImages.length, resetBannerAutoSlide])

  // 1. Fetch initial raw restaurant list
  useEffect(() => {
    let cancelled = false;
    const fetchRestaurantsList = async () => {
      try {
        setLoadingRestaurants(true)
        const params = zoneId ? { zoneId } : {}
        if (location?.latitude && location?.longitude) {
          params.lat = location.latitude
          params.lng = location.longitude
        }
        const response = await restaurantAPI.getRestaurants(params)
        const restaurantsRaw = (Array.isArray(response?.data?.data?.restaurants)
          ? response.data.data.restaurants
          : [])
        
        if (!cancelled) {
          setAllRawRestaurants(restaurantsRaw)
          setVisibleRestaurantCount(5) // Load first 5 immediately
          setUnder250Restaurants([]) // Reset
          fetchedIdsRef.current.clear()
          setHasMore(restaurantsRaw.length > 0)
          
          pageCache.allRawRestaurants = restaurantsRaw;
          pageCache.visibleRestaurantCount = 5;
          pageCache.under250Restaurants = [];
          pageCache.fetchedIds = new Set();
          pageCache.hasMore = restaurantsRaw.length > 0;
          pageCache.zoneId = zoneId;
        }
      } catch (error) {
        debugError('Error fetching restaurants list:', error)
        if (!cancelled) setAllRawRestaurants([])
      } finally {
        if (!cancelled) setLoadingRestaurants(false)
      }
    }
    
    fetchRestaurantsList()
    return () => { cancelled = true }
  }, [zoneId, isOutOfService])

  // 2. Fetch menus for the current chunk when visible count increases
  useEffect(() => {
    if (allRawRestaurants.length === 0 || visibleRestaurantCount === 0) return;
    
    let cancelled = false;
    
    const fetchMenusForChunk = async () => {
      try {
        const targetSlice = allRawRestaurants.slice(0, visibleRestaurantCount)
        
        const newRestaurantsToFetch = targetSlice.filter(r => {
          const rId = String(r?.restaurantId || r?._id)
          return rId && !fetchedIdsRef.current.has(rId)
        })

        if (newRestaurantsToFetch.length === 0) {
          if (!cancelled) {
            setHasMore(visibleRestaurantCount < allRawRestaurants.length)
            setLoadingMore(false)
          }
          return;
        }

        if (!cancelled) {
          setLoadingMore(true)
        }

        const userLat = Number(location?.latitude)
        const userLng = Number(location?.longitude)
        
        const newRestaurantsWithUnder250Dishes = await Promise.all(
          newRestaurantsToFetch.map(async (restaurant) => {
            const restaurantId = restaurant?.restaurantId || restaurant?._id
            if (!restaurantId) return null

            try {
              const menuResponse = await restaurantAPI.getMenuByRestaurantId(restaurantId)
              const menu = getMenuFromResponse(menuResponse)
              const menuItems = flattenMenuItems(menu)
                .filter((item) => Number(item?.price || 0) <= under250PriceLimit && item?.isAvailable !== false)
                .map((item) => {
                  const foodType = String(item?.foodType || "").toLowerCase()
                  const isVeg = foodType.includes("veg") && !foodType.includes("non")
                  return {
                    ...item,
                    id: String(item?.id || item?._id || `${restaurantId}-${item?.name || "dish"}`),
                    price: Number(item?.price || 0),
                    isVeg,
                    image:
                      item?.image ||
                      restaurant?.coverImages?.[0]?.url ||
                      restaurant?.coverImages?.[0] ||
                      restaurant?.menuImages?.[0]?.url ||
                      restaurant?.menuImages?.[0] ||
                      restaurant?.profileImage?.url ||
                      "",
                  }
                })

              if (menuItems.length === 0) return null

              const deliveryMinutes =
                Number(restaurant?.estimatedDeliveryTimeMinutes) ||
                Number(restaurant?.estimatedDeliveryTime) ||
                null
              const restaurantLocation = restaurant?.location
              const restaurantLat = Number(
                restaurantLocation?.latitude ??
                (Array.isArray(restaurantLocation?.coordinates) ? restaurantLocation.coordinates[1] : null)
              )
              const restaurantLng = Number(
                restaurantLocation?.longitude ??
                (Array.isArray(restaurantLocation?.coordinates) ? restaurantLocation.coordinates[0] : null)
              )
              const distanceInKm = restaurant?.distanceInKm !== undefined
                ? restaurant.distanceInKm
                : ((
                Number.isFinite(userLat) &&
                Number.isFinite(userLng) &&
                Number.isFinite(restaurantLat) &&
                Number.isFinite(restaurantLng)
              )
                ? calculateDistance(userLat, userLng, restaurantLat, restaurantLng)
                : null)
              const fallbackDistance =
                typeof restaurant?.distance === "number"
                  ? formatDistance(restaurant.distance)
                  : (restaurant?.distanceText || restaurant?.distance || "")

              return {
                id: String(restaurantId),
                restaurantId: String(restaurantId),
                slug:
                  restaurant?.slug ||
                  String(restaurant?.restaurantName || restaurant?.name || "")
                    .toLowerCase()
                    .replace(/\s+/g, "-"),
                name: restaurant?.restaurantName || restaurant?.name || "Restaurant",
                rating: Number(restaurant?.rating || 0),
                totalRatings: Number(restaurant?.totalRatings || restaurant?.ratingCount || 0),
                deliveryTime:
                  restaurant?.estimatedDeliveryTime ||
                  (deliveryMinutes ? `${deliveryMinutes} mins` : "30 mins"),
                distance: restaurant?.distanceText || (distanceInKm !== null ? formatDistance(distanceInKm) : fallbackDistance),
                distanceInKm,
                distanceText: restaurant?.distanceText || null,
                distanceInfo: restaurant?.distanceInfo || null,
                discount: restaurant?.discount || 0,
                itemDiscounts: Array.isArray(restaurant?.itemDiscounts) ? restaurant.itemDiscounts : [],
                discountRules: Array.isArray(restaurant?.discountRules) ? restaurant.discountRules : [],
                isActive: restaurant?.isActive !== false,
                isAcceptingOrders: restaurant?.isAcceptingOrders !== false,
                openDays: Array.isArray(restaurant?.openDays) ? restaurant.openDays : [],
                outletTimings: restaurant?.outletTimings || null,
                deliveryTimings: restaurant?.deliveryTimings || null,
                openingTime: restaurant?.openingTime || restaurant?.deliveryTimings?.openingTime || null,
                closingTime: restaurant?.closingTime || restaurant?.deliveryTimings?.closingTime || null,
                originalIndex: allRawRestaurants.findIndex(r => String(r?.restaurantId || r?._id) === String(restaurantId)),
                menuItems,
              }
            } catch {
              return null
            }
          })
        )

        if (!cancelled) {
          const validNewRestaurants = newRestaurantsWithUnder250Dishes.filter(Boolean)
          
          // Mark IDs as fetched ONLY after successful completion (not before async call)
          // This prevents React StrictMode double-mount from skipping restaurants
          newRestaurantsToFetch.forEach(r => {
             fetchedIdsRef.current.add(String(r?.restaurantId || r?._id))
          })
          
          setUnder250Restaurants(prev => {
             const updated = [...prev, ...validNewRestaurants];
             pageCache.under250Restaurants = updated;
             return updated;
          })
          setHasMore(visibleRestaurantCount < allRawRestaurants.length)
          pageCache.visibleRestaurantCount = visibleRestaurantCount;
          pageCache.hasMore = visibleRestaurantCount < allRawRestaurants.length;
          pageCache.fetchedIds = new Set(fetchedIdsRef.current);
          pageCache.zoneId = zoneId;
        }
      } catch (error) {
        debugError("Error fetching menu chunks:", error)
      } finally {
        if (!cancelled) setLoadingMore(false)
      }
    }

    fetchMenusForChunk()
    
    return () => { cancelled = true }
  }, [allRawRestaurants, visibleRestaurantCount, location?.latitude, location?.longitude, under250PriceLimit])

  // 3. Intersection Observer for Infinite Scroll
  useEffect(() => {
    if (!hasMore || loadingMore || loadingRestaurants || isSwitchingCategory) return;

    const currentObserverTarget = observerTarget.current;
    
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          setVisibleRestaurantCount(prev => prev + 5)
        }
      },
      { threshold: 0.1, rootMargin: "200px" } // trigger before user hits absolute bottom
    )

    if (currentObserverTarget) {
      observer.observe(currentObserverTarget)
    }

    return () => {
      if (currentObserverTarget) {
         observer.unobserve(currentObserverTarget)
      }
      observer.disconnect()
    }
  }, [hasMore, loadingMore, loadingRestaurants, isSwitchingCategory])

  // Fetch categories from backend (no static fallback list)
  useEffect(() => {
    if (pageCache.zoneId === zoneId && pageCache.categories?.length > 0) {
      setCategories(pageCache.categories);
      setLoadingCategories(false);
      return;
    }
    let cancelled = false

    const fetchCategories = async () => {
      try {
        setLoadingCategories(true)
        const response = await adminAPI.getPublicCategories(zoneId ? { zoneId } : {})
        const payload = response?.data?.data || response?.data || response || {}
        const categoriesRaw = Array.isArray(payload?.categories)
          ? payload.categories
          : (Array.isArray(payload) ? payload : [])

        const mappedCategories = categoriesRaw
          .map((cat, index) => {
            const name = String(cat?.name || "").trim()
            if (!name) return null

            return {
              id: String(cat?.id || cat?._id || cat?.slug || `cat-${index}`),
              name,
              slug: String(cat?.slug || name.toLowerCase().replace(/\s+/g, "-")),
              image:
                cat?.imageUrl ||
                cat?.image ||
                cat?.icon ||
                "",
            }
          })
          .filter(Boolean)

        if (!cancelled) {
          setCategories(mappedCategories)
          pageCache.categories = mappedCategories
          pageCache.zoneId = zoneId
        }
      } catch (error) {
        debugError("Error fetching under-250 categories:", error)
        if (!cancelled) setCategories([])
      } finally {
        if (!cancelled) setLoadingCategories(false)
      }
    }

    fetchCategories()

    return () => {
      cancelled = true
    }
  }, [zoneId])

  // Sync quantities from cart on mount
  useEffect(() => {
    const cartQuantities = {}
    cart.forEach((item) => {
      cartQuantities[item.id] = item.quantity || 0
    })
    setQuantities(cartQuantities)
  }, [cart])

  useEffect(() => {
    if (!selectedItem || !showItemDetail) return

    const existingQuantity = quantities[selectedItem.id] || 0
    if (existingQuantity > 0) {
      setItemDetailQuantity(existingQuantity)
    }
  }, [quantities, selectedItem, showItemDetail])

  useEffect(() => {
    if (!showSortPopup) return
    setDraftSelectedSort(selectedSort)
  }, [showSortPopup, selectedSort])

  useEffect(() => {
    if (!showSortPopup && !showItemDetail && !showShareOptions) return
    if (typeof window === "undefined") return

    const bodyStyle = document.body.style
    scrollLockYRef.current = window.scrollY

    const originalOverflow = bodyStyle.overflow
    const originalPosition = bodyStyle.position
    const originalTop = bodyStyle.top
    const originalWidth = bodyStyle.width

    bodyStyle.overflow = "hidden"
    bodyStyle.position = "fixed"
    bodyStyle.top = `-${scrollLockYRef.current}px`
    bodyStyle.width = "100%"

    return () => {
      bodyStyle.overflow = originalOverflow
      bodyStyle.position = originalPosition
      bodyStyle.top = originalTop
      bodyStyle.width = originalWidth
      window.scrollTo(0, scrollLockYRef.current)
    }
  }, [showSortPopup, showItemDetail, showShareOptions])

  useEffect(() => {
    if (typeof window === "undefined") return

    if (!selectedSort && !activeCategory && !under30MinsFilter) {
      window.localStorage.removeItem(UNDER_250_FILTERS_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(
      UNDER_250_FILTERS_STORAGE_KEY,
      JSON.stringify({
        selectedSort,
        activeCategory,
        under30MinsFilter,
      })
    )
  }, [selectedSort, activeCategory, under30MinsFilter])

  // Helper function to update item quantity in bothlocal state and cart
  const updateItemQuantity = (item, newQuantity, event = null, restaurantName = null) => {
    // Check authentication
    if (!isModuleAuthenticated('user')) {
      toast.error("Please login to add items to cart")
      navigate('/user/auth/login', { state: { from: location.pathname } })
      return
    }

    // CRITICAL: Check if user is in service zone
    if (isOutOfService) {
      toast.error(serviceUnavailableMessage || 'Service is currently unavailable.')
      return
    }

    // Update local state
    setQuantities((prev) => ({
      ...prev,
      [item.id]: newQuantity,
    }))

    // Find restaurant name from the item or use provided parameter
    const restaurant = restaurantName || item.restaurant || "Under 250"

    // Find restaurant to get its discount
    const restaurantObj = under250Restaurants.find(r => 
      r.menuItems?.some(m => m.id === item.id)
    );
    
    // Evaluate Item-Specific and Smart Rules Discounts
    let discountPercentage = restaurantObj?.discount || 0;
    const specificItemDiscount = (restaurantObj?.itemDiscounts || []).find(d => String(d.itemId) === String(item.id || item._id));
    if (specificItemDiscount) {
      discountPercentage = specificItemDiscount.discountValue || 0;
    } else {
      const matchingRule = (restaurantObj?.discountRules || []).find(rule => {
        const val = Number(rule.conditionValue);
        if (rule.conditionType === 'PRICE_ABOVE' && item.price > val) return true;
        if (rule.conditionType === 'PRICE_BELOW' && item.price < val) return true;
        return false;
      });
      if (matchingRule) discountPercentage = matchingRule.discountValue || 0;
    }
    
    const finalPrice = discountPercentage > 0 ? Math.round(item.price * (1 - discountPercentage / 100)) : item.price;

    // Prepare cart item with all required properties
    const cartItem = {
      id: item.id,
      name: item.name,
      price: finalPrice, // Use discounted price
      image: item.image,
      restaurant: restaurant,
      description: item.description || "",
      originalPrice: item.originalPrice || item.price,
      priceOnOtherPlatforms: item.priceOnOtherPlatforms || null, // Include platform pricing for savings display
      otherPlatformGst: item.otherPlatformGst ?? null,
      isVeg: item.isVeg,
      foodType: item.foodType,
    }

    // Get source position for animation from event target
    let sourcePosition = null
    if (event) {
      let buttonElement = event.currentTarget
      if (!buttonElement && event.target) {
        buttonElement = event.target.closest('button') || event.target
      }

      if (buttonElement) {
        const rect = buttonElement.getBoundingClientRect()
        const scrollX = window.pageXOffset || window.scrollX || 0
        const scrollY = window.pageYOffset || window.scrollY || 0

        sourcePosition = {
          viewportX: rect.left + rect.width / 2,
          viewportY: rect.top + rect.height / 2,
          scrollX: scrollX,
          scrollY: scrollY,
          itemId: item.id,
        }
      }
    }

    // Update cart context
    if (newQuantity <= 0) {
      const productInfo = {
        id: item.id,
        name: item.name,
        imageUrl: item.image,
      }
      removeFromCart(item.id, sourcePosition, productInfo)
    } else {
      const existingCartItem = getCartItem(item.id)
      if (existingCartItem) {
        const productInfo = {
          id: item.id,
          name: item.name,
          imageUrl: item.image,
        }

        if (newQuantity > existingCartItem.quantity && sourcePosition) {
          const result = addToCart(cartItem, sourcePosition)
          if (result?.ok === false) {
            toast.error(result.error || 'Cannot add item from different restaurant. Please clear cart first.')
            return
          }
          if (newQuantity > existingCartItem.quantity + 1) {
            updateQuantity(item.id, newQuantity)
          }
        } else if (newQuantity < existingCartItem.quantity && sourcePosition) {
          updateQuantity(item.id, newQuantity, sourcePosition, productInfo)
        } else {
          updateQuantity(item.id, newQuantity)
        }
      } else {
        const result = addToCart(cartItem, sourcePosition)
        if (result?.ok === false) {
          toast.error(result.error || 'Cannot add item from different restaurant. Please clear cart first.')
          return
        }
        if (newQuantity > 1) {
          updateQuantity(item.id, newQuantity)
        }
      }
    }
  }

  const closeItemDetail = useCallback(() => {
    setShowItemDetail(false)
    setShowShareOptions(false)
  }, [])

  const handleItemClick = (item, restaurant) => {
    // Add restaurant info to item for display
    const itemWithRestaurant = {
      ...item,
      restaurant: restaurant.name,
      restaurantSlug: restaurant.slug || restaurant.restaurantId || "",
      description: item.description || `${item.name} from ${restaurant.name}`,
      customisable: item.customisable || false,
      notEligibleForCoupons: item.notEligibleForCoupons || false,
    }
    const existingQuantity = quantities[item.id] || 0
    setItemDetailQuantity(existingQuantity > 0 ? existingQuantity : 1)
    setSelectedItem(itemWithRestaurant)
    setShowShareOptions(false)
    setShowItemDetail(true)
  }

  const handleBookmarkClick = (itemId) => {
    setBookmarkedItems((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }

  const handleShareItem = async (item) => {
    if (!item) return

    const itemId = item.id || item._id
    const restaurantSlug = item.restaurantSlug || item.slug || ""
    const shareUrl = restaurantSlug
      ? `${window.location.origin}/user/restaurants/${restaurantSlug}${itemId ? `?dish=${encodeURIComponent(itemId)}` : ""}`
      : window.location.href

    try {
      if (navigator.share) {
        await navigator.share({
          title: item.name || "Dish",
          text: `Check out ${item.name || "this dish"} from ${item.restaurant || "Under 250"}`,
          url: shareUrl,
        })
        return
      }
    } catch (error) {
      if (error?.name === "AbortError") return
    }

    setShowShareOptions(true)
  }

  const handleShareOption = async (type) => {
    if (!selectedItem) return

    const itemId = selectedItem.id || selectedItem._id
    const restaurantSlug = selectedItem.restaurantSlug || selectedItem.slug || ""
    const shareUrl = selectedItem.restaurantSlug
      ? `${window.location.origin}/user/restaurants/${restaurantSlug}${itemId ? `?dish=${encodeURIComponent(itemId)}` : ""}`
      : window.location.href
    const shareText = `Check out ${selectedItem.name || "this dish"} from ${selectedItem.restaurant || "Under 250"}`
    const encodedUrl = encodeURIComponent(shareUrl)
    const encodedText = encodeURIComponent(`${shareText} ${shareUrl}`)

    try {
      if (type === "copy") {
        await navigator.clipboard.writeText(shareUrl)
        toast.success("Link copied to clipboard!")
      } else if (type === "whatsapp") {
        window.open(`https://wa.me/?text=${encodedText}`, "_blank", "noopener,noreferrer")
      } else if (type === "telegram") {
        window.open(`https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer")
      } else if (type === "sms") {
        window.location.href = `sms:?&body=${encodedText}`
      } else if (type === "email") {
        window.location.href = `mailto:?subject=${encodeURIComponent(selectedItem.name || "Dish")}&body=${encodedText}`
      }
      setShowShareOptions(false)
    } catch {
      toast.error("Failed to share link")
    }
  }

  const handleItemDetailTouchStart = (e) => {
    if (!showItemDetail) return
    itemDetailGestureRef.current = {
      startY: e.touches?.[0]?.clientY || 0,
      dragging: true,
    }
  }

  const handleItemDetailTouchEnd = (e) => {
    if (!showItemDetail || !itemDetailGestureRef.current.dragging) return

    const endY = e.changedTouches?.[0]?.clientY || 0
    const deltaY = endY - itemDetailGestureRef.current.startY
    const contentScrollTop = itemDetailContentRef.current?.scrollTop || 0

    itemDetailGestureRef.current.dragging = false

    if (contentScrollTop <= 0 && deltaY > 80) {
      closeItemDetail()
    }
  }

  const handleItemDetailWheel = (e) => {
    if (!showItemDetail) return
    const contentScrollTop = itemDetailContentRef.current?.scrollTop || 0
    if (contentScrollTop <= 0 && e.deltaY < -20) {
      closeItemDetail()
    }
  }

  // Check if should show grayscale (only when user is out of service)
  const shouldShowGrayscale = isOutOfService

  return (
    <div className={`relative min-h-screen bg-white dark:bg-[#0a0a0a] ${shouldShowGrayscale ? 'grayscale opacity-75' : ''}`}>
      {/* ── Menu Scan Intro Animation ── */}
      {showScanAnimation && (
        <MenuScanAnimation
          duration={2200}
          onComplete={() => setShowScanAnimation(false)}
        />
      )}
      
      {/* Header removed */}

      {/* Banner Section */}
      <div
        ref={bannerShellRef}
        data-banner-shell="true"
        className="relative w-full aspect-[2/1] sm:aspect-[21/9] lg:aspect-[3/1] max-h-[240px] md:max-h-[320px]"
      >
        {/* Floating Back Button */}
        <button 
          onClick={() => navigate(-1)} 
          className="absolute top-4 left-4 md:top-48 md:left-8 z-40 w-10 h-10 rounded-full bg-black/30 backdrop-blur-md flex items-center justify-center text-white border border-white/20 shadow-lg transition-transform active:scale-95"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Floating Search Button */}
        <button 
          onClick={() => setShowSearch(true)} 
          className="absolute top-4 right-4 md:top-48 md:right-8 z-40 w-10 h-10 rounded-full bg-black/30 backdrop-blur-md flex items-center justify-center text-white border border-white/20 shadow-lg transition-transform active:scale-95"
        >
          <Search className="w-5 h-5" />
        </button>

        {/* Floating Search Bar */}
        <AnimatePresence>
          {showSearch && (
            <motion.div
              initial={{ y: -100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -100, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="absolute top-0 left-0 right-0 z-50 bg-white dark:bg-black p-3 sm:p-4 shadow-md border-b border-gray-100 dark:border-gray-800"
            >
              <div className="flex items-center gap-2 max-w-7xl mx-auto">
                <button 
                  onClick={() => {
                    setShowSearch(false)
                    setSearchQuery("")
                  }}
                  className="p-2 -ml-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <ArrowLeft className="w-6 h-6" />
                </button>
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search dishes or restaurants..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-10 py-2.5 bg-gray-100 dark:bg-gray-900 border border-transparent focus:border-primary/30 rounded-xl outline-none text-sm md:text-base text-gray-900 dark:text-white placeholder:text-gray-400 transition-colors"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 bg-white dark:bg-gray-800 rounded-full shadow-sm"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Banner Image */}
        {bannerImages.length > 0 && (
          <div
            className="w-full h-full relative z-0 overflow-hidden rounded-b-[2rem] md:rounded-b-none"
            onTouchStart={handleBannerTouchStart}
            onTouchMove={handleBannerTouchMove}
            onTouchEnd={handleBannerTouchEnd}
          >
            {/* Shining Glint Effect */}
            <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
              <motion.div 
                animate={{ 
                  x: ['-200%', '200%'],
                }}
                transition={{ 
                  duration: 3, 
                  repeat: Infinity, 
                  repeatDelay: 4,
                  ease: "easeInOut"
                }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-[-20deg] w-[150%] h-full"
              />
            </div>

            <div
              className="flex h-full w-full transition-transform duration-500 ease-out"
              style={{ transform: `translateX(-${currentBannerIndex * 100}%)` }}
            >
              {bannerImages.map((bannerImage, index) => (
                <div key={`${bannerImage}-${index}`} className="relative h-full w-full shrink-0">
                  <OptimizedImage
                    src={bannerImage}
                    alt={`Under 250 Banner ${index + 1}`}
                    className="w-full h-full"
                    objectFit="cover"
                    priority={index === 0}
                    sizes="100vw"
                  />
                  {/* Subtle Gradient Overlay for depth */}
                  <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
                </div>
              ))}
            </div>
            {/* Indicators removed as requested */}
          </div>
        )}
        {bannerImages.length === 0 && !loadingBanner && (
          <div className="w-full h-full relative z-0 bg-gradient-to-br from-[#fcf4f9] to-[#f5e8f1] dark:from-[#3c0f3d] dark:to-secondary overflow-hidden rounded-b-[2rem] md:rounded-b-none" />
        )}
      </div>

      {/* Content Section */}
      <div className="relative max-w-7xl mx-auto space-y-0 pb-6 md:pb-8 lg:pb-10">

        <div className={`sticky z-30 transition-all duration-300 bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur-xl shadow-sm border-b border-gray-100 dark:border-gray-800 top-0 pt-2 sm:pt-3 md:pt-4 px-3 sm:px-4 md:px-6 lg:px-8 xl:px-12`}>
          <section className="space-y-1 sm:space-y-1.5">
          <div
            className="flex gap-3 sm:gap-4 md:gap-5 lg:gap-6 overflow-x-auto md:overflow-x-visible overflow-y-visible scrollbar-hide scroll-smooth px-2 sm:px-3 pt-1 pb-1 sm:pt-2 sm:pb-2 md:pt-3 md:pb-3"
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              touchAction: "pan-x pan-y pinch-zoom",
              overflowY: "hidden",
            }}
          >
            {/* All Button */}
            <div className="flex-shrink-0 cursor-pointer" onClick={() => handleCategorySwitch(null)}>
              <motion.div
                className={`flex flex-col items-center justify-center gap-1 w-[76px] h-[76px] sm:w-[88px] sm:h-[88px] md:w-[96px] md:h-[96px] rounded-[1rem] transition-all border ${!activeCategory ? 'bg-primary border-primary text-white shadow-md' : 'bg-white border-gray-100 text-gray-600 dark:bg-[#1a1a1a] dark:border-gray-800 dark:text-gray-300'}`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <div className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 ${!activeCategory ? 'text-white' : 'text-gray-400'}`}>
                  <UtensilsCrossed className="w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9" />
                </div>
                <span className={`text-[10px] sm:text-[11px] md:text-xs font-semibold text-center leading-tight ${!activeCategory ? 'text-white' : ''}`}>
                  All
                </span>
              </motion.div>
            </div>
            {loadingCategories ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={`skel-cat-${i}`} className="flex-shrink-0">
                  <div className="flex flex-col items-center justify-center gap-1 w-[76px] h-[76px] sm:w-[88px] sm:h-[88px] md:w-[96px] md:h-[96px] rounded-[1rem] border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#1a1a1a]">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse"></div>
                    <div className="h-3 w-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
                  </div>
                </div>
              ))
            ) : (
              categories.map((category, index) => {
                const isActive = activeCategory === category.id
                return (
                  <div key={category.id} className="flex-shrink-0 cursor-pointer" onClick={() => handleCategorySwitch(isActive ? null : category.id)}>
                      <motion.div
                        className={`flex flex-col items-center justify-center gap-1 w-[76px] h-[76px] sm:w-[88px] sm:h-[88px] md:w-[96px] md:h-[96px] rounded-[1rem] transition-all border ${isActive ? 'bg-primary border-primary text-white shadow-md' : 'bg-white border-gray-100 text-gray-600 dark:bg-[#1a1a1a] dark:border-gray-800 dark:text-gray-300'}`}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <div className="w-10 h-10 sm:w-11 sm:h-11 md:w-12 md:h-12 rounded-full overflow-hidden mb-0.5 flex-shrink-0 flex items-center justify-center bg-white shadow-sm border border-gray-50">
                          <OptimizedImage
                            src={category.image}
                            alt={category.name}
                            className="w-full h-full object-cover scale-[1.15]"
                            sizes="(max-width: 640px) 40px, (max-width: 768px) 44px, 48px"
                            placeholder="blur"
                          />
                        </div>
                        <span className={`text-[10px] sm:text-[11px] md:text-xs font-semibold text-center leading-tight px-1 ${isActive ? 'text-white' : ''}`}>
                          {category.name.length > 9 ? `${category.name.slice(0, 9)}..` : category.name}
                        </span>
                      </motion.div>
                  </div>
                )
              })
            )}
          </div>
        </section>
        </div>

        {/* Filters Section (Not Sticky) */}
        <div className="px-3 sm:px-4 md:px-6 lg:px-8 xl:px-12 pt-1 md:pt-2">
          <section className="py-2 sm:py-3 md:py-4">
          <div className="flex items-center gap-2 md:gap-3">
            <Button
              variant="outline"
              onClick={() => setShowSortPopup(true)}
              className="h-8 sm:h-9 md:h-10 px-3 sm:px-4 md:px-5 rounded-md flex items-center gap-2 whitespace-nowrap flex-shrink-0 font-medium transition-all bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm md:text-base"
            >
              <ArrowDownUp className="h-4 w-4 md:h-5 md:w-5 rotate-90" />
              <span className="text-sm md:text-base font-medium">
                {selectedSort ? sortOptions.find(opt => opt.id === selectedSort)?.label : 'Sort'}
              </span>
              <ChevronDown className="h-3 w-3 md:h-4 md:w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => setUnder30MinsFilter(!under30MinsFilter)}
              className={`h-8 sm:h-9 md:h-10 px-3 sm:px-4 md:px-5 rounded-md flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 font-medium transition-all text-sm md:text-base ${under30MinsFilter
                ? 'bg-primary text-white border border-primary hover:bg-secondary'
                : 'bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'
                }`}
            >
              <Timer className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
              <span className="text-xs sm:text-sm md:text-base font-medium">Under 30 mins</span>
            </Button>
          </div>
          </section>
        </div>

        {/* Restaurant Menu Sections */}
        <div className="px-3 sm:px-4 md:px-6 lg:px-8 xl:px-12 pt-4">
        {loadingRestaurants || isSwitchingCategory ? (
          <div className="space-y-8 sm:space-y-10 md:space-y-12">
            {Array.from({ length: 3 }).map((_, rIndex) => (
              <section key={`skel-rest-${rIndex}`} className="pt-4 sm:pt-6 md:pt-8 lg:pt-10">
                {/* Skeleton Restaurant Header */}
                <div className="flex items-start justify-between mb-3 md:mb-4 lg:mb-6">
                  <div className="flex-1 space-y-3">
                    <div className="h-6 sm:h-8 w-48 sm:w-64 bg-orange-100 dark:bg-orange-900/30 rounded-md animate-pulse shadow-[0_0_15px_rgba(249,115,22,0.15)]"></div>
                    <div className="flex items-center gap-3">
                      <div className="h-4 w-20 bg-orange-100 dark:bg-orange-900/30 rounded animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.1)]"></div>
                      <div className="h-4 w-24 bg-orange-100 dark:bg-orange-900/30 rounded animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.1)]"></div>
                      <div className="h-4 w-16 bg-orange-100 dark:bg-orange-900/30 rounded animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.1)]"></div>
                    </div>
                  </div>
                </div>
                {/* Skeleton Menu Items Horizontal Scroll */}
                <div className="flex md:grid gap-3 sm:gap-4 md:gap-5 lg:gap-6 overflow-hidden md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, iIndex) => (
                    <div key={`skel-item-${rIndex}-${iIndex}`} className="flex-shrink-0 w-[200px] sm:w-[220px] md:w-full bg-white dark:bg-[#1a1a1a] rounded-lg md:rounded-xl border border-orange-100 dark:border-orange-900/20 overflow-hidden relative shadow-[0_4px_20px_rgba(249,115,22,0.08)]">
                      <div className="w-full h-32 sm:h-36 md:h-40 lg:h-48 xl:h-52 bg-orange-50 dark:bg-orange-900/20 animate-pulse"></div>
                      <div className="p-3 md:p-4 space-y-3">
                        <div className="h-5 w-3/4 bg-orange-100 dark:bg-orange-900/30 rounded animate-pulse"></div>
                        <div className="h-5 w-1/4 bg-orange-100 dark:bg-orange-900/30 rounded animate-pulse mt-2"></div>
                        <div className="flex justify-between items-center mt-4">
                          <div className="h-6 w-1/3 bg-orange-100 dark:bg-orange-900/30 rounded animate-pulse"></div>
                          <div className="h-8 w-20 bg-orange-200 dark:bg-orange-800/40 rounded-full animate-pulse"></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : sortedAndFilteredRestaurants.length === 0 ? (
          <div className="flex justify-center items-center py-12">
            <div className="text-gray-500 dark:text-gray-400">
              {under250Restaurants.length === 0
                ? `No restaurants with dishes under ${RUPEE_SYMBOL}${under250PriceLimit} found.`
                : "No restaurants match the selected filters."}
            </div>
          </div>
        ) : (
          sortedAndFilteredRestaurants.map((restaurant) => {
            const restaurantSlug = restaurant.slug || restaurant.name.toLowerCase().replace(/\s+/g, "-")
            const availability = getRestaurantAvailabilityStatus(restaurant)
            const isClosed = !availability.isOpen

            return (
              <section key={restaurant.id} className={`p-4 md:p-5 lg:p-6 mb-6 md:mb-8 rounded-2xl bg-slate-50 dark:bg-[#1a1a1a] ${isClosed ? 'opacity-70 grayscale' : ''}`}>
                {/* Restaurant Header */}
                <div className="flex items-start justify-between mb-4 md:mb-5">
                  <div className="flex-1">
                    <h3 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-1.5">
                      {restaurant.name}
                    </h3>
                    <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
                      <div className="flex items-center gap-1 text-sm md:text-base font-bold text-gray-700 dark:text-gray-300">
                        <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center">
                           <Star className="h-3 w-3 fill-white text-white" />
                        </div>
                        <span>{restaurant.rating} {restaurant.totalRatings > 0 ? `(${restaurant.totalRatings >= 1000 ? `${(restaurant.totalRatings / 1000).toFixed(1)}K+` : restaurant.totalRatings}+)` : ''}</span>
                      </div>
                      <span className="text-gray-500 dark:text-gray-400 text-sm md:text-base">•</span>
                      {restaurant.distance && (
                        <>
                          <div className="flex items-center text-sm md:text-base font-semibold text-gray-700 dark:text-gray-300">
                            <span>{restaurant.distance}</span>
                          </div>
                          <span className="text-gray-500 dark:text-gray-400 text-sm md:text-base">•</span>
                        </>
                      )}
                      <div className="flex items-center text-sm md:text-base font-semibold text-gray-700 dark:text-gray-300">
                        <span>{restaurant.deliveryTime}</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* View Items Link */}
                  <Link to={isClosed ? '#' : `/user/restaurants/${restaurantSlug}?under250=true`} className={`flex-shrink-0 mt-1 ${isClosed ? 'cursor-not-allowed opacity-50' : ''}`} onClick={(e) => { if(isClosed) e.preventDefault() }}>
                    <span className={`font-bold text-sm md:text-base flex items-center hover:underline ${isClosed ? 'text-gray-500' : 'text-primary'}`}>
                      {isClosed ? 'Offline' : 'View Items'} <ArrowRight className="h-4 w-4 ml-0.5" />
                    </span>
                  </Link>
                </div>

                {/* Menu Items Horizontal Scroll */}
                {restaurant.menuItems && restaurant.menuItems.length > 0 && (
                  <div className="mt-4">
                    <HorizontalMenuScroller 
                      restaurant={restaurant}
                      quantities={quantities}
                      isClosed={isClosed}
                      handleItemClick={handleItemClick}
                      RUPEE_SYMBOL={RUPEE_SYMBOL}
                    />
                  </div>
                )}
              </section>
            )
          }))}
        </div>
      </div>

      {/* Infinite Scroll Elements */}
      {loadingMore && (
        <div className="py-8 flex justify-center items-center w-full">
          <div className="w-8 h-8 rounded-full border-[3px] border-gray-200 border-t-primary animate-spin" />
        </div>
      )}
      <div ref={observerTarget} className="h-4 w-full" />

      {/* Sort Popup - Bottom Sheet */}
      <AnimatePresence>
        {showSortPopup && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowSortPopup(false)}
              className="fixed inset-0 bg-black/50 z-100"
            />

            {/* Bottom Sheet */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 30
              }}
              className="fixed bottom-0 left-0 right-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:max-w-lg lg:max-w-2xl bg-white dark:bg-[#1a1a1a] rounded-t-3xl shadow-2xl z-[110] max-h-[60vh] md:max-h-[80vh] overflow-hidden flex flex-col"
            >
              {/* Drag Handle */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-12 h-1 bg-gray-300 rounded-full" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-4 md:px-6 py-4 md:py-5 border-b dark:border-gray-800">
                <h2 className="text-lg md:text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">Sort By</h2>
                <button
                  onClick={handleClearAll}
                  className="text-primary dark:text-[#b18da5] font-medium text-sm md:text-base"
                >
                  Clear all
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6">
                <div className="flex flex-col gap-3 md:gap-4">
                  {sortOptions.map((option) => (
                    <button
                      key={option.id || 'relevance'}
                      onClick={() => setDraftSelectedSort(option.id)}
                      className={`px-4 md:px-5 lg:px-6 py-3 md:py-4 rounded-xl border text-left transition-colors ${draftSelectedSort === option.id
                        ? 'border-primary bg-[#fdfafc] dark:bg-primary/20'
                        : 'border-gray-200 dark:border-gray-800 hover:border-primary'
                        }`}
                    >
                      <span className={`text-sm md:text-base lg:text-lg font-medium ${draftSelectedSort === option.id ? 'text-primary dark:text-[#b18da5]' : 'text-gray-700 dark:text-gray-300'}`}>
                        {option.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-4 md:gap-6 px-4 md:px-6 py-4 md:py-5 border-t dark:border-gray-800 bg-white dark:bg-[#1a1a1a]">
                <button
                  onClick={() => setShowSortPopup(false)}
                  className="flex-1 py-3 md:py-4 text-center font-semibold text-gray-700 dark:text-gray-300 text-sm md:text-base"
                >
                  Close
                </button>
                <button
                  onClick={handleApply}
                  className="flex-1 py-3 md:py-4 font-semibold rounded-xl transition-colors text-sm md:text-base bg-primary text-white hover:bg-secondary"
                >
                  Apply
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Item Detail Popup */}
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
              onClick={closeItemDetail}
            />

            {/* Item Detail Bottom Sheet */}
            <motion.div
              className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:max-w-2xl lg:max-w-4xl xl:max-w-5xl z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl shadow-2xl max-h-[90vh] md:max-h-[85vh] flex flex-col"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.15, type: "spring", damping: 30, stiffness: 400 }}
              onClick={(e) => e.stopPropagation()}
              onTouchStart={handleItemDetailTouchStart}
              onTouchEnd={handleItemDetailTouchEnd}
              onWheel={handleItemDetailWheel}
            >
              {/* Close Button - Top Center Above Popup with 4px gap */}
              <div className="absolute -top-[44px] left-1/2 -translate-x-1/2 z-[10001]">
                <motion.button
                  onClick={closeItemDetail}
                  className="h-10 w-10 md:h-12 md:w-12 rounded-full bg-gray-800 dark:bg-gray-700 flex items-center justify-center hover:bg-gray-900 dark:hover:bg-gray-600 transition-colors shadow-lg"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <X className="h-5 w-5 md:h-6 md:w-6 text-white" />
                </motion.button>
              </div>

              {/* Image Section */}
              <div className="relative w-full h-64 md:h-80 lg:h-96 xl:h-[500px] overflow-hidden rounded-t-3xl">
                <OptimizedImage
                  src={selectedItem.image}
                  alt={selectedItem.name}
                  className="w-full h-full"
                  objectFit="cover"
                  sizes="100vw"
                  priority={true}
                  placeholder="blur"
                />
                {/* Bookmark and Share Icons Overlay */}
                <div className="absolute bottom-4 right-4 flex items-center gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleBookmarkClick(selectedItem.id)
                    }}
                    className={`h-10 w-10 rounded-full border flex items-center justify-center transition-all duration-300 ${bookmarkedItems.has(selectedItem.id)
                      ? "border-red-500 bg-red-50 text-red-500"
                      : "border-white bg-white/90 text-gray-600 hover:bg-white"
                      }`}
                  >
                    <Bookmark
                      className={`h-5 w-5 transition-all duration-300 ${bookmarkedItems.has(selectedItem.id) ? "fill-red-500" : ""
                        }`}
                    />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleShareItem(selectedItem)
                    }}
                    className="h-10 w-10 rounded-full border border-white bg-white/90 text-gray-600 hover:bg-white flex items-center justify-center transition-colors"
                  >
                    <Share2 className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Content Section */}
              <div
                ref={itemDetailContentRef}
                className="flex-1 overflow-y-auto px-4 md:px-6 lg:px-8 xl:px-10 py-4 md:py-6 lg:py-8"
              >
                {/* Item Name and Indicator */}
                <div className="flex items-start justify-between mb-3 md:mb-4 lg:mb-6">
                  <div className="flex items-center gap-2 md:gap-3 flex-1">
                    {selectedItem.isVeg && (
                      <div className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7 rounded border-2 border-green-600 dark:border-green-500 bg-green-50 dark:bg-green-900/20 flex items-center justify-center flex-shrink-0">
                        <div className="h-2.5 w-2.5 md:h-3 md:w-3 lg:h-3.5 lg:w-3.5 rounded-full bg-green-600 dark:bg-green-500" />
                      </div>
                    )}
                    <h2 className="text-xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-gray-900 dark:text-white">
                      {selectedItem.name}
                    </h2>
                  </div>
                  {/* Bookmark and Share Icons (Desktop) */}
                  <div className="hidden md:flex items-center gap-2 lg:gap-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleBookmarkClick(selectedItem.id)
                      }}
                      className={`h-8 w-8 lg:h-10 lg:w-10 rounded-full border flex items-center justify-center transition-all duration-300 ${bookmarkedItems.has(selectedItem.id)
                        ? "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400"
                        : "border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                        }`}
                    >
                      <Bookmark
                        className={`h-4 w-4 lg:h-5 lg:w-5 transition-all duration-300 ${bookmarkedItems.has(selectedItem.id) ? "fill-red-500 dark:fill-red-400" : ""
                          }`}
                      />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleShareItem(selectedItem)
                      }}
                      className="h-8 w-8 lg:h-10 lg:w-10 rounded-full border border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 flex items-center justify-center transition-colors"
                    >
                      <Share2 className="h-4 w-4 lg:h-5 lg:w-5" />
                    </button>
                  </div>
                </div>

                {/* Description */}
                <p className="text-sm md:text-base lg:text-lg text-gray-600 dark:text-gray-400 mb-4 md:mb-6 lg:mb-8 leading-relaxed">
                  {selectedItem.description || `${selectedItem.name} from ${selectedItem.restaurant || 'Under 250'}`}
                </p>

                {/* Highly Reordered Progress Bar */}
                {selectedItem.customisable && (
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 h-0.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: '50%' }} />
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
              </div>

              {/* Bottom Action Bar */}
              <div className="border-t dark:border-gray-800 border-gray-200 px-4 md:px-6 lg:px-8 xl:px-10 py-4 md:py-5 lg:py-6 bg-white dark:bg-[#1a1a1a]">
                <div className="flex items-center gap-4 md:gap-5 lg:gap-6">
                  {/* Quantity Selector */}
                  <div className={`flex items-center gap-3 md:gap-4 lg:gap-5 border-2 rounded-lg md:rounded-xl px-3 md:px-4 lg:px-5 h-[44px] md:h-[50px] lg:h-[56px] ${shouldShowGrayscale
                    ? 'border-gray-300 dark:border-gray-700 opacity-50'
                    : 'border-gray-300 dark:border-gray-700'
                    }`}>
                    <button
                      onClick={(e) => {
                        if (!shouldShowGrayscale) {
                          e.stopPropagation()
                          setItemDetailQuantity((prev) => Math.max(1, prev - 1))
                        }
                      }}
                      disabled={itemDetailQuantity <= 1 || shouldShowGrayscale}
                      className={`${shouldShowGrayscale
                        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed'
                        }`}
                    >
                      <Minus className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7" />
                    </button>
                    <span className={`text-lg md:text-xl lg:text-2xl font-semibold min-w-[2rem] md:min-w-[2.5rem] lg:min-w-[3rem] text-center ${shouldShowGrayscale
                      ? 'text-gray-400 dark:text-gray-600'
                      : 'text-gray-900 dark:text-white'
                      }`}>
                      {itemDetailQuantity}
                    </span>
                    <button
                      onClick={(e) => {
                        if (!shouldShowGrayscale) {
                          e.stopPropagation()
                          setItemDetailQuantity((prev) => prev + 1)
                        }
                      }}
                      disabled={shouldShowGrayscale}
                      className={shouldShowGrayscale
                        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                      }
                    >
                      <Plus className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7" />
                    </button>
                  </div>

                  {/* Add Item Button */}
                  <Button
                    className={`flex-1 h-[44px] md:h-[50px] lg:h-[56px] rounded-lg md:rounded-xl font-semibold flex items-center justify-center gap-2 text-sm md:text-base lg:text-lg ${shouldShowGrayscale
                      ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-600 cursor-not-allowed opacity-50'
                      : 'bg-primary hover:bg-secondary dark:bg-primary dark:hover:bg-secondary text-white'
                      }`}
                    onClick={(e) => {
                      if (!shouldShowGrayscale) {
                        updateItemQuantity(selectedItem, itemDetailQuantity, e)
                        closeItemDetail()
                      }
                    }}
                    disabled={shouldShowGrayscale}
                  >
                    <span>Add item</span>
                    <div className="flex items-center gap-1 md:gap-2">
                      {/* Check if we have a restaurant discount for the selected item */}
                      {(() => {
                        const restaurant = under250Restaurants.find(r => 
                          r.menuItems?.some(m => m.id === selectedItem.id)
                        );
                        if (restaurant?.discount > 0) {
                          return (
                            <>
                              <span className="text-sm md:text-base lg:text-lg line-through text-red-200">
                                {RUPEE_SYMBOL}{Math.round(selectedItem.price)}
                              </span>
                              <span className="text-base md:text-lg lg:text-xl font-bold">
                                {RUPEE_SYMBOL}{Math.round(selectedItem.price * (1 - restaurant.discount / 100))}
                              </span>
                            </>
                          );
                        } else if (selectedItem.originalPrice && selectedItem.originalPrice > selectedItem.price) {
                          return (
                            <>
                              <span className="text-sm md:text-base lg:text-lg line-through text-red-200">
                                {RUPEE_SYMBOL}{Math.round(selectedItem.originalPrice)}
                              </span>
                              <span className="text-base md:text-lg lg:text-xl font-bold">
                                {RUPEE_SYMBOL}{Math.round(selectedItem.price)}
                              </span>
                            </>
                          );
                        }
                        return (
                          <span className="text-base md:text-lg lg:text-xl font-bold">
                            {RUPEE_SYMBOL}{Math.round(selectedItem.price)}
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
      </AnimatePresence>

      <AnimatePresence>
        {showShareOptions && selectedItem && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 z-[10020]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowShareOptions(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.2, type: "spring", damping: 28, stiffness: 320 }}
              className="fixed bottom-0 left-0 right-0 z-[10021] bg-white dark:bg-[#1a1a1a] rounded-t-3xl shadow-2xl px-4 py-4"
            >
              <div className="flex justify-center pb-3">
                <div className="w-12 h-1 bg-gray-300 rounded-full" />
              </div>
              <div className="flex items-center justify-between pb-4">
                <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white">Share dish</h3>
                <button
                  onClick={() => setShowShareOptions(false)}
                  className="text-sm font-medium text-gray-500 dark:text-gray-400"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: "whatsapp", label: "WhatsApp" },
                  { id: "telegram", label: "Telegram" },
                  { id: "sms", label: "SMS" },
                  { id: "email", label: "Email" },
                  { id: "copy", label: "Copy Link" },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => handleShareOption(option.id)}
                    className="rounded-2xl border border-gray-200 dark:border-gray-700 px-4 py-3 text-sm font-medium text-gray-800 dark:text-gray-200 hover:border-primary hover:text-primary transition-colors"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add to Cart Animation */}
      {!showScanAnimation && <ScrollAwareAddToCartAnimation />}
    </div>
  )
}


