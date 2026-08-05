import { useEffect, useRef, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import {
  User,
  ArrowRight,
  Bike,
  Ticket,
  ChevronRight,
  Share2,
  LogOut,
  X,
  Loader2,
  Briefcase,
  Trash2,
  AlertTriangle,
  Bell
} from "lucide-react"
import { deliveryAPI, notificationAPI } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import { toast } from "sonner"
import { clearModuleAuth } from "@food/utils/auth"
import { registerWebPushForCurrentModule } from "@food/utils/firebaseMessaging"

/**
 * ProfileV2 - 1:1 EXACT Restoration of the Legacy Profile Hub.
 * Matches ProfilePage.jsx exactly.
 */
export const ProfileV2 = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [referralReward, setReferralReward] = useState(0)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [logoutSubmitting, setLogoutSubmitting] = useState(false)
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [deleteStep, setDeleteStep] = useState(1)
  const [deleteCaptcha, setDeleteCaptcha] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [isTestingNotification, setIsTestingNotification] = useState(false)

  const normalizeImageUrl = (imageUrl) => {
    if (typeof imageUrl !== 'string' || !imageUrl) return '';
    if (imageUrl.startsWith('http')) return imageUrl;
    
    let backendOrigin = '';
    if (API_BASE_URL && API_BASE_URL.startsWith('http')) {
       backendOrigin = API_BASE_URL.replace(/\/api(\/v\d+)?\/?$/i, '').replace(/\/+$/, '');
    } else if (typeof window !== 'undefined') {
       backendOrigin = window.location.origin;
    } else {
       backendOrigin = 'http://localhost:5000';
    }
    
    return `${backendOrigin}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
  };

  useEffect(() => {
    // Register for push notifications on mount for this module
    registerWebPushForCurrentModule().catch(err => {
      console.error("Failed to register push notifications:", err)
    })
  }, [])

  // Fetch profile data
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true)
        const response = await deliveryAPI.getProfile()
        if (response?.data?.success && response?.data?.data?.profile) {
          setProfile(response.data.data.profile)
        }
      } catch (error) {
        toast.error("Failed to load profile data")
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [])

  useEffect(() => {
    deliveryAPI.getReferralStats().then((res) => {
      const reward = res?.data?.data?.stats?.rewardAmount
      setReferralReward(Number(reward) || 0)
    }).catch(() => {})
  }, [])

  const refId = profile?._id || profile?.id || profile?.referralCode || ""
  const referralLink = refId ? `${window.location.origin}/food/delivery/signup?ref=${encodeURIComponent(String(refId))}` : ""

  const handleShareReferral = async () => {
    if (!referralLink) return
    const rewardText = referralReward > 0 ? `₹${referralReward}` : "rewards"
    const shareText = `Join as a delivery partner and earn ${rewardText}.`
    try {
      if (navigator.share) {
        await navigator.share({ title: "Delivery referral", text: shareText, url: referralLink })
      } else {
        const fallbackUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralLink}`)}`
        window.open(fallbackUrl, "_blank", "noopener,noreferrer")
      }
    } catch (e) {}
  }

  const handleLogout = async () => {
    if (logoutSubmitting) return
    setShowLogoutConfirm(false)
    try {
      setLogoutSubmitting(true)
      let fcmToken = null;
      let voipToken = null;
      let platform = "web";
      let devicePlatform = "web";
      let deviceId = null;
      if (typeof window !== "undefined" && window.flutter_inappwebview) {
        platform = "mobile";
        const fcmHandlerNames = ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"];
        for (const handlerName of fcmHandlerNames) {
          try {
            const t = await Promise.race([
              window.flutter_inappwebview.callHandler(handlerName, { module: "delivery" }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1500))
            ]);
            if (t && typeof t === "string" && t.length > 20) {
              fcmToken = t.trim();
              break;
            }
          } catch (e) {
            console.warn(`Bridge handler ${handlerName} failed or timed out`, e);
          }
        }

        const platformHandlerNames = ["getDevicePlatform", "getPlatform", "getNativePlatform"];
        for (const handlerName of platformHandlerNames) {
          try {
            const value = await Promise.race([
              window.flutter_inappwebview.callHandler(handlerName, { module: "delivery" }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1000))
            ]);
            const normalized = String(value || "").trim().toLowerCase();
            if (["ios", "android", "web"].includes(normalized)) {
              devicePlatform = normalized;
              break;
            }
          } catch (e) {
            console.warn(`Platform bridge handler ${handlerName} failed or timed out`, e);
          }
        }

        if (devicePlatform === "ios") {
          const voipHandlerNames = ["getVoipToken", "getVOIPToken", "getPushKitToken"];
          for (const handlerName of voipHandlerNames) {
            try {
              const t = await Promise.race([
                window.flutter_inappwebview.callHandler(handlerName, { module: "delivery" }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1500))
              ]);
              if (t && typeof t === "string" && t.length > 20) {
                voipToken = t.trim();
                break;
              }
            } catch (e) {
              console.warn(`VoIP bridge handler ${handlerName} failed or timed out`, e);
            }
          }
        }

        if (!fcmToken) {
          fcmToken = localStorage.getItem("fcm_web_registered_token_delivery") || null;
        }
      } else {
        fcmToken = localStorage.getItem("fcm_web_registered_token_delivery") || null;
      }

      const tokenSeed = String(voipToken || fcmToken || "").trim().slice(-16);
      deviceId = tokenSeed ? ["tuggo", "delivery", devicePlatform || "unknown", tokenSeed].join(":") : null;
      
      if (deviceId || fcmToken || voipToken) {
        try {
          await deliveryAPI.removePushDevice({ deviceId, fcmToken, voipToken });
        } catch (e) {
          console.warn("Failed to remove push device directly", e);
        }
      }

      if (fcmToken) {
        try {
          await deliveryAPI.removeFcmToken(fcmToken, platform);
        } catch (e) {
          console.warn("Failed to remove FCM token directly", e);
        }
      }

      await deliveryAPI.logout(null, fcmToken, platform)
    } catch (error) {}
    clearModuleAuth("delivery")
    localStorage.removeItem("app:isOnline")
    toast.success("Logged out successfully")
    navigate("/food/delivery/login", { replace: true })
    setLogoutSubmitting(false)
  }

  const handleTestNotification = async () => {
    if (isTestingNotification) return
    setIsTestingNotification(true)
    try {
      let platform = "web"
      if (typeof window !== "undefined" && window.flutter_inappwebview) {
        platform = "mobile"
      }
      const response = await deliveryAPI.sendTestNotification(platform)
      const details = response?.data?.data || {}
      const successCount = details?.successCount || 0
      const failureCount = details?.failureCount || 0
      
      console.log("[FCM Test Details]:", details)
      if (successCount > 0) {
        toast.success(`Test sent! Delivered: ${successCount}, Failed: ${failureCount}`)
      } else {
        toast.error(`Test failed to deliver. Delivered: 0, Failed: ${failureCount}`)
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to send test notification")
    } finally {
      setIsTestingNotification(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center font-poppins">
        <div className="flex items-center gap-2 text-gray-700">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm font-medium">Loading profile...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 font-poppins pb-24">
      {/* Top Header */}
      <div className="w-full safe-top sticky top-0 z-50 shadow-sm" style={{ backgroundColor: 'var(--dv-primary)' }}>
        <div className="flex items-center justify-center px-4 py-4">
           <h1 className="text-lg font-black text-white uppercase tracking-wider">Profile</h1>
        </div>
      </div>

      {/* Profile Header Block */}
      <div className="bg-white p-4 w-full shadow-sm">
        <div 
          onClick={() => navigate("/food/delivery/profile/details")}
          className="flex items-start justify-between cursor-pointer"
        >
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-2xl md:text-3xl font-bold">{profile?.name || ""}</h2>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-gray-600 text-sm md:text-base mb-3 font-medium">{profile?.deliveryId || ""}</p>
          </div>
          <div className="relative shrink-0 ml-4">
            {profile?.profileImage?.url ? (
              <img src={normalizeImageUrl(profile.profileImage.url)} alt="Profile" className="w-20 h-20 md:w-24 md:h-24 rounded-full object-cover border-2 border-gray-200" />
            ) : (
              <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gray-100 flex items-center justify-center border-2 border-gray-200">
                <User className="w-10 h-10 md:w-12 md:h-12 text-gray-400" />
              </div>
            )}
            <div className="absolute bottom-0 right-0 bg-white rounded-full p-2 shadow-md border-2 border-white">
              <Briefcase className="w-4 h-4 text-gray-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-6">
        {/* Navigation Buttons */}
        <div className="grid grid-cols-1 gap-3 mb-6">
          <button
            onClick={() => navigate("/food/delivery/history")}
            className="bg-white rounded-xl p-4 flex flex-col items-center gap-2 border border-transparent active:bg-gray-50 transition-colors"
          >
            <div className="rounded-full bg-gray-50 p-3">
              <Bike className="w-6 h-6 text-gray-700" />
            </div>
            <span className="text-sm font-bold text-gray-900">Trips history</span>
          </button>
        </div>

        {/* Sections */}
        <div className="space-y-4">
          {/* Shift Details */}
          {profile?.shiftStartPic && (
            <div className="bg-white rounded-xl p-4 flex flex-col gap-3">
              <h3 className="text-gray-400 text-[10px] font-black uppercase tracking-[0.2em]">Current Shift Verification</h3>
              <div className="flex gap-4 items-center">
                <div className="w-20 h-20 shrink-0 rounded-xl border-2 border-green-500 overflow-hidden shadow-sm">
                  <img src={profile.shiftStartPic} alt="Shift Start" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 mb-1">
                    Started at {new Date(profile.shiftStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  {profile.shiftStartAddress && (
                    <p className="text-xs text-gray-500 font-medium line-clamp-2">
                      {profile.shiftStartAddress}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* Share & Earn */}
          <div className="bg-white rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900 mb-1">
                Share & Earn{referralReward > 0 ? ` ₹${referralReward}` : ""}
              </h3>
              <p className="text-gray-500 text-xs font-medium">Invite friends to join the delivery partner fleet.</p>
            </div>
            <button
              onClick={handleShareReferral}
              className="shrink-0 bg-black text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest shadow-md"
            >
              Share
            </button>
          </div>

          {/* Support Section */}
          <div>
            <h3 className="text-gray-400 text-[10px] font-black uppercase tracking-[0.2em] mb-3 px-1">Support</h3>
            <div 
              onClick={() => navigate("/food/delivery/help/tickets")}
              className="bg-white rounded-xl p-4 flex items-center justify-between cursor-pointer active:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Ticket className="w-5 h-5 text-gray-700" />
                <span className="text-sm font-bold text-gray-900">Support tickets</span>
              </div>
              <ArrowRight className="w-5 h-5 text-gray-300" />
            </div>
          </div>

          {/* Test Notification (Debug) */}
          <div className="pt-0">
            <div
              onClick={handleTestNotification}
              className="bg-white rounded-xl p-4 flex items-center justify-between cursor-pointer border border-blue-50 hover:bg-blue-50/30 active:bg-blue-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Bell className={`w-5 h-5 text-blue-500 ${isTestingNotification ? "animate-pulse" : ""}`} />
                <span className="text-sm font-bold text-gray-900">{isTestingNotification ? "Sending test..." : "Test Notification"}</span>
              </div>
              <ArrowRight className="w-5 h-5 text-blue-200" />
            </div>
          </div>

          {/* Delete Account */}
          <div className="pt-0">
            <div
              onClick={() => { setDeleteStep(1); setDeleteCaptcha(""); setDeleteAccountOpen(true); }}
              className="bg-white rounded-xl p-4 flex items-center justify-between cursor-pointer border border-red-100 hover:bg-red-50/30 active:bg-red-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Trash2 className="w-5 h-5 text-red-500" />
                <span className="text-sm font-bold text-red-500">Delete Account</span>
              </div>
              <ArrowRight className="w-5 h-5 text-red-200" />
            </div>
          </div>

          {/* Logout Section */}
          <div className="pt-2">
            <div 
              onClick={() => setShowLogoutConfirm(true)}
              className="bg-white rounded-xl p-4 flex items-center justify-between cursor-pointer border border-red-50 hover:bg-red-50/30 active:bg-red-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <LogOut className="w-5 h-5 text-red-600" />
                <span className="text-sm font-bold text-red-600">Log out</span>
              </div>
              <ArrowRight className="w-5 h-5 text-red-100" />
            </div>
          </div>
        </div>
      </div>

      {/* Logout Confirm Popup */}
      {showLogoutConfirm && (
        <div 
          className="fixed inset-0 bg-black/60 z-[1000] flex items-center justify-center px-4"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div 
            className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-black text-gray-900 mb-2">Do you want to log out?</h3>
            <p className="text-sm text-gray-500 mb-5">You will be signed out from your delivery account.</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-700 font-bold"
              >
                No
              </button>
              <button
                onClick={handleLogout}
                disabled={logoutSubmitting}
                className="flex-1 h-11 rounded-xl bg-red-600 text-white font-bold disabled:opacity-60"
              >
                {logoutSubmitting ? "Logging out..." : "Yes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation */}
      {deleteAccountOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-[1000] flex items-center justify-center px-4"
          onClick={() => setDeleteAccountOpen(false)}
        >
          <div
            className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {deleteStep === 1 && (
              <div className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-red-100 rounded-full p-2.5">
                    <AlertTriangle className="h-6 w-6 text-red-500" />
                  </div>
                  <h3 className="text-base font-black text-gray-900">Delete Account?</h3>
                </div>
                <div className="bg-red-50 rounded-xl p-3.5 mb-4 border border-red-100">
                  <p className="text-sm font-semibold text-red-600 mb-2">⚠️ This action is permanent!</p>
                  <ul className="text-xs text-red-500/80 space-y-1.5">
                    <li>• Your profile and documents will be deleted</li>
                    <li>• Wallet balance and earnings will be forfeited</li>
                    <li>• Trip history will be anonymized</li>
                    <li>• Pending withdrawals will be cancelled</li>
                    <li>• You can register again as a new partner</li>
                  </ul>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setDeleteAccountOpen(false)}
                    className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-700 font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setDeleteStep(2)}
                    className="flex-1 h-11 rounded-xl bg-red-500 text-white font-bold"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {deleteStep === 2 && (
              <div className="p-5">
                <h3 className="text-base font-black text-gray-900 mb-2">Confirm Deletion</h3>
                <p className="text-sm text-gray-500 mb-4">Type <span className="font-bold text-red-500">DELETE MY ACCOUNT</span> to confirm.</p>
                <input
                  type="text"
                  value={deleteCaptcha}
                  onChange={(e) => setDeleteCaptcha(e.target.value)}
                  placeholder="Type here..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
                  autoFocus
                  autoComplete="off"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setDeleteStep(1); setDeleteCaptcha(""); }}
                    className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-700 font-bold"
                  >
                    Back
                  </button>
                  <button
                    onClick={async () => {
                      if (isDeleting) return;
                      setIsDeleting(true);
                      try {
                        await deliveryAPI.deleteAccount();
                        toast.success("Account deleted successfully");
                        clearModuleAuth("delivery");
                        localStorage.removeItem("app:isOnline");
                        navigate("/food/delivery/login", { replace: true });
                      } catch (err) {
                        toast.error(err?.response?.data?.message || "Failed to delete account");
                      } finally {
                        setIsDeleting(false);
                      }
                    }}
                    disabled={deleteCaptcha.trim() !== "DELETE MY ACCOUNT" || isDeleting}
                    className="flex-1 h-11 rounded-xl bg-red-500 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isDeleting ? "Deleting..." : "Delete Forever"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ProfileV2;
