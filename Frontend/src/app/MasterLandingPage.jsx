import React, { useState, useEffect } from "react"
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion"
import { useNavigate } from "react-router-dom"
import api from "@food/api"
import {
  UtensilsCrossed,
  MapPin,
  Heart,
  Star,
  ChevronDown,
  Apple,
  Play,
  ShoppingBag,
  Clock,
  Zap,
  Activity,
  ShieldCheck,
  User,
  Ticket,
  Award,
  ArrowRight,
  Instagram,
  Twitter,
  Facebook,
  Linkedin,
  Youtube
} from "lucide-react"

// --- Components for Floating Elements ---
const FloatingFood = ({ src, className, delay = 0, yOffset = 20 }) => (
  <motion.img
    src={src}
    initial={{ opacity: 0, scale: 0.8 }}
    whileInView={{ opacity: 1, scale: 1 }}
    viewport={{ once: true }}
    animate={{ y: [0, yOffset, 0] }}
    transition={{
      duration: 6,
      repeat: Infinity,
      ease: "easeInOut",
      delay: delay
    }}
    className={`absolute pointer-events-none drop-shadow-2xl z-10 ${className}`}
  />
)

const FeatureBadge = ({ icon, text, className, delay = 0, yOffset = 15 }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.8 }}
    whileInView={{ opacity: 1, scale: 1 }}
    viewport={{ once: false, amount: 0.2 }}
    animate={{ y: [0, yOffset, 0] }}
    transition={{
      duration: 5,
      repeat: Infinity,
      ease: "easeInOut",
      delay: delay
    }}
    className={`absolute bg-white/90 backdrop-blur-xl rounded-[28px] p-4 shadow-[0_20px_40px_rgba(226,55,68,0.12)] flex flex-col items-center justify-center gap-3 border border-white z-20 hover:scale-110 transition-transform ${className}`}
  >
    <div className="w-14 h-14 bg-gradient-to-br from-red-50 to-orange-50 rounded-2xl flex items-center justify-center shadow-inner border border-red-100/50">
      <img src={icon} alt={text} className="w-8 h-8 object-contain drop-shadow-sm" onError={(e) => e.target.style.display = 'none'} />
    </div>
    <span className="text-sm font-bold text-gray-800 text-center leading-tight tracking-tight">{text}</span>
  </motion.div>
)

const FeatureRow = ({ title, desc, Icon, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, x: -30 }}
    whileInView={{ opacity: 1, x: 0 }}
    viewport={{ once: false, amount: 0.2 }}
    transition={{ delay, duration: 0.5 }}
    className="flex gap-5 items-start bg-white/50 backdrop-blur-sm p-4 rounded-3xl hover:bg-white transition-colors cursor-pointer border border-transparent hover:border-red-50 hover:shadow-xl"
  >
    <div className="w-14 h-14 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border border-red-100">
      <Icon className="w-7 h-7" />
    </div>
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-500 font-medium leading-relaxed">{desc}</p>
    </div>
  </motion.div>
)

const FeatureRowRight = ({ title, desc, Icon, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, x: 30 }}
    whileInView={{ opacity: 1, x: 0 }}
    viewport={{ once: false, amount: 0.2 }}
    transition={{ delay, duration: 0.5 }}
    className="flex gap-5 items-start md:flex-row-reverse md:text-right bg-white/50 backdrop-blur-sm p-4 rounded-3xl hover:bg-white transition-colors cursor-pointer border border-transparent hover:border-red-50 hover:shadow-xl"
  >
    <div className="w-14 h-14 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center shrink-0 shadow-sm border border-red-100">
      <Icon className="w-7 h-7" />
    </div>
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-500 font-medium leading-relaxed">{desc}</p>
    </div>
  </motion.div>
)


const SLIDES = [
  {
    id: 1,
    image: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=2070&auto=format&fit=crop",
    title: "Tuggo Food Delivery",
    subtitle: "Giving you the best service and all"
  },
  {
    id: 2,
    image: "https://images.unsplash.com/photo-1534080564583-6be75777b70a?q=80&w=2070&auto=format&fit=crop",
    title: "Elegant Interior and Design",
    subtitle: "High-class Professional Service"
  },
  {
    id: 3,
    image: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?q=80&w=2070&auto=format&fit=crop",
    title: "Tradition & Passion",
    subtitle: "Only the best ingredients for our dishes"
  }
]

