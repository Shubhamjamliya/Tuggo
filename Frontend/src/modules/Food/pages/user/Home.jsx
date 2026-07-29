import { useSearchParams, Link, useNavigate } from "react-router-dom";
import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
  startTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  Star,
  Clock,
  MapPin,
  Heart,
  Search,
  Tag,
  Flame,
  ShoppingBag,
  ShoppingCart,
  Mic,
  SlidersHorizontal,
  CheckCircle2,
  Bookmark,
  BadgePercent,
  X,
  ArrowDownUp,
  Timer,
  CalendarClock,
  ShieldCheck,
  IndianRupee,
  UtensilsCrossed,
  Pizza,
  Leaf,
  AlertCircle,
  Loader2,
  Plus,
  Check,
  Share2,
} from "lucide-react";
import outOfZoneBg from "@food/assets/out-of-zone-bg.png";
import { motion, AnimatePresence } from "framer-motion";
import Footer from "@food/components/user/Footer";
import AddToCartButton from "@food/components/user/AddToCartButton";
import StickyCartCard from "@food/components/user/StickyCartCard";
import OrderTrackingCard from "@food/components/user/OrderTrackingCard";
import {
  CategoryChipRowSkeleton,
  HeroBannerSkeleton,
  LoadingSkeletonRegion,
} from "@food/components/ui/loading-skeletons";
import { useProfile } from "@food/context/ProfileContext";
import { useCart } from "@food/context/CartContext";
import { HorizontalCarousel } from "@food/components/ui/horizontal-carousel";
import { DotPattern } from "@food/components/ui/dot-pattern";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@food/components/ui/card";
import { Button } from "@food/components/ui/button";
import { Badge } from "@food/components/ui/badge";
import { Input } from "@food/components/ui/input";
import { Switch } from "@food/components/ui/switch";
import { Checkbox } from "@food/components/ui/checkbox";
import {
  useSearchOverlay,
  useLocationSelector,
} from "@food/components/user/UserLayout";
import PageNavbar from "@food/components/user/PageNavbar";

const debugLog = (...args) => { };
const debugWarn = (...args) => { };
const debugError = (...args) => { };

// Import shared food images - prevents duplication
import { foodImages } from "@food/constants/images";

import { Avatar, AvatarFallback } from "@food/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@food/components/ui/dropdown-menu";
import { useAppLocation } from "@food/hooks/useAppLocation";
import offerImage from "@food/assets/offerimage.png";
import api, { publicGetOnce, restaurantAPI, getPublicLandingSettings, getPublicExploreIcons, getPublicCategories } from "@food/api";
import { API_BASE_URL } from "@food/api/config";
import OptimizedImage, { ShopPlaceholder } from "@food/components/OptimizedImage";
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability";
import HomeHeader from "@food/components/user/home/HomeHeader";
import HeroBanner from "@food/components/user/home/HeroBanner";
import RestaurantGrid from "@food/components/user/home/RestaurantGrid";
import ExploreMoreSection from "@food/components/user/home/ExploreMoreSection";
import RestaurantImageCarousel from "@food/components/user/home/RestaurantImageCarousel";
import QuickSection from "@food/components/user/home/QuickSection";
import PromoRow from "@food/components/user/home/PromoRow";
import FestBanner from "@food/components/user/home/FestBanner";
import chefMascot from "@food/assets/chef-mascot.png";
import AdsBannerCarousel from "@food/components/user/home/AdsBannerCarousel";
import { getRestaurantDisplayName } from "@food/utils/restaurantDisplayName";
import { primeOutletTimingsCache } from "@food/utils/outletTimingsCache";

// Explore More Icons
import exploreOffers from "@food/assets/explore more icons/offers.png";
import exploreGourmet from "@food/assets/explore more icons/gourmet.png";
import exploreTop10 from "@food/assets/explore more icons/top 10.png";
import exploreCollection from "@food/assets/explore more icons/collection.png";

// Animated placeholder for search - moved outside component to prevent recreation
const placeholders = [
  'Search "burger"',
  'Search "biryani"',
  'Search "pizza"',
  'Search "desserts"',
  'Search "chinese"',
  'Search "thali"',
  'Search "momos"',
  'Search "dosa"',
];

const homePageCache = {
  effectiveZoneId: null,
  lat: null,
  lng: null,
  landingExploreMore: null,
  landingExploreFetched: false,
  exploreMoreHeading: null,
  recommendedRestaurantIds: null,
  under250PriceLimit: null,
  recommendedRestaurantsFromSettings: null,
  festBannerImages: null,
  heroBannerImages: null,
  heroBannersData: null,
  heroBannersFetched: false,
  adsBannerImages: null,
  adsBannersData: null,
  adsBannersFetched: false,
};

const roundCoord = (value) =>
  Number.isFinite(Number(value))
    ? Math.round(Number(value) * 100000) / 100000
    : null;

