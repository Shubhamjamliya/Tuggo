import { useNavigate, useLocation } from "react-router-dom"
import { useMemo, useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  FileText,
  Package,
  MessageSquare,
  Compass,
} from "lucide-react"
import useNotificationInbox from "@food/hooks/useNotificationInbox"
import { useRestaurantNotifications } from "@food/hooks/useRestaurantNotifications"

const getOrdersTabs = (basePath = "/food/restaurant") => [
  { id: "orders", label: "Orders", icon: FileText, route: `${basePath}` },
  { id: "inventory", label: "Inventory", icon: Package, route: `${basePath}/inventory` },
  { id: "feedback", label: "Feedback", icon: MessageSquare, route: `${basePath}/feedback` },
  { id: "explore", label: "Explore", icon: Compass, route: `${basePath}/explore` },
]

const findActiveTab = (tabs, pathname) =>
  tabs
    .slice()
    .sort((a, b) => b.route.length - a.route.length)
    .find((tab) => pathname === tab.route || pathname.startsWith(tab.route + "/"))

export default function BottomNavOrders() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)

  // Hide bottom nav when keyboard is open (standard mobile UX)
  useEffect(() => {
    const handleResize = () => {
      if (window.visualViewport) {
        // If the visual viewport is significantly smaller than innerHeight, keyboard is open
        const isKeyboardOpen = window.visualViewport.height < window.innerHeight * 0.85
        setIsKeyboardVisible(isKeyboardOpen)
      }
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize)
      // Initial check
      handleResize()
      return () => window.visualViewport.removeEventListener('resize', handleResize)
    } else {
      // Fallback for older browsers
      const handleWindowResize = () => {
        setIsKeyboardVisible(window.innerHeight < 550)
      }
      window.addEventListener('resize', handleWindowResize)
      return () => window.removeEventListener('resize', handleWindowResize)
    }
  }, [])


  const basePath = pathname.includes("/food/restaurant")
    ? "/food/restaurant"
    : pathname.includes("/restaurant")
    ? "/food/restaurant"
    : "/food/restaurant"

  const { unreadCount } = useNotificationInbox("restaurant", { limit: 20, pollMs: 60 * 1000 })
  const { newOrder, newReservation } = useRestaurantNotifications();

  const tabs = useMemo(() => getOrdersTabs(basePath), [basePath])

  const isInternalPage =
    pathname.includes("/create-offers") ||
    pathname.includes("/hub-menu/item") ||
    pathname.includes("/outlet-timings/") ||
    (pathname.includes("/orders/") && !pathname.endsWith("/orders/all"))
  if (isInternalPage || isKeyboardVisible) {
    return null
  }

  const activeTab = useMemo(() => {
    const match = findActiveTab(tabs, pathname)
    return match?.id || "orders"
  }, [tabs, pathname])

  const handleTabClick = (tab) => {
    if (tab.route && tab.route !== pathname) {
      navigate(tab.route)
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-60 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] lg:hidden">
      <div className="mx-auto flex w-full max-w-md items-end gap-2">
        <div className="flex-1 min-w-0">
          <div className="relative overflow-visible rounded-[30px] bg-primary py-2 pl-3 pr-2 shadow-2xl shadow-primary/35">
            <div className="relative flex items-end justify-around gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon
                const isActive = activeTab === tab.id

                return (
                  <motion.button
                    key={tab.id}
                    onClick={() => handleTabClick(tab)}
                    aria-current={isActive ? "page" : undefined}
                    className="relative z-10 flex min-w-0 flex-1 flex-col items-center justify-center gap-1 overflow-visible rounded-full px-2 py-2"
                    whileHover={{ 
                      scale: 1.1,
                      y: -4,
                      transition: { type: "spring", stiffness: 400, damping: 10 }
                    }}
                    whileTap={{ scale: 0.9 }}
                  >
                    {isActive && (
                        <motion.div
                          layoutId="bottomNavActive"
                          className="absolute inset-0 -z-10 rounded-full bg-white/25 shadow-[0_0_15px_rgba(255,255,255,0.2)]"
                          initial={false}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                    )}
                    <motion.div
                      animate={{ 
                        scale: isActive ? [1, 1.2, 1] : 1,
                        rotate: isActive ? [0, -10, 10, 0] : 0
                      }}
                      transition={{ duration: 0.4 }}
                    >
                      <Icon
                        className={`relative z-10 h-5 w-5 transition-colors duration-300 ease-in-out ${
                          isActive ? "text-white" : "text-white/70"
                        }`}
                      />
                    </motion.div>
                    {/* Notification Dot */}
                    {((tab.id === 'orders' && (newOrder || newReservation)) || 
                      (tab.id === 'feedback' && unreadCount > 0)) && (
                      <span className="absolute top-2 right-2">
                        <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-75" />
                        <span className="relative block w-2.5 h-2.5 rounded-full bg-red-500 border border-white shadow-sm" />
                      </span>
                    )}
                    <motion.span
                      animate={{ 
                        scale: isActive ? 1.1 : 1,
                        fontWeight: isActive ? 800 : 500
                      }}
                      className={`relative z-10 whitespace-nowrap text-[11px] leading-none transition-colors duration-300 ease-in-out ${
                        isActive ? "text-white" : "text-white/70"
                      }`}
                    >
                      {tab.label}
                    </motion.span>
                  </motion.button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
