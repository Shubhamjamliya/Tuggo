import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { foodImages } from "@food/constants/images";

const WEBVIEW_SESSION_CACHE_BUSTER = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function OfferBannerContent({ item }) {
  if (!item) return null;
  return (
    <div className="flex items-center w-full gap-2 px-3 py-1.5">
      <span className="text-[11px] font-semibold text-white uppercase whitespace-nowrap">
        {item.dText}
      </span>
      <div className="w-[3px] h-[3px] rounded-full bg-white/60 shrink-0" />
      <span className="font-medium text-white/95 text-[11px] whitespace-nowrap truncate flex-1">
        {item.name}
      </span>
      <div className="flex items-center gap-1.5 shrink-0 pl-1">
        {item.discountedPrice && item.discountedPrice < item.price ? (
          <>
            <span className="text-[10px] text-white/70 line-through">₹{Math.round(item.price)}</span>
            <span className="font-semibold text-white text-[11px]">₹{Math.round(item.discountedPrice)}</span>
          </>
        ) : (
          <span className="font-semibold text-white text-[11px]">₹{Math.round(item.price)}</span>
        )}
      </div>
    </div>
  );
}

const RestaurantImageCarousel = React.memo(
  ({
    restaurant,
    priority = false,
    backendOrigin = "",
    className = "h-48 sm:h-56 md:h-60 lg:h-64 xl:h-72",
    roundedClass = "rounded-t-md",
    onSlideClick = null,
  }) => {
    const webviewSessionKeyRef = useRef(WEBVIEW_SESSION_CACHE_BUSTER);
    const imageElementRef = useRef(null);

    const withCacheBuster = useCallback(
      (url) => {
        if (typeof url !== "string" || !url) return "";
        if (/^data:/i.test(url) || /^blob:/i.test(url)) return url;

        // Resolve relative URLs (e.g. /uploads/...) so they load on mobile when backend is different from frontend.
        const isRelative = !/^(https?:|\/\/|data:|blob:)/i.test(url.trim());
        const resolvedUrl =
          backendOrigin && isRelative
            ? `${backendOrigin.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`
            : url;

        // Do not mutate signed URLs (legacy S3/Cloudfront/Firebase links can break if query changes).
        const hasSignedParams =
          /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
            resolvedUrl,
          );
        if (hasSignedParams) return resolvedUrl;

        try {
          const parsed = new URL(resolvedUrl, window.location.origin);
          return parsed.toString();
        } catch {
          return resolvedUrl;
        }
      },
      [backendOrigin],
    );

    const slides = useMemo(() => {
      const result = [];
      const recItems = Array.isArray(restaurant?.recommendedItems) ? restaurant.recommendedItems : [];

      // Add recommended food items
      recItems.forEach((item) => {
        const rawImg = item?.image || item?.imageUrl || item?.photoUrl;
        if (typeof rawImg === "string" && rawImg.trim()) {
          result.push({
            url: withCacheBuster(rawImg.trim()),
            id: item.id || item._id,
            name: item.name || "Recommended Dish",
            price: item.price || 0,
            isRecommended: true,
          });
        }
      });

      // If recommended food images exist, show ONLY recommended dishes
      if (result.length > 0) {
        return result;
      }

      // Fallback: If no recommended items exist, use regular restaurant cover images
      let sourceImages = [];
      if (Array.isArray(restaurant?.images) && restaurant.images.length > 0) {
        sourceImages = restaurant.images;
      } else if (Array.isArray(restaurant?.coverImages) && restaurant.coverImages.length > 0) {
        sourceImages = restaurant.coverImages;
      } else if (restaurant?.image) {
        sourceImages = [restaurant.image];
      }

      const validImages = sourceImages
        .filter((img) => typeof img === "string" && img.trim())
        .map((img) => img.trim());

      validImages.forEach((img) => {
        const processedUrl = withCacheBuster(img);
        if (!result.some((s) => s.url === processedUrl)) {
          result.push({
            url: processedUrl,
            isRecommended: false,
          });
        }
      });

      if (result.length === 0) {
        result.push({
          url: foodImages[0],
          isRecommended: false,
        });
      }

      return result;
    }, [restaurant?.recommendedItems, restaurant?.images, restaurant?.coverImages, restaurant?.image, withCacheBuster]);

    const images = useMemo(() => slides.map((s) => s.url), [slides]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [currentItemIndex, setCurrentItemIndex] = useState(0);

    const bannerItems = useMemo(() => {
      const items = [];

      // If backend populated dish names inside itemDiscounts, use them directly!
      if (Array.isArray(restaurant?.itemDiscounts) && restaurant.itemDiscounts.some((d) => d.name)) {
        restaurant.itemDiscounts.forEach((d) => {
          if (d.name) {
            items.push({
              id: d.itemId,
              name: d.name,
              price: d.price || 0,
            });
          }
        });
      }

      if (items.length === 0 && restaurant?.menu?.sections && Array.isArray(restaurant.menu.sections)) {
        restaurant.menu.sections.forEach((sec) => {
          if (Array.isArray(sec.items)) items.push(...sec.items);
        });
      }

      if (items.length === 0) {
        if (Array.isArray(restaurant?.popularItems) && restaurant.popularItems.length > 0) {
          items.push(...restaurant.popularItems);
        } else if (Array.isArray(restaurant?.menuItems) && restaurant.menuItems.length > 0) {
          items.push(...restaurant.menuItems);
        }
      }

      if (items.length === 0 && restaurant?.featuredDish) {
        items.push({
          name: restaurant.featuredDish,
          price: restaurant.featuredPrice || 0,
          originalPrice: restaurant.featuredPrice || 0,
        });
      }

      const globalOffers = Array.isArray(restaurant?.offers) ? restaurant.offers : [];
      let bestGlobalOffer = null;
      globalOffers.forEach((offer) => {
        if (!bestGlobalOffer || Number(offer.discountValue) > Number(bestGlobalOffer.discountValue)) {
          bestGlobalOffer = offer;
        }
      });

      const discountedItems = items
        .map((item) => {
          let priceNum = Number(item.price || item.originalPrice || 0);

          if (typeof item.price === "string") {
            const parsed = parseFloat(item.price.replace(/[^0-9.]/g, ""));
            if (!isNaN(parsed)) priceNum = parsed;
          }

          let discountedPrice = null;
          let dText = "SPECIAL OFFER";

          const specificDiscount = Array.isArray(restaurant?.itemDiscounts)
            ? restaurant.itemDiscounts.find((d) => String(d.itemId) === String(item.id || item._id || item.menuItemId))
            : null;

          if (specificDiscount) {
            const discountVal = Number(specificDiscount.discountValue) || 0;
            const isFlat = String(specificDiscount.discountType || "").toUpperCase() === "FLAT";
            if (!isFlat) {
              discountedPrice = priceNum * (1 - discountVal / 100);
              dText = `${discountVal}% OFF`;
            } else {
              discountedPrice = Math.max(0, priceNum - discountVal);
              dText = `FLAT ₹${discountVal} OFF`;
            }
          } else if (!discountedPrice && bestGlobalOffer) {
            const discountVal = Number(bestGlobalOffer.discountValue) || 0;
            const isFlat = String(bestGlobalOffer.discountType || "").toUpperCase() === "FLAT";
            if (!isFlat) {
              const maxD = Number(bestGlobalOffer.maxDiscount) || Infinity;
              const calcD = priceNum * (discountVal / 100);
              const actualD = Math.min(calcD, maxD);
              discountedPrice = priceNum - actualD;
              dText = bestGlobalOffer.title || `${discountVal}% OFF`;
            } else {
              discountedPrice = Math.max(0, priceNum - discountVal);
              dText = bestGlobalOffer.title || `FLAT ₹${discountVal} OFF`;
            }
          } else if (!discountedPrice && restaurant?.discount > 0) {
            discountedPrice = priceNum * (1 - restaurant.discount / 100);
            dText = `${restaurant.discount}% OFF`;
          } else {
            const matchingRule = (restaurant?.discountRules || []).find((rule) => {
              const val = Number(rule.conditionValue);
              if (rule.conditionType === "PRICE_ABOVE" && priceNum > val) return true;
              if (rule.conditionType === "PRICE_BELOW" && priceNum < val) return true;
              return false;
            });
            if (matchingRule) {
              const discountVal = matchingRule.discountValue || 0;
              discountedPrice = priceNum * (1 - discountVal / 100);
              dText = `${discountVal}% OFF`;
            }
          }

          return {
            name: item.name,
            price: priceNum,
            discountedPrice: discountedPrice,
            dText: dText,
          };
        })
        .filter((item) => item.discountedPrice !== null && item.discountedPrice < item.price);

      return discountedItems.slice(0, 5);
    }, [restaurant]);

    useEffect(() => {
      if (!priority || bannerItems.length <= 1) return;
      const interval = setInterval(() => {
        setCurrentItemIndex((prev) => (prev + 1) % bannerItems.length);
      }, 2000);
      return () => clearInterval(interval);
    }, [priority, bannerItems.length]);

    // Auto-slide for restaurant/recommended images (priority cards only)
    useEffect(() => {
      if (!priority || images.length <= 1) return;
      const interval = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % images.length);
      }, 3500);
      return () => clearInterval(interval);
    }, [priority, images.length]);

    const [loadedBySrc, setLoadedBySrc] = useState({});
    const [, setAttemptedSrcs] = useState({});
    const [isImageUnavailable, setIsImageUnavailable] = useState(false);
    const [showShimmer, setShowShimmer] = useState(true);
    const [lastGoodSrc, setLastGoodSrc] = useState("");
    const touchStartX = useRef(0);
    const touchEndX = useRef(0);
    const isSwiping = useRef(false);

    const safeIndex =
      images.length > 0
        ? ((currentIndex % images.length) + images.length) % images.length
        : 0;
    const currentSlide = slides[safeIndex] || null;
    const primarySrc = images[safeIndex] || "";
    const displaySrc = primarySrc;
    const renderSrc = displaySrc || lastGoodSrc;

    // Reset transient image state when restaurant or source list changes.
    useEffect(() => {
      setCurrentIndex(0);
      setLoadedBySrc({});
      setAttemptedSrcs({});
      setIsImageUnavailable(images.length === 0);
      setShowShimmer(images.length > 0);
    }, [restaurant?.id, restaurant?.slug, restaurant?.updatedAt, images]);

    // Clear sticky successful source only when card identity changes.
    useEffect(() => {
      setLastGoodSrc("");
    }, [restaurant?.id, restaurant?.slug]);

    // WebView can serve from cache without firing onLoad; handle already-complete images.
    useEffect(() => {
      if (!renderSrc) return;
      const imgEl = imageElementRef.current;
      if (!imgEl) return;

      setShowShimmer(true);
      const shimmerTimeout = setTimeout(() => {
        setShowShimmer(false);
      }, 2500);

      if (imgEl.complete) {
        if (imgEl.naturalWidth > 0) {
          setLoadedBySrc((prev) =>
            prev[renderSrc] ? prev : { ...prev, [renderSrc]: true },
          );
          setLastGoodSrc(renderSrc);
          setShowShimmer(false);
        } else {
          setAttemptedSrcs((prev) => ({ ...prev, [renderSrc]: true }));
        }
      }
      return () => clearTimeout(shimmerTimeout);
    }, [renderSrc]);

    // Handle touch events for swipe
    const handleTouchStart = (e) => {
      touchStartX.current = e.touches[0].clientX;
      isSwiping.current = false;
    };

    const handleTouchMove = (e) => {
      const currentX = e.touches[0].clientX;
      const diff = touchStartX.current - currentX;

      if (Math.abs(diff) > 10) {
        isSwiping.current = true;
      }
    };

    const handleTouchEnd = (e) => {
      if (!isSwiping.current) return;

      touchEndX.current = e.changedTouches[0].clientX;
      const diff = touchStartX.current - touchEndX.current;
      const minSwipeDistance = 85;

      if (Math.abs(diff) > minSwipeDistance) {
        if (diff > 0) {
          // Swipe left - next image
          setCurrentIndex((prev) => (prev + 1) % images.length);
        } else {
          // Swipe right - previous image
          setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
        }
      }

      isSwiping.current = false;
      touchStartX.current = 0;
      touchEndX.current = 0;
    };

    const handleCarouselClick = (e) => {
      if (onSlideClick && currentSlide) {
        onSlideClick(currentSlide, e);
      }
    };

    const showMultipleImages = images.length > 1;

    return (
      <div
        className={`relative ${className} w-full overflow-hidden ${roundedClass} flex-shrink-0 group`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleCarouselClick}
      >
        {showShimmer && !isImageUnavailable && Boolean(renderSrc) && (
          <div className="absolute inset-0 z-[1] overflow-hidden bg-gray-200">
            <div className="h-full w-full animate-pulse bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
          </div>
        )}

        <div className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-110">
          {renderSrc && (
            <img
              ref={imageElementRef}
              src={renderSrc}
              alt={`${restaurant?.name || "Restaurant"} - Image ${safeIndex + 1}`}
              className="w-full h-full object-cover"
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : "low"}
              decoding="async"
              onLoad={() => {
                setLoadedBySrc((prev) => ({ ...prev, [renderSrc]: true }));
                setLastGoodSrc(renderSrc);
                setShowShimmer(false);
              }}
              onError={() => {
                setAttemptedSrcs((prev) => {
                  const next = { ...prev, [primarySrc]: true };
                  const attemptedCount = Object.keys(next).length;

                  if (attemptedCount >= images.length) {
                    setIsImageUnavailable(true);
                  } else if (images.length > 1) {
                    setCurrentIndex((prevIndex) => (prevIndex + 1) % images.length);
                  }

                  return next;
                });
                if (images.length === 1) {
                  setIsImageUnavailable(true);
                }
              }}
            />
          )}

          {/* Secretly preload the next image to prevent white flash on swipe */}
          {images.length > 1 && (
            <img
              src={images[(currentIndex + 1) % images.length]}
              className="hidden"
              alt="preload next"
              aria-hidden="true"
              decoding="async"
            />
          )}
        </div>

        {/* Recommended Dish Floating Tag */}
        {currentSlide?.isRecommended && currentSlide?.name && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/75 backdrop-blur-md text-white text-[11px] font-bold shadow-lg border border-amber-400/40 pointer-events-none">
            <Sparkles className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
            <span className="truncate max-w-[140px] sm:max-w-[190px]">{currentSlide.name}</span>
            {currentSlide.price > 0 && (
              <span className="text-amber-300 font-extrabold ml-0.5">₹{Math.round(currentSlide.price)}</span>
            )}
          </div>
        )}

        {isImageUnavailable && (
          <div className="absolute inset-0 z-[2] flex items-center justify-center bg-gray-100">
            <span className="text-xs text-gray-500">Image unavailable</span>
          </div>
        )}

        {/* Image Indicators - only show if more than 1 image */}
        {showMultipleImages && (
          <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex items-center z-10 -space-x-2">
            {images.map((_, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCurrentIndex(index);
                }}
                className="w-10 h-10 flex items-center justify-center focus:outline-none group/btn rounded-full"
                aria-label={`Go to image ${index + 1}`}
              >
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    index === currentIndex
                      ? "w-6 bg-white"
                      : "w-1.5 bg-white/50 group-hover/btn:bg-white/75"
                  }`}
                />
              </button>
            ))}
          </div>
        )}

        {/* Gradient Overlay on Hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {/* Shine Effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full transition-transform duration-1000 group-hover:animate-shine" />

        {/* Sliding Minimal Orange Banner for Items or Static Fallback */}
        {bannerItems.length > 0 ? (
          <div className="absolute bottom-0 left-0 right-0 bg-[#ea580c] z-[20]">
            <div className="w-full relative overflow-hidden h-[24px]">
              {priority && bannerItems.length > 1 ? (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentItemIndex}
                    initial={{ y: 15, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -15, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-0 flex items-center w-full"
                  >
                    <OfferBannerContent item={bannerItems[currentItemIndex]} />
                  </motion.div>
                </AnimatePresence>
              ) : (
                <div className="absolute inset-0 flex items-center w-full">
                  <OfferBannerContent item={bannerItems[0]} />
                </div>
              )}
            </div>
          </div>
        ) : (() => {
          let maxDiscount = restaurant?.discount || 0;
          if (Array.isArray(restaurant?.discountRules) && restaurant.discountRules.length > 0) {
            const maxRule = Math.max(...restaurant.discountRules.map((r) => r.discountValue || 0));
            if (maxRule > maxDiscount) maxDiscount = maxRule;
          }
          if (maxDiscount > 0) {
            return (
              <div className="absolute bottom-0 left-0 right-0 bg-[#ea580c] px-3 py-1.5 z-[20] flex items-center justify-between">
                <span className="text-[11px] font-semibold text-white uppercase whitespace-nowrap">
                  SPECIAL OFFER
                </span>
                <span className="font-medium text-white/95 text-[11px] whitespace-nowrap">
                  UP TO {maxDiscount}% OFF
                </span>
              </div>
            );
          }
          return null;
        })()}
      </div>
    );
  },
);

RestaurantImageCarousel.displayName = "RestaurantImageCarousel";

export default RestaurantImageCarousel;
