import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Clock, MapPin, Heart, Star } from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import Footer from "@food/components/user/Footer"
import ScrollReveal from "@food/components/user/ScrollReveal"
import TextReveal from "@food/components/user/TextReveal"
import { Card, CardTitle, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { RestaurantGridSkeleton } from "@food/components/ui/loading-skeletons"
import { useProfile } from "@food/context/ProfileContext"
import { useAppLocation } from "@food/hooks/useAppLocation"
import { restaurantAPI } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import { useDelayedLoading } from "@food/hooks/useDelayedLoading"
import { getPlaceholderImage } from "@/shared/utils/media.js"
import { useAppLogo } from "@food/hooks/useAppLogo"

const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api(\/v\d+)?\/?$/, "")

const normalizeImageUrl = (imageUrl) => {
  if (typeof imageUrl !== "string" || !imageUrl.trim()) return ""
  const trimmed = imageUrl.trim()
  if (/^(https?:)?\/\//i.test(trimmed) || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
    return trimmed
  }
  return trimmed.startsWith("/")
    ? `${BACKEND_ORIGIN}${trimmed}`
    : `${BACKEND_ORIGIN}/${trimmed}`
}

const pickRestaurantImage = (restaurant) => {
  const candidates = [
    restaurant?.coverImage?.url,
    restaurant?.coverImage,
    ...(Array.isArray(restaurant?.coverImages) ? restaurant.coverImages.map((img) => img?.url || img) : []),
    ...(Array.isArray(restaurant?.menuImages) ? restaurant.menuImages.map((img) => img?.url || img) : []),
    restaurant?.profileImage?.url,
    restaurant?.profileImage,
  ]
  const firstValid = candidates.find((value) => typeof value === "string" && value.trim())
  return normalizeImageUrl(firstValid || "")
}