export default function MasterLandingPage() {
  const navigate = useNavigate()
  const { scrollYProgress } = useScroll()
  const yHero = useTransform(scrollYProgress, [0, 1], ["0%", "40%"])
  const [currentSlide, setCurrentSlide] = useState(0)
  const [landingSettings, setLandingSettings] = useState(null)

  const activeSlides = landingSettings?.heroSlides?.length > 0 ? landingSettings.heroSlides : SLIDES;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % activeSlides.length)
    }, 5000)
    return () => clearInterval(timer)
  }, [activeSlides.length])

  useEffect(() => {
    api.get('/food/landing/settings/public').then(res => {
      if (res.data?.success) {
        setLandingSettings(res.data.data)
      }
    }).catch(err => console.error("Failed to load landing settings", err))
  }, [])

  // Colors
  const zRed = "#E23744"
  const zBlack = "#1C1C1C"

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans selection:bg-red-500/30 overflow-x-hidden relative">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap');
        .font-cursive {
          font-family: 'Great Vibes', cursive;
        }
      `}</style>

      <button
        type="button"
        onClick={() => navigate("/admin/food/restaurant-delay-alerts")}
        className="fixed right-4 z-[100] inline-flex items-center gap-2 rounded-full border border-white/20 bg-[#1C1C1C]/95 px-4 py-3 text-sm font-bold text-white shadow-2xl backdrop-blur-md transition active:scale-95 md:right-6 md:px-5"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
        aria-label="Open admin restaurant delay alerts"
      >
        <ShieldCheck className="h-5 w-5 text-orange-400" />
        Admin Delay Alerts
      </button>

      {/* 1. HERO SECTION (SLIDER) */}
      <section className="relative h-screen w-full flex items-center justify-center overflow-hidden bg-[#0a0a0a]">

        <AnimatePresence mode="wait">
          <motion.div
            key={currentSlide}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
            className="absolute inset-0 z-0"
          >
            <div className="absolute inset-0 bg-black/60 z-10" />
            {activeSlides[currentSlide]?.type === 'video' ? (
              <video
                src={activeSlides[currentSlide]?.image || activeSlides[currentSlide]?.url}
                autoPlay
                loop
                muted
                className="w-full h-full object-cover"
              />
            ) : (
              <img
                src={activeSlides[currentSlide]?.image || activeSlides[currentSlide]?.url}
                alt="Hero Background"
                className="w-full h-full object-cover"
              />
            )}

            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center px-4">
              <motion.h1
                initial={{ y: -60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
                className="text-[60px] md:text-[90px] text-white mb-4 font-cursive tracking-wider"
                style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}
              >
                {activeSlides[currentSlide]?.title}
              </motion.h1>

              <motion.p
                initial={{ y: 60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
                className="text-lg md:text-2xl text-gray-200 font-medium tracking-wide"
                style={{ textShadow: '1px 1px 3px rgba(0,0,0,0.8)' }}
              >
                {activeSlides[currentSlide]?.subtitle}
              </motion.p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Slide Indicators */}
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 flex gap-3">
          {activeSlides.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              className={`w-3 h-3 rounded-full border border-white transition-all duration-300 ${index === currentSlide ? 'bg-orange-400 border-orange-400' : 'bg-transparent hover:bg-white/50'
                }`}
            />
          ))}
        </div>
      </section>

      {/* 2. BETTER FOOD FOR BETTER PEOPLE */}
      <section className="relative py-32 bg-white overflow-hidden flex flex-col items-center">
        {/* Thin swirly background lines */}
        <div className="absolute inset-0 pointer-events-none opacity-20">
          <svg viewBox="0 0 1000 1000" className="w-full h-full text-red-500 fill-transparent stroke-current" strokeWidth="1">
            <path d="M-100,500 C200,800 300,100 600,400 C900,700 1000,200 1200,500" />
            <path d="M-100,200 C300,-100 400,900 800,600 C1100,300 1200,800 1200,500" />
          </svg>
        </div>

        {/* Floating food items (Flaticon transparent PNGs) */}
        <FloatingFood src="https://cdn-icons-png.flaticon.com/512/3075/3075977.png" className="w-48 md:w-64 -left-10 md:left-20 top-40" delay={0} yOffset={15} />
        <FloatingFood src="https://cdn-icons-png.flaticon.com/512/5029/5029280.png" className="w-40 md:w-56 right-10 top-20" delay={1} yOffset={-20} />
        <FloatingFood src="https://cdn-icons-png.flaticon.com/512/3132/3132693.png" className="w-44 md:w-60 right-20 bottom-40" delay={0.5} yOffset={25} />

        {/* Tomato & Mint floating */}
        <FloatingFood src="https://cdn-icons-png.flaticon.com/512/1202/1202125.png" className="w-12 h-12 left-1/4 bottom-1/4" delay={0.2} yOffset={-10} />
        <FloatingFood src="https://cdn-icons-png.flaticon.com/512/1202/1202125.png" className="w-10 h-10 right-1/4 top-1/3" delay={0.8} yOffset={10} />
        <FloatingFood src="https://cdn-icons-png.flaticon.com/512/1685/1685412.png" className="w-8 h-8 left-1/3 top-20" delay={1.5} yOffset={15} />

        <div className="relative z-20 text-center max-w-3xl mx-auto px-6 pt-10">
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="text-5xl md:text-[64px] font-bold text-[#E23744] leading-[1.1] mb-6"
          >
            Better food for<br />better people
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ delay: 0.1 }}
            className="text-xl md:text-2xl text-gray-500 font-medium max-w-2xl mx-auto"
          >
            For over a decade, we've enabled our customers to discover new tastes, delivered right to their doorstep
          </motion.p>
        </div>

        {/* Stats Card */}
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="relative z-20 mt-32 bg-white rounded-3xl p-8 md:p-10 shadow-[0_15px_50px_rgba(0,0,0,0.06)] border border-gray-100 flex flex-col md:flex-row items-center justify-between gap-8 md:gap-10 w-[95%] max-w-6xl mx-auto"
        >
          <div className="flex items-center gap-4 md:gap-6 flex-1 justify-center md:justify-start">
            <div className="text-center md:text-left">
              <h3 className="text-3xl md:text-[40px] font-black text-gray-700 whitespace-nowrap">{landingSettings?.stats?.restaurants || "3,00,000+"}</h3>
              <p className="text-gray-500 text-lg font-medium whitespace-nowrap">restaurants</p>
            </div>
            <div className="w-12 h-12 md:w-14 md:h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center shrink-0">
              <UtensilsCrossed className="w-6 h-6 md:w-7 md:h-7" />
            </div>
          </div>

          <div className="hidden md:block w-px h-16 bg-gray-200 shrink-0"></div>

          <div className="flex items-center gap-4 md:gap-6 flex-1 justify-center md:justify-center">
            <div className="text-center md:text-left">
              <h3 className="text-3xl md:text-[40px] font-black text-gray-700 whitespace-nowrap">{landingSettings?.stats?.cities || "800+"}</h3>
              <p className="text-gray-500 text-lg font-medium whitespace-nowrap">cities</p>
            </div>
            <div className="w-12 h-12 md:w-14 md:h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center shrink-0">
              <MapPin className="w-6 h-6 md:w-7 md:h-7" />
            </div>
          </div>

          <div className="hidden md:block w-px h-16 bg-gray-200 shrink-0"></div>

          <div className="flex items-center gap-4 md:gap-6 flex-1 justify-center md:justify-end">
            <div className="text-center md:text-left">
              <h3 className="text-3xl md:text-[40px] font-black text-gray-700 whitespace-nowrap">{landingSettings?.stats?.orders || "3 billion+"}</h3>
              <p className="text-gray-500 text-lg font-medium whitespace-nowrap">orders delivered</p>
            </div>
            <div className="w-12 h-12 md:w-14 md:h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center shrink-0">
              <ShoppingBag className="w-6 h-6 md:w-7 md:h-7" />
            </div>
          </div>
        </motion.div>
      </section>

      {/* 3. WHAT'S WAITING FOR YOU */}
      <section className="relative py-32 bg-gradient-to-b from-white via-rose-50/30 to-[#FDFBF7] overflow-hidden flex flex-col items-center">
        {/* Decorative Background Elements */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-red-400/5 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-orange-400/5 rounded-full blur-[100px] pointer-events-none" />

        <div className="text-center max-w-3xl mx-auto px-6 mb-20 relative z-20">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: false, amount: 0.2 }}
            className="inline-block mb-4 px-4 py-1.5 rounded-full bg-red-50 border border-red-100 text-red-500 font-bold text-sm tracking-wide uppercase"
          >
            Features
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            className="text-4xl md:text-[56px] font-black text-[#E23744] leading-[1.1] mb-6 drop-shadow-sm"
          >
            What's waiting for you<br />on the app?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{ delay: 0.1 }}
            className="text-xl md:text-2xl text-gray-600 font-medium max-w-2xl mx-auto"
          >
            Our app is packed with features that enable you to experience food delivery like never before
          </motion.p>
        </div>

        <div className="relative w-full max-w-7xl mx-auto px-6 flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-8 z-20">

          {/* Left Feature Column */}
          <div className="flex-1 space-y-4 w-full order-2 lg:order-1">
            <FeatureRow title="Lightning Fast Delivery" desc="Experience superfast delivery for food delivered fresh & on time" Icon={Zap} delay={0.1} />
            <FeatureRow title="Live Order Tracking" desc="Know where your order is at all times, from the restaurant to your doorstep" Icon={MapPin} delay={0.2} />
            <FeatureRow title="No Minimum Order" desc="Order in for yourself or for the group, with no restrictions on order value" Icon={ShoppingBag} delay={0.3} />
          </div>

          {/* Center Phone Mockup */}
          <div className="flex justify-center shrink-0 order-1 lg:order-2 relative">
            {/* Glowing Aura behind phone */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[550px] bg-gradient-to-br from-red-400/20 to-orange-400/20 blur-[80px] rounded-full z-0" />

            <motion.div
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, amount: 0.2 }}
              className="relative z-10 w-[300px] h-[600px] rounded-[50px] shadow-[0_30px_60px_rgba(226,55,68,0.15)] border-[12px] border-[#1C1C1C] overflow-hidden bg-white"
            >
              <div className="absolute top-0 inset-x-0 h-6 bg-[#1C1C1C] rounded-b-3xl w-1/2 mx-auto z-20" />

              {/* Realistic App Mockup UI */}
              <div className="w-full h-full bg-[#f8f9fa] flex flex-col pt-10 pb-6 relative overflow-hidden">
                <div className="px-5 mb-6">
                  <div className="w-24 h-4 bg-gray-200 rounded-full mb-2" />
                  <div className="w-40 h-6 bg-gradient-to-r from-gray-300 to-gray-200 rounded-full" />
                </div>

                <div className="flex gap-3 px-5 mb-6 overflow-hidden">
                  <div className="w-16 h-16 bg-red-100 rounded-2xl flex-shrink-0" />
                  <div className="w-16 h-16 bg-orange-100 rounded-2xl flex-shrink-0" />
                  <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex-shrink-0" />
                  <div className="w-16 h-16 bg-green-100 rounded-2xl flex-shrink-0" />
                </div>

                <div className="px-5 flex-1 flex flex-col gap-4">
                  <div className="w-full bg-white rounded-[24px] shadow-sm border border-gray-100 p-3">
                    <div className="w-full h-24 bg-gray-100 rounded-[16px] mb-3" />
                    <div className="w-3/4 h-3 bg-gray-200 rounded-full mb-2" />
                    <div className="w-1/2 h-2 bg-gray-200 rounded-full" />
                  </div>
                  <div className="w-full bg-white rounded-[24px] shadow-sm border border-gray-100 p-3">
                    <div className="w-full h-24 bg-gray-100 rounded-[16px] mb-3" />
                    <div className="w-3/4 h-3 bg-gray-200 rounded-full mb-2" />
                    <div className="w-1/2 h-2 bg-gray-200 rounded-full" />
                  </div>
                </div>

                {/* Central Floating Feature Simulation */}
                <div className="absolute inset-0 bg-white/40 backdrop-blur-sm flex items-center justify-center z-10">
                  <motion.div
                    animate={{ scale: [1, 1.03, 1], y: [0, -5, 0] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    className="bg-white p-6 rounded-3xl shadow-[0_20px_40px_rgba(226,55,68,0.2)] flex flex-col items-center border border-red-50"
                  >
                    <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-3">
                      <Clock className="w-8 h-8 text-[#E23744]" />
                    </div>
                    <span className="font-black text-gray-900 text-center leading-tight text-lg">Schedule<br />your order</span>
                  </motion.div>
                </div>

                <div className="mt-auto px-5 relative z-20">
                  <div className="h-16 w-full bg-white rounded-[24px] shadow-md border border-gray-100 flex items-center justify-around px-2">
                    <div className="w-10 h-10 bg-red-50 text-red-500 rounded-xl flex items-center justify-center"><User className="w-5 h-5" /></div>
                    <div className="w-6 h-6 bg-gray-200 rounded-full" />
                    <div className="w-6 h-6 bg-gray-200 rounded-full" />
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Right Feature Column */}
          <div className="flex-1 space-y-4 w-full order-3">
            <FeatureRowRight title="Huge Discounts & Offers" desc="Enjoy exciting offers, discounts and coupons exclusively on the app" Icon={Ticket} delay={0.1} />
            <FeatureRowRight title="Tuggo Food Delivery GOLD" desc="Get free delivery and extra discounts on every order with premium membership" Icon={Award} delay={0.2} />
            <FeatureRowRight title="Safety & Hygiene" desc="Best in class safety standards with regular temperature checks" Icon={ShieldCheck} delay={0.3} />
          </div>

        </div>
      </section>

      {/* 4. DOWNLOAD THE APP NOW */}
      <section className="py-24 bg-white flex justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="w-full max-w-5xl bg-[#FFF6F7] rounded-[40px] p-8 md:p-16 flex flex-col md:flex-row items-center justify-between gap-12 border border-[#ffe0e3]"
        >
          <div className="flex-1 text-center md:text-left">
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4 leading-tight">
              Download the app now!
            </h2>
            <p className="text-xl text-gray-500 font-medium mb-10 max-w-md">
              Experience seamless online ordering only on the Tuggo Food Delivery app
            </p>
            <div className="flex gap-4 justify-center md:justify-start">
              <img
                src="https://b.zmtcdn.com/data/webuikit/23e930757c3df49840c482a8638bf5c31556001144.png"
                alt="Google Play"
                className="h-12 object-contain cursor-pointer"
                onClick={() => window.open(landingSettings?.appLinks?.playStore || 'https://play.google.com/store/apps/details?id=com.indian.Tuggo.user', '_blank')}
              />
              <img
                src="https://b.zmtcdn.com/data/webuikit/9f0c85a5e33adb783fa0aef667075f9e1556003622.png"
                alt="App Store"
                className="h-12 object-contain cursor-pointer"
                onClick={() => window.open(landingSettings?.appLinks?.appStore || '#', '_blank')}
              />
            </div>
          </div>

          <div className="flex-shrink-0 relative">
            <div className="absolute inset-0 bg-[#E23744]/5 blur-[50px] rounded-full pointer-events-none" />
            <div className="relative w-64 h-[450px] bg-white rounded-[40px] shadow-2xl border-[10px] border-[#1C1C1C] overflow-hidden flex flex-col items-center justify-center p-6">
              <div className="absolute top-0 inset-x-0 h-6 bg-[#1C1C1C] rounded-b-3xl w-1/2 mx-auto z-20" />
              <p className="text-sm font-bold text-gray-700 text-center mb-6 mt-4">
                Scan the QR code to<br />download the app
              </p>
              <div className="w-40 h-40 bg-gray-100 rounded-2xl flex items-center justify-center border border-gray-200">
                {/* Fake QR Code */}
                <div className="w-32 h-32 grid grid-cols-4 grid-rows-4 gap-1">
                  {Array.from({ length: 16 }).map((_, i) => (
                    <div key={i} className={`bg-black rounded-sm ${Math.random() > 0.3 ? 'opacity-100' : 'opacity-0'}`} />
                  ))}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white border border-gray-200 rounded-md flex items-center justify-center">
                    <span className="text-xs font-black text-[#E23744]">IB</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>


      {/* 6. FOOTER */}
      <footer className="bg-[#0f0f0f] text-white pt-20 pb-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row justify-between mb-16 gap-12">
            <div className="lg:w-1/4">
              <h1 className="text-4xl font-black italic tracking-tighter mb-8">
                Tuggo Food Delivery
              </h1>
            </div>

            <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-8">
              <div>
                <h4 className="font-bold text-lg mb-6 uppercase tracking-wider text-gray-200">About IB</h4>
                <ul className="space-y-3 text-gray-400 font-medium">
                  {(landingSettings?.footerLinks?.about || [
                    { label: 'Who We Are', url: '#' },
                    { label: 'Blog', url: '#' },
                    { label: 'Work With Us', url: '#' },
                    { label: 'Investor Relations', url: '#' },
                    { label: 'Report Fraud', url: '#' }
                  ]).map((link, i) => (
                    <li key={i}><a href={link.url} className="hover:text-white transition-colors">{link.label}</a></li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-lg mb-6 uppercase tracking-wider text-gray-200">For Restaurants</h4>
                <ul className="space-y-3 text-gray-400 font-medium">
                  {(landingSettings?.footerLinks?.forRestaurants || [
                    { label: 'Partner With Us', url: '#' },
                    { label: 'Apps For You', url: '#' }
                  ]).map((link, i) => (
                    <li key={i}><a href={link.url} className="hover:text-white transition-colors">{link.label}</a></li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-lg mb-6 uppercase tracking-wider text-gray-200">Learn More</h4>
                <ul className="space-y-3 text-gray-400 font-medium">
                  {(landingSettings?.footerLinks?.learnMore || [
                    { label: 'Privacy', url: '#' },
                    { label: 'Security', url: '#' },
                    { label: 'Terms', url: '#' },
                    { label: 'Sitemap', url: '#' }
                  ]).map((link, i) => (
                    <li key={i}><a href={link.url} className="hover:text-white transition-colors">{link.label}</a></li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex gap-4">
              {(!landingSettings?.socialLinks || landingSettings.socialLinks.linkedin) && (
                <div onClick={() => window.open(landingSettings?.socialLinks?.linkedin || '#', '_blank')} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#E23744] transition-colors cursor-pointer text-white">
                  <Linkedin className="w-5 h-5" />
                </div>
              )}
              {(!landingSettings?.socialLinks || landingSettings.socialLinks.instagram) && (
                <div onClick={() => window.open(landingSettings?.socialLinks?.instagram || '#', '_blank')} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#E23744] transition-colors cursor-pointer text-white">
                  <Instagram className="w-5 h-5" />
                </div>
              )}
              {(!landingSettings?.socialLinks || landingSettings.socialLinks.twitter) && (
                <div onClick={() => window.open(landingSettings?.socialLinks?.twitter || '#', '_blank')} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#E23744] transition-colors cursor-pointer text-white">
                  <Twitter className="w-5 h-5" />
                </div>
              )}
              {(!landingSettings?.socialLinks || landingSettings.socialLinks.youtube) && (
                <div onClick={() => window.open(landingSettings?.socialLinks?.youtube || '#', '_blank')} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#E23744] transition-colors cursor-pointer text-white">
                  <Youtube className="w-5 h-5" />
                </div>
              )}
              {(!landingSettings?.socialLinks || landingSettings.socialLinks.facebook) && (
                <div onClick={() => window.open(landingSettings?.socialLinks?.facebook || '#', '_blank')} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-[#E23744] transition-colors cursor-pointer text-white">
                  <Facebook className="w-5 h-5" />
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <img
                src="https://b.zmtcdn.com/data/webuikit/23e930757c3df49840c482a8638bf5c31556001144.png"
                alt="Google Play"
                className="h-10 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                onClick={() => window.open(landingSettings?.appLinks?.playStore || 'https://play.google.com/store/apps/details?id=com.indian.Tuggo.user', '_blank')}
              />
              <img
                src="https://b.zmtcdn.com/data/webuikit/9f0c85a5e33adb783fa0aef667075f9e1556003622.png"
                alt="App Store"
                className="h-10 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                onClick={() => window.open(landingSettings?.appLinks?.appStore || '#', '_blank')}
              />
            </div>
          </div>

          <div className="text-gray-500 text-sm font-medium mt-10 text-center md:text-left leading-relaxed">
            By continuing past this page, you agree to our Terms of Service, Cookie Policy, Privacy Policy and Content Policies. All trademarks are properties of their respective owners. <br />
            {landingSettings?.copyrightText || '© 2026 Tuggo Food Delivery™ Ltd. All rights reserved.'}
          </div>
        </div>
      </footer>
    </div>
  )
}
