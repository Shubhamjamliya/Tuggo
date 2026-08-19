const BASE = "/food/restaurant"

const MAIN_TAB_ROUTES = new Set([
  `${BASE}`,
  `${BASE}/dashboard`,
  `${BASE}/inventory`,
  `${BASE}/feedback`,
  `${BASE}/explore`,
])

const HIDE_BOTTOM_NAV_PATTERNS = [
  "/create-offers",
  "/hub-menu/item",
  "/outlet-timings/",
  "/orders/",
]

export function getRestaurantHeaderOptions(pathname) {
  return {
    showSearch:
      pathname === `${BASE}` || pathname === `${BASE}/inventory`,
    showOfflineOnlineTag: true,
    showNotifications: true,
  }
}

export function getRestaurantLayoutOptions(pathname) {
  const hideBottomNav = HIDE_BOTTOM_NAV_PATTERNS.some((p) => pathname.includes(p))

  return {
    showSidebar: true,
    showNavbar: true,
    showBottomNav: !hideBottomNav,
  }
}

export function isMainTabRoute(pathname) {
  return MAIN_TAB_ROUTES.has(pathname)
}

export const RESTAURANT_SIDEBAR_SECTIONS = [
  {
    title: "Main",
    items: [
      { label: "Dashboard", route: `${BASE}/dashboard`, icon: "dashboard" },
      { label: "Orders", route: `${BASE}`, icon: "orders" },
      { label: "Inventory", route: `${BASE}/inventory`, icon: "inventory" },
      { label: "Feedback", route: `${BASE}/feedback`, icon: "feedback" },
    ],
  },
  {
    title: "Outlet",
    items: [
      { label: "Outlet info", route: `${BASE}/outlet-info` },
      { label: "Outlet timings", route: `${BASE}/outlet-timings` },
      { label: "Menu categories", route: `${BASE}/menu-categories` },
      { label: "Promo codes", route: `${BASE}/promocodes` },
      { label: "Delivery settings", route: `${BASE}/delivery-settings` },
      { label: "Zone setup", route: `${BASE}/zone-setup` },
    ],
  },
  {
    title: "Orders & reviews",
    items: [
      { label: "Order history", route: `${BASE}/orders/all` },
      { label: "Ratings & reviews", route: `${BASE}/ratings-reviews` },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Payout", route: `${BASE}/hub-finance` },
      { label: "Bank details", route: `${BASE}/update-bank-details` },
      { label: "Withdrawal history", route: `${BASE}/withdrawal-history` },
    ],
  },
  {
    title: "Support",
    items: [
      { label: "Notifications", route: `${BASE}/notifications` },
      { label: "Help centre", route: `${BASE}/help-centre/support` },
      { label: "Share feedback", route: `${BASE}/share-feedback` },
    ],
  },
]
