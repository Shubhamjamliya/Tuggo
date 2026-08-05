import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Loader2 } from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Input } from "@food/components/ui/input"
import { Button } from "@food/components/ui/button"
import { deliveryAPI } from "@food/api"
import { setAuthData as storeAuthData } from "@food/utils/auth"
import { registerWebPushForCurrentModule, clearCachedFcmToken } from "@food/utils/firebaseMessaging"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function DeliveryOTP() {
  const navigate = useNavigate()
  const [otp, setOtp] = useState(["", "", "", "", "", ""])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [resendTimer, setResendTimer] = useState(0)
  const [authData, setAuthData] = useState(null)
  const [showNameInput, setShowNameInput] = useState(false)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState("")
  const [verifiedOtp, setVerifiedOtp] = useState("")
  const [pendingMessage, setPendingMessage] = useState("")
  const [isRejected, setIsRejected] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [deviceToken, setDeviceToken] = useState(null)
  const [activePlatform, setActivePlatform] = useState("web")
  const inputRefs = useRef([])

  useEffect(() => {
    // Get auth data from localStorage (delivery module key)
    const stored = localStorage.getItem("deliveryAuthData")
    if (stored) {
      const data = JSON.parse(stored)
      setAuthData(data)
    } else {
      // No active OTP flow: if already authenticated, go to delivery home
      const token = localStorage.getItem("delivery_accessToken")
      const authenticated = localStorage.getItem("delivery_authenticated") === "true"
      if (token && authenticated) {
        try {
          const parts = token.split('.')
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
            const now = Math.floor(Date.now() / 1000)
            if (payload.exp && payload.exp > now) {
              navigate("/food/delivery", { replace: true })
              return
            }
          }
        } catch (e) {
          // Ignore token parse errors and continue to sign-in redirect
        }
      }

      // No auth data, redirect to sign in
      navigate("/food/delivery/login", { replace: true })
      return
    }

    // OTP field should be empty - delivery boy needs to enter it manually
    // No auto-fill for delivery OTP

    // Start resend timer (60 seconds)
    setResendTimer(60)
    const timer = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // iOS Safari keyboard float fix
  useEffect(() => {
    const handleFocus = () => {
      if (typeof window !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) {
        setTimeout(() => {
          window.scrollTo(0, 0);
        }, 50);
      }
    };
    const inputs = document.querySelectorAll('input[type="tel"], input[type="text"]');
    inputs.forEach(input => input.addEventListener('focus', handleFocus));
    return () => {
      inputs.forEach(input => input.removeEventListener('focus', handleFocus));
    };
  }, [])

  useEffect(() => {
    // Don't auto-focus - let user manually enter OTP
    // Focus first input only if all fields are empty (small delay to ensure inputs are rendered)
    if (inputRefs.current[0] && otp.every(digit => digit === "")) {
      setTimeout(() => {
        inputRefs.current[0]?.focus()
      }, 100)
    }
  }, [otp])

  const handleChange = (index, value) => {
    // Only allow digits
    if (value && !/^\d$/.test(value)) {
      return
    }

    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)
    setError("")

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-submit when all 6 digits are entered and we are in OTP step
    if (!showNameInput && newOtp.every((digit) => digit !== "") && newOtp.length === 6) {
      handleVerify(newOtp.join(""))
    }
  }

  const handleKeyDown = (index, e) => {
    // Handle backspace
    if (e.key === "Backspace") {
      if (otp[index]) {
        // If current input has value, clear it
        const newOtp = [...otp]
        newOtp[index] = ""
        setOtp(newOtp)
      } else if (index > 0) {
        // If current input is empty, move to previous and clear it
        inputRefs.current[index - 1]?.focus()
        const newOtp = [...otp]
        newOtp[index - 1] = ""
        setOtp(newOtp)
      }
    }
    // Handle paste
    if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      navigator.clipboard.readText().then((text) => {
        const digits = text.replace(/\D/g, "").slice(0, 6).split("")
        const newOtp = [...otp]
        digits.forEach((digit, i) => {
          if (i < 6) {
            newOtp[i] = digit
          }
        })
        setOtp(newOtp)
        if (digits.length === 6) {
          handleVerify(newOtp.join(""))
        } else {
          inputRefs.current[digits.length]?.focus()
        }
      })
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData("text")
    const digits = pastedData.replace(/\D/g, "").slice(0, 6).split("")
    const newOtp = [...otp]
    digits.forEach((digit, i) => {
      if (i < 6) {
        newOtp[i] = digit
      }
    })
    setOtp(newOtp)
    if (!showNameInput && digits.length === 6) {
      handleVerify(newOtp.join(""))
      return
    }
    inputRefs.current[digits.length]?.focus()
  }

  const handleVerify = async (otpValue = null) => {
    if (showNameInput) {
      // In name collection step, ignore OTP auto-submit
      return
    }

    const code = otpValue || otp.join("")

    if (code.length !== 6) {
      return
    }

    setIsLoading(true)
    setError("")

    try {
      const phone = authData?.phone
      const purpose = authData?.purpose || "login"
      const providedName = authData?.isSignUp ? authData?.name || null : null
      if (!phone) {
        setError("Phone number not found. Please try again.")
        setIsLoading(false)
        return
      }

      // Try to get FCM token before verifying OTP
      let fcmToken = null;
      let platform = "web";
      try {
        if (typeof window !== "undefined") {
          if (window.flutter_inappwebview) {
            platform = "mobile";
            const handlerNames = ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"];
            for (const handlerName of handlerNames) {
              try {
                const t = await window.flutter_inappwebview.callHandler(handlerName, { module: "delivery" });
                if (t && typeof t === "string" && t.length > 20) {
                  fcmToken = t.trim();
                  break;
                }
              } catch (e) {}
            }
          } else {
            fcmToken = localStorage.getItem("fcm_web_registered_token_delivery") || null;
          }
        }
      } catch (e) {
        debugWarn("Failed to get FCM token during login", e);
      }

      setDeviceToken(fcmToken);
      setActivePlatform(platform);

      // Backend: POST /auth/delivery/verify-otp returns either:
      // - { needsRegistration: true } when no partner exists yet
      // - or { accessToken, refreshToken, user } for existing partners
      const response = await deliveryAPI.verifyOTP(phone, code, purpose, providedName, fcmToken, platform)
      debugLog("Delivery OTP Response:", response)
      const data = response?.data?.data || response?.data || {}
      debugLog("Parsed Delivery OTP Data:", data)

      if (data.pendingApproval === true) {
        localStorage.removeItem("deliveryAuthData")
        setIsLoading(false)
        setError("")
        setPendingMessage(data.message || "Your account is pending admin verification. You will be notified once approved.")
        setIsRejected(data.isRejected || false)
        setRejectionReason(data.rejectionReason || "")
        return
      }

      const needsRegistration = data.needsRegistration === true

      if (needsRegistration) {
        // No DB record yet; redirect to registration details page WITHOUT creating anything in DB.
        localStorage.removeItem("deliveryAuthData")
        localStorage.setItem("deliveryNeedsRegistration", "true")
        const digits = String(phone || "").replace(/\D/g, "")
        const details = {
          name: "",
          phone: digits.slice(-10),
          countryCode: "+91",
        }
        localStorage.setItem("deliverySignupDetails", JSON.stringify(details))
        setIsLoading(false)
        navigate("/food/delivery/signup/details", { replace: true })
        return
      }

      const accessToken = data.accessToken
      const refreshToken = data.refreshToken || null
      const user = data.user

      if (!accessToken || !user) {
        throw new Error("Invalid response from server")
      }

      localStorage.removeItem("deliveryAuthData")

      try {
        debugLog("Storing auth data for delivery:", { hasToken: !!accessToken, hasUser: !!user })
        storeAuthData("delivery", accessToken, user, refreshToken)
        debugLog("Auth data stored successfully")
        clearCachedFcmToken("delivery")
        registerWebPushForCurrentModule("/food/delivery").catch(() => {})
      } catch (storageError) {
        debugError("Failed to store authentication data:", storageError)
        setError("Failed to save authentication. Please try again or clear your browser storage.")
        setIsLoading(false)
        return
      }

      window.dispatchEvent(new Event("deliveryAuthChanged"))

      setSuccess(true)
      setIsLoading(false)

      let retryCount = 0
      const maxRetries = 10
      const verifyAndNavigate = () => {
        const storedToken = localStorage.getItem("delivery_accessToken")
        const storedAuth = localStorage.getItem("delivery_authenticated")

        if (storedToken && storedAuth === "true") {
          navigate("/food/delivery", { replace: true })
        } else if (retryCount < maxRetries) {
          retryCount++
          setTimeout(verifyAndNavigate, 100)
        } else {
          setError("Failed to save authentication. Please try again.")
          setIsLoading(false)
        }
      }
      setTimeout(verifyAndNavigate, 200)
    } catch (err) {
      debugError("OTP Verification Error:", err)
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to verify OTP. Please try again."
      setError(message)
      setIsLoading(false)
    }
  }

  const handleSubmitName = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError("Name is required")
      return
    }

    if (!verifiedOtp) {
      setError("OTP verification step missing. Please request a new OTP.")
      return
    }

    setIsLoading(true)
    setError("")
    setNameError("")

    try {
      const phone = authData?.phone
      const purpose = authData?.purpose || "login"
      if (!phone) {
        setError("Phone number not found. Please try again.")
        return
      }

      // Second call with name to auto-register and login
      const response = await deliveryAPI.verifyOTP(phone, verifiedOtp, purpose, trimmedName, deviceToken, activePlatform)
      const data = response?.data?.data || response?.data || {}

      const accessToken = data.accessToken
      const refreshToken = data.refreshToken || null
      const user = data.user

      if (!accessToken || !user) {
        throw new Error("Invalid response from server")
      }

      // Clear auth data from localStorage
      localStorage.removeItem("deliveryAuthData")

      // Store auth data using utility function to ensure proper role handling
      // The setAuthData function includes error handling and verification
      try {
        debugLog("Storing auth data for delivery (with name):", { hasToken: !!accessToken, hasUser: !!user })
        storeAuthData("delivery", accessToken, user, refreshToken)
        debugLog("Auth data stored successfully")
      } catch (storageError) {
        debugError("Failed to store authentication data:", storageError)
        setError("Failed to save authentication. Please try again or clear your browser storage.")
        setIsLoading(false)
        return
      }

      // Dispatch custom event for same-tab updates
      window.dispatchEvent(new Event("deliveryAuthChanged"))

      setSuccess(true)
      setIsLoading(false)

      // Verify token is stored and then navigate
      let retryCount = 0
      const maxRetries = 10
      const verifyAndNavigate = () => {
        const storedToken = localStorage.getItem("delivery_accessToken")
        const storedAuth = localStorage.getItem("delivery_authenticated")

        debugLog("Verifying token storage (with name):", { hasToken: !!storedToken, authenticated: storedAuth, retryCount })

        if (storedToken && storedAuth === "true") {
          // Token is stored, navigate to delivery home
          debugLog("Token verified, navigating to /delivery")
          navigate("/food/delivery", { replace: true })
        } else if (retryCount < maxRetries) {
          // Token not stored yet, retry after short delay
          retryCount++
          setTimeout(verifyAndNavigate, 100)
        } else {
          // Max retries reached, show error
          debugError("Token storage verification failed after max retries")
          setError("Failed to save authentication. Please try again.")
          setIsLoading(false)
        }
      }

      // Start verification after a small delay
      setTimeout(verifyAndNavigate, 200)
    } catch (err) {
      debugError("Name Submission Error:", err)
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to complete registration. Please try again."
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    if (resendTimer > 0) return

    setIsLoading(true)
    setError("")

    try {
      const phone = authData?.phone
      const purpose = authData?.purpose || "login"
      if (!phone) {
        setError("Phone number not found. Please go back and try again.")
        return
      }

      // Call backend to resend OTP
      await deliveryAPI.sendOTP(phone, purpose)
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to resend OTP. Please try again."
      setError(message)
    } finally {
      setIsLoading(false)
    }

    // Reset timer to 60 seconds
    setResendTimer(60)
    const timer = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    setOtp(["", "", "", "", "", ""])
    setShowNameInput(false)
    setName("")
    setNameError("")
    setVerifiedOtp("")
    inputRefs.current[0]?.focus()
  }

  const getPhoneNumber = () => {
    if (!authData) return ""
    if (authData.method === "phone") {
      // Format phone number as +91-9098569620
      const phone = authData.phone || ""
      // Remove spaces and format
      const cleaned = phone.replace(/\s/g, "")
      // Add hyphen after country code if not present
      if (cleaned.startsWith("+91") && cleaned.length > 3) {
        return cleaned.slice(0, 3) + "-" + cleaned.slice(3)
      }
      return cleaned
    }
    return authData.email || ""
  }

  if (!authData) {
    return null
  }

  return (
    <AnimatedPage className="min-h-screen bg-[#FFF9F2] dark:bg-[#0a0a0a] flex flex-col relative overflow-hidden font-['Poppins']">
      {/* iOS Keyboard Push-up Fix */}
      <style>{`
        @supports (-webkit-touch-callout: none) {
          body, html {
            height: -webkit-fill-available;
            overscroll-behavior-y: none;
          }
          .min-h-screen {
            min-height: -webkit-fill-available !important;
          }
          input:focus {
            scroll-margin-bottom: 50vh;
          }
        }
      `}</style>
      
      {/* Soft Ambient Background Elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] rounded-full bg-[#FFE4C4]/40 dark:bg-primary/5 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-[#E0F7FA]/50 dark:bg-blue-900/10 blur-[100px] pointer-events-none" />

      {/* Header */}
      <div className="relative flex items-center justify-center py-6 px-4 z-20">
        <button
          onClick={() => navigate("/food/delivery/login")}
          className="absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/70 dark:bg-gray-800/70 backdrop-blur-md flex items-center justify-center shadow-sm border border-white/50 hover:bg-white transition-all active:scale-95"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5 text-gray-800 dark:text-gray-200" />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col justify-center px-6 pb-12 pt-4 relative z-10 w-full max-w-md mx-auto">
        <div className="bg-white/70 dark:bg-[#1a1a1a]/80 backdrop-blur-2xl rounded-[3rem] p-8 sm:p-10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] border border-white/50 dark:border-gray-800 relative overflow-hidden w-full space-y-8">
          
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-transparent via-[#4CB8C4]/40 to-transparent" />

          {/* Message */}
          <div className="text-center space-y-3">
            <h2 className="text-2xl font-black text-gray-900 dark:text-white font-['Outfit'] tracking-tight">
              {showNameInput ? "Almost there!" : "Verify your number"}
            </h2>
            <div className="h-1 w-12 bg-gradient-to-r from-[#4CB8C4] to-[#3CD3AD] rounded-full mx-auto" />
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
              {showNameInput
                ? "Please tell us your name to complete registration."
                : "We have sent a verification code to"}
            </p>
            {!showNameInput && (
              <p className="text-base text-gray-800 dark:text-gray-200 font-bold tracking-wide">
                {getPhoneNumber()}
              </p>
            )}
          </div>

          {/* Pending approval message */}
          {pendingMessage && (
            <div className={`rounded-2xl p-5 text-center space-y-4 shadow-sm border ${isRejected ? "bg-red-50/80 border-red-100" : "bg-amber-50/80 border-amber-100"}`}>
              <div className="space-y-2">
                <p className={`text-sm font-black uppercase tracking-wider ${isRejected ? "text-red-700" : "text-amber-700"}`}>
                  {isRejected ? "Application Rejected" : "Pending Verification"}
                </p>
                <p className={`text-sm font-medium leading-relaxed ${isRejected ? "text-red-600" : "text-amber-600"}`}>
                  {pendingMessage}
                </p>
                {isRejected && rejectionReason && (
                  <div className="mt-3 p-3 bg-white/70 rounded-xl border border-red-100">
                    <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1">Reason</p>
                    <p className="text-sm text-red-700 font-medium italic">"{rejectionReason}"</p>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 pt-2">
                {isRejected ? (
                  <button
                    type="button"
                    onClick={() => {
                      const phone = authData?.phone
                      const digits = String(phone || "").replace(/\D/g, "")
                      localStorage.setItem("deliveryNeedsRegistration", "true")
                      const details = {
                        name: "",
                        phone: digits.slice(-10),
                        countryCode: "+91",
                      }
                      localStorage.setItem("deliverySignupDetails", JSON.stringify(details))
                      navigate("/food/delivery/signup/details", { replace: true })
                    }}
                    className="w-full py-3.5 bg-red-500 text-white rounded-2xl font-bold shadow-lg shadow-red-500/20 hover:bg-red-600 transition-all active:scale-95"
                  >
                    Re-apply Now
                  </button>
                ) : null}
                
                <button
                  type="button"
                  onClick={() => navigate("/food/delivery/login", { replace: true })}
                  className={`text-sm font-bold underline transition-colors ${isRejected ? "text-red-500 hover:text-red-700" : "text-amber-600 hover:text-amber-800"}`}
                >
                  Back to login
                </button>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-500 text-sm font-semibold p-3 rounded-xl text-center border border-red-100 dark:border-red-900">
              {error}
            </div>
          )}

          {/* OTP Input Fields */}
          {!showNameInput && !pendingMessage && (
            <div className="space-y-8">
              <div className="flex justify-center gap-3 sm:gap-4">
                {otp.map((digit, index) => (
                  <Input
                    key={index}
                    ref={(el) => (inputRefs.current[index] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={index === 0 ? handlePaste : undefined}
                    disabled={isLoading}
                    autoComplete="off"
                    autoFocus={false}
                    className="w-10 h-12 sm:w-12 sm:h-14 text-center text-xl font-black p-0 border-2 border-gray-200 dark:border-gray-700 rounded-2xl focus-visible:ring-0 focus-visible:border-[#4CB8C4] bg-white/80 dark:bg-gray-900/50 shadow-sm transition-all text-gray-900 dark:text-white"
                  />
                ))}
              </div>

              {/* Resend Section */}
              <div className="text-center space-y-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                  Didn't get the OTP?
                </p>
                {resendTimer > 0 ? (
                  <p className="text-sm font-bold text-gray-500 bg-gray-100/50 dark:bg-gray-800/50 py-2 px-4 rounded-full inline-block">
                    Resend SMS in <span className="text-[#4CB8C4]">{resendTimer}s</span>
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isLoading}
                    className="text-sm font-bold text-[#4CB8C4] hover:text-[#3BA0AB] transition-colors disabled:opacity-50 py-2 px-4 rounded-full bg-[#4CB8C4]/10 hover:bg-[#4CB8C4]/20 inline-block"
                  >
                    Resend SMS
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Name Input (shown only after OTP verified and user is new) */}
          {showNameInput && (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] ml-1">
                  Full name
                </label>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (nameError) setNameError("")
                  }}
                  disabled={isLoading}
                  placeholder="Enter your name"
                  className={`h-14 rounded-2xl bg-white/80 dark:bg-gray-900/50 border-2 font-semibold text-gray-900 dark:text-white px-5 shadow-sm transition-all ${
                    nameError ? "border-red-400 focus-visible:border-red-500" : "border-gray-200 dark:border-gray-700 focus-visible:border-[#4CB8C4]"
                  }`}
                />
                {nameError && (
                  <p className="text-xs text-red-500 font-semibold ml-1">
                    {nameError}
                  </p>
                )}
              </div>

              <button
                onClick={handleSubmitName}
                disabled={isLoading}
                className="w-full py-4 bg-gradient-to-r from-[#4CB8C4] to-[#3CD3AD] hover:from-[#3BA0AB] hover:to-[#2BB896] text-white rounded-2xl font-bold text-lg shadow-[0_15px_30px_-10px_rgba(76,184,196,0.5)] transition-all active:scale-[0.98] disabled:opacity-70 disabled:scale-100 flex justify-center items-center"
              >
                {isLoading ? "Continuing..." : "Continue"}
              </button>
            </div>
          )}

          {/* Loading Spinner */}
          {isLoading && !showNameInput && (
            <div className="flex justify-center pt-4">
              <Loader2 className="h-8 w-8 text-[#4CB8C4] animate-spin" />
            </div>
          )}
        </div>
      </div>
    </AnimatedPage>
  )
}

