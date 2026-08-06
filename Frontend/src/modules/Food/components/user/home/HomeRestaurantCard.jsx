import { Link } from "react-router-dom";
import { memo, useMemo } from "react";
import {
  BadgePercent,
  Bookmark,
  Clock,
  Star,
  Timer,
} from "lucide-react";
import { Card, CardContent } from "@food/components/ui/card";
import { Button } from "@food/components/ui/button";
import RestaurantImageCarousel from "@food/components/user/home/RestaurantImageCarousel";
import { useDeferredOutletTimings } from "@food/hooks/user/useDeferredOutletTimings";
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability";

function resolveRestaurantSlug(restaurant, index) {
  const nameStr = typeof restaurant?.name === "string" ? restaurant.name.trim() : "";
  const fallbackSlugSource =
    nameStr ||
    (typeof restaurant?.restaurantName === "string"
      ? restaurant.restaurantName.trim()
      : "") ||
    String(
      restaurant?.slug ||
        restaurant?.id ||
        restaurant?._id ||
        `restaurant-${index}`,
    );

  return typeof restaurant?.slug === "string" && restaurant.slug.trim()
    ? restaurant.slug.trim()
    : fallbackSlugSource.toLowerCase().replace(/\s+/g, "-");
}

function HomeRestaurantCard({
  restaurant,
  index = 0,
  backendOrigin = "",
  isOutOfService = false,
  isFavorite,
  onToggleFavorite,
  animateEntrance = false,
}) {
  const { ref, outletTimings } = useDeferredOutletTimings(
    restaurant?.mongoId,
    restaurant?.outletTimings ?? null,
  );

  const restaurantForAvailability = useMemo(
    () => ({ ...restaurant, outletTimings: outletTimings ?? restaurant?.outletTimings }),
    [restaurant, outletTimings],
  );

  const availability = getRestaurantAvailabilityStatus(
    restaurantForAvailability,
    new Date()
  );

  const restaurantSlug = resolveRestaurantSlug(restaurant, index);
  const favorite = isFavorite(restaurantSlug);
  const priority = index < 3;

  return (
    <div
      ref={ref}
      className="h-full transform transition-all duration-300 hover:-translate-y-3 hover:scale-[1.02]"
      style={{
        perspective: 1000,
        animation: animateEntrance
          ? `fade-in-up 0.5s ease-out ${Math.min(index, 9) * 0.05}s backwards`
          : "none",
      }}
    >
      <div className="h-full group">
        <Link to={`/user/restaurants/${restaurantSlug}`} className="h-full flex">
          <Card
            className={`overflow-hidden gap-0 cursor-pointer border-0 dark:border-gray-800 group bg-white dark:bg-[#1a1a1a] border-background transition-all duration-500 py-0 rounded-[28px] flex flex-col h-full w-full relative shadow-sm hover:shadow-xl ${
              isOutOfService || !availability.isOpen
                ? "grayscale opacity-75"
                : ""
            }`}
          >
            <div className="relative">
              <RestaurantImageCarousel
                restaurant={restaurant}
                priority={priority}
                backendOrigin={backendOrigin}
              />

              <div className="absolute top-4 right-4 z-10 transform transition-transform duration-300 group-hover:scale-110">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(event) => onToggleFavorite(event, restaurant, restaurantSlug, favorite)}
                  aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
                  className={`h-11 w-11 rounded-[20px] shadow-xl flex items-center justify-center transition-all duration-300 ${
                    favorite
                      ? "bg-red-500 text-white"
                      : "bg-white/90 backdrop-blur-sm text-gray-800 hover:bg-white"
                  }`}
                >
                  <Bookmark
                    className={`h-5 w-5 transition-all duration-300 ${
                      favorite ? "fill-white" : ""
                    }`}
                  />
                </Button>
              </div>
            </div>

            <div className="transform transition-transform duration-300 group-hover:-translate-y-1">
              <CardContent className="p-3 sm:p-4 lg:p-5 pt-3 sm:pt-4 lg:pt-5 flex flex-col flex-grow">
                <div className="flex items-start justify-between gap-2 mb-2 lg:mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl lg:text-[26px] font-bold text-gray-950 dark:text-white line-clamp-1 leading-tight tracking-tight transition-colors duration-300 group-hover:text-primary">
                      {restaurant.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest shadow-sm ${
                          availability.isOpen
                            ? "bg-primary text-white"
                            : "bg-gray-400 text-white"
                        }`}
                      >
                        {availability.isOpen ? "Open now" : "Offline"}
                      </span>
                      {restaurant.discount > 0 && (
                        <div className="inline-flex rounded-full px-2.5 py-1 bg-[#ea580c] text-white text-[10px] font-black uppercase tracking-widest shadow-sm items-center gap-1">
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.864 2.227l8.909 8.91a2.182 2.182 0 010 3.085l-7.364 7.364a2.182 2.182 0 01-3.085 0l-8.91-8.91A2.182 2.182 0 012 11.137V4.41A2.182 2.182 0 014.182 2.23h6.727a2.182 2.182 0 011.955-.003z" /></svg>
                          {restaurant.discount}% OFF
                        </div>
                      )}
                      {availability.isOpen &&
                        availability.closingCountdownLabel &&
                        availability.openingTime &&
                        availability.closingTime && (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-[10px] font-black uppercase tracking-widest">
                            <Timer className="h-3 w-3 flex-shrink-0" strokeWidth={3} />
                            <span>{availability.closingCountdownLabel}</span>
                          </div>
                        )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 bg-green-600 text-white px-3 py-1.5 rounded-2xl flex items-center gap-1.5 shadow-md transform transition-transform duration-300 group-hover:scale-110">
                    <span className="text-sm lg:text-lg font-black tracking-tight">
                      {Number(restaurant.rating) > 0
                        ? Number(restaurant.rating).toFixed(1)
                        : "NEW"}
                    </span>
                    {Number(restaurant.rating) > 0 && (
                      <Star
                        className="h-3.5 w-3.5 lg:h-4.5 lg:w-4.5 fill-white text-white"
                        strokeWidth={0}
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 text-sm lg:text-base text-gray-500 mb-2 lg:mb-3 transition-opacity duration-300 opacity-70 group-hover:opacity-100">
                  <Clock
                    className="h-4 w-4 lg:h-5 lg:w-5 text-gray-500 dark:text-gray-400"
                    strokeWidth={1.5}
                  />
                  <span className="font-medium dark:text-gray-300 text-gray-700">
                    {restaurant.deliveryTime}
                  </span>
                  <span className="mx-1">|</span>
                  <span className="font-medium dark:text-gray-300 text-gray-700">
                    {restaurant.distance}
                  </span>
                </div>

                {restaurant.offer && (
                  <div className="flex items-center gap-2 text-sm lg:text-base mt-auto transform transition-transform duration-300 group-hover:translate-x-1">
                    <BadgePercent
                      className="h-4 w-4 lg:h-5 lg:w-5 text-primary"
                      strokeWidth={3}
                    />
                    <span className="text-primary dark:text-[#a05485] font-black uppercase text-[10px] tracking-wider">
                      {restaurant.offer}
                    </span>
                  </div>
                )}
              </CardContent>
            </div>

            <div className="absolute inset-0 rounded-md pointer-events-none z-0 transition-all duration-300 border border-transparent group-hover:border-primary/30 group-hover:shadow-[inset_0_0_0_1px_rgba(235,89,14,0.2)]" />
          </Card>
        </Link>
      </div>
    </div>
  );
}

export default memo(HomeRestaurantCard);
