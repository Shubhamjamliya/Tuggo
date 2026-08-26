import { useState, useEffect, useMemo } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  Search,
  FileText,
  Calendar,
  Clock,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Link as LinkIcon,
  UtensilsCrossed,
  Building2,
  FolderTree,
  Plus,
  Utensils,
  Megaphone,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  X,
  LayoutDashboard,
  Gift,
  DollarSign,
  Image,
  Bell,
  MessageSquare,
  Mail,
  Users,
  Wallet,
  Award,
  Truck,
  Package,
  CreditCard,
  Settings,
  UserCog,
  User,
  Globe,
  Palette,
  Camera,
  LogIn,
  Database,
  Zap,
  Phone,
  IndianRupee,
  PiggyBank,
  Lock,
  ListChecks,
} from "lucide-react"
import { cn } from "@food/utils/utils"
import { Input } from "@food/components/ui/input"
import { adminSidebarMenu } from "@food/utils/adminSidebarMenu"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"
import { adminAPI } from "@food/api"
const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }


// Icon mapping
const iconMap = {
  LayoutDashboard,
  UtensilsCrossed,
  Building2,
  FileText,
  Calendar,
  Clock,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Link: LinkIcon,
  FolderTree,
  Plus,
  Utensils,
  Megaphone,
  Gift,
  DollarSign,
  Image,
  Bell,
  MessageSquare,
  Mail,
  Users,
  Wallet,
  Award,
  Truck,
  Package,
  CreditCard,
  Settings,
  UserCog,
  User,
  Globe,
  Palette,
  Camera,
  LogIn,
  Database,
  Zap,
  Phone,
  IndianRupee,
  PiggyBank,
  Lock,
  ListChecks,
  X,
}

