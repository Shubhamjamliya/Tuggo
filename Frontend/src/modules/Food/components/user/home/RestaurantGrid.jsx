import React from "react";
import { ShopPlaceholder } from "@food/components/OptimizedImage";
import HomeRestaurantCard from "@food/components/user/home/HomeRestaurantCard";
import { useAppLogo } from "@food/hooks/useAppLogo";

function RestaurantGridSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={`skel-card-${index}`} className="h-full">
          <div className="overflow-hidden gap-0 border-0 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] rounded-[28px] flex flex-col h-full w-full relative shadow-sm border border-orange-50 dark:border-orange-900/10 shadow-[0_4px_20px_rgba(249,115,22,0.04)]">
            <div className="relative h-48 sm:h-56 md:h-60 lg:h-64 xl:h-72 bg-[#f7f5f2] dark:bg-zinc-800 animate-pulse flex flex-col items-center justify-center">
              <ShopPlaceholder />
            </div>
            <div className="p-3 sm:p-4 lg:p-5 pt-3 sm:pt-4 lg:pt-5 flex flex-col flex-grow">
              <div className="flex items-start justify-between gap-2 mb-2 lg:mb-3">
                <div className="h-6 lg:h-8 w-48 lg:w-64 bg-orange-100 dark:bg-orange-900/30 rounded-md animate-pulse" />
                <div className="h-6 lg:h-8 w-16 bg-orange-200 dark:bg-orange-800/40 rounded-3xl animate-pulse" />
              </div>
              <div className="h-4 lg:h-5 w-24 bg-orange-50 dark:bg-orange-900/20 rounded animate-pulse" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function RestaurantGrid({
  restaurants = [],
  backendOrigin = "",
  isOutOfService = false,
  showSkeleton = false,
  isLoading = false,
  isFavorite,
  onToggleFavorite,
}) {
  const logoUrl = useAppLogo('user_app') || "/logo.png";

  if (restaurants.length === 0) {
    return null;
  }

  return (
    <div
      className={`px-4 pt-1 sm:pt-1.5 lg:pt-2 pb-10 ${
        isLoading ? "opacity-50" : "opacity-100"
      } transition-opacity duration-300`}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-4 lg:gap-5 xl:gap-6 items-stretch pb-5 sm:pb-4 lg:pb-5 xl:pb-6">
        {restaurants.map((restaurant, index) => (
          <HomeRestaurantCard
            key={
              restaurant?.id ||
              restaurant?._id ||
              restaurant?.mongoId ||
              index
            }
            restaurant={restaurant}
            index={index}
            backendOrigin={backendOrigin}
            isOutOfService={isOutOfService}
            isFavorite={isFavorite}
            onToggleFavorite={onToggleFavorite}
            animateEntrance={index < 10}
          />
        ))}
      </div>

      {/* End of list Tuggo branding */}
      <div className="pt-10 pb-4 flex flex-col items-center justify-center select-none">
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
  );
}

export default React.memo(RestaurantGrid);