export default function Home() {
  const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api(\/v\d+)?\/?$/, "");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const [heroSearch, setHeroSearch] = useState("");
  const { openSearch, closeSearch, searchValue, setSearchValue } =
    useSearchOverlay();
  const { openLocationSelector } = useLocationSelector();
  const {
    vegMode,
    setVegMode: setVegModeContext,
    vegModeOption,
    setVegModeOption
  } = useProfile();
  const [prevVegMode, setPrevVegMode] = useState(vegMode);
  const [showVegModePopup, setShowVegModePopup] = useState(false);
  const [showSwitchOffPopup, setShowSwitchOffPopup] = useState(false);

  const [isApplyingVegMode, setIsApplyingVegMode] = useState(false);
  const [isSwitchingOffVegMode, setIsSwitchingOffVegMode] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0, triangleLeft: 0 });
  const vegModeToggleRef = useRef(null);
  const [isStickyHeaderVisible, setIsStickyHeaderVisible] = useState(false);
  const [showStickySearch, setShowStickySearch] = useState(false);
  const [isCategoryStuck, setIsCategoryStuck] = useState(false);
  const categoryAnchorRef = useRef(null);
  const lastScrollY = useRef(0);
  const scrollRafRef = useRef(null);

  useEffect(() => {
    const runScrollWork = () => {
      scrollRafRef.current = null;
      const currentScrollY = window.scrollY;

      const categoriesSection = document.getElementById("categories-section");
      if (categoriesSection) {
        const rect = categoriesSection.getBoundingClientRect();
        const sectionBottom = rect.bottom + currentScrollY;
        setIsStickyHeaderVisible(currentScrollY > sectionBottom);
        setShowStickySearch(currentScrollY < lastScrollY.current);
      }

      const heroShell = heroShellRef.current;
      const stickyHeader = stickyHeaderRef.current;
      if (heroShell) {
        const heroRect = heroShell.getBoundingClientRect();
        const stickyHeight = stickyHeader?.getBoundingClientRect().height || 0;
        setHasScrolledPastBanner(heroRect.bottom <= stickyHeight);
      } else {
        setHasScrolledPastBanner(false);
      }

      lastScrollY.current = currentScrollY;
    };

    const onScrollOrResize = () => {
      if (scrollRafRef.current != null) return;
      scrollRafRef.current = window.requestAnimationFrame(runScrollWork);
    };

    runScrollWork();
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const [heroBannerImages, setHeroBannerImages] = useState(() => homePageCache.heroBannerImages ?? []);
  const [heroBannersData, setHeroBannersData] = useState(() => homePageCache.heroBannersData ?? []);
  const [loadingBanners, setLoadingBanners] = useState(() => !homePageCache.heroBannersFetched);
  const [adsBannerImages, setAdsBannerImages] = useState(() => homePageCache.adsBannerImages ?? []);
  const [adsBannersData, setAdsBannersData] = useState(() => homePageCache.adsBannersData ?? []);
  const [loadingAdsBanners, setLoadingAdsBanners] = useState(() => !homePageCache.adsBannersFetched);
  const [hasScrolledPastBanner, setHasScrolledPastBanner] = useState(false);
  const [landingCategories, setLandingCategories] = useState([]);
  const [landingExploreMore, setLandingExploreMore] = useState(() => homePageCache.landingExploreMore || []);
  const [exploreMoreHeading, setExploreMoreHeading] = useState(() => homePageCache.exploreMoreHeading || "Explore More");
  const [festBannerImages, setFestBannerImages] = useState(() => homePageCache.festBannerImages ?? []);
  const [bgIndex, setBgIndex] = useState(0);
  const [recommendedRestaurantIds, setRecommendedRestaurantIds] = useState(() => homePageCache.recommendedRestaurantIds || []);
  const [under250PriceLimit, setUnder250PriceLimit] = useState(() => homePageCache.under250PriceLimit || 250);
  const [
    recommendedRestaurantsFromSettings,
    setRecommendedRestaurantsFromSettings,
  ] = useState(() => homePageCache.recommendedRestaurantsFromSettings || []);
  const [loadingLandingConfig, setLoadingLandingConfig] = useState(() => !homePageCache.landingExploreFetched);
  const [restaurantsData, setRestaurantsData] = useState(() => homePageCache.restaurantsData || []);
  const [loadingRestaurants, setLoadingRestaurants] = useState(() => !homePageCache.restaurantsData);
  const [realCategories, setRealCategories] = useState([]);
  const [loadingRealCategories, setLoadingRealCategories] = useState(true);
  const [menuCategories, setMenuCategories] = useState([]);
  const [loadingMenuCategories, setLoadingMenuCategories] = useState(false);
  const [showAllCategoriesModal, setShowAllCategoriesModal] = useState(false);
  const isHandlingSwitchOff = useRef(false);
  const heroShellRef = useRef(null);
  const stickyHeaderRef = useRef(null);
  const slugifyCategory = useCallback(
    (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
    [],
  );
  const festVideoActive =
    Array.isArray(festBannerImages) && festBannerImages.length > 0;

  useEffect(() => {
    if (!festVideoActive || festBannerImages.length <= 1) return;
    const timer = setInterval(() => {
      setBgIndex(prev => (prev + 1) % festBannerImages.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [festVideoActive, festBannerImages.length]);

  // Stable list of restaurant ids for menu-category union so we don't refetch menus
  // when `restaurantsData` changes for reasons like distance recalculation or outletTimings enrichment.
  const menuUnionRestaurantIdsKey = useMemo(() => {
    if (!Array.isArray(restaurantsData) || restaurantsData.length === 0) return "";
    return restaurantsData
      .map((r) => String(r?.restaurantId || r?.id || "").trim())
      .filter(Boolean)
      .sort()
      .join(",");
  }, [restaurantsData]);

  const normalizeImageUrl = useCallback(
    (imageUrl) => {
      if (typeof imageUrl !== "string") return "";
      const trimmed = imageUrl.trim();
      if (!trimmed) return "";
      if (/^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
        return trimmed;
      }
      const appProtocol =
        typeof window !== "undefined" ? window.location?.protocol : "";
      const appHost =
        typeof window !== "undefined" ? window.location?.hostname : "";
      let normalizedInput = trimmed
        .replace(/\\/g, "/")
        .replace(/^(https?):\/(?!\/)/i, "$1://")
        .replace(/^(https?:\/\/)(https?:\/\/)/i, "$1");

      if (/^\/\//.test(normalizedInput)) {
        normalizedInput = `${appProtocol || "https:"}${normalizedInput}`;
      }

      // WebView can fail on unescaped spaces/special chars; keep URLs safely encoded.
      if (/^(https?:)?\/\//i.test(normalizedInput)) {
        try {
          const parsed = new URL(normalizedInput, window.location.origin);

          // In mobile production, localhost/127.0.0.1 inside image URLs is unreachable.
          // Use BACKEND_ORIGIN (API server) for image host, not frontend hostï¿½uploads are served by the backend.
          if (
            appHost &&
            appHost !== "localhost" &&
            appHost !== "127.0.0.1" &&
            /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)
          ) {
            try {
              const backendUrl = new URL(BACKEND_ORIGIN);
              parsed.protocol = backendUrl.protocol;
              parsed.hostname = backendUrl.hostname;
              parsed.port = backendUrl.port;
            } catch {
              parsed.protocol = window.location.protocol;
              parsed.hostname = window.location.hostname;
              if (window.location.port) parsed.port = window.location.port;
            }
          }

          // Prevent mixed-content image blocking in HTTPS WebView.
          if (appProtocol === "https:" && parsed.protocol === "http:") {
            parsed.protocol = "https:";
          }

          const finalUrl = parsed.toString();
          // Do not encode signed URLs (S3/Cloudfront/Cloudinary); encoding query params can break signatures.
          const hasSignedParams =
            /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
              finalUrl,
            );
          return hasSignedParams ? finalUrl : encodeURI(finalUrl);
        } catch {
          return normalizedInput;
        }
      }

      const absolutePath = normalizedInput.startsWith("/")
        ? `${BACKEND_ORIGIN}${normalizedInput}`
        : `${BACKEND_ORIGIN}/${normalizedInput.replace(/^\.?\/*/, "")}`;

      try {
        const parsed = new URL(absolutePath, window.location.origin);
        if (appProtocol === "https:" && parsed.protocol === "http:") {
          parsed.protocol = "https:";
        }
        const finalUrl = parsed.toString();
        const hasSignedParams =
          /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
            finalUrl,
          );
        return hasSignedParams ? finalUrl : encodeURI(finalUrl);
      } catch {
        return absolutePath;
      }
    },
    [BACKEND_ORIGIN],
  );

  const extractImageFromValue = useCallback(
    (value) => {
      if (!value) return "";

      if (typeof value === "string") {
        return normalizeImageUrl(value);
      }

      if (typeof value === "object") {
        const candidate =
          value.url ||
          value.secure_url ||
          value.imageUrl ||
          value.imageURL ||
          value.image ||
          value.src ||
          value.path ||
          value.location ||
          value.link ||
          value.href ||
          "";
        return typeof candidate === "string"
          ? normalizeImageUrl(candidate)
          : "";
      }

      return "";
    },
    [normalizeImageUrl],
  );

  const buildRestaurantImageCandidates = useCallback(
    (value) => {
      const normalized = extractImageFromValue(value);
      if (!normalized) return [];

      // Mobile WebView safety: try deterministic JPEG first, then auto, then original.
      if (
        /res\.cloudinary\.com/i.test(normalized) &&
        /\/image\/upload\//i.test(normalized)
      ) {
        const hasTransform =
          /\/image\/upload\/(?:f_|q_|w_|h_|c_|dpr_|g_)/i.test(normalized);
        if (!hasTransform) {
          return Array.from(
            new Set([
              normalized.replace(
                "/image/upload/",
                "/image/upload/f_jpg,q_auto,w_500/",
              ),
              normalized.replace(
                "/image/upload/",
                "/image/upload/f_auto,q_auto,w_500/",
              ),
              normalized,
            ]),
          );
        }
      }

      return [normalized];
    },
    [extractImageFromValue],
  );

  const extractImages = useCallback(
    (source) => {
      if (!source) return [];

      const normalizedImages = (Array.isArray(source)
        ? source.flatMap((entry) => buildRestaurantImageCandidates(entry))
        : buildRestaurantImageCandidates(source)
      )
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean);

      // De-duplicate image urls while preserving order.
      return normalizedImages.filter(
        (value, index) => normalizedImages.indexOf(value) === index,
      );

    },
    [buildRestaurantImageCandidates],
  );

  // Merge API explore items with fallback to ensure all 4 cards are shown
  const finalExploreItems = useMemo(() => {
    const fallback = [
      {
        id: "offers",
        label: "Offers",
        image: exploreOffers,
        href: "/food/user/offers",
      },
      {
        id: "gourmet",
        label: "Gourmet",
        image: exploreGourmet,
        href: "/food/user/gourmet",
      },
      {
        id: "collection",
        label: "Collections",
        image: exploreCollection,
        href: "/food/user/profile/favorites",
      },
    ];

    if (!landingExploreMore || landingExploreMore.length === 0) return fallback;

    return fallback.map((item) => {
      const apiItem = landingExploreMore.find(
        (ai) => ai.label?.toLowerCase() === item.label?.toLowerCase(),
      );
      if (apiItem) {
        const href = apiItem.link
          ? apiItem.link.startsWith("/")
            ? apiItem.link
            : `/${apiItem.link}`
          : item.href;
        return {
          ...item,
          image:
            normalizeImageUrl(apiItem.imageUrl || apiItem.image || "") ||
            item.image,
          href,
        };
      }
      return item;
    });
  }, [landingExploreMore, normalizeImageUrl]);

  const normalizedLandingCategories = useMemo(() => {
    return (landingCategories || []).map((category, index) => ({
      id: category.id || category._id || `landing-category-${index}`,
      name: category.label || category.name || "Category",
      image:
        normalizeImageUrl(category.imageUrl || category.image) ||
        foodImages[index % foodImages.length] ||
        foodImages[0],
      slug:
        category.slug || slugifyCategory(category.label || category.name || ""),
      label: category.label || category.name || "Category",
    }));
  }, [landingCategories, normalizeImageUrl, slugifyCategory]);

  const displayCategories = useMemo(() => {
    if (realCategories.length > 0) return realCategories;
    if (menuCategories.length > 0) return menuCategories;
    return normalizedLandingCategories;
  }, [menuCategories, realCategories, normalizedLandingCategories]);

  // Swipe functionality for hero banner carousel
  // Sync prevVegMode when vegMode changes from context
  useEffect(() => {
    if (vegMode !== prevVegMode && !isHandlingSwitchOff.current) {
      setPrevVegMode(vegMode);
    }
  }, [vegMode]);

  // Keep persisted Veg Mode preference; only reset popup UI state on mount.
  useEffect(() => {
    setPrevVegMode(vegMode);
    setShowVegModePopup(false);
    setShowSwitchOffPopup(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle vegMode toggle - show popup when turned ON or OFF
  const handleVegModeChange = (newValue) => {
    // Skip if we're handling switch off confirmation
    if (isHandlingSwitchOff.current) {
      return;
    }

    if (newValue && !prevVegMode) {
      // Veg mode was just turned ON
      // Calculate popup position relative to toggle
      if (vegModeToggleRef.current) {
        const rect = vegModeToggleRef.current.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const popupWidth = Math.min(screenWidth - 32, 320); // 320 is max-w-xs

        let left = rect.left + rect.width / 2 - popupWidth / 2;
        left = Math.max(16, Math.min(left, screenWidth - popupWidth - 16));

        const triangleLeft = rect.left + rect.width / 2 - left;

        setPopupPosition({
          top: rect.bottom + 10,
          left: left,
          triangleLeft: triangleLeft
        });
      }
      setShowVegModePopup(true);
      // Don't update context yet - wait for user to apply or cancel
    } else if (!newValue && prevVegMode) {
      // Veg mode was just turned OFF - show switch off confirmation popup
      isHandlingSwitchOff.current = true;
      setShowSwitchOffPopup(true);
      // Don't update context yet - wait for user to confirm
    } else {
      // Normal state change - update context directly
      setVegModeContext(newValue);
      setPrevVegMode(newValue);
    }
  };

  // Update popup position on scroll/resize
  useEffect(() => {
    if (!showVegModePopup) return;

    const updatePosition = () => {
      if (vegModeToggleRef.current) {
        const rect = vegModeToggleRef.current.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const popupWidth = Math.min(screenWidth - 32, 320);

        let left = rect.left + rect.width / 2 - popupWidth / 2;
        left = Math.max(16, Math.min(left, screenWidth - popupWidth - 16));

        const triangleLeft = rect.left + rect.width / 2 - left;

        setPopupPosition({
          top: rect.bottom + 10,
          left: left,
          triangleLeft: triangleLeft
        });
      }
    };

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [showVegModePopup]);


  const [activeFilters, setActiveFilters] = useState(new Set());
  const [sortBy, setSortBy] = useState(null); // null, 'price-low', 'price-high', 'rating-high', 'rating-low'
  const [selectedCuisine, setSelectedCuisine] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState({
    activeFilters: new Set(),
    sortBy: null,
    selectedCuisine: null,
  });
  const [isLoadingFilterResults, setIsLoadingFilterResults] = useState(false);
  const [activeFilterTab, setActiveFilterTab] = useState("sort");
  const categoryScrollRef = useRef(null);
  const gsapAnimationsRef = useRef([]);
  // Show skeletons immediately while loading â€” delayed toggles caused visible layout swap (CLS).
  const showBannerSkeleton = loadingBanners;
  const showCategorySkeleton = loadingRealCategories || loadingMenuCategories;
  const showExploreSkeleton = loadingLandingConfig;
  const showRestaurantSkeleton = isLoadingFilterResults || loadingRestaurants;
  // Safely get profile context - handle case when ProfileProvider is not available
  let profileContext = null;
  try {
    profileContext = useProfile();
  } catch (error) {
    debugWarn("ProfileProvider not available, using fallback:", error.message);
    // Fallback values when ProfileProvider is not available
    profileContext = {
      addFavorite: () => debugWarn("ProfileProvider not available"),
      removeFavorite: () => debugWarn("ProfileProvider not available"),
      isFavorite: () => false,
      getFavorites: () => [],
      getDefaultAddress: () => null,
    };
  }

  const {
    addFavorite,
    removeFavorite,
    isFavorite,
    getFavorites,
    getDefaultAddress,
  } = profileContext;
  const { addToCart, cart } = useCart();
  const { location, loading: effectiveZoneLoading, requestLocation, zoneId: effectiveZoneId, zoneStatus: effectiveZoneStatus, isOutOfService: isEffectiveLocationOutOfService, isOutOfZone: isEffectiveLocationOutOfZone, isOutOfRadius: isEffectiveLocationOutOfRadius, serviceUnavailableMessage: effectiveServiceUnavailableMessage } = useAppLocation();
  const [showToast, setShowToast] = useState(false);
  const [showManageCollections, setShowManageCollections] = useState(false);
  const [selectedRestaurantSlug, setSelectedRestaurantSlug] = useState(null);

  // Memoize cartCount to prevent recalculation on every render - use cart directly
  const cartCount = useMemo(
    () => cart.reduce((total, item) => total + (item.quantity || 0), 0),
    [cart],
  );

  const cityName = location?.city || "Select";
  const stateName = location?.state || "Location";
  const hasLiveLocation = useMemo(() => {
    if (!location) return false;

    const isPlaceholder = (value) => {
      if (!value) return true;
      const normalized = String(value).trim().toLowerCase();
      return (
        !normalized ||
        normalized === "select location" ||
        normalized === "current location"
      );
    };

    const hasAddressText =
      !isPlaceholder(location.formattedAddress) ||
      !isPlaceholder(location.address);
    const hasCityState =
      !isPlaceholder(location.city) || !isPlaceholder(location.state);

    return hasAddressText || hasCityState;
  }, [location]);

  const formatSavedAddress = useCallback((address) => {
    if (!address) return "";

    if (
      address.formattedAddress &&
      address.formattedAddress !== "Select location"
    ) {
      return address.formattedAddress;
    }

    const parts = [];
    if (address.additionalDetails) parts.push(address.additionalDetails);
    if (address.street) parts.push(address.street);
    if (address.city) parts.push(address.city);
    if (address.state) parts.push(address.state);
    if (address.zipCode) parts.push(address.zipCode);

    if (parts.length > 0) return parts.join(", ");
    if (address.address && address.address !== "Select location")
      return address.address;

    return "";
  }, []);

  const savedAddressText = useMemo(() => {
    const defaultAddress = getDefaultAddress?.();
    return formatSavedAddress(defaultAddress);
  }, [getDefaultAddress, formatSavedAddress]);

  const defaultSavedAddress = useMemo(
    () => getDefaultAddress?.() || null,
    [getDefaultAddress],
  );

  const defaultSavedAddressLocation = useMemo(() => {
    const coords = defaultSavedAddress?.location?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = parseFloat(coords[0]);
      const lat = parseFloat(coords[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng };
      }
    }

    const lat = parseFloat(
      defaultSavedAddress?.latitude || defaultSavedAddress?.lat,
    );
    const lng = parseFloat(
      defaultSavedAddress?.longitude || defaultSavedAddress?.lng,
    );
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }

    return null;
  }, [defaultSavedAddress]);

  const effectiveLocation = location;

  // Fetch categories (zone-aware) for the homepage category rail.
  useEffect(() => {
    if (effectiveZoneLoading) return;

    let cancelled = false;
    const run = async () => {
      try {
        setLoadingRealCategories(true);
        const data = await getPublicCategories(effectiveZoneId || null);
        if (cancelled) return;

        const list = data?.categories || (Array.isArray(data) ? data : []);
        const categories = Array.isArray(list)
          ? list.map((cat, idx) => ({
              id: String(cat?.id || cat?._id || cat?.slug || idx),
              name: cat?.name || "",
              slug:
                cat?.slug ||
                String(cat?.name || "")
                  .toLowerCase()
                  .replace(/\s+/g, "-"),
              image:
                normalizeImageUrl(cat?.image || cat?.imageUrl) ||
                foodImages[idx % foodImages.length] ||
                foodImages[0],
              type: cat?.type || "",
            }))
          : [];

        setRealCategories(categories);
      } catch (err) {
        debugWarn("Failed to fetch categories:", err);
        if (!cancelled) setRealCategories([]);
      } finally {
        if (!cancelled) setLoadingRealCategories(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [effectiveZoneId, effectiveZoneLoading, normalizeImageUrl]);

  // Fetch explore icons and landing settings from public APIs
  useEffect(() => {
    if (effectiveZoneLoading) return;

    if (homePageCache.landingExploreFetched && homePageCache.effectiveZoneId === effectiveZoneId) {
      setLoadingLandingConfig(false);
      return;
    }
    let cancelled = false;
    setLoadingLandingConfig(true);
    Promise.all([
      getPublicExploreIcons(effectiveZoneId).catch(() => ({})),
      getPublicLandingSettings(effectiveZoneId).catch(() => ({})),
    ])
      .then(([exploreData, settings]) => {
        if (cancelled) return;
        const items = Array.isArray(exploreData?.items)
          ? exploreData.items
          : Array.isArray(exploreData)
            ? exploreData
            : [];
        const exploreMoreData = items.map((it) => ({
          ...it,
          imageUrl: it.imageUrl || it.iconUrl,
          label: it.label || it.name,
        }));
        setLandingExploreMore(exploreMoreData);

        const settingsData = settings || {};
        const heading = settingsData.exploreMoreHeading || "Explore More";
        setExploreMoreHeading(heading);
        setRecommendedRestaurantIds(settingsData.recommendedRestaurantIds || []);
        setUnder250PriceLimit(Number(settingsData.under250PriceLimit) || 250);

        const recRest = settingsData.recommendedRestaurants || [];
        setRecommendedRestaurantsFromSettings(recRest);

        const images = Array.isArray(settingsData.festBannerImages) ? settingsData.festBannerImages : [];
        setFestBannerImages(images);

        // Update cache
        homePageCache.landingExploreMore = exploreMoreData;
        homePageCache.exploreMoreHeading = heading;
        homePageCache.recommendedRestaurantIds = settingsData.recommendedRestaurantIds || [];
        homePageCache.under250PriceLimit = Number(settingsData.under250PriceLimit) || 250;
        homePageCache.recommendedRestaurantsFromSettings = recRest;
        homePageCache.festBannerImages = images;
        homePageCache.landingExploreFetched = true;
        homePageCache.effectiveZoneId = effectiveZoneId;
      })
      .catch(() => {
        if (!cancelled) {
          setLandingExploreMore([]);
          setExploreMoreHeading("Explore More");
          setRecommendedRestaurantsFromSettings([]);
          setFestBannerImages([]);
        }
        homePageCache.landingExploreFetched = true;
        homePageCache.effectiveZoneId = effectiveZoneId;
      })
      .finally(() => {
        if (!cancelled) setLoadingLandingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveZoneId, effectiveZoneLoading]);

  // Fetch hero banners from public API (no auth required)
  useEffect(() => {
    if (effectiveZoneLoading) return;

    if (homePageCache.heroBannersFetched && homePageCache.effectiveZoneId === effectiveZoneId) {
      setLoadingBanners(false);
      return;
    }
    let cancelled = false;
    setLoadingBanners(true);
    publicGetOnce("/food/hero-banners/public", { params: { zoneId: effectiveZoneId } })
      .then((response) => {
        if (cancelled) return;
        const data = response?.data?.data;
        const list = Array.isArray(data?.banners)
          ? data.banners
          : Array.isArray(data)
            ? data
            : [];
        const images = list
          .map((b) => (b && typeof b.imageUrl === "string" ? b.imageUrl : ""))
          .filter(Boolean);
        setHeroBannerImages(images);
        setHeroBannersData(list);

        homePageCache.heroBannerImages = images;
        homePageCache.heroBannersData = list;
        homePageCache.heroBannersFetched = true;
        homePageCache.effectiveZoneId = effectiveZoneId;
      })
      .catch((err) => {
        if (cancelled) return;
        debugError("Failed to fetch hero banners", err);
        setHeroBannerImages([]);
        setHeroBannersData([]);
        homePageCache.heroBannerImages = [];
        homePageCache.heroBannersData = [];
        homePageCache.heroBannersFetched = true;
        homePageCache.effectiveZoneId = effectiveZoneId;
      })
      .finally(() => {
        if (!cancelled) setLoadingBanners(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveZoneId, effectiveZoneLoading]);

  // Fetch ads banners from public API (no auth required)
  useEffect(() => {
    if (effectiveZoneLoading) return;

    if (homePageCache.adsBannersFetched && homePageCache.effectiveZoneId === effectiveZoneId) {
      setLoadingAdsBanners(false);
      return;
    }
    let cancelled = false;
    setLoadingAdsBanners(true);
    publicGetOnce("/food/hero-banners/ads/public", { params: { zoneId: effectiveZoneId } })
      .then((response) => {
        if (cancelled) return;
        const data = response?.data?.data;
        const list = Array.isArray(data?.banners)
          ? data.banners
          : Array.isArray(data)
            ? data
            : [];
        const images = list
          .map((b) => (b && typeof b.imageUrl === "string" ? b.imageUrl : ""))
          .filter(Boolean);
        setAdsBannerImages(images);
        setAdsBannersData(list);

        homePageCache.adsBannerImages = images;
        homePageCache.adsBannersData = list;
        homePageCache.adsBannersFetched = true;
        homePageCache.effectiveZoneId = effectiveZoneId;
      })
      .catch((err) => {
        if (cancelled) return;
        debugError("Failed to fetch ads banners", err);
        setAdsBannerImages([]);
        setAdsBannersData([]);
        homePageCache.adsBannerImages = [];
        homePageCache.adsBannersData = [];
        homePageCache.adsBannersFetched = true;
        homePageCache.effectiveZoneId = effectiveZoneId;
      })
      .finally(() => {
        if (!cancelled) setLoadingAdsBanners(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveZoneId, effectiveZoneLoading]);

  const shouldShowOutOfZoneHome =
    !effectiveZoneLoading &&
    isEffectiveLocationOutOfZone;


  // Mock points value - replace with actual points from context/store
  const userPoints = 99;

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("food");
  const [headerBgHeight, setHeaderBgHeight] = useState(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsCategoryStuck(!entry.isIntersecting);
      },
      {
        threshold: 0,
        rootMargin: "-72px 0px 0px 0px",
      }
    );

    if (categoryAnchorRef.current) {
      observer.observe(categoryAnchorRef.current);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const calculateHeight = () => {
      const locEl = document.getElementById('home-header-loc-row');
      const searchEl = document.getElementById('home-header-search-row');
      const festEl = document.getElementById('fest-banner-wrapper');

      let height = 0;
      if (locEl) height += locEl.offsetHeight;
      if (searchEl) {
      }
      
      if (locEl) {
        let maxBottom = locEl.offsetTop + locEl.offsetHeight;
        if (searchEl) {
          maxBottom = Math.max(maxBottom, searchEl.offsetTop + searchEl.offsetHeight);
        }
        if (festEl && activeTab === 'food') {
          maxBottom = Math.max(maxBottom, festEl.offsetTop + festEl.offsetHeight);
        }
        
        if (maxBottom > 0) {
          setHeaderBgHeight(maxBottom); // Height perfectly matches wrapper, so the curved corners are exposed before the white category section starts
        }
      }
    };

    calculateHeight();
    window.addEventListener('resize', calculateHeight);
    const timeout = setTimeout(calculateHeight, 100);
    const timeout2 = setTimeout(calculateHeight, 500);
    
    return () => {
      window.removeEventListener('resize', calculateHeight);
      clearTimeout(timeout);
      clearTimeout(timeout2);
    };
  }, [activeTab]);

  // Simple filter toggle function
  const toggleFilter = (filterId) => {
    setActiveFilters((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filterId)) {
        newSet.delete(filterId);
      } else {
        newSet.add(filterId);
      }
      return newSet;
    });
  };

  // Refs for scroll tracking
  const filterSectionRefs = useRef({});
  const [activeScrollSection, setActiveScrollSection] = useState("sort");
  const rightContentRef = useRef(null);
  const restaurantsRequestSeqRef = useRef(0);
  const menuUnionRequestSeqRef = useRef(0);
  const menuUnionCacheRef = useRef(new Map());

  // Scroll tracking effect
  useEffect(() => {
    if (!isFilterOpen || !rightContentRef.current) return;

    const observerOptions = {
      root: rightContentRef.current,
      rootMargin: "-20% 0px -70% 0px",
      threshold: 0,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.getAttribute("data-section-id");
          if (sectionId) {
            setActiveScrollSection(sectionId);
            setActiveFilterTab(sectionId);
          }
        }
      });
    }, observerOptions);

    // Observe all filter sections
    Object.values(filterSectionRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [isFilterOpen]);

  // Fetch restaurants from API with filters
  const fetchRestaurants = useCallback(
    async (filters = {}) => {
      const isDefaultFetch = Object.keys(filters).length === 0 ||
        (!filters.sortBy && !filters.selectedCuisine && (!filters.activeFilters || filters.activeFilters.size === 0));

      if (isDefaultFetch && effectiveZoneLoading) {
        return;
      }

      if (!effectiveZoneId && !effectiveLocation?.city) {
        setLoadingRestaurants(false);
        setRestaurantsData([]);
        return;
      }

      const isLocationSame =
        homePageCache.lat === roundCoord(effectiveLocation?.latitude) &&
        homePageCache.lng === roundCoord(effectiveLocation?.longitude);

      if (isDefaultFetch && homePageCache.restaurantsData && homePageCache.restaurantsData.length > 0 && homePageCache.effectiveZoneId === effectiveZoneId && isLocationSame) {
        setLoadingRestaurants(false);
        return;
      }

      const requestSeq = ++restaurantsRequestSeqRef.current;
      try {
        setLoadingRestaurants(true);

        // Backend disconnected - new backend in progress. Skip health check.

        // Build query parameters from filters
        const params = {};

        // Always send user coordinates when available so backend can compute distance/sort.
        const effectiveLat = effectiveLocation?.latitude !== undefined ? effectiveLocation.latitude : effectiveLocation?.lat;
        const effectiveLng = effectiveLocation?.longitude !== undefined ? effectiveLocation.longitude : effectiveLocation?.lng;
        if (
          Number.isFinite(effectiveLat) &&
          Number.isFinite(effectiveLng)
        ) {
          params.lat = effectiveLat;
          params.lng = effectiveLng;
        }

        // Sort by
        if (filters.sortBy) {
          params.sortBy = filters.sortBy;
        }

        // Cuisine
        if (filters.selectedCuisine) {
          params.cuisine = filters.selectedCuisine;
        }

        // Rating filters
        if (filters.activeFilters?.has("rating-45-plus")) {
          params.minRating = 4.5;
        } else if (filters.activeFilters?.has("rating-4-plus")) {
          params.minRating = 4.0;
        } else if (filters.activeFilters?.has("rating-35-plus")) {
          params.minRating = 3.5;
        }

        // Delivery time filters
        if (filters.activeFilters?.has("delivery-under-30")) {
          params.maxDeliveryTime = 30;
        } else if (filters.activeFilters?.has("delivery-under-45")) {
          params.maxDeliveryTime = 45;
        }

        // Distance filters
        if (filters.activeFilters?.has("distance-under-1km")) {
          params.radiusKm = 1.0;
        } else if (filters.activeFilters?.has("distance-under-2km")) {
          params.radiusKm = 2.0;
        }

        // Price filters
        if (filters.activeFilters?.has("price-under-200")) {
          params.maxPrice = 200;
        } else if (filters.activeFilters?.has("price-under-500")) {
          params.maxPrice = 500;
        }

        // Offers filter
        if (filters.activeFilters?.has("has-offers")) {
          params.hasOffers = "true";
        }

        // Trust filters
        if (filters.activeFilters?.has("top-rated")) {
          params.topRated = "true";
        } else if (filters.activeFilters?.has("trusted")) {
          params.trusted = "true";
        }

        if (effectiveZoneId) {
          params.zoneId = effectiveZoneId;
        }


        debugLog("Fetching restaurants with params:", params);
        const response = await restaurantAPI.getRestaurants(params, { noCache: true });
        debugLog("Restaurants API response:", response.data);

        // If a newer request started, ignore this response to avoid races/flicker.
        if (requestSeq !== restaurantsRequestSeqRef.current) return;

        if (
          response.data &&
          response.data.success &&
          response.data.data &&
          response.data.data.restaurants
        ) {
          const restaurantsArray = response.data.data.restaurants;
          debugLog(`Fetched ${restaurantsArray.length} restaurants from API`);

          if (restaurantsArray.length === 0) {
            debugWarn("No restaurants found in API response");
            setRestaurantsData([]);
            return;
          }

          // Calculate distance helper function (Fallback Haversine with multiplier)
          const calculateDistance = (lat1, lng1, lat2, lng2) => {
            const R = 6371; // Earth's radius in kilometers
            const dLat = ((lat2 - lat1) * Math.PI) / 180;
            const dLng = ((lng2 - lng1) * Math.PI) / 180;
            const a =
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos((lat1 * Math.PI) / 180) *
              Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLng / 2) *
              Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return (R * c) * 1.35; // Distance in kilometers with routing multiplier
          };

          // Get user coordinates
          const userLat = effectiveLocation?.latitude ?? effectiveLocation?.lat;
          const userLng = effectiveLocation?.longitude ?? effectiveLocation?.lng;

          // Transform API data to match expected format
          const normalizeCityValue = (value) =>
            String(value || "")
              .trim()
              .split(",")[0]
              .toLowerCase()
              .replace(/[^a-z0-9\s]/g, "")
              .replace(/\s+/g, " ")
              .trim();

          const transformedRestaurants = restaurantsArray
            .filter((restaurant) => {
              const name = (restaurant.restaurantName || restaurant.name || "").toLowerCase()
              return true
            })
            .map((restaurant, index) => {
              // Use restaurant data if available, otherwise use defaults
              const deliveryTime =
                restaurant.estimatedDeliveryTime || "25-30 mins";

              // Calculate distance from user to restaurant
              let distance = restaurant.distance || "1.2 km";

              // Get restaurant coordinates
              const restaurantLocation = restaurant.location;
              const restaurantLat =
                restaurantLocation?.latitude ||
                (restaurantLocation?.coordinates &&
                  Array.isArray(restaurantLocation.coordinates)
                  ? restaurantLocation.coordinates[1]
                  : null);
              const restaurantLng =
                restaurantLocation?.longitude ||
                (restaurantLocation?.coordinates &&
                  Array.isArray(restaurantLocation.coordinates)
                  ? restaurantLocation.coordinates[0]
                  : null);

              // Calculate distance if both user and restaurant coordinates are available
              let distanceInKm = null;
              if (restaurant.distanceText) {
                // If backend provided Google Distance Matrix result
                distance = restaurant.distanceText;
                distanceInKm = restaurant.distanceInfo?.distanceValue ? (restaurant.distanceInfo.distanceValue / 1000) : null;
              } else if (
                userLat &&
                userLng &&
                restaurantLat &&
                restaurantLng &&
                !isNaN(userLat) &&
                !isNaN(userLng) &&
                !isNaN(restaurantLat) &&
                !isNaN(restaurantLng)
              ) {
                distanceInKm = calculateDistance(
                  userLat,
                  userLng,
                  restaurantLat,
                  restaurantLng,
                );
                // Format distance: show 1 decimal place if >= 1km, otherwise show in meters
                if (distanceInKm >= 1) {
                  distance = `${distanceInKm.toFixed(1)} km`;
                } else {
                  const distanceInMeters = Math.round(distanceInKm * 1000);
                  distance = `${distanceInMeters} m`;
                }
              }

              // Get first cuisine or default
              const cuisine =
                restaurant.cuisines && restaurant.cuisines.length > 0
                  ? restaurant.cuisines[0]
                  : "Multi-cuisine";

              // Legacy-safe image extraction (supports old schema variants).
              const coverImages = extractImages([
                ...(Array.isArray(restaurant.coverImages) ? restaurant.coverImages : [restaurant.coverImages]).filter(Boolean),
                restaurant.coverImage,
              ]);

              const profileImageCandidates = extractImages([
                ...buildRestaurantImageCandidates(restaurant.profileImage),
                ...buildRestaurantImageCandidates(
                  restaurant.onboarding?.step2?.profileImageUrl,
                ),
                ...buildRestaurantImageCandidates(restaurant.image),
                ...buildRestaurantImageCandidates(restaurant.imageUrl),
              ]);
              const profileImageUrl = profileImageCandidates[0] || "";

              const allImages = Array.from(
                new Set(
                  [
                    ...coverImages,
                    ...profileImageCandidates,
                  ].filter(Boolean),
                ),
              );

              // Keep single image for backward compatibility
              const image = allImages[0] || profileImageUrl || "";
              const offerText = restaurant.offer || null;

              return {
                id: restaurant.restaurantId || restaurant._id,
                mongoId: restaurant._id || null,
                name: getRestaurantDisplayName(restaurant),
                cuisine: cuisine,
                cuisines: Array.isArray(restaurant.cuisines)
                  ? restaurant.cuisines
                  : [],
                rating: Number(restaurant.rating) || 0,
                deliveryTime:
                  restaurant.deliveryTime ||
                  restaurant.estimatedDeliveryTime ||
                  (restaurant.estimatedDeliveryTimeMinutes
                    ? `${restaurant.estimatedDeliveryTimeMinutes} mins`
                    : deliveryTime),
                distance: distance,
                distanceInKm: distanceInKm, // Store numeric distance for sorting
                image: image,
                images: allImages, // Array of cover images for carousel (separate from menu images)
                priceRange: restaurant.priceRange || "$$", // Use from API or default
                featuredDish:
                  restaurant.featuredDish ||
                  (restaurant.cuisines && restaurant.cuisines.length > 0
                    ? `${restaurant.cuisines[0]} Special`
                    : "Special Dish"),
                featuredPrice: restaurant.featuredPrice || 249, // Use from API or default
                menuItems: restaurant.menu?.sections
                  ? restaurant.menu.sections.reduce((acc, section) => acc.concat(section.items || []), [])
                  : (Array.isArray(restaurant.menuItems) ? restaurant.menuItems : (Array.isArray(restaurant.topItems) ? restaurant.topItems : [])),
                popularItems: Array.isArray(restaurant.popularItems) ? restaurant.popularItems : [],
                itemDiscounts: Array.isArray(restaurant.itemDiscounts) ? restaurant.itemDiscounts : [],
                offer: offerText,
                slug: restaurant.slug,
                restaurantId: restaurant.restaurantId,
                pureVegRestaurant: restaurant.pureVegRestaurant === true,
                location: restaurant.location, // Store location for distance recalculation
                isActive: restaurant.isActive !== false, // Default to true if not specified
                isAcceptingOrders: restaurant.isAcceptingOrders !== false, // Default to true if not specified
                openDays: Array.isArray(restaurant.openDays)
                  ? restaurant.openDays
                  : [],
                deliveryTimings: restaurant.deliveryTimings || null,
                outletTimings: restaurant.outletTimings || null,
                openingTime: restaurant.openingTime || restaurant?.deliveryTimings?.openingTime || null,
                closingTime: restaurant.closingTime || restaurant?.deliveryTimings?.closingTime || null,
                zoneRank: restaurant.zoneRank || null,
                discount: restaurant.discount || 0,
                distanceText: restaurant.distanceText || null,
                distanceInfo: restaurant.distanceInfo || null,
              };
            },
            );

          const sortRestaurantsForDisplay = (restaurants) => {
            if (!userLat || !userLng) return restaurants;
            return [...restaurants].sort((a, b) => {
              // Available restaurants first, then unavailable
              const aAvailable = getRestaurantAvailabilityStatus(
                a,
                new Date(),
                { ignoreOperationalStatus: true },
              ).isOpen;
              const bAvailable = getRestaurantAvailabilityStatus(
                b,
                new Date(),
                { ignoreOperationalStatus: true },
              ).isOpen;

              if (aAvailable !== bAvailable) {
                return aAvailable ? -1 : 1; // Available restaurants come first
              }

              // Apply secondary sort based on sortBy filter
              if (filters.sortBy === "price-low") {
                return (a.featuredPrice || 0) - (b.featuredPrice || 0);
              }
              if (filters.sortBy === "price-high") {
                return (b.featuredPrice || 0) - (a.featuredPrice || 0);
              }
              if (filters.sortBy === "rating-high") {
                return (b.rating || 0) - (a.rating || 0);
              }
              if (filters.sortBy === "rating-low") {
                return (a.rating || 0) - (b.rating || 0);
              }
              if (filters.sortBy === "nearby") {
                const aDist = a.distanceInKm !== null ? a.distanceInKm : Infinity;
                const bDist = b.distanceInKm !== null ? b.distanceInKm : Infinity;
                return aDist - bDist;
              }

              // Default: sort by zoneRank first, then by distance
              const aRank = a.zoneRank !== null && a.zoneRank !== undefined ? a.zoneRank : Infinity;
              const bRank = b.zoneRank !== null && b.zoneRank !== undefined ? b.zoneRank : Infinity;

              if (aRank !== bRank) {
                return aRank - bRank;
              }

              const aDistance =
                a.distanceInKm !== null ? a.distanceInKm : Infinity;
              const bDistance =
                b.distanceInKm !== null ? b.distanceInKm : Infinity;
              return aDistance - bDistance;
            });
          };

          debugLog(
            "Transformed and sorted restaurants:",
            transformedRestaurants,
          );
          transformedRestaurants.forEach((restaurant) => {
            if (restaurant?.mongoId && restaurant?.outletTimings) {
              primeOutletTimingsCache(restaurant.mongoId, restaurant.outletTimings);
            }
          });
          startTransition(() => {
            const finalSorted = sortRestaurantsForDisplay(transformedRestaurants);
            setRestaurantsData(finalSorted);

            const isDefaultFetch = Object.keys(filters).length === 0 ||
              (!filters.sortBy && !filters.selectedCuisine && (!filters.activeFilters || filters.activeFilters.size === 0));

            if (isDefaultFetch) {
              homePageCache.restaurantsData = finalSorted;
              homePageCache.effectiveZoneId = effectiveZoneId;
              homePageCache.lat = roundCoord(effectiveLocation?.latitude);
              homePageCache.lng = roundCoord(effectiveLocation?.longitude);
            }
          });

        } else {
          debugWarn("Invalid API response structure:", response.data);
          setRestaurantsData([]);
        }
      } catch (error) {
        debugError("Error fetching restaurants:", error);
        debugError("Error details:", error.response?.data || error.message);
        // Don't set hardcoded data here - let the useMemo fallback handle it
        // This way, if API succeeds later, it will show the real data
        setRestaurantsData([]);
      } finally {
        if (requestSeq === restaurantsRequestSeqRef.current) {
          setLoadingRestaurants(false);
        }
      }
    },
    [
      extractImages,
      buildRestaurantImageCandidates,
      effectiveLocation?.latitude,
      effectiveLocation?.longitude,
      effectiveLocation?.lat,
      effectiveLocation?.lng,
      effectiveLocation?.city,
      effectiveLocation?.state,
      effectiveZoneId,
      effectiveZoneLoading,
    ],
  );

  const applyFiltersAndRefetch = useCallback(
    async (
      nextActiveFilters = activeFilters,
      nextSortBy = sortBy,
      nextSelectedCuisine = selectedCuisine,
    ) => {
      const nextFilterState = {
        activeFilters: new Set(nextActiveFilters),
        sortBy: nextSortBy,
        selectedCuisine: nextSelectedCuisine,
      };

      setAppliedFilters(nextFilterState);
      setIsLoadingFilterResults(true);

      try {
        await fetchRestaurants(nextFilterState);
      } catch (error) {
        debugError("Error applying filters:", error);
      } finally {
        setIsLoadingFilterResults(false);
      }
    },
    [activeFilters, sortBy, selectedCuisine, fetchRestaurants],
  );

  // Fetch restaurants when appliedFilters change
  useEffect(() => {
    fetchRestaurants(appliedFilters);
  }, [appliedFilters, fetchRestaurants]);

  // Recalculate distances when user location updates
  useEffect(() => {
    if (!effectiveLocation?.latitude || !effectiveLocation?.longitude) return;

    setRestaurantsData((prevData) => {
      if (!prevData || prevData.length === 0) return prevData;

      const calculateDistance = (lat1, lng1, lat2, lng2) => {
        const R = 6371; // Earth's radius in kilometers
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLng = ((lng2 - lng1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return (R * c) * 1.35; // Distance in kilometers with routing multiplier
      };

      const userLat = effectiveLocation.latitude;
      const userLng = effectiveLocation.longitude;

      let hasChanges = false;
      const updatedRestaurants = prevData.map((restaurant) => {
        if (!restaurant.location) return restaurant;

        const restaurantLat =
          restaurant.location?.latitude ||
          (restaurant.location?.coordinates &&
            Array.isArray(restaurant.location.coordinates)
            ? restaurant.location.coordinates[1]
            : null);
        const restaurantLng =
          restaurant.location?.longitude ||
          (restaurant.location?.coordinates &&
            Array.isArray(restaurant.location.coordinates)
            ? restaurant.location.coordinates[0]
            : null);

        if (
          !restaurantLat ||
          !restaurantLng ||
          isNaN(restaurantLat) ||
          isNaN(restaurantLng)
        ) {
          return restaurant;
        }

        let calculatedDistance = null;
        let distanceInKm = null;
        
        if (restaurant.distanceText) {
          calculatedDistance = restaurant.distanceText;
          distanceInKm = restaurant.distanceInfo?.distanceValue ? (restaurant.distanceInfo.distanceValue / 1000) : null;
        } else {
          distanceInKm = calculateDistance(
            userLat,
            userLng,
            restaurantLat,
            restaurantLng,
          );

          // Format distance: show 1 decimal place if >= 1km, otherwise show in meters
          if (distanceInKm >= 1) {
            calculatedDistance = `${distanceInKm.toFixed(1)} km`;
          } else {
            const distanceInMeters = Math.round(distanceInKm * 1000);
            calculatedDistance = `${distanceInMeters} m`;
          }
        }

        if (
          restaurant.distance !== calculatedDistance ||
          restaurant.distanceInKm !== distanceInKm
        ) {
          hasChanges = true;
          return {
            ...restaurant,
            distance: calculatedDistance,
            distanceInKm: distanceInKm, // Preserve numeric distance for sorting
          };
        }
        return restaurant;
      });

      if (!hasChanges) return prevData;

      // Re-sort data based on updated distances
      return [...updatedRestaurants].sort((a, b) => {
        const aAvailable = getRestaurantAvailabilityStatus(a, new Date(), { ignoreOperationalStatus: true }).isOpen;
        const bAvailable = getRestaurantAvailabilityStatus(b, new Date(), { ignoreOperationalStatus: true }).isOpen;
        if (aAvailable !== bAvailable) return aAvailable ? -1 : 1;

        if (appliedFilters.sortBy === "price-low") return (a.featuredPrice || 0) - (b.featuredPrice || 0);
        if (appliedFilters.sortBy === "price-high") return (b.featuredPrice || 0) - (a.featuredPrice || 0);
        if (appliedFilters.sortBy === "rating-high") return (b.rating || 0) - (a.rating || 0);
        if (appliedFilters.sortBy === "rating-low") return (a.rating || 0) - (b.rating || 0);
        if (appliedFilters.sortBy === "nearby") {
          const aDist = a.distanceInKm !== null ? a.distanceInKm : Infinity;
          const bDist = b.distanceInKm !== null ? b.distanceInKm : Infinity;
          return aDist - bDist;
        }

        const aRank = a.zoneRank !== null && a.zoneRank !== undefined ? a.zoneRank : Infinity;
        const bRank = b.zoneRank !== null && b.zoneRank !== undefined ? b.zoneRank : Infinity;
        if (aRank !== bRank) return aRank - bRank;

        const aDistance = a.distanceInKm !== null ? a.distanceInKm : Infinity;
        const bDistance = b.distanceInKm !== null ? b.distanceInKm : Infinity;
        return aDistance - bDistance;
      });
    });

    debugLog(
      "?? Recalculated distances for all restaurants based on user location",
    );
  }, [effectiveLocation?.latitude, effectiveLocation?.longitude]);

  // IMPORTANT:
  // Homepage should avoid eager N+1 menu requests. We only resolve menu metadata
  // when the UI truly needs it: Veg Mode is enabled, or admin categories are unavailable.
  useEffect(() => {
    const restaurantIds = menuUnionRestaurantIdsKey
      ? menuUnionRestaurantIdsKey.split(",").filter(Boolean)
      : [];
    const shouldFetchMenuMeta = realCategories.length === 0;

    const fetchMenuCategories = async () => {
      const requestSeq = ++menuUnionRequestSeqRef.current;

      if (!menuUnionRestaurantIdsKey || !shouldFetchMenuMeta) {
        setMenuCategories([]);
        setLoadingMenuCategories(false);
        return;
      }

      setLoadingMenuCategories(true);
      try {
        const categoryMap = new Map();
        const menuCache = menuUnionCacheRef.current;
        const menuResponses = [];

        for (let index = 0; index < restaurantIds.length; index += 4) {
          const batchIds = restaurantIds.slice(index, index + 4);
          const batchResponses = await Promise.all(
            batchIds.map(async (id) => {
              if (!id) return { id: null, menu: null };

              if (menuCache.has(id)) {
                return { id, menu: menuCache.get(id) };
              }

              try {
                const response = await restaurantAPI.getMenuByRestaurantId(id);
                const menu = response?.data?.data?.menu || null;
                menuCache.set(id, menu);
                return { id, menu };
              } catch {
                menuCache.set(id, null);
                return { id, menu: null };
              }
            }),
          );

          if (requestSeq !== menuUnionRequestSeqRef.current) return;
          menuResponses.push(...batchResponses);
        }

        if (requestSeq !== menuUnionRequestSeqRef.current) return;

        menuResponses.forEach(({ menu }) => {
          const sections = Array.isArray(menu?.sections) ? menu.sections : [];
          sections.forEach((section) => {
            const categoryName = String(section?.name || "").trim();
            if (!categoryName) return;

            const slug = slugifyCategory(categoryName);
            if (!slug) return;

            let image = "";
            if (Array.isArray(section?.items) && section.items.length > 0) {
              image = normalizeImageUrl(section.items[0]?.image);
            }
            if (!image && Array.isArray(section?.subsections)) {
              for (const subsection of section.subsections) {
                if (
                  Array.isArray(subsection?.items) &&
                  subsection.items.length > 0
                ) {
                  image = normalizeImageUrl(subsection.items[0]?.image);
                  if (image) break;
                }
              }
            }

            if (!categoryMap.has(slug)) {
              categoryMap.set(slug, {
                id: slug,
                name: categoryName,
                slug,
                label: categoryName,
                image: image || "",
              });
            } else if (image && !categoryMap.get(slug).image) {
              categoryMap.get(slug).image = image;
            }
          });
        });

        const categories = Array.from(categoryMap.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((category, index) => ({
            ...category,
            image:
              category.image ||
              foodImages[index % foodImages.length] ||
              foodImages[0],
          }));

        setMenuCategories(categories);
      } finally {
        if (requestSeq === menuUnionRequestSeqRef.current) {
          setLoadingMenuCategories(false);
        }
      }
    };

    fetchMenuCategories();
  }, [
    menuUnionRestaurantIdsKey,
    normalizeImageUrl,
    realCategories.length,
    slugifyCategory,
  ]);

  const matchesVegMode = useCallback(
    (restaurant) => {
      if (!vegMode) return true;
      // If "Pure Veg restaurants only" is selected, only show pure veg restaurants.
      // If "All restaurants" is selected, show all (item-level filtering happens in listing/detail pages).
      if (vegModeOption === "pure-veg") {
        return restaurant?.pureVegRestaurant === true;
      }
      return true;
    },
    [vegMode, vegModeOption],
  );

  const matchesCategory = useCallback(
    (restaurant) => {
      if (selectedCategory === "All") return true;
      const cuisines = restaurant.cuisines || [];
      if (cuisines.some(c => c.toLowerCase() === selectedCategory.toLowerCase())) return true;
      
      const allItems = [];
      if (restaurant.menuItems) allItems.push(...restaurant.menuItems);
      if (restaurant.popularItems) allItems.push(...restaurant.popularItems);
      if (restaurant.itemDiscounts) allItems.push(...restaurant.itemDiscounts);
      
      return allItems.some(item => 
        item.category && item.category.toLowerCase() === selectedCategory.toLowerCase()
      );
    },
    [selectedCategory]
  );

  // Filter restaurants and foods based on active filters
  const filteredRestaurants = useMemo(() => {
    // Rely on API data which is already filtered and sorted by the backend.
    // We only apply client-side Veg Mode and Category filtering here.
    return (restaurantsData || []).filter(matchesVegMode).filter(matchesCategory);
  }, [restaurantsData, matchesVegMode, matchesCategory]);

  const shouldShowOutOfRadiusHome =
    !effectiveZoneLoading &&
    isEffectiveLocationOutOfRadius &&
    !showRestaurantSkeleton &&
    filteredRestaurants.length === 0;

  const recommendedForYouRestaurants = useMemo(() => {
    const idsInOrder = (recommendedRestaurantIds || []).map((id) => String(id));
    const hasIds = idsInOrder.length > 0;
    const fromSettings = Array.isArray(recommendedRestaurantsFromSettings)
      ? recommendedRestaurantsFromSettings
      : [];

    // Primary source: restaurants returned by landing settings API (already admin-selected).
    const fromSettingsMapped = fromSettings.map((restaurant) => {
      const restaurantId = restaurant?._id ? String(restaurant._id) : "";
      const cuisine =
        Array.isArray(restaurant?.cuisines) && restaurant.cuisines.length > 0
          ? restaurant.cuisines[0]
          : "Multi-cuisine";
      const imageCandidates = extractImages([
        ...(Array.isArray(restaurant?.coverImages)
          ? restaurant.coverImages
          : [restaurant?.coverImages]
        ).filter(Boolean),
        restaurant?.profileImage,
      ]);
      const image = imageCandidates[0] || foodImages[0];

      return {
        id: restaurant?.restaurantId || restaurantId,
        mongoId: restaurantId,
        name: getRestaurantDisplayName(restaurant),
        cuisine,
        rating: Number(restaurant?.rating) || 0,
        distance: "",
        deliveryTime: "",
        image: normalizeImageUrl(image) || foodImages[0],
        images: imageCandidates.length > 0 ? imageCandidates : [foodImages[0]],
        slug: restaurant?.slug || restaurant?.restaurantId || restaurantId,
        offer: null,
        pureVegRestaurant: restaurant?.pureVegRestaurant === true,
        isActive: true,
        isAcceptingOrders: true,
      };
    });

    // Keep admin-selected order when IDs exist.
    const orderedFromSettings = hasIds
      ? idsInOrder
        .map((id) =>
          fromSettingsMapped.find(
            (restaurant) => String(restaurant.mongoId) === id,
          ),
        )
        .filter(Boolean)
      : fromSettingsMapped;

    // Fallback: if settings payload misses some entries, recover them from fetched restaurant list by ID.
    const existingIds = new Set(
      orderedFromSettings.map((restaurant) =>
        String(restaurant.mongoId || restaurant.id),
      ),
    );
    const fromFetchedMissing = (restaurantsData || []).filter((restaurant) => {
      const mongoId = String(restaurant.mongoId || "");
      return (
        hasIds && idsInOrder.includes(mongoId) && !existingIds.has(mongoId)
      );
    });

    return [...orderedFromSettings, ...fromFetchedMissing]
      .filter(matchesVegMode)
      .slice(0, 12);
  }, [
    recommendedRestaurantIds,
    recommendedRestaurantsFromSettings,
    restaurantsData,
    extractImages,
    normalizeImageUrl,
    matchesVegMode,
  ]);

  // Featured foods removed - will be handled by restaurants data from API
  const filteredFeaturedFoods = useMemo(() => {
    // Return empty array - featured foods will come from API if needed
    return [];
  }, [activeFilters, sortBy]);

  // Memoize callbacks to prevent unnecessary re-renders
  const handleLocationClick = useCallback(() => {
    openLocationSelector();
  }, [openLocationSelector]);

  const handleSearchFocus = useCallback(() => {
    navigate("/food/user/search");
  }, [navigate]);

  const handleVoiceSearchClick = useCallback(() => {
    navigate("/food/user/search?voice=true");
  }, [navigate]);

  const handleSearchClose = useCallback(() => {
    closeSearch();
    setHeroSearch("");
  }, [closeSearch]);

  // Removed GSAP animations - using CSS and ScrollReveal components instead for better performance
  // Auto-scroll removed - manual scroll only

  // Animated placeholder cycling - same as RestaurantDetails highlight offer animation
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 2000); // Change placeholder every 2 seconds (same as RestaurantDetails)

    return () => clearInterval(interval);
  }, []); // placeholders is a constant, no need for dependency

  const handleRestaurantFavoriteToggle = useCallback(
    (event, restaurant, restaurantSlug, favorite) => {
      event.preventDefault();
      event.stopPropagation();
      if (favorite) {
        setSelectedRestaurantSlug(restaurantSlug);
        setShowManageCollections(true);
      } else {
        addFavorite({
          slug: restaurantSlug,
          name: restaurant.name,
          cuisine: restaurant.cuisine,
          rating: restaurant.rating,
          deliveryTime: restaurant.deliveryTime,
          distance: restaurant.distance,
          priceRange: restaurant.priceRange,
          image: restaurant.image,
        });
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000);
      }
    },
    [addFavorite],
  );

  if (shouldShowOutOfZoneHome) {
    return (
      <div className="fixed inset-0 z-[100] w-full bg-[#1e1332] overflow-hidden flex flex-col justify-center">
        <img src={outOfZoneBg} alt="Out of zone background" className="absolute inset-0 w-full h-full object-cover z-0" />

        {/* Dark overlay at bottom for text readability */}
        <div className="absolute bottom-0 w-full h-[70%] bg-gradient-to-t from-[#1b152d] via-black/60 to-transparent z-10 pointer-events-none"></div>

        <div className="relative z-20 flex flex-col items-center justify-center px-6 text-center h-full pb-20">
          <h2 className="text-3xl font-black text-white mb-3 tracking-tight drop-shadow-lg">
            We are coming soon in your city
          </h2>
          <p className="text-base text-gray-200 mb-10 max-w-sm drop-shadow-md">
            Please change the location to continue ordering.
          </p>

          <Button
            onClick={() => navigate('/food/user/address-selector')}
            className="w-full max-w-[280px] bg-red-600 hover:bg-red-700 text-white font-bold h-14 rounded-2xl shadow-xl transition-transform active:scale-95 text-lg"
          >
            Change Location
          </Button>
        </div>
      </div>
    );
  }

  return (

    <div className="relative min-h-screen bg-white dark:bg-[#0a0a0a] pb-16 md:pb-6 overflow-x-clip">


      <div className="transition-all duration-300">
        {/* Unified Background for Entire Page - Vibrant Food Theme */}
        <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none overflow-hidden z-0">
          {/* Main Background */}
          <div className="absolute inset-0 bg-white dark:bg-[#0a0a0a]"></div>
          {/* Background Elements - Reduced to 2 blobs with CSS animations for better performance */}
          <div className="absolute inset-0 overflow-hidden opacity-20">
            {/* Top right blob - CSS animation */}
            <div
              style={{
                animation: "blob 8s ease-in-out infinite",
                willChange: "transform",
              }}
            />
            {/* Bottom left blob - CSS animation */}
            <div
              style={{
                animation: "blob-reverse 10s ease-in-out infinite",
                willChange: "transform",
              }}
            />
          </div>
          {/* CSS keyframes for animations */}
          <style>{`
          @keyframes blob {
            0%, 100% {
              transform: translate(0, 0) scale(1);
            }
            50% {
              transform: translate(50px, -30px) scale(1.2);
            }
          }
          @keyframes blob-reverse {
            0%, 100% {
              transform: translate(0, 0) scale(1);
            }
            50% {
              transform: translate(-40px, 40px) scale(1.3);
            }
          }
          @keyframes fade-in {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes gradient {
            0%, 100% {
              background-position: 0% 50%;
            }
            50% {
              background-position: 100% 50%;
            }
          }
          @keyframes fade-in-up {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes wiggle {
            0%, 100% {
              transform: rotate(0deg);
            }
            25% {
              transform: rotate(10deg);
            }
            75% {
              transform: rotate(-10deg);
            }
          }
          @keyframes placeholderFade {
            0% {
              opacity: 0;
              transform: translateY(20px);
            }
            100% {
              opacity: 0.6;
              transform: translateY(0);
            }
          }
          @keyframes gradientShift {
            0%, 100% {
              background-position: 0% 50%;
            }
            50% {
              background-position: 100% 50%;
            }
          }
          @keyframes slideUp {
            0% {
              opacity: 0;
              transform: translateY(15px);
            }
            100% {
              opacity: 1;
              transform: translateY(0);
            }
          }
            .red-header-bg {
              background-color: #ef4f5f;
              background-image: linear-gradient(180deg, #ef4f5f 0%, #e03546 100%);
            }
            @keyframes gradient-shift {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
            .animate-gradient-shift {
              animation: gradient-shift 3s ease infinite;
            }
          `}</style>
        </div>

        <div className="relative overflow-x-clip bg-white dark:bg-[#0a0a0a]">
          {/* Brand Top Section (Dark) */}
          {/* Decoupled Dark Background - Dynamic height based on actual components to prevent clipping sticky elements while covering properly */}
          <div 
             className="absolute top-0 left-0 right-0 overflow-hidden bg-gradient-to-b from-[#3a142c] to-[#1a0a14] shadow-lg pointer-events-none z-0 transition-all duration-300 [transform:translateZ(0)] [mask-image:-webkit-radial-gradient(white,black)]"
             style={{ height: festVideoActive ? '360px' : (headerBgHeight > 0 ? `${headerBgHeight}px` : (activeTab === 'food' ? '300px' : '140px')) }}
          >
            {festVideoActive && (
              <div className="absolute inset-0 z-0 overflow-hidden bg-slate-900 pointer-events-auto">
                {festBannerImages.map((image, index) => {
                  const mediaUrl = image?.startsWith('/') ? `${BACKEND_ORIGIN}${image}` : image;
                  const isVideo = typeof mediaUrl === 'string' && (mediaUrl.toLowerCase().endsWith('.mp4') || mediaUrl.toLowerCase().endsWith('.webm') || mediaUrl.toLowerCase().endsWith('.ogg'));
                  return isVideo ? (
                    <video
                      key={`hero-bg-${index}-${mediaUrl}`}
                      src={mediaUrl}
                      className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ease-in-out"
                      style={{
                        opacity: bgIndex === index ? 1 : 0,
                        zIndex: bgIndex === index ? 2 : 1,
                      }}
                      autoPlay
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      key={`hero-bg-${index}-${mediaUrl}`}
                      src={mediaUrl}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ease-in-out"
                      style={{
                        opacity: bgIndex === index ? 1 : 0,
                        zIndex: bgIndex === index ? 2 : 1,
                      }}
                      loading={index === 0 ? "eager" : "lazy"}
                      draggable={false}
                    />
                  );
                })}
                <div className="absolute inset-0 bg-black/20 z-[3]" />
              </div>
            )}
          </div>

          {/* Unified Scroll Container so Sticky Search Bar works for the whole page */}
          <div className="relative z-10 w-full mb-2">
            <HomeHeader
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              location={effectiveLocation}
              handleLocationClick={handleLocationClick}
              handleSearchFocus={handleSearchFocus}
              placeholderIndex={placeholderIndex}
              placeholders={placeholders}
              vegMode={vegMode}
              handleVegModeChange={handleVegModeChange}
              isCategoryStuck={isCategoryStuck}
              handleVoiceSearchClick={handleVoiceSearchClick}
            />

            {activeTab === "food" && (
              <div id="fest-banner-wrapper" className="w-full">
                {festVideoActive ? (
                  <div className="w-full h-[235px] sm:h-[245px]" />
                ) : (
                  <div className="pb-4 sm:pb-6">
                    <FestBanner
                      isVegMode={vegMode}
                      images={[]}
                      hideFoodImages={false}
                    />
                  </div>
                )}
              </div>
            )}
            
            <div className="h-3 w-full" />

          <AnimatePresence mode="wait">
            {activeTab === "food" ? (
              <motion.div
                key="food-content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="bg-transparent dark:bg-transparent"
              >

                {/* "What's on your mind today?" Section - Now with Sticky Logic */}
                <div ref={categoryAnchorRef} className="h-0 w-full" />
                <div
                  id="categories-section"
                  className={`sticky top-[60px] z-[50] w-full transition-all duration-300 ${isCategoryStuck ? "bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur-2xl shadow-[0_4px_30px_rgba(0,0,0,0.05)] pb-2 pt-2 border-b border-white/50 dark:border-white/10 px-4" : "bg-transparent px-4 py-2.5"} space-y-3`}
                >
                  <div className={`flex items-center gap-2 min-w-0 ${isCategoryStuck ? 'hidden' : ''}`}>
                    <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white min-w-0 flex-shrink leading-tight">What's on your mind today?</h2>
                    <div className="h-[1px] bg-gray-100 dark:bg-gray-800 flex-1"></div>
                    <Link to="/food/user/under-250" className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-0.5 whitespace-nowrap shrink-0 hover:text-gray-900 dark:hover:text-white transition-colors">
                      View All <ArrowDownUp className="h-3 w-3 rotate-90" />
                    </Link>
                  </div>

                  {/* Categories Horizontal Slider */}
                  <div className="flex overflow-x-auto gap-1.5 pb-2 scrollbar-hide -mx-4 px-4 mask-edge-fade">
                    {[
                      {
                        id: "all",
                        name: "All",
                        slug: "all",
                        image: foodImages[0]
                      },
                      ...displayCategories
                    ].map((category, index) => {
                      const isActive = selectedCategory === category.name;
                      return (
                      <Link
                        key={category.id || index}
                        to={category.slug === 'all' ? '/food/user/under-250' : `/food/user/category/${category.slug || category.name.toLowerCase().replace(/\s+/g, "-")}`}
                        onClick={() => setSelectedCategory(category.name)}
                        className={`flex-shrink-0 flex flex-col items-center gap-1.5 group w-[76px] transition-transform ${isActive ? 'scale-105' : ''}`}
                      >
                        <div className={`relative w-[68px] h-[68px] sm:w-[84px] sm:h-[84px] rounded-full overflow-hidden shadow-md border-2 ${isActive ? 'border-primary ring-2 ring-primary/30' : 'border-gray-100 dark:border-gray-800'} bg-white dark:bg-[#1a1a1a] group-active:scale-95 transition-all duration-300`}>
                          {/* Shining Glint Effect */}
                          <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
                            <motion.div
                              animate={{
                                x: ['-200%', '200%'],
                              }}
                              transition={{
                                duration: 2,
                                repeat: Infinity,
                                repeatDelay: 3 + index * 0.5,
                                ease: "easeInOut"
                              }}
                              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-[-20deg] w-[150%] h-full"
                            />
                          </div>

                          <OptimizedImage
                            src={category.image}
                            alt={category.name}
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                          />
                        </div>
                        <span className={`text-[11px] font-extrabold text-center leading-tight line-clamp-1 w-full px-0.5 ${isActive ? 'text-primary' : 'text-gray-900 dark:text-gray-100'}`}>
                          {category.name}
                        </span>
                      </Link>
                    )})}
                  </div>
                </div>

                {/* Removed Dynamic Sticky Header (Search + Slider + Filters) */}

                {/* Admin Hero Banners Section - Now below categories */}
                <HeroBanner
                  images={heroBannerImages}
                  bannersData={heroBannersData}
                  loading={showBannerSkeleton}
                  shellRef={heroShellRef}
                />


                {/* Filters Sticky Sidebar Header */}
                <section className="bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur-md sticky top-0 z-[40] -mx-4 w-[calc(100%+2rem)] border-b border-gray-100 dark:border-white/5 shadow-sm transition-colors duration-300">
                  <div
                    className="flex items-center gap-2 overflow-x-auto scrollbar-hide px-4 py-2.5"
                    style={{
                      scrollbarWidth: "none",
                      msOverflowStyle: "none",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setIsFilterOpen(true)}
                      className="h-9 px-4 rounded-full flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 font-bold transition-all bg-white dark:bg-[#1a1a1a] border border-gray-200 shadow-sm active:scale-95"
                    >
                      <SlidersHorizontal className="h-4 w-4 text-black" />
                      <span className="text-xs font-bold text-black dark:text-white uppercase tracking-tight">
                        Filters
                      </span>
                    </button>

                    {[
                      { id: "delivery-under-30", label: "Under 30 mins" },
                      { id: "delivery-under-45", label: "Under 45 mins" },
                      { id: "distance-under-1km", label: "Under 1km", icon: MapPin },
                      { id: "distance-under-2km", label: "Under 2km", icon: MapPin },
                    ].map((filter) => {
                      const Icon = filter.icon;
                      const isActive = activeFilters.has(filter.id);
                      return (
                        <button
                          key={filter.id}
                          type="button"
                          onClick={() => {
                            const nextFilters = new Set(activeFilters);
                            if (nextFilters.has(filter.id)) {
                              nextFilters.delete(filter.id);
                            } else {
                              nextFilters.add(filter.id);
                            }
                            setActiveFilters(nextFilters);
                            void applyFiltersAndRefetch(
                              nextFilters,
                              sortBy,
                              selectedCuisine,
                            );
                          }}
                          className={`h-9 px-4 rounded-full flex items-center gap-2 whitespace-nowrap flex-shrink-0 transition-all font-bold shadow-sm active:scale-95 ${isActive
                            ? "bg-primary text-white border border-primary hover:bg-orange-700"
                            : "bg-white dark:bg-[#1a1a1a] border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                            }`}
                        >
                          {Icon && (
                            <Icon
                              className={`h-3.5 w-3.5 ${isActive ? "fill-white" : ""}`}
                            />
                          )}
                          <span className="text-xs font-bold tracking-tight">
                            {filter.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>



        {recommendedForYouRestaurants.length > 0 && (
          <motion.section
            className="content-auto pt-1 sm:pt-2"
            initial={false}
            animate={{ opacity: 1, y: 0 }}>
            <h2 className="text-xs sm:text-sm lg:text-base font-semibold text-gray-400 dark:text-gray-500 tracking-widest uppercase mb-2 sm:mb-3 px-4">
              Recommended For You
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 px-4">
              {recommendedForYouRestaurants.map((restaurant, index) => {
                const restaurantSlug =
                  restaurant.slug ||
                  restaurant.name.toLowerCase().replace(/\s+/g, "-");
                return (
                  <div
                    key={`recommended-${restaurant.mongoId || restaurant.id || restaurantSlug}`}
                    className="transform transition-all duration-300 hover:-translate-y-1"
                    style={
                      index < 6
                        ? {
                            animation: `fade-in-up 0.35s ease-out ${index * 0.05}s backwards`,
                          }
                        : undefined
                    }
                  >
                    <Link
                      to={`/user/restaurants/${restaurantSlug}`}
                      className="block rounded-[20px] overflow-hidden border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] shadow-sm hover:shadow-md transition-shadow">
                      <div className="relative h-24 sm:h-28 md:h-32 bg-gray-50">
                        <RestaurantImageCarousel
                          restaurant={restaurant}
                          backendOrigin={BACKEND_ORIGIN}
                          className="h-24 sm:h-28 md:h-32"
                          roundedClass="rounded-t-[20px]"
                        />
                        <div className={`absolute bottom-2 left-2 px-2 py-0.5 rounded-lg ${Number(restaurant.rating) > 0 ? "bg-black/80 backdrop-blur-md text-white font-medium" : "bg-gray-200/90 text-gray-600 font-medium"} text-[10px] shadow-lg border border-white/10`}>
                          {Number(restaurant.rating) > 0 ? Number(restaurant.rating).toFixed(1) : "NEW"}
                        </div>
                      </div>
                      <div className="p-2.5">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate tracking-tight">
                          {restaurant.name}
                        </p>
                        <p className="text-[10px] text-primary font-bold mt-1 flex items-center gap-1 uppercase tracking-wider">
                          <Flame className="w-3.5 h-3.5 fill-primary" />
                          Near & Fast
                        </p>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          </motion.section>
        )}

        {/* Ads Banner Section Removed as requested */}

        <ExploreMoreSection
          heading={exploreMoreHeading}
          items={finalExploreItems}
          showSkeleton={showExploreSkeleton}
        />

        {/* Featured Foods - Horizontal Scroll */}

        {/* Restaurants - Enhanced with Animations */}
        <section
          className="content-auto space-y-0 pt-3 sm:pt-4 lg:pt-6 pb-8 md:pb-10"
        >
          {!shouldShowOutOfZoneHome && (
            <>
              {/* Premium Restaurants Horizontal Scroll */}
              {filteredRestaurants.filter(r => (r.rating || 0) >= 4.5).length > 0 && (
                <div className="mb-6 lg:mb-8">
                  <div className="px-4 mb-3">
                    <h2 className="text-lg sm:text-xl lg:text-2xl font-black text-gray-900 dark:text-white tracking-tight">
                      Gourmet Restaurants
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium">Premium spots just for you</p>
                  </div>
                  <div className="flex overflow-x-auto gap-4 px-4 pb-4 scrollbar-hide snap-x snap-mandatory">
                    {filteredRestaurants
                      .filter(r => (r.rating || 0) >= 4.5)
                      .map((restaurant) => {
                        const restaurantSlug = restaurant.slug || restaurant.name.toLowerCase().replace(/\s+/g, "-");
                        return (
                          <div key={restaurant.mongoId || restaurant.id} className="min-w-[240px] max-w-[240px] sm:min-w-[280px] sm:max-w-[280px] snap-start flex-shrink-0">
                            <Link
                              to={`/user/restaurants/${restaurantSlug}`}
                              className="block rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] shadow-sm hover:shadow-md transition-all active:scale-95"
                            >
                              <div className="relative h-32 sm:h-36 bg-gray-50 dark:bg-gray-900">
                                <RestaurantImageCarousel
                                  restaurant={restaurant}
                                  backendOrigin={BACKEND_ORIGIN}
                                  className="h-32 sm:h-36"
                                  roundedClass="rounded-t-2xl"
                                />
                                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-white font-bold text-xs shadow-lg border border-white/10 flex items-center gap-1">
                                  <Star className="w-3 h-3 fill-primary text-primary" />
                                  {Number(restaurant.rating).toFixed(1)}
                                </div>
                              </div>
                              <div className="p-3">
                                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
                                  {restaurant.name}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
                                  {Array.isArray(restaurant.cuisines) ? restaurant.cuisines.join(", ") : "Various Cuisines"}
                                </p>
                              </div>
                            </Link>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              <div className="px-4 mb-3 lg:mb-4">
                <div className="flex flex-col gap-0.5 lg:gap-1">
                  <h2 className="text-xs sm:text-sm lg:text-base font-semibold text-gray-400 tracking-widest uppercase">
                    {filteredRestaurants.length} Restaurants Delivering to You
                  </h2>
                  <span className="text-base sm:text-lg lg:text-2xl text-gray-900 dark:text-white font-bold tracking-tight">
                    All Restaurants
                  </span>
                </div>
              </div>
            </>
          )}
          {shouldShowOutOfZoneHome || shouldShowOutOfRadiusHome ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center min-h-[480px] overflow-visible">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="flex flex-col items-center max-w-sm mx-auto relative"
              >
                <div className="relative mb-14">
                  {/* Multi-layered Glow System */}
                  <motion.div
                    animate={{
                      scale: [1, 1.4, 1],
                      opacity: [0.15, 0.35, 0.15],
                    }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 bg-primary rounded-full blur-[70px]"
                  />
                  <motion.div
                    animate={{
                      scale: [1.3, 1, 1.3],
                      opacity: [0.1, 0.25, 0.1],
                    }}
                    transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                    className="absolute inset-0 bg-rose-400 rounded-full blur-[50px]"
                  />

                  {/* Floating Decorative Icons */}
                  <motion.div
                    animate={{ y: [0, -15, 0], rotate: [0, 15, 0], scale: [1, 1.1, 1] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute -top-10 -left-10 text-orange-400/40"
                  >
                    <Pizza className="w-12 h-12" strokeWidth={1} />
                  </motion.div>
                  <motion.div
                    animate={{ y: [0, 15, 0], rotate: [0, -20, 0], scale: [1, 1.05, 1] }}
                    transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                    className="absolute -bottom-6 -right-12 text-rose-400/40"
                  >
                    <UtensilsCrossed className="w-10 h-10" strokeWidth={1} />
                  </motion.div>
                  <motion.div
                    animate={{ x: [0, 12, 0], y: [0, -10, 0] }}
                    transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
                    className="absolute top-4 -right-14 text-amber-400/30"
                  >
                    <Flame className="w-8 h-8" strokeWidth={1} />
                  </motion.div>

                  <motion.div
                    animate={{ y: [0, -25, 0] }}
                    transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
                    className="relative z-10 w-44 h-44 bg-white/80 dark:bg-[#1a1a1a]/80 backdrop-blur-sm rounded-[3rem] shadow-[0_20px_50px_rgba(126,56,102,0.3)] flex items-center justify-center border border-white/50 dark:border-white/10 overflow-hidden"
                  >
                    <img
                      src={chefMascot}
                      alt="Chef Mascot"
                      className="w-full h-full object-contain p-2 transform scale-115 drop-shadow-2xl"
                    />
                  </motion.div>

                  {/* Animated Particles with varied colors */}
                  {[...Array(5)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{
                        y: [0, -120],
                        x: [0, (i - 2) * 40],
                        opacity: [0, 0.6, 0],
                        scale: [0, 1, 0]
                      }}
                      transition={{
                        duration: 3 + i * 0.2,
                        repeat: Infinity,
                        delay: i * 0.6,
                        ease: "easeOut"
                      }}
                      className={`absolute top-1/2 left-1/2 w-${2 + (i % 2)} h-${2 + (i % 2)} ${i % 2 === 0 ? 'bg-primary/40' : 'bg-rose-400/40'} rounded-full`}
                    />
                  ))}
                </div>

                <h3 className="text-3xl sm:text-4xl font-black mb-4 tracking-tight leading-tight bg-gradient-to-r from-primary via-rose-500 to-primary bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient-shift">
                  {shouldShowOutOfZoneHome ? "Coming Soon!" : "Service Unavailable"}
                </h3>
                <p className="text-base sm:text-lg font-medium text-gray-500 dark:text-gray-400 leading-relaxed px-4 max-w-xs">
                  {effectiveServiceUnavailableMessage || "Service is currently unavailable."} Please try another delivery location.
                </p>

                <div className="mt-12 flex items-center gap-3">
                  <motion.div
                    animate={{ width: [8, 40, 8], opacity: [0.2, 0.5, 0.2] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                    className="h-1.5 bg-primary rounded-full"
                  />
                  <motion.div
                    animate={{ width: [40, 8, 40], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                    className="h-1.5 bg-primary rounded-full"
                  />
                  <motion.div
                    animate={{ width: [8, 40, 8], opacity: [0.2, 0.5, 0.2] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                    className="h-1.5 bg-primary rounded-full"
                  />
                </div>
              </motion.div>
            </div>
          ) : (
            <RestaurantGrid
              restaurants={filteredRestaurants}
              backendOrigin={BACKEND_ORIGIN}
              isOutOfService={isEffectiveLocationOutOfService}
              showSkeleton={showRestaurantSkeleton}
              isLoading={isLoadingFilterResults || loadingRestaurants}
              isFavorite={isFavorite}
              onToggleFavorite={handleRestaurantFavoriteToggle}
            />
          )}
        </section>
              </motion.div>
            ) : (
              <motion.div
                key="quick-content"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
              >
                <QuickSection />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Filter Modal - Bottom Sheet */}
      <AnimatePresence>
        {isFilterOpen && (
          <div className="fixed inset-0 z-[100]">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/50"
              onClick={() => setIsFilterOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />

            {/* Modal Content */}
            <motion.div
              className="absolute bottom-0 left-0 right-0 bg-white dark:bg-[#1a1a1a] rounded-t-3xl max-h-[85vh] flex flex-col"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{
                type: "spring",
                damping: 30,
                stiffness: 400,
                duration: 0.3,
              }}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-4 border-b dark:border-gray-800">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  Filters and sorting
                </h2>
                <button
                  onClick={() => {
                    setActiveFilters(new Set());
                    setSortBy(null);
                    setSelectedCuisine(null);
                  }}
                  className="text-primary font-medium text-sm">
                  Clear all
                </button>
              </div>

              {/* Body */}
              <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar - Tabs */}
                <div className="w-24 sm:w-28 bg-gray-50 dark:bg-[#0a0a0a] border-r dark:border-gray-800 flex flex-col">
                  {[
                    { id: "sort", label: "Sort By", icon: ArrowDownUp },
                    { id: "time", label: "Time", icon: Timer },
                    { id: "rating", label: "Rating", icon: Star },
                    { id: "distance", label: "Distance", icon: MapPin },
                    { id: "price", label: "Dish Price", icon: IndianRupee },
                    { id: "offers", label: "Offers", icon: BadgePercent },
                    { id: "trust", label: "Trust", icon: ShieldCheck },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive =
                      activeScrollSection === tab.id ||
                      activeFilterTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveFilterTab(tab.id);
                          const section = filterSectionRefs.current[tab.id];
                          if (section) {
                            section.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }
                        }}
                        className={`flex flex-col items-center gap-1 py-4 px-2 text-center relative transition-colors ${isActive
                          ? "bg-white dark:bg-[#1a1a1a] text-primary"
                          : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                          }`}>
                        {isActive && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r" />
                        )}
                        <Icon className="h-5 w-5" strokeWidth={1.5} />
                        <span className="text-xs font-medium leading-tight">
                          {tab.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Right Content Area - Scrollable */}
                <div
                  ref={rightContentRef}
                  className="flex-1 overflow-y-auto p-4">
                  {/* Sort By Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["sort"] = el)}
                    data-section-id="sort"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Sort by
                    </h3>
                    <div className="flex flex-col gap-3">
                      {[
                        { id: null, label: "Relevance" },
                        { id: "nearby", label: "Nearby" },
                        { id: "price-low", label: "Price: Low to High" },
                        { id: "price-high", label: "Price: High to Low" },
                        { id: "rating-high", label: "Rating: High to Low" },
                        { id: "rating-low", label: "Rating: Low to High" },
                      ].map((option) => (
                        <button
                          key={option.id || "relevance"}
                          onClick={() => setSortBy(option.id)}
                          className={`px-4 py-3 rounded-xl border text-left transition-colors ${sortBy === option.id
                            ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-primary"
                            }`}>
                          <span
                            className={`text-sm font-medium ${sortBy === option.id ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                            {option.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Time Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["time"] = el)}
                    data-section-id="time"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Estimated Time
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("delivery-under-30")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("delivery-under-30")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <Timer
                          className={`h-6 w-6 ${activeFilters.has("delivery-under-30") ? "text-primary" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("delivery-under-30") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 30 mins
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("delivery-under-45")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("delivery-under-45")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <Timer
                          className={`h-6 w-6 ${activeFilters.has("delivery-under-45") ? "text-primary" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("delivery-under-45") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 45 mins
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Rating Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["rating"] = el)}
                    data-section-id="rating"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900  dark:text-white mb-4">
                      Restaurant Rating
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("rating-35-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-35-plus")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-35-plus") ? "text-primary fill-primary" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-35-plus") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 3.5+
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("rating-4-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-4-plus")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-4-plus") ? "text-primary fill-primary" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-4-plus") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 4.0+
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("rating-45-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-45-plus")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-45-plus") ? "text-primary fill-primary" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-45-plus") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 4.5+
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Distance Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["distance"] = el)}
                    data-section-id="distance"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Distance
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("distance-under-1km")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("distance-under-1km")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <MapPin
                          className={`h-6 w-6 ${activeFilters.has("distance-under-1km") ? "text-primary" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("distance-under-1km") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 1 km
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("distance-under-2km")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("distance-under-2km")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <MapPin
                          className={`h-6 w-6 ${activeFilters.has("distance-under-2km") ? "text-primary" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("distance-under-2km") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 2 km
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Price Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["price"] = el)}
                    data-section-id="price"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Dish Price
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("price-under-200")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("price-under-200")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("price-under-200") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Under â‚¹200
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("price-under-500")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("price-under-500")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("price-under-500") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Under â‚¹500
                        </span>
                      </button>
                    </div>
                  </div>



                  {/* Trust Markers Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["trust"] = el)}
                    data-section-id="trust"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Trust Markers
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("top-rated")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("top-rated")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("top-rated") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Top Rated
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("trusted")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("trusted")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("trusted") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Trusted by 1000+ users
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Offers Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["offers"] = el)}
                    data-section-id="offers"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Offers
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("has-offers")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("has-offers")
                          ? "border-primary bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-primary"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("has-offers") ? "text-primary" : "text-gray-700 dark:text-gray-300"}`}>
                          Restaurants with offers
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-4 px-4 py-4 border-t dark:border-gray-800 bg-white dark:bg-[#1a1a1a]">
                <button
                  onClick={() => setIsFilterOpen(false)}
                  className="flex-1 py-3 text-center font-semibold text-gray-700 dark:text-gray-300">
                  Close
                </button>
                <button
                  onClick={async () => {
                    setIsFilterOpen(false);
                    await applyFiltersAndRefetch(
                      activeFilters,
                      sortBy,
                      selectedCuisine,
                    );
                  }}
                  className={`flex-1 py-3 font-semibold rounded-xl transition-colors ${activeFilters.size > 0 || sortBy || selectedCuisine
                    ? "bg-primary text-white hover:bg-secondary"
                    : "bg-gray-200 text-gray-500"
                    }`}
                  disabled={isLoadingFilterResults}>
                  {isLoadingFilterResults
                    ? "Loading..."
                    : activeFilters.size > 0 || sortBy || selectedCuisine
                      ? `Show results`
                      : "Show results"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Veg Mode Popup */}
      <AnimatePresence>
        {showVegModePopup && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => {
                setShowVegModePopup(false);
                // Revert veg mode to OFF if popup is closed without applying
                setVegModeContext(false);
                setPrevVegMode(false);
              }}
              className="fixed inset-0 bg-black/30 z-[9998] backdrop-blur-sm"
            />

            {/* Popup */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{
                type: "spring",
                damping: 25,
                stiffness: 300,
                mass: 0.8,
              }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl p-6 w-[calc(100%-2rem)] max-w-xs"
              onClick={(e) => e.stopPropagation()}>

              {/* Title */}
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-3">
                See veg dishes from
              </h3>

              {/* Radio Options */}
              <div className="space-y-2 mb-4">
                {/* All restaurants */}
                <label
                  className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  onClick={() => setVegModeOption("all")}>
                  <div className="relative flex items-center justify-center">
                    <input
                      type="radio"
                      name="vegModeOption"
                      value="all"
                      checked={vegModeOption === "all"}
                      onChange={() => setVegModeOption("all")}
                      className="sr-only"
                    />
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${vegModeOption === "all"
                        ? "border-green-600 dark:border-green-500 bg-green-600 dark:bg-green-500"
                        : "border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a2a]"
                        }`}>
                      {vegModeOption === "all" && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-white" />
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    All restaurants
                  </span>
                </label>

                {/* Pure Veg restaurants only */}
                <label
                  className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  onClick={() => setVegModeOption("pure-veg")}>
                  <div className="relative flex items-center justify-center">
                    <input
                      type="radio"
                      name="vegModeOption"
                      value="pure-veg"
                      checked={vegModeOption === "pure-veg"}
                      onChange={() => setVegModeOption("pure-veg")}
                      className="sr-only"
                    />
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${vegModeOption === "pure-veg"
                        ? "border-green-600 dark:border-green-500 bg-green-600 dark:bg-green-500"
                        : "border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a2a]"
                        }`}>
                      {vegModeOption === "pure-veg" && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-white" />
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    Pure Veg restaurants only
                  </span>
                </label>
              </div>

              {/* Apply Button */}
              <button
                onClick={() => {
                  setShowVegModePopup(false);
                  setIsApplyingVegMode(true);
                  // Confirm veg mode is ON by updating context and prevVegMode
                  setVegModeContext(true);
                  setPrevVegMode(true);
                  // Simulate applying veg mode settings
                  setTimeout(() => {
                    setIsApplyingVegMode(false);
                  }, 2000);
                }}
                className="w-full bg-primary text-white font-semibold py-2.5 rounded-xl hover:bg-secondary transition-colors mb-2 text-sm">
                Apply
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Switch Off Veg Mode Popup */}
      <AnimatePresence>
        {showSwitchOffPopup && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => {
                setShowSwitchOffPopup(false);
                isHandlingSwitchOff.current = false;
                setVegModeContext(true);
                // prevVegMode stays true (from before), which is correct
              }}
              className="fixed inset-0 bg-black/50 z-[9998] backdrop-blur-sm"
            />

            {/* Popup */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{
                type: "spring",
                damping: 25,
                stiffness: 300,
                mass: 0.8,
              }}
              className="fixed inset-0 z-[9999] flex dark:bg-[#lalala] dark:text-white items-center justify-center p-4"
              onClick={(e) => e.stopPropagation()}>
              <div className="bg-white dark:bg-[#lalala] dark:text-white rounded-2xl shadow-2xl w-[85%] max-w-sm p-6">
                {/* Warning Icon */}
                <div className="flex justify-center mb-4">
                  <div className="w-20 h-20 rounded-full bg-pink-100 flex items-center justify-center">
                    <AlertCircle
                      className="w-20 h-20 text-white bg-red-500/90 rounded-full p-2"
                      strokeWidth={2.5}
                    />
                  </div>
                </div>

                {/* Title */}
                <h2 className="text-2xl font-bold text-gray-900  text-center mb-2">
                  Switch off Veg Mode?
                </h2>

                {/* Description */}
                <p className="text-gray-600 text-center mb-6 text-sm">
                  You'll see all restaurants, including those serving non-veg
                  dishes
                </p>

                {/* Buttons */}
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      setShowSwitchOffPopup(false);
                      setIsSwitchingOffVegMode(true);
                      // Simulate switching off veg mode
                      setTimeout(() => {
                        setIsSwitchingOffVegMode(false);
                        isHandlingSwitchOff.current = false;
                        setVegModeContext(false);
                        setPrevVegMode(false); // Set to false to match current state (veg mode is OFF)
                      }, 2000);
                    }}
                    className="w-full bg-transparent text-red-600 font-normal py-1 text-normal rounded-xl hover:bg-red-50 transition-colors text-base">
                    Switch off
                  </button>

                  <button
                    onClick={() => {
                      setShowSwitchOffPopup(false);
                      isHandlingSwitchOff.current = false;
                      setVegModeContext(true);
                      // prevVegMode stays true (from before), which is correct
                    }}
                    className="w-full text-gray-900 font-normal py-1 text-center rounded-xl hover:bg-gray-200 transition-colors text-base">
                    Keep using this mode
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* All Categories Modal */}
      <AnimatePresence>
        {showAllCategoriesModal && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowAllCategoriesModal(false)}
              className="fixed inset-0 bg-black/40 z-[9998] backdrop-blur-sm"
            />

            {/* Modal - Full screen with rounded corners */}
            <motion.div
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{
                type: "spring",
                damping: 30,
                stiffness: 300,
              }}
              className="fixed inset-x-0 bottom-0 top-12 sm:top-16 md:top-20 z-[9999] bg-white dark:bg-[#1a1a1a] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 sm:px-6 sm:py-5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
                  All Categories
                </h2>
                <button
                  onClick={() => setShowAllCategoriesModal(false)}
                  className="p-1.5 sm:p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  aria-label="Close">
                  <X className="w-5 h-5 sm:w-6 sm:h-6 text-gray-600 dark:text-gray-400" />
                </button>
              </div>

              {/* Categories Grid - Scrollable */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 sm:py-5">
                <div className="grid grid-cols-3 gap-4 sm:gap-5 md:gap-6">
                  {displayCategories.map((category, index) => {
                    const categoryData = {
                      name: category.name || category.label,
                      image: category.image || category.imageUrl,
                      slug: category.slug,
                    };
                    return (
                      <motion.div
                        key={category.id || index}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                          duration: 0.3,
                          delay: index * 0.02,
                          type: "spring",
                          stiffness: 100,
                        }}
                        whileTap={{ scale: 0.95 }}>
                        <Link
                          to={`/food/user/category/${categoryData.slug || categoryData.name.toLowerCase().replace(/\s+/g, "-")}`}
                          onClick={() => setShowAllCategoriesModal(false)}
                          className="block">
                          <div className="flex flex-col items-center gap-2 sm:gap-2.5 cursor-pointer w-full">
                            <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-full overflow-hidden shadow-md transition-all hover:shadow-lg flex-shrink-0">
                              <OptimizedImage
                                src={categoryData.image}
                                alt={categoryData.name}
                                className="w-full h-full bg-white rounded-full"
                                sizes="(max-width: 640px) 80px, (max-width: 768px) 96px, 112px"
                                objectFit="cover"
                                placeholder="blur"
                                onError={() => { }}
                              />
                            </div>
                            <span className="text-xs sm:text-sm font-medium text-gray-800 dark:text-gray-200 text-center leading-tight px-1 break-words w-full min-w-0">
                              {categoryData.name}
                            </span>
                          </div>
                        </Link>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isApplyingVegMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[10000] bg-white dark:bg-[#0a0a0a] flex items-center justify-center">
            <div className="relative w-32 h-32 flex items-center justify-center w-full">
              {/* Animated circles - positioned absolutely at the center */}
              {[...Array(8)].map((_, i) => {
                const baseSize = 112;
                const maxSize = 600;
                return (
                  <motion.div
                    key={i}
                    initial={{
                      scale: 1,
                      opacity: 0,
                    }}
                    animate={{
                      scale: maxSize / baseSize,
                      opacity: [0, 0.4, 0.2, 0],
                    }}
                    transition={{
                      duration: 2.5,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeOut",
                      delay: i * 0.15,
                    }}
                    className="absolute rounded-full border border-green-300 dark:border-green-600"
                    style={{
                      width: baseSize,
                      height: baseSize,
                    }}
                  />
                );
              })}

              {/* 100% VEG badge - absolute positioning at exact center */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.1,
                }}
                className="absolute z-10 w-28 h-28 rounded-full border-2 border-green-600 dark:border-green-500 bg-white dark:bg-[#1a1a1a] flex flex-col items-center justify-center shadow-sm"
              >
                <motion.div
                  className="flex flex-col items-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}>
                  <span className="text-green-600 dark:text-green-400 font-extrabold text-3xl leading-none">
                    100%
                  </span>
                  <span className="text-green-600 dark:text-green-400 font-extrabold text-3xl leading-none mt-0.5">
                    VEG
                  </span>
                </motion.div>
              </motion.div>

              {/* Text below badge */}
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-xl font-normal text-gray-800 dark:text-gray-200 text-center relative z-10 mt-56 w-full">
                Explore veg dishes from all restaurants
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Screen - Switching Off Veg Mode */}
      <AnimatePresence>
        {isSwitchingOffVegMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[10000] bg-white dark:bg-[#0a0a0a] flex items-center justify-center">
            <div className="flex flex-col items-center gap-6">
              {/* Two Circles Spinning in Opposite Directions */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.1,
                }}
                className="relative w-16 h-16 flex items-center justify-center">
                {/* Outer Circle - Spins Clockwise */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{
                    rotate: {
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "linear",
                    },
                  }}
                  className="absolute w-16 h-16 border-[4px] border-transparent border-t-pink-500 dark:border-t-pink-400 border-r-pink-500 dark:border-r-pink-400 rounded-full"
                />

                {/* Inner Circle - Spins Counter-clockwise */}
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{
                    rotate: {
                      duration: 1,
                      repeat: Infinity,
                      ease: "linear",
                    },
                  }}
                  className="absolute w-12 h-12 border-[4px] border-transparent border-r-pink-500 dark:border-r-pink-400 rounded-full"
                />
              </motion.div>

              {/* Loading Text */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-center">
                <motion.h2
                  className="text-xl font-normal text-gray-800 dark:text-gray-200 mb-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}>
                  Switching off
                </motion.h2>
                <motion.p
                  className="text-xl font-normal text-gray-800 dark:text-gray-200"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}>
                  Veg Mode for you
                </motion.p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification - Fixed to viewport bottom */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showToast && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ duration: 0.3, type: "spring", damping: 25 }}
                className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[10001] bg-black text-white px-6 py-3 rounded-lg shadow-2xl">
                <p className="text-sm font-medium">Added to bookmark</p>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
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
                  className="fixed left-0 right-0 bottom-0 z-[10000] bg-white rounded-t-3xl shadow-2xl"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{
                    duration: 0.2,
                    type: "spring",
                    damping: 30,
                    stiffness: 400,
                  }}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900">
                      Manage Collections
                    </h2>
                    <button
                      onClick={() => setShowManageCollections(false)}
                      className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center hover:bg-gray-800 transition-colors">
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>

                  {/* Collections List */}
                  <div className="px-4 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
                    {/* Bookmarks Collection */}
                    <div
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Don't close modal on click, let checkbox handle it
                      }}>
                      <div className="h-12 w-12 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <Bookmark className="h-6 w-6 text-red-500 fill-red-500" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-medium text-gray-900">
                            Bookmarks
                          </span>
                          {selectedRestaurantSlug && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={isFavorite(selectedRestaurantSlug)}
                                onCheckedChange={(checked) => {
                                  if (!checked) {
                                    removeFavorite(selectedRestaurantSlug);
                                    setSelectedRestaurantSlug(null);
                                    setShowManageCollections(false);
                                  }
                                }}
                                className="h-5 w-5 rounded border-2 border-red-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                              />
                            </div>
                          )}
                          {!selectedRestaurantSlug && (
                            <div className="h-5 w-5 rounded border-2 border-red-500 bg-red-500 flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {getFavorites().length} restaurant
                          {getFavorites().length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>

                    {/* Create new Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors"
                      onClick={() => setShowManageCollections(false)}>
                      <div className="h-12 w-12 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <Plus className="h-6 w-6 text-red-500" />
                      </div>
                      <div className="flex-1 text-left">
                        <span className="text-base font-medium text-gray-900">
                          Create new Collection
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Done Button */}
                  <div className="border-t border-gray-200 px-4 py-4">
                    <Button
                      className="w-full bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-medium"
                      onClick={() => {
                        setSelectedRestaurantSlug(null);
                        setShowManageCollections(false);
                      }}>
                      Done
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}

      <StickyCartCard />
      {/* Live order strip: only on homepage (not in UserLayout) */}
      <OrderTrackingCard hasBottomNav />
      </div> {/* Closes the unified relative z-10 w-full mb-2 container from top */}
    </div>
  );
}