export default function AdminSidebar({ isOpen = false, onClose, onCollapseChange }) {
  const location = useLocation()
  const [searchQuery, setSearchQuery] = useState("")
  const [badges, setBadges] = useState({})
  const [adminUser, setAdminUser] = useState(null)

  useEffect(() => {
    const loadAdminUser = () => {
      try {
        const userStr = localStorage.getItem('admin_user');
        if (userStr) setAdminUser(JSON.parse(userStr));
      } catch (e) { }
    }
    loadAdminUser()
    window.addEventListener('adminAuthChanged', loadAdminUser)
    return () => window.removeEventListener('adminAuthChanged', loadAdminUser)
  }, [])

  useEffect(() => {
    const fetchBadges = async () => {
      try {
        const res = await adminAPI.getSidebarBadges()
        if (res?.data?.success) {
          setBadges(res.data.counts || {})
        }
      } catch (error) {
        debugError("Error fetching sidebar badges:", error)
      }
    }
    fetchBadges()
    const timer = setInterval(fetchBadges, 60000)
    return () => clearInterval(timer)
  }, [])

  const getBadgeCount = (label = "", path = "") => {
    const l = label.toLowerCase()
    const p = path?.toLowerCase() || ""

    // FOOD MANAGEMENT
    if (p.includes("food-approval")) return badges.foodApprovals || 0
    if (l === "foods") return badges.foods || 0

    // RESTAURANT MANAGEMENT
    if (l === "restaurants") return (badges.restaurants || 0) + (badges.restaurantComplaints || 0)
    if (p.includes("restaurants/joining-request")) return badges.restaurants || 0
    if (p.includes("restaurants/complaints")) return badges.restaurantComplaints || 0

    // ORDER MANAGEMENT
    if (l === "orders") return (badges.orders || 0) + (badges.offlinePayments || 0)
    if (p.includes("orders/pending")) return badges.orders || 0
    if (p.includes("orders/offline-payments")) return badges.offlinePayments || 0

    // CUSTOMER MANAGEMENT
    if (p.includes("contact-messages")) return badges.contactMessages || 0
    if (p === "/admin/food/support-tickets") return badges.userSupportTickets || 0

    // DELIVERYMAN MANAGEMENT
    if (l === "deliveryman") return (badges.deliveryPartners || 0) + (badges.earningAddons || 0)
    if (p.includes("delivery-partners/join-request")) return badges.deliveryPartners || 0
    if (p.includes("delivery-withdrawal")) return badges.deliveryWithdrawals || 0
    if (p.includes("delivery-emergency-help")) return badges.emergencyHelp || 0
    if (p.includes("delivery-support-tickets")) return badges.deliverySupportTickets || 0
    if (p.includes("earning-addon-history")) return badges.earningAddons || 0

    // HELP & SUPPORT
    if (p.includes("safety-emergency-reports")) return badges.safetyReports || 0

    // TRANSACTION MANAGEMENT
    if (p.includes("restaurant-withdraws")) return badges.restaurantWithdrawals || 0

    return 0
  }
  const [logoUrl, setLogoUrl] = useState(() => localStorage.getItem('admin_app_logo') || getCachedSettings()?.logo?.url || null)
  const [companyName, setCompanyName] = useState(() => getCachedSettings()?.companyName || null)

  // Load business settings logo
  useEffect(() => {
    const loadLogo = async () => {
      try {
        const adminLogo = localStorage.getItem('admin_app_logo');
        if (adminLogo) {
          setLogoUrl(adminLogo);
        } else {
          // First check cache
          let cached = getCachedSettings()
          if (cached) {
            if (cached.logo?.url) {
              setLogoUrl(cached.logo.url)
            }
            if (cached.companyName) {
              setCompanyName(cached.companyName)
            }
          }

          // Always try to load fresh data to ensure we have the latest
          const settings = await loadBusinessSettings()
          if (settings) {
            if (settings.logo?.url) {
              setLogoUrl(settings.logo.url)
            }
            if (settings.companyName) {
              setCompanyName(settings.companyName)
            }
          }
        }
      } catch (error) {
        debugError('Error loading logo:', error)
      }
    }

    // Load immediately
    loadLogo()

    // Listen for business settings updates
    const handleSettingsUpdate = () => {
      const adminLogo = localStorage.getItem('admin_app_logo');
      if (adminLogo) {
        setLogoUrl(adminLogo);
      } else {
        const cached = getCachedSettings()
        if (cached) {
          if (cached.logo?.url) {
            setLogoUrl(cached.logo.url)
          }
          if (cached.companyName) {
            setCompanyName(cached.companyName)
          }
        }
      }
    }

    // Listen for themeLoaded
    const handleThemeLoaded = () => {
      const adminLogo = localStorage.getItem('admin_app_logo');
      if (adminLogo) setLogoUrl(adminLogo);
    };

    window.addEventListener('businessSettingsUpdated', handleSettingsUpdate)
    window.addEventListener('themeLoaded', handleThemeLoaded)

    return () => {
      window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate)
      window.removeEventListener('themeLoaded', handleThemeLoaded)
    }
  }, [])

  // Get initial states from consolidated admin_sidebar_state
  const getInitialStates = () => {
    try {
      const saved = localStorage.getItem('admin_sidebar_state')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch (e) {
      debugError('Error loading sidebar state:', e)
    }
    return { isCollapsed: false, expandedSections: {} }
  }

  const [isCollapsed, setIsCollapsed] = useState(() => getInitialStates().isCollapsed)
  const isVisuallyCollapsed = isCollapsed && !isOpen
  const [expandedSections, setExpandedSections] = useState(() => {
    const initialState = getInitialStates().expandedSections
    if (Object.keys(initialState || {}).length > 0) return initialState

    // Generate defaults if empty
    const state = {}
    adminSidebarMenu.forEach((item) => {
      if (item.type === "section") {
        item.items.forEach((suTuggom) => {
          if (suTuggom.type === "expandable") {
            state[suTuggom.label.toLowerCase().replace(/\s+/g, "")] = false
          }
        })
      }
    })
    return state
  })

  // Save states to consolidated localStorage and notify parent
  useEffect(() => {
    try {
      const currentState = JSON.parse(localStorage.getItem('admin_sidebar_state') || '{}')
      localStorage.setItem('admin_sidebar_state', JSON.stringify({
        ...currentState,
        isCollapsed
      }))
      if (onCollapseChange) {
        onCollapseChange(isCollapsed)
      }
    } catch (e) {
      debugError('Error saving sidebar collapsed state:', e)
    }
  }, [isCollapsed, onCollapseChange])

  // Notify parent on initial load
  useEffect(() => {
    if (onCollapseChange) {
      onCollapseChange(isCollapsed)
    }
  }, [])

  const toggleCollapse = () => {
    setIsCollapsed(prev => !prev)
  }

  // expandedSections state is initialized above in getInitialStates consolidation


  // Filter menu items based on search query and sub-admin permissions
  const filteredMenuData = useMemo(() => {
    let sourceMenu = adminSidebarMenu

    if (adminUser?.role === 'SUB_ADMIN') {
      const allowed = adminUser.accessibleModules || []
      sourceMenu = []
      adminSidebarMenu.forEach((item) => {
        if (item.type === "section") {
          const filteredItems = item.items.reduce((acc, suTuggom) => {
            if (suTuggom.type === "expandable") {
              // Check if they have the main parent permission OR any specific sub-permission
              const allowedSuTuggoms = (suTuggom.suTuggoms || []).filter(si =>
                allowed.includes(suTuggom.label) || allowed.includes(si.label)
              )
              if (allowedSuTuggoms.length > 0) {
                acc.push({ ...suTuggom, suTuggoms: allowedSuTuggoms })
              } else if (allowed.includes(suTuggom.label)) {
                // If no specific sub-items allowed but parent is allowed, show all (backwards compatibility)
                acc.push(suTuggom)
              }
            } else if (allowed.includes(suTuggom.label)) {
              acc.push(suTuggom)
            }
            return acc
          }, [])
          if (filteredItems.length > 0) {
            sourceMenu.push({ ...item, items: filteredItems })
          }
        } else if (item.type === "link" || item.type === "expandable") {
          if (allowed.includes(item.label)) {
            sourceMenu.push(item)
          }
        }
      })
    }

    if (!searchQuery.trim()) {
      return sourceMenu
    }

    const query = searchQuery.toLowerCase().trim()
    const filtered = []

    sourceMenu.forEach((item) => {
      if (item.type === "link") {
        if (item.label.toLowerCase().includes(query)) {
          filtered.push(item)
        }
      } else if (item.type === "section") {
        const filteredItems = []

        item.items.forEach((suTuggom) => {
          if (suTuggom.type === "link") {
            if (suTuggom.label.toLowerCase().includes(query)) {
              filteredItems.push(suTuggom)
            }
          } else if (suTuggom.type === "expandable") {
            const matchesLabel = suTuggom.label.toLowerCase().includes(query)
            const matchingSuTuggoms = suTuggom.suTuggoms?.filter(
              (si) => si.label.toLowerCase().includes(query)
            ) || []

            if (matchesLabel || matchingSuTuggoms.length > 0) {
              filteredItems.push({
                ...suTuggom,
                suTuggoms: matchesLabel ? suTuggom.suTuggoms : matchingSuTuggoms,
              })
            }
          }
        })

        if (filteredItems.length > 0) {
          filtered.push({
            ...item,
            items: filteredItems,
          })
        }
      }
    })

    return filtered
  }, [searchQuery, adminUser])

  // Auto-expand sections with matches when searching
  useEffect(() => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()

      setExpandedSections((prev) => {
        const newExpandedState = { ...prev }

        adminSidebarMenu.forEach((item) => {
          if (item.type === "section") {
            item.items.forEach((suTuggom) => {
              if (suTuggom.type === "expandable") {
                const matchesLabel = suTuggom.label.toLowerCase().includes(query)
                const hasMatchingSuTuggoms = suTuggom.suTuggoms?.some(
                  (si) => si.label.toLowerCase().includes(query)
                )

                if (matchesLabel || hasMatchingSuTuggoms) {
                  const sectionKey = suTuggom.label.toLowerCase().replace(/\s+/g, "")
                  newExpandedState[sectionKey] = true
                }
              }
            })
          }
        })

        return newExpandedState
      })
    }
  }, [searchQuery])

  const isActive = (path, allPaths = []) => {
    const currentPath = location.pathname.replace(/\/+$/, "") || "/"
    const targetPath = String(path || "").replace(/\/+$/, "") || "/"
    const matchesPath = (candidatePath) =>
      currentPath === candidatePath || currentPath.startsWith(`${candidatePath}/`)

    if (targetPath === "/admin" || targetPath === "/admin/food") {
      return currentPath === targetPath
    }

    // For suTuggoms, check if this is the most specific match
    if (allPaths.length > 0) {
      // Sort paths by length (longest first) to find most specific match
      const sortedPaths = [...allPaths].sort((a, b) => b.length - a.length)
      const bestMatch = sortedPaths.find((candidatePath) =>
        matchesPath(String(candidatePath || "").replace(/\/+$/, "") || "/")
      )
      return (String(bestMatch || "").replace(/\/+$/, "") || "/") === targetPath
    }

    return matchesPath(targetPath)
  }

  useEffect(() => {
    try {
      const currentState = JSON.parse(localStorage.getItem('admin_sidebar_state') || '{}')
      localStorage.setItem('admin_sidebar_state', JSON.stringify({
        ...currentState,
        expandedSections
      }))
    } catch (e) {
      debugError('Error saving sidebar state:', e)
    }
  }, [expandedSections])

  const toggleSection = (sectionKey) => {
    setExpandedSections((prev) => {
      const isCurrentlyOpen = Boolean(prev[sectionKey])

      // Accordion behavior:
      // 1) If current section is open -> close it.
      // 2) If current section is closed -> open it and close all others.
      if (isCurrentlyOpen) {
        return {
          ...prev,
          [sectionKey]: false,
        }
      }

      const next = {}
      Object.keys(prev).forEach((key) => {
        next[key] = key === sectionKey
      })
      return next
    })
  }

  const renderMenuItem = (item, index, isInSection = false) => {
    if (item.type === "link") {
      const Icon = iconMap[item.icon] || Utensils
      return (
        <Link
          key={item.path || item.label || index}
          to={item.path}
          onClick={() => {
            if (window.innerWidth < 1024 && onClose) {
              onClose()
            }
          }}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-300 ease-out menu-item-animate text-left",
            isInSection ? "text-base font-bold" : "text-base font-bold",
            item.label === "Log out" ? "text-red-500 hover:bg-red-500/10 hover:text-red-400" :
              isActive(item.path)
                ? "bg-white/10 text-white border border-white/15"
                : "text-neutral-100 hover:bg-white/5 hover:text-white",
            isVisuallyCollapsed && "justify-center px-2"
          )}
          style={{ animationDelay: `${index * 0.05}s` }}
          title={isVisuallyCollapsed ? item.label : undefined}
        >
          <Icon className={cn(
            "shrink-0 transition-all duration-300 text-left",
            isInSection ? "w-4 h-4" : "w-4 h-4",
            isActive(item.path) ? "text-white scale-110" : "text-neutral-300"
          )} />
          {!isVisuallyCollapsed && (
            <div className="flex-1 flex items-center justify-between overflow-hidden">
              <span className="text-left font-bold">
                {item.label}
              </span>
              {getBadgeCount(item.label, item.path) > 0 && (
                <span className="shrink-0 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 min-w-[18px] text-center">
                  {getBadgeCount(item.label, item.path) > 99 ? "99+" : getBadgeCount(item.label, item.path)}
                </span>
              )}
            </div>
          )}
          {isVisuallyCollapsed && getBadgeCount(item.label, item.path) > 0 && (
            <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-orange-500 rounded-full border-2 border-neutral-950 animate-pulse" />
          )}
        </Link>
      )
    }

    if (item.type === "expandable") {
      const Icon = iconMap[item.icon] || Utensils
      const sectionKey = item.label.toLowerCase().replace(/\s+/g, "")
      const isExpanded = expandedSections[sectionKey] || false

      if (isVisuallyCollapsed) {
        return (
          <div key={item.path || item.label || index} className="menu-item-animate" style={{ animationDelay: `${index * 0.05}s` }}>
            <button
              onClick={() => toggleSection(sectionKey)}
              className={cn(
                "w-full flex items-center justify-center px-2 py-2 rounded-lg transition-all duration-300 ease-out text-base font-bold",
                "text-white hover:bg-white/5"
              )}
              title={item.label}
            >
              <div className="relative">
                <Icon className="w-4 h-4 shrink-0 text-neutral-300 transition-transform duration-300" />
                {getBadgeCount(item.label, item.path) > 0 && (
                  <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-orange-500 rounded-full border-2 border-neutral-950 animate-pulse" />
                )}
              </div>
            </button>
          </div>
        )
      }

      return (
        <div key={item.path || item.label || index} className="menu-item-animate" style={{ animationDelay: `${index * 0.05}s` }}>
          <button
            onClick={() => toggleSection(sectionKey)}
            className={cn(
              "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-all duration-300 ease-out text-base font-bold text-left",
              "text-white hover:bg-white/5"
            )}
          >
            <div className="flex items-center gap-2.5 text-left flex-1 min-w-0">
              <Icon className="w-4 h-4 shrink-0 text-neutral-100 transition-transform duration-300" />
              <span className="font-bold text-left">{item.label}</span>
              {getBadgeCount(item.label, item.path) > 0 && (
                <span className="shrink-0 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 min-w-[18px] text-center">
                  {getBadgeCount(item.label, item.path) > 99 ? "99+" : getBadgeCount(item.label, item.path)}
                </span>
              )}
            </div>
            <div className="transition-transform duration-300 shrink-0" style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
              <ChevronDown className="w-4 h-4 shrink-0 text-neutral-300" />
            </div>
          </button>
          {isExpanded && item.suTuggoms && (
            <div className="ml-5 mt-1 space-y-1 border-neutral-800/60 pl-3 submenu-animate overflow-hidden">
              {item.suTuggoms.map((suTuggom, subIndex) => {
                const allSubPaths = item.suTuggoms.map(si => si.path)
                return (
                  <Link
                    key={suTuggom.path || suTuggom.label}
                    to={suTuggom.path}
                    onClick={() => {
                      if (window.innerWidth < 1024 && onClose) {
                        onClose()
                      }
                    }}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-md transition-all duration-300 ease-out text-base font-bold text-left",
                      isActive(suTuggom.path, allSubPaths)
                        ? "bg-white/10 text-white"
                        : "text-neutral-100 hover:bg-white/5 hover:text-white"
                    )}
                    style={{ animationDelay: `${subIndex * 0.03}s` }}
                  >
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-300",
                      isActive(suTuggom.path, allSubPaths) ? "bg-white scale-125" : "bg-neutral-400"
                    )}></span>
                    <span className="text-left flex-1">{suTuggom.label}</span>
                    {getBadgeCount(suTuggom.label, suTuggom.path) > 0 && (
                      <span className="shrink-0 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 min-w-[18px] text-center">
                        {getBadgeCount(suTuggom.label, suTuggom.path) > 99 ? "99+" : getBadgeCount(suTuggom.label, suTuggom.path)}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    return null
  }

  return (
    <>
      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        
        @keyframes expandDown {
          from {
            opacity: 0;
            max-height: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            max-height: 500px;
            transform: translateY(0);
          }
        }
        
        .menu-item-animate {
          animation: slideIn 0.3s ease-out forwards;
        }
        
        .submenu-animate {
          animation: expandDown 0.3s ease-out forwards;
        }
        
        .admin-sidebar-scroll {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
        }
        
        .admin-sidebar-scroll::-webkit-scrollbar {
          width: 2px;
        }
        .admin-sidebar-scroll::-webkit-scrollbar-track {
          background: rgba(17, 24, 39, 0.4);
        }
        .admin-sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 10px;
          transition: background 0.2s ease;
        }
        .admin-sidebar-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.35);
        }
        .admin-sidebar-scroll:hover::-webkit-scrollbar {
          width: 6px;
        }
        .admin-sidebar-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.25) rgba(17, 24, 39, 0.4);
        }
      `}</style>
      <div
        className={cn(
          "border-r border-neutral-700/30 fixed left-0 top-0 z-[70] flex h-[100dvh] flex-col overflow-hidden",
          "transform transition-all duration-300 ease-in-out",
          "lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
          "w-[min(20rem,calc(100vw-1.5rem))]",
          isVisuallyCollapsed ? "lg:w-20" : "lg:w-80",
          "bg-[#576574]"
        )}
        style={{
          backgroundColor: 'var(--ad-primary, #576574)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Header with Logo and Brand */}
        <div
          className="shrink-0 px-3 py-3 border-b border-neutral-700/30 animate-[fadeIn_0.4s_ease-out] bg-[#4a5664]"
          style={{ backgroundColor: 'var(--ad-primary-strong, #4a5664)' }}
        >
          <div className="flex items-center justify-between mb-3">
            {!isVisuallyCollapsed && (
              <div className="flex items-center gap-2 animate-[slideIn_0.3s_ease-out]">
                <div className="w-24 h-12 rounded-lg flex items-center justify-center shadow-black/20">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={companyName || "Company"}
                      className="w-24 h-10 object-contain"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : companyName ? (
                    <span className="text-xs font-semibold text-white px-2 truncate">
                      {companyName}
                    </span>
                  ) : (
                    <span className="text-sm font-bold text-white">T</span>
                  )}
                </div>
              </div>
            )}
            {isVisuallyCollapsed && (
              <div className="w-full flex items-center justify-center">
                <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shadow-lg shadow-black/20 ring-1 ring-white/10">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={companyName || "Company"}
                      className="w-10 h-10 object-contain"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <span className="text-sm font-bold text-white">{(companyName || 'T').charAt(0).toUpperCase()}</span>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleCollapse}
                className="hidden lg:inline-flex text-neutral-300 hover:text-white transition-all duration-200 hover:scale-110 p-1.5 rounded-lg hover:bg-white/5"
                title={isVisuallyCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {isVisuallyCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={onClose}
                className="lg:hidden text-neutral-300 hover:text-white transition-all duration-200 hover:scale-110"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Admin Panel Label */}
          {!isVisuallyCollapsed && (
            <div className="mb-3 animate-[slideIn_0.4s_ease-out_0.1s_both]">
              <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider text-left">
                Admin Panel
              </h2>
            </div>
          )}

          {/* Search Bar */}
          {!isVisuallyCollapsed && (
            <div className="relative animate-[slideIn_0.4s_ease-out_0.2s_both]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-400 w-4 h-4 z-10 transition-colors duration-200" />
              <Input
                type="text"
                placeholder="Search Menu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
                spellCheck="false"
                autoCorrect="off"
                autoCapitalize="off"
                className={cn(
                  "w-full pl-9 py-2.5 bg-[#404c59] border border-[#394450] rounded-lg text-base font-bold text-white placeholder:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/40 transition-all duration-200 text-left",
                  searchQuery ? "pr-9" : "pr-3"
                )}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-neutral-400 hover:text-white transition-all duration-200 hover:scale-110 z-10"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Navigation Menu */}
        <nav className="admin-sidebar-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 py-3 space-y-2">
          {filteredMenuData.length === 0 && searchQuery.trim() ? (
            <div className="px-3 py-12 text-left animate-[fadeIn_0.4s_ease-out]">
              <p className="text-neutral-300 text-sm font-medium text-left">No menu items found</p>
              <p className="text-neutral-500 text-sm mt-2 text-left">Try a different search term</p>
            </div>
          ) : (
            filteredMenuData.map((item, index) => {
              if (item.type === "link") {
                return renderMenuItem(item, index)
              }

              if (item.type === "section") {
                return (
                  <div
                    key={item.label || index}
                    className={cn(
                      index > 0 ? "mt-4 pt-4 border-t border-neutral-800/60" : "",
                      "animate-[fadeIn_0.4s_ease-out]"
                    )}
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    <div className="px-3 py-2 mb-2 flex items-center justify-between">
                      <span className="text-neutral-300 font-semibold text-base text-left">
                        {item.label}
                      </span>
                      {item.items.some(suTuggom => {
                        const count = getBadgeCount(suTuggom.label, suTuggom.path);
                        if (count > 0) return true;
                        if (suTuggom.type === "expandable" && suTuggom.suTuggoms) {
                          return suTuggom.suTuggoms.some(si => getBadgeCount(si.label, si.path) > 0);
                        }
                        return false;
                      }) && (
                          <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                        )}
                    </div>
                    <div className="space-y-1">
                      {item.items.map((suTuggom, subIndex) => renderMenuItem(suTuggom, `${index}-${subIndex}`, true))}
                    </div>
                  </div>
                )
              }

              return null
            })
          )}
        </nav>
      </div>
    </>
  )
}





