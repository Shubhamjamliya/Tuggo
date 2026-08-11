import { useState, useRef, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { motion } from "framer-motion"
import { ShieldCheck, Truck, Star, Heart, ArrowRight, Loader2, ShieldQuestion } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { toast } from "sonner"
import { deliveryAPI } from "@food/api"
import { clearModuleAuth } from "@food/utils/auth"
import { useAppLogo } from "@food/hooks/useAppLogo"
import logoNew from "@/assets/logo.png"

const DEFAULT_COUNTRY_CODE = "+91"

export default function DeliverySignIn() {
  const logoUrl = useAppLogo('delivery_app') || logoNew
  const navigate = useNavigate()
  const [phone, setPhone] = useState(() => {
    const draft = localStorage.getItem("delivery_draft_phone")
    if (draft) return draft;
    const stored = localStorage.getItem("deliveryAuthData")
    if (stored) {
      try {
        const data = JSON.parse(stored)
        return data.phone ? data.phone.replace("+91", "").trim() : ""
      } catch (e) { return "" }
    }
    return ""
  })
  const [loading, setLoading] = useState(false)
  const submitting = useRef(false)

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

  const validatePhone = (num) => {
    const digits = num.replace(/\D/g, "")
    return digits.length === 10 && ["6", "7", "8", "9"].includes(digits[0])
  }

  const handleSendOTP = async (e) => {
    if (e) e.preventDefault()
    if (!validatePhone(phone)) {
      toast.error("Please enter a valid 10-digit mobile number")
      return
    }
    if (submitting.current) return
    submitting.current = true
    setLoading(true)

    const fullPhone = `${DEFAULT_COUNTRY_CODE} ${phone}`.trim()

    try {
      clearModuleAuth("delivery")
      await deliveryAPI.sendOTP(fullPhone, "login")

      const authData = {
        method: "phone",
        phone: fullPhone,
        isSignUp: false,
        purpose: "login",
        module: "delivery",
      }
      localStorage.setItem("deliveryAuthData", JSON.stringify(authData))
      toast.success("Verification code sent to your phone!")
      navigate("/food/delivery/otp")
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || "Failed to send OTP."
      toast.error(msg)
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  return (
    <div className="min-h-screen bg-[#FFF9F2] dark:bg-[#0a0a0a] flex flex-col relative overflow-hidden font-['Poppins']">
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
      
      {/* Floating Decorative Elements (Approximating the reference image's background icons) */}
      <motion.div animate={{ y: [0, -15, 0], rotate: [0, 5, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} className="absolute top-[15%] left-[8%] opacity-30 dark:opacity-10 pointer-events-none">
        <span className="text-4xl text-orange-500">🍕</span>
      </motion.div>
      <motion.div animate={{ y: [0, 20, 0], rotate: [0, -10, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }} className="absolute top-[25%] right-[10%] opacity-30 dark:opacity-10 pointer-events-none">
        <span className="text-4xl">🛵</span>
      </motion.div>
      <motion.div animate={{ y: [0, -10, 0], scale: [1, 1.1, 1] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} className="absolute bottom-[20%] left-[12%] opacity-30 dark:opacity-10 pointer-events-none">
        <span className="text-4xl">⭐</span>
      </motion.div>
      <motion.div animate={{ y: [0, 15, 0], rotate: [0, 15, 0] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} className="absolute bottom-[15%] right-[15%] opacity-30 dark:opacity-10 pointer-events-none">
        <span className="text-5xl">📍</span>
      </motion.div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 relative z-10 w-full max-w-md mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="w-full flex flex-col items-center"
        >
          <div className="relative mb-6 flex justify-center">
            <div className="absolute inset-0 bg-blue-400/20 rounded-full blur-[40px] scale-150 pointer-events-none" />
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 20 }}
              className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-full bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] overflow-hidden border-4 border-white"
              style={{ borderRadius: '50%', WebkitMaskImage: '-webkit-radial-gradient(white, black)' }}
            >
              <img 
                src={logoUrl} 
                alt="Delivery Logo" 
                className="w-full h-full object-contain p-2"
              />
            </motion.div>
          </div>

          {/* Typography Section */}
          <div className="text-center mb-8 px-2">
            <h1 className="text-[28px] md:text-[32px] font-black text-[#3c2a21] dark:text-white leading-tight tracking-tight mb-2 font-['Outfit']">
              Deliver smiles, <br/> earn on your schedule.
            </h1>
            <h2 className="text-[22px] text-[#5e4b3c] dark:text-gray-300 font-semibold mb-1">
              Delivery Partner Login
            </h2>
            <p className="text-sm text-[#8c7a6b] dark:text-gray-400 font-medium">
              Login with your mobile number
            </p>
          </div>

          <form onSubmit={handleSendOTP} className="w-full space-y-6">
            {/* Pill-shaped Glassmorphic Input */}
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-orange-100 to-blue-100 dark:from-gray-800 dark:to-gray-800 rounded-full blur opacity-50 group-hover:opacity-100 transition duration-500"></div>
              <div className="relative flex items-center bg-white/70 dark:bg-[#1a1a1a]/80 backdrop-blur-xl border border-white/50 dark:border-gray-800 rounded-[2rem] p-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                
                {/* Prefix Section */}
                <div className="flex items-center pl-4 pr-3 border-r border-gray-200 dark:border-gray-700">
                  <img src="https://flagcdn.com/w20/in.png" alt="India" className="w-5 h-auto mr-2 rounded-sm" />
                  <span className="text-base font-bold text-gray-800 dark:text-gray-200 mr-2">+91</span>
                </div>
                
                <div className="pl-3 pr-2 text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                  </svg>
                </div>

                {/* Input Field */}
                <input
                  type="tel"
                  required
                  autoFocus
                  value={phone}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setPhone(val);
                    localStorage.setItem("delivery_draft_phone", val);
                  }}
                  maxLength={10}
                  className="flex-1 bg-transparent border-0 outline-none focus:border-transparent focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 text-gray-900 dark:text-white font-bold text-lg placeholder:text-gray-400 placeholder:font-medium placeholder:text-sm py-2 px-1"
                  style={{ boxShadow: "none", border: "none", outline: "none" }}
                  placeholder="Enter your 10-digit registered..."
                />
              </div>
            </div>

            {/* Gradient CTA Button */}
            <button
              type="submit"
              disabled={loading || phone.length < 10}
              className="w-full py-4.5 bg-gradient-to-r from-[#4CB8C4] to-[#3CD3AD] hover:from-[#3BA0AB] hover:to-[#2BB896] disabled:from-gray-300 disabled:to-gray-300 dark:disabled:from-gray-800 dark:disabled:to-gray-800 disabled:text-gray-500 text-white rounded-[2rem] font-bold text-[17px] shadow-[0_15px_30px_-10px_rgba(76,184,196,0.5)] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                "Send OTP to Register/Login"
              )}
            </button>
          </form>

          {/* Support Link */}
          <div className="mt-6">
            <Link 
              to="/food/delivery/support"
              className="flex items-center justify-center gap-2 px-6 py-2.5 bg-white/50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-sm font-bold text-gray-700 dark:text-gray-300 shadow-sm transition-all"
            >
              <ShieldQuestion className="w-4 h-4 text-orange-500" />
              Need Help? Support
            </Link>
          </div>

          {/* Footer Terms */}
          <div className="mt-8 text-center">
            <p className="text-xs text-gray-500 font-medium">
              By continuing, you agree to our <br className="sm:hidden" />
              <Link to="/food/delivery/profile/terms" className="text-gray-800 dark:text-gray-300 font-bold hover:text-[#4CB8C4] underline underline-offset-2 mx-1">Terms</Link>
              &
              <Link to="/food/delivery/profile/privacy" className="text-gray-800 dark:text-gray-300 font-bold hover:text-[#4CB8C4] underline underline-offset-2 ml-1">Privacy Policy</Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
