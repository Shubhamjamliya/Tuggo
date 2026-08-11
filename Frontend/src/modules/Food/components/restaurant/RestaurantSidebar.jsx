import { Link, useLocation } from "react-router-dom"
import {
  FileText,
  Package,
  MessageSquare,
  LayoutDashboard,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { cn } from "@food/utils/utils"
import { RESTAURANT_SIDEBAR_SECTIONS } from "@food/utils/restaurantLayoutConfig"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"
import { useState, useEffect } from "react"

const ICON_MAP = {
  dashboard: LayoutDashboard,
  orders: FileText,
  inventory: Package,
  feedback: MessageSquare,
}

export default function RestaurantSidebar({
  isOpen,
  onClose,
  collapsed,
  onToggleCollapse,
}) {
  const { pathname } = useLocation()
  const [companyName, setCompanyName] = useState("Restaurant Panel")
  const [logoUrl, setLogoUrl] = useState(null)

  useEffect(() => {
    const apply = (settings) => {
      if (settings?.companyName) setCompanyName(settings.companyName)
      const resLogo = settings?.restaurantLogo?.url || settings?.logo?.url
      if (resLogo) setLogoUrl(resLogo)
    }
    const cached = getCachedSettings()
    if (cached) apply(cached)
    else loadBusinessSettings().then((s) => s && apply(s))

    const onUpdate = () => {
      const c = getCachedSettings()
      if (c) apply(c)
    }
    window.addEventListener("businessSettingsUpdated", onUpdate)
    return () => window.removeEventListener("businessSettingsUpdated", onUpdate)
  }, [])

  const isActive = (route) => {
    if (route === "/food/restaurant") return pathname === route
    return pathname === route || pathname.startsWith(`${route}/`)
  }

  return (
    <>
      <aside
        className={cn(
          "restaurant-sidebar fixed inset-y-0 left-0 z-50 flex flex-col border-r border-[var(--rt-border)] bg-white transition-transform duration-300 ease-in-out",
          collapsed ? "w-20" : "w-72",
          "max-lg:shadow-2xl",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--rt-border)] px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl && (
              <img
                src={logoUrl}
                alt=""
                className="h-9 w-9 shrink-0 rounded-lg object-contain"
              />
            )}
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-[var(--rt-text)]">
                  {companyName}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--rt-muted)]">
                  Partner panel
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <ChevronLeft className="h-5 w-5" />
            )}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {RESTAURANT_SIDEBAR_SECTIONS.map((section) => (
            <div key={section.title} className="mb-5">
              {!collapsed && (
                <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-widest text-[var(--rt-muted)]">
                  {section.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon ? ICON_MAP[item.icon] : null
                  const active = isActive(item.route)
                  return (
                    <li key={item.route}>
                      <Link
                        to={item.route}
                        onClick={onClose}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                          active
                            ? "bg-[var(--rt-primary-soft)] text-[var(--rt-primary)]"
                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                          collapsed && "justify-center px-2"
                        )}
                      >
                        {Icon && <Icon className="h-5 w-5 shrink-0" />}
                        {!collapsed && (
                          <span className="truncate">{item.label}</span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}
