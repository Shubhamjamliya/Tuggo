import { Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useEffect, Suspense, lazy, useRef } from "react"
import ProtectedRoute from "@food/components/ProtectedRoute"
import AuthRedirect from "@food/components/AuthRedirect"
import Loader from "@food/components/Loader"
import AuthInitializer from "@food/components/AuthInitializer"
import PushSoundEnableButton from "@food/components/PushSoundEnableButton"
import { registerWebPushForCurrentModule } from "@food/utils/firebaseMessaging"

// Lazy Loading Components
const UserRouter = lazy(() => import("@food/components/user/UserRouter"))

// Restaurant Module
const RestaurantRouter = lazy(() => import("@food/components/restaurant/RestaurantRouter"))

// Admin Module
const AdminRouter = lazy(() => import("@food/components/admin/AdminRouter"))
const AdminLogin = lazy(() => import("@food/pages/admin/auth/AdminLogin"))
const AdminSignup = lazy(() => import("@food/pages/admin/auth/AdminSignup"))
const AdminForgotPassword = lazy(() => import("@food/pages/admin/auth/AdminForgotPassword"))

// Delivery Module
const DeliveryRouter = lazy(() => import("../DeliveryV2"))

function UserPathRedirect() {
  const location = useLocation()
  // Correctly handle the /food/user -> /food redirect regardless of where it starts
  const newPath = location.pathname.replace("/user", "") || "/food"
  return <Navigate to={newPath} replace />
}

// Scroll to top on route change
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  const location = useLocation()
  const fcmRegisteredModulesRef = useRef(new Set())

  useEffect(() => {
    const path = location.pathname || ""
    let moduleName = "user"
    if (path.includes("/food/restaurant") || path.includes("/restaurant")) {
      moduleName = "restaurant"
    } else if (path.includes("/food/delivery") || path.includes("/delivery")) {
      moduleName = "delivery"
    } else if (path.includes("/food/admin") || path.includes("/admin")) {
      moduleName = "admin"
    }

    if (moduleName === "admin") return
    if (fcmRegisteredModulesRef.current.has(moduleName)) return

    registerWebPushForCurrentModule(location.pathname)
      .then((res) => {
        if (res !== false) {
          fcmRegisteredModulesRef.current.add(moduleName)
        }
      })
      .catch(() => {})
  }, [location.pathname])

  return (
    <AuthInitializer>
      <>
        <ScrollToTop />
        <PushSoundEnableButton />
        <Suspense fallback={<Loader />}>
          <Routes>
            {/* Restaurant Module - Already mapped to /restaurant */}
            <Route
              path="restaurant/*"
              element={
                <RestaurantRouter />
              }
            />

            {/* Delivery Module - Already mapped to /delivery */}
            <Route
              path="delivery/*"
              element={<DeliveryRouter />}
            />

            {/* Admin Module - Redirect /food/admin to /admin */}
            <Route path="admin/*" element={<Navigate to="/admin" replace />} />

            {/* User Module - Explicitly mapped to /user and the catch-all for /food/ and / */}
            {/* NOTE: /user/food is a common mis-navigation - redirect to correct /food/user home */}
            <Route path="user/food" element={<Navigate to="/food/user" replace />} />
            <Route
              path="user/*"
              element={<UserRouter />}
            />

            {/* Make UserRouter the default for all other paths to handle / and /food/ as user home */}
            <Route path="/*" element={<UserRouter />} />
          </Routes>
        </Suspense>
      </>
    </AuthInitializer>
  )
}