export default function Restaurants() {
  const { addFavorite, removeFavorite, isFavorite } = useProfile()
  const { location: userLocation, zoneId } = useAppLocation()
  const logoUrl = useAppLogo('user_app') || "/logo.png"
  const [restaurants, setRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const showRestaurantsSkeleton = useDelayedLoading(loading)

  useEffect(() => {
    let cancelled = false

    const fetchRestaurants = async () => {
      try {
        setLoading(true)
        const params = { limit: 300, _ts: Date.now() }
        if (zoneId) {
          params.zoneId = zoneId
        }
        const response = await restaurantAPI.getRestaurants(params)
        const list =
          response?.data?.data?.restaurants ||
          response?.data?.restaurants ||
          []
        if (cancelled) return

        const transformed = list.map((restaurant) => {
          const slug =
            restaurant?.slug ||
            String(restaurant?.name || "")
              .toLowerCase()
              .trim()
              .replace(/\s+/g, "-")
          const cuisine = Array.isArray(restaurant?.cuisines) && restaurant.cuisines.length > 0
            ? restaurant.cuisines[0]
            : "Multi-cuisine"
          const isBanned = Boolean(
            restaurant?.isBanned === true || 
            restaurant?.status === 'banned' || 
            (restaurant?.status === 'rejected' && /disabled by admin|banned/i.test(restaurant?.rejectionReason || ''))
          );
          return {
            id: restaurant?._id || restaurant?.restaurantId || slug,
            isBanned,
            slug,
            name: restaurant?.name || "Unknown Restaurant",
            cuisine,
            rating: Number(restaurant?.rating || 0) || 4.5,
            deliveryTime: restaurant?.estimatedDeliveryTime || (restaurant?.estimatedDeliveryTimeMinutes ? `${restaurant.estimatedDeliveryTimeMinutes} mins` : "25-30 mins"),
            distance: restaurant?.distance ? (typeof restaurant.distance === 'number' ? `${restaurant.distance.toFixed(1)} km` : restaurant.distance) : "1.2 km",
            priceRange: restaurant?.priceRange || "$$",
            image: pickRestaurantImage(restaurant),
          }
        })

        transformed.sort((a, b) => {
          const aBanned = Boolean(a.isBanned);
          const bBanned = Boolean(b.isBanned);
          if (aBanned !== bBanned) return aBanned ? 1 : -1;
          return 0;
        });
        setRestaurants(transformed)
      } catch (error) {
        if (!cancelled) {
          setRestaurants([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchRestaurants()
    return () => {
      cancelled = true
    }
  }, [zoneId])

  const hasRestaurants = useMemo(() => restaurants.length > 0, [restaurants.length])

  return (
    <AnimatedPage className="min-h-screen bg-gradient-to-b from-yellow-50/30 dark:from-[#0a0a0a] via-white dark:via-[#0a0a0a] to-orange-50/20 dark:to-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 xl:px-12 py-4 sm:py-6 md:py-8 lg:py-10 space-y-4 sm:space-y-6 lg:space-y-8">
        <ScrollReveal>
          <div className="flex items-center gap-3 sm:gap-4 lg:gap-5 mb-4 lg:mb-6">
            <Link to="/">
              <Button variant="ghost" size="icon" className="rounded-full h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 hover:bg-gray-100 dark:hover:bg-gray-800">
                <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-gray-900 dark:text-gray-100" />
              </Button>
            </Link>
            <TextReveal className="flex items-center gap-2 sm:gap-3 lg:gap-4">
              <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-gray-900 dark:text-white">
                All Restaurants
              </h1>
            </TextReveal>
          </div>
        </ScrollReveal>

        {showRestaurantsSkeleton ? (
          <RestaurantGridSkeleton count={4} />
        ) : !hasRestaurants ? (
          <div className="py-16 text-center text-sm text-gray-500">No restaurants available right now.</div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5 xl:gap-6 pt-2 sm:pt-3 lg:pt-4">
              {restaurants.map((restaurant, index) => {
                const favorite = !restaurant.isBanned && isFavorite(restaurant.slug)

                const handleToggleFavorite = (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (restaurant.isBanned) return
                  if (favorite) {
                    removeFavorite(restaurant.slug)
                  } else {
                    addFavorite({
                      slug: restaurant.slug,
                      name: restaurant.name,
                      cuisine: restaurant.cuisine,
                      rating: restaurant.rating,
                      deliveryTime: restaurant.deliveryTime,
                      distance: restaurant.distance,
                      priceRange: restaurant.priceRange,
                      image: restaurant.image,
                    })
                  }
                }

                const CardWrapper = restaurant.isBanned ? "div" : Link
                const cardWrapperProps = restaurant.isBanned
                  ? { className: "h-full flex cursor-not-allowed select-none" }
                  : { to: `/restaurants/${restaurant.slug}`, className: "h-full flex" }

                return (
                  <ScrollReveal key={restaurant.id} delay={index * 0.05}>
                    <CardWrapper {...cardWrapperProps}>
                      <Card className={`overflow-hidden border border-gray-200 dark:border-gray-800 group bg-white dark:bg-[#1a1a1a] pb-1 sm:pb-2 lg:pb-3 flex flex-col h-full w-full transition-all duration-300 ${
                        restaurant.isBanned 
                          ? "grayscale opacity-75 cursor-not-allowed select-none" 
                          : "cursor-pointer hover:shadow-lg dark:hover:shadow-xl dark:hover:shadow-gray-900/50"
                      }`}>
                        <div className="flex flex-row min-h-[120px] sm:min-h-[140px] md:min-h-[160px] lg:min-h-[180px] flex-1">
                          <CardContent className="flex-1 flex flex-col justify-between p-3 sm:p-4 md:p-5 lg:p-6 min-w-0 overflow-hidden">
                            <div className="flex-1 flex flex-col justify-between gap-2">
                              <div className="flex-shrink-0">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div className="flex-1 min-w-0 pr-2">
                                    <CardTitle className="text-base sm:text-lg md:text-xl mb-1 line-clamp-2 text-gray-900 dark:text-white">
                                      {restaurant.name}
                                    </CardTitle>
                                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 font-medium mb-2 line-clamp-1">
                                      {restaurant.cuisine}
                                    </p>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <div className="flex items-center gap-1 bg-yellow-50 dark:bg-yellow-900/30 px-1.5 py-0.5 rounded-full">
                                        <Star className="h-3 w-3 sm:h-3.5 sm:w-3.5 fill-yellow-400 text-yellow-400" />
                                        <span className="font-bold text-xs sm:text-sm text-yellow-700 dark:text-yellow-400">{restaurant.rating.toFixed(1)}</span>
                                      </div>
                                    </div>
                                  </div>
                                  {!restaurant.isBanned && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className={`h-7 w-7 sm:h-8 sm:w-8 rounded-full flex-shrink-0 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${favorite ? "text-red-500 dark:text-red-400" : "text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400"}`}
                                      onClick={handleToggleFavorite}
                                    >
                                      <Heart className={`h-4 w-4 sm:h-5 sm:w-5 ${favorite ? "fill-red-500 dark:fill-red-400" : ""}`} />
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-2 mt-auto pt-2 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
                                <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-gray-600 dark:text-gray-400 flex-wrap">
                                  <div className="flex items-center gap-1">
                                    <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                                    <span className="font-medium whitespace-nowrap">{restaurant.deliveryTime}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                                    <span className="font-medium whitespace-nowrap">{restaurant.distance}</span>
                                  </div>
                                </div>
                                {restaurant.isBanned ? (
                                  <span className="bg-gray-400 text-white text-xs font-semibold px-3 py-1 rounded-md">
                                    Offline
                                  </span>
                                ) : (
                                  <Button className="bg-primary hover:opacity-90 dark:hover:opacity-80 text-white text-xs sm:text-sm h-7 sm:h-8 px-3 sm:px-4 flex-shrink-0 transition-opacity">
                                    Order Now
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardContent>

                          <div className="w-36 sm:w-44 md:w-56 lg:w-64 xl:w-72 flex-shrink-0 relative overflow-hidden group/image">
                            <img
                              src={restaurant.image || getPlaceholderImage({ width: 400, height: 300, text: "Restaurant" })}
                              alt={restaurant.name}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-gradient-to-l from-black/20 dark:from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      </Card>
                    </CardWrapper>
                  </ScrollReveal>
                )
              })}
            </div>

            {/* End of list Tuggo branding */}
            <div className="pt-10 pb-6 flex flex-col items-center justify-center select-none">
              <div className="flex items-center gap-4 w-full max-w-xs sm:max-w-sm">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-200 dark:via-zinc-800 to-gray-300 dark:to-zinc-700" />
                <div className="flex items-center justify-center">
                  <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-white dark:bg-zinc-900 border border-gray-200/90 dark:border-zinc-800 shadow-sm flex items-center justify-center p-2.5 overflow-hidden ring-4 ring-gray-100 dark:ring-zinc-800/60 transition-transform duration-300 hover:scale-105">
                    <img
                      src={logoUrl}
                      alt="Tuggo"
                      className="h-full w-full object-contain"
                      onError={(e) => {
                        e.currentTarget.src = "/logo.png";
                      }}
                    />
                  </div>
                </div>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent via-gray-200 dark:via-zinc-800 to-gray-300 dark:to-zinc-700" />
              </div>
              <p className="text-[11px] sm:text-xs font-semibold tracking-widest uppercase text-gray-400 dark:text-zinc-500 mt-3">
                That's all for now
              </p>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </AnimatedPage>
  )
}
