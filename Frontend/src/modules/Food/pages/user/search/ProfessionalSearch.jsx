import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useSearchParams, Link, useNavigate } from "react-router-dom"
import { 
  ArrowLeft, Star, Clock, Search, SlidersHorizontal, 
  ChevronDown, Bookmark, BadgePercent, Mic, Grid2x2,
  X, Utensils, Store, Loader2, History, MapPin
} from "lucide-react"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { useAppLocation } from "@food/hooks/useAppLocation"
import { searchAPI, adminAPI } from "@/services/api"
import { motion, AnimatePresence } from "framer-motion"
import { createPortal } from "react-dom"
import OptimizedImage from "@food/components/OptimizedImage"
import { useVoiceSearch } from "@food/hooks/useVoiceSearch"
import PremiumLoader from "./PremiumLoader"
import { calculateDistance } from "@food/utils/common"
import { readScopedValue, writeScopedValue } from "@food/utils/appStorage"

// Simple in-memory session cache to provide instant loads on re-visits
const sessionSearchCache = new Map();
const sessionCategoriesCache = new Map();

// Helper to resolve media URLs consistently
const getMediaUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('http')) return url;
  
  // Use VITE_API_BASE_URL to derive the backend origin
  const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/v1";
  const origin = apiBase.split('/api/v1')[0];
  
  return `${origin}${url.startsWith('/') ? url : '/' + url}`;
};

// Debounce hook for real-time search
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])
  return debouncedValue
}

const SEARCH_HISTORY_KEY = "professional_search_history_v1"
const SEARCH_HISTORY_SCOPE = "search"
const SEARCH_HISTORY_NAME = "professional-history"

const readSearchHistory = () => {
  const scoped = readScopedValue(SEARCH_HISTORY_SCOPE, SEARCH_HISTORY_NAME, { fallback: null })
  if (Array.isArray(scoped)) return scoped.filter((item) => typeof item === "string").slice(0, 5)

  try {
    const legacy = localStorage.getItem(SEARCH_HISTORY_KEY)
    if (!legacy) return []
    const parsed = JSON.parse(legacy)
    const normalized = Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 5) : []
    writeScopedValue(SEARCH_HISTORY_SCOPE, SEARCH_HISTORY_NAME, normalized)
    localStorage.removeItem(SEARCH_HISTORY_KEY)
    return normalized
  } catch {
    return []
  }
}

const persistSearchHistory = (history) => {
  const normalized = Array.isArray(history) ? history.filter((item) => typeof item === "string").slice(0, 5) : []
  writeScopedValue(SEARCH_HISTORY_SCOPE, SEARCH_HISTORY_NAME, normalized)
}


export default function ProfessionalSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get("q") || ""
  const navigate = useNavigate()
  const { location: userCoords, zoneId } = useAppLocation()
  
  const [query, setQuery] = useState(initialQuery)
  const debouncedQuery = useDebounce(query, 500)
  
  const [results, setResults] = useState({ restaurants: [], dishes: [] })
  const [loading, setLoading] = useState(false)
  const { isListening, startListening, stopListening } = useVoiceSearch((transcript) => {
    setQuery(transcript)
    addToHistory(transcript)
  })

  // Auto-start voice search if voice=true in URL
  useEffect(() => {
    if (searchParams.get("voice") === "true") {
      // Start listening on next tick to ensure component is fully mounted
      setTimeout(() => {
        startListening()
      }, 100)
      
      // Clean up URL parameter
      const newParams = new URLSearchParams(searchParams)
      newParams.delete("voice")
      setSearchParams(newParams, { replace: true })
    }
  }, [searchParams, setSearchParams, startListening])
  const [categories, setCategories] = useState([])
  const [selectedCategoryId, setSelectedCategoryId] = useState(searchParams.get("cat") || null)
  const [history, setHistory] = useState([])
  const [selectedDish, setSelectedDish] = useState(null)

  // Load search history
  useEffect(() => {
    setHistory(readSearchHistory())
    fetchCategories()
  }, [zoneId])

  const fetchCategories = async () => {
    const cacheKey = String(zoneId || 'global');
    if (sessionCategoriesCache.has(cacheKey)) {
      setCategories(sessionCategoriesCache.get(cacheKey));
      return;
    }
    try {
      const res = await adminAPI.getPublicCategories({ zoneId })
      const payload = res?.data?.data || res?.data || res || {}
      if (Array.isArray(payload.categories) || Array.isArray(payload)) {
        const categories = Array.isArray(payload.categories) ? payload.categories : payload;
        sessionCategoriesCache.set(cacheKey, categories);
        setCategories(categories)
      }
    } catch (err) {
      console.error("Failed to fetch categories", err)
    }
  }

  const addToHistory = (term) => {
    const newHistory = [term, ...history.filter(h => h !== term)].slice(0, 5)
    setHistory(newHistory)
    persistSearchHistory(newHistory)
  }

  const performSearch = useCallback(async (searchTerm, catId) => {
    if (!searchTerm && !catId) {
      setResults({ restaurants: [], dishes: [] })
      return
    }
    const cacheKey = `${searchTerm}-${catId}-${zoneId}`;
    if (sessionSearchCache.has(cacheKey)) {
      setResults(sessionSearchCache.get(cacheKey));
      return; // instant load
    }
    
    setLoading(true)
    try {
      const res = await searchAPI.unifiedSearch({
        q: searchTerm,
        categoryId: catId,
        lat: userCoords?.latitude,
        lng: userCoords?.longitude,
        zoneId
      })
      
      if (res.data?.success) {
        // Grouping results into Restaurants and potential Dishes
        const all = res.data.data.restaurants || []
        const parsedResults = {
          restaurants: all.filter(r => r.matchType === 'restaurant' || !r.matchType),
          dishes: all.filter(r => r.matchType === 'food')
        };
        sessionSearchCache.set(cacheKey, parsedResults);
        setResults(parsedResults);
      }
    } catch (err) {
      console.error("Search failed", err)
    } finally {
      setLoading(false)
    }
  }, [userCoords, zoneId])

  useEffect(() => {
    performSearch(debouncedQuery, selectedCategoryId)
    const params = {}
    if (debouncedQuery) params.q = debouncedQuery
    if (selectedCategoryId) params.cat = selectedCategoryId
    setSearchParams(params, { replace: true })
  }, [debouncedQuery, selectedCategoryId, performSearch, setSearchParams])

  // Auto-scroll to selected category on load or when category changes
  useEffect(() => {
    if (selectedCategoryId && categories.length > 0) {
      setTimeout(() => {
        const el = document.getElementById(`cat-${selectedCategoryId}`);
        if (el && el.parentElement) {
          const container = el.parentElement;
          const containerCenter = container.offsetWidth / 2;
          const elementCenter = el.offsetLeft + (el.offsetWidth / 2);
          container.scrollTo({
            left: elementCenter - containerCenter,
            behavior: 'smooth'
          });
        }
      }, 150);
    }
  }, [selectedCategoryId, categories]);

  // Speech Recognition Implementation
  const handleVoiceSearch = () => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }

  const handleClear = () => {
    setQuery("")
    setSelectedCategoryId(null)
    setSearchParams({}, { replace: true })
    setResults({ restaurants: [], dishes: [] })
  }

  const handleCategoryClick = (id, e) => {
    // Scroll the clicked element to center reliably
    if (e && e.currentTarget && e.currentTarget.parentElement) {
        const el = e.currentTarget;
        const container = el.parentElement;
        const containerCenter = container.offsetWidth / 2;
        const elementCenter = el.offsetLeft + (el.offsetWidth / 2);
        
        container.scrollTo({
          left: elementCenter - containerCenter,
          behavior: 'smooth'
        });
    }

    const newCat = selectedCategoryId === id ? null : id
    setSelectedCategoryId(newCat)
    if (newCat) {
        setSearchParams({ ...Object.fromEntries(searchParams), cat: newCat }, { replace: true })
    } else {
        const p = Object.fromEntries(searchParams)
        delete p.cat
        setSearchParams(p, { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border-b border-gray-100 dark:border-zinc-800 px-3 py-2 sm:px-4 sm:py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-2 sm:gap-3">
          <button 
            onClick={() => navigate(-1)} 
            className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-full transition-all active:scale-90"
          >
            <ArrowLeft className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
          
          <div className="flex-1 relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary transition-transform group-focus-within:scale-110" strokeWidth={2.5} />
            <Input 
              autoFocus
              placeholder="Search dishes or restaurants" 
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                if (e.target.value && selectedCategoryId) {
                  setSelectedCategoryId(null)
                }
              }}
              className="pl-10 pr-12 h-10 sm:h-12 bg-gray-50 dark:bg-zinc-800/50 border-gray-100 dark:border-zinc-700 focus:border-primary dark:focus:border-primary focus:ring-4 focus:ring-primary/5 rounded-2xl text-sm sm:text-base transition-all"
            />
            
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {query && (
                <button 
                  onClick={handleClear} 
                  className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <div className="w-[1px] h-4 bg-gray-200 dark:bg-zinc-700 mx-0.5" />
              <button 
                onClick={handleVoiceSearch}
                className={`p-1.5 rounded-xl transition-all active:scale-95 ${isListening ? 'bg-red-50 text-red-500 animate-pulse' : 'text-primary'}`}
              >
                <Mic className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4">
        {/* Recent History (Moved Up) */}
        {!query && !loading && history.length > 0 && (
          <div className="mb-6">
             <h3 className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-3 px-1">Recent Searches</h3>
             <div className="flex flex-wrap gap-2 px-1">
                {history.map((term, i) => (
                  <button 
                    key={i} 
                    onClick={() => {
                      setQuery(term)
                      setSelectedCategoryId(null)
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl text-[12px] font-bold text-gray-600 dark:text-zinc-400 hover:bg-gray-50 hover:border-primary/30 transition-all shadow-sm"
                  >
                    <History className="w-3.5 h-3.5 text-gray-400" />
                    {term}
                  </button>
                ))}
             </div>
          </div>
        )}

        {/* Categories (Horizontal Slider) */}
        {!query && !loading && (
          <div className={`mb-8 transition-all ${query ? 'hidden' : ''}`}>
            <div className="flex items-center justify-between mb-4 px-1">
              <h3 className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Trending Categories</h3>
            </div>
            
            {/* Horizontal Scroll Container */}
            <div className="flex overflow-x-auto gap-4 py-2 pb-4 px-4 snap-x snap-mandatory hide-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {categories
                .filter(cat => cat.image) // Only show categories with images for a premium look
                .slice(0, 15) // Limit to top 15 to keep it clean
                .map((cat) => (
                <button 
                  id={`cat-${cat._id}`}
                  key={cat._id} 
                  onClick={(e) => handleCategoryClick(cat._id, e)}
                  className="flex flex-col items-center group transition-all active:scale-95 snap-start shrink-0 w-16 sm:w-20"
                >
                  <div className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-full mb-2 transition-all duration-300 shrink-0 ${selectedCategoryId === cat._id ? 'border-[3px] border-primary shadow-md shadow-primary/20 bg-white p-[2px]' : 'border border-gray-200/80 shadow-sm bg-gray-50 dark:bg-zinc-900 group-hover:border-primary/40 p-[2px]'}`}>
                    <div className="w-full h-full rounded-full overflow-hidden bg-white dark:bg-zinc-950">
                       <OptimizedImage 
                         src={getMediaUrl(cat.image)} 
                         alt={cat.name} 
                         className="w-full h-full object-cover rounded-full transition-transform duration-500 group-hover:scale-105" 
                       />
                    </div>
                  </div>
                  <span className={`text-[10px] sm:text-[11px] font-bold text-center px-0.5 w-full line-clamp-2 leading-tight transition-colors ${selectedCategoryId === cat._id ? 'text-primary' : 'text-gray-600 dark:text-zinc-400 group-hover:text-primary'}`} style={{ wordBreak: 'break-word' }}>
                    {cat.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Premium Loader */}
        <AnimatePresence>
          {loading && (
            <motion.div 
               initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
               className="flex justify-center"
            >
              <PremiumLoader />
            </motion.div>
          )}
        </AnimatePresence>



        {/* Search Results */}
        {!loading && (query || selectedCategoryId) && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {/* Dish Results Section */}
            {results.dishes.length > 0 && (
              <motion.section initial="hidden" animate="show" variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } }}>
                <div className="flex items-center justify-between mb-5 px-1">
                   <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest">Matched Dishes</h2>
                   <span className="text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-zinc-900 px-2 py-0.5 rounded-full">{results.dishes.length} results</span>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  {results.dishes.map((r) => (
                    <motion.button variants={{ hidden: { opacity: 0, y: 15 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } } }} onClick={() => setSelectedDish(r)} key={r._id} className="flex w-full text-left gap-4 p-3 bg-white dark:bg-zinc-900 rounded-[24px] shadow-sm border border-gray-100 dark:border-zinc-800 hover:shadow-xl hover:shadow-gray-200/50 dark:hover:shadow-none transition-all group overflow-hidden active:scale-[0.98]">
                       <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gray-100 dark:bg-zinc-800 flex-shrink-0 relative">
                           {/* Shimmer Placeholder behind image */}
                           <div className="absolute inset-0 bg-gray-200 dark:bg-zinc-700 animate-pulse" />
                           <OptimizedImage 
                            src={getMediaUrl(r.matchedDishImage || r.profileImage || r.image || (Array.isArray(r.images) && r.images[0]))} 
                            className="w-full h-full object-cover group-hover:scale-115 transition-transform duration-500"
                            fallback="/placeholder-dish.jpg"
                          />
                          {r.pureVegRestaurant && (
                            <div className="absolute top-1.5 left-1.5 w-4 h-4 border border-green-600 p-[1.5px] bg-white rounded-sm shadow-sm">
                               <div className="w-full h-full bg-green-600 rounded-full" />
                            </div>
                          )}
                       </div>
                       <div className="flex-1 min-w-0 py-1 flex flex-col justify-between">
                          <div>
                            <div className="text-[#a05485] text-[9px] font-black uppercase tracking-wider mb-1 px-2 py-0.5 bg-primary/5 rounded-full w-fit">
                               {r.restaurantName}
                            </div>
                            <h3 className="text-base font-black text-gray-900 dark:text-white line-clamp-1 group-hover:text-primary transition-colors">{r.matchedDish || query}</h3>
                          </div>
                          <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-zinc-400 mt-2 font-medium">
                                <div className="flex items-center gap-1">
                                   <Star className="w-3 h-3 text-primary fill-primary" />
                                   <span className="font-black text-gray-900 dark:text-white">{r.rating || "New"}</span>
                                </div>
                                <span className="text-gray-200">•</span>
                                <div className="flex items-center gap-1">
                                   <Clock className="w-3 h-3" />
                                   <span>{r.estimatedDeliveryTime || "30-40 mins"}</span>
                                </div>
                             </div>
                             {(r.matchedDishPrice || r.price) && (
                                <span className="text-sm font-black text-gray-900 dark:text-white bg-gray-50 dark:bg-zinc-800 px-2 py-1 rounded-lg">₹{Number(r.matchedDishPrice || r.price).toFixed(2)}</span>
                             )}
                          </div>
                       </div>
                    </motion.button>
                  ))}
                </div>
              </motion.section>
            )}

            {/* Restaurant Results Section */}
            {results.restaurants.length > 0 && (
              <motion.section initial="hidden" animate="show" variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } }}>
                <div className="flex items-center justify-between mb-5 px-1">
                   <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest">Restaurants</h2>
                   <span className="text-[10px] font-bold text-gray-400 bg-gray-100 dark:bg-zinc-900 px-2 py-0.5 rounded-full">{results.restaurants.length} stores</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-6">
                  {results.restaurants.map((r) => (
                    <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 200, damping: 20 } } }} key={r._id}>
                    <Link to={`/user/restaurants/${r.slug || r.originalRestaurantId || r._id}`} className="block group active:scale-[0.98] transition-all">
                      <div className="relative rounded-[32px] overflow-hidden aspect-[16/10] sm:aspect-[16/9] mb-4 bg-gray-200 dark:bg-zinc-800 shadow-xl shadow-gray-200/20">
                         {/* Shimmer Placeholder behind image */}
                         <div className="absolute inset-0 bg-gray-300 dark:bg-zinc-700 animate-pulse" />
                         <OptimizedImage 
                          src={getMediaUrl(r.profileImage || r.image || (Array.isArray(r.images) && r.images[0]))} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                          placeholderType="shop"
                          fallback="/placeholder-restaurant.jpg"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80" />
                        <div className="absolute bottom-4 left-5 right-5 flex justify-between items-end">
                           <div className="min-w-0 flex-1 mr-2">
                              <h3 className="text-xl sm:text-2xl font-black text-white mb-1.5 truncate">{r.restaurantName}</h3>
                              <p className="text-white/80 text-[11px] font-bold uppercase tracking-wider line-clamp-1">{r.cuisines?.join(", ")}</p>
                           </div>
                           <div className="bg-white/10 backdrop-blur-xl border border-white/20 px-3 py-1.5 rounded-2xl flex items-center gap-1.5 shadow-2xl">
                              <Star className="w-4 h-4 text-white fill-white" />
                              <span className="text-white text-sm font-black">{r.rating || "4.0"}</span>
                           </div>
                        </div>
                        {r.offer && (
                           <div className="absolute top-5 left-0 bg-primary text-white text-[10px] font-black px-4 py-2 rounded-r-2xl shadow-xl flex items-center gap-1.5 tracking-tighter uppercase whitespace-nowrap">
                              <BadgePercent className="w-3.5 h-3.5" />
                              {r.offer}
                           </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between px-2">
                         <div className="flex items-center gap-3 text-[12px] text-gray-500 dark:text-zinc-400 font-bold uppercase tracking-tight">
                            <div className="flex items-center gap-1.5">
                               <Clock className="w-3.5 h-3.5 text-primary" />
                               {r.estimatedDeliveryTime || "30 mins"}
                            </div>
                            <span className="text-gray-200">•</span>
                            <div className="flex items-center gap-1.5">
                               <MapPin className="w-3.5 h-3.5 text-primary" />
                               {userCoords?.latitude && r.location?.coordinates ? 
                                 `${calculateDistance(userCoords.latitude, userCoords.longitude, r.location.coordinates[1], r.location.coordinates[0]).toFixed(1)} km` 
                                 : (r.location?.area || "Nearby")
                               }
                            </div>
                         </div>
                         <div className="text-[10px] font-black text-white bg-gradient-to-r from-primary to-[#a05485] px-3 py-1.5 rounded-full uppercase tracking-widest shadow-lg shadow-primary/20">
                            View Menu
                         </div>
                      </div>
                    </Link>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            )}

            {/* Empty State */}
            {!loading && results.restaurants.length === 0 && results.dishes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                 <div className="w-20 h-20 bg-slate-100 dark:bg-zinc-900 rounded-full flex items-center justify-center mb-4">
                    <Search className="w-8 h-8 text-slate-300" />
                 </div>
                 <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">We couldn't find any results</h2>
                 <p className="text-slate-500 text-sm max-w-xs">Maybe try searching for something else or check your spelling</p>
                 <Button variant="outline" onClick={handleClear} className="mt-6 rounded-xl border-rose-500 text-rose-500 hover:bg-rose-50">
                    Clear all filters
                 </Button>
              </div>
            )}

          </div>
        )}
      </div>
      {typeof window !== "undefined" && createPortal(
        <>
        <AnimatePresence>
          {selectedDish && (
            <>
              <motion.div 
                className="fixed inset-0 bg-black/60 z-[9999] backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedDish(null)}
              />
              <motion.div 
                className="fixed bottom-0 left-0 right-0 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-[10000] w-full sm:max-w-md bg-white dark:bg-zinc-900 rounded-t-[32px] sm:rounded-[32px] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
                initial={{ y: "100%", opacity: 0.5 }}
                animate={{ opacity: 1, x: window.innerWidth >= 640 ? "-50%" : 0, y: window.innerWidth >= 640 ? "-50%" : 0 }}
                exit={{ y: "100%", opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
              >
                 <button onClick={() => setSelectedDish(null)} className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center bg-black/40 backdrop-blur-md text-white rounded-full hover:bg-black/60 transition-colors">
                    <X className="w-5 h-5" />
                 </button>
                 
                 <div className="w-full h-56 sm:h-64 bg-gray-100 relative shrink-0">
                     <OptimizedImage 
                       src={getMediaUrl(selectedDish.matchedDishImage || selectedDish.profileImage || selectedDish.image || (Array.isArray(selectedDish.images) && selectedDish.images[0]))} 
                       className="w-full h-full object-cover" 
                       fallback="/placeholder-dish.jpg"
                     />
                     <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                     <div className="absolute bottom-4 left-4 right-4 text-white">
                        <div className="flex items-center gap-2 mb-1">
                          {selectedDish.pureVegRestaurant && (
                            <div className="w-4 h-4 border border-green-500 p-[1.5px] bg-white rounded-sm shadow-sm flex items-center justify-center">
                               <div className="w-full h-full bg-green-500 rounded-full" />
                            </div>
                          )}
                          <div className="text-[10px] font-black uppercase tracking-wider bg-primary text-white px-2 py-0.5 rounded-full w-fit">
                             {selectedDish.restaurantName}
                          </div>
                        </div>
                        <h2 className="text-2xl font-black line-clamp-2 leading-tight">{selectedDish.matchedDish || selectedDish.name}</h2>
                     </div>
                 </div>
                 
                 <div className="p-5 overflow-y-auto">
                     <div className="flex items-center gap-4 text-[12px] text-gray-500 dark:text-zinc-400 font-bold uppercase tracking-tight mb-4">
                        <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-zinc-800 px-2.5 py-1 rounded-lg text-gray-700 dark:text-gray-300">
                           <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                           {selectedDish.rating || "New"}
                        </div>
                        <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-zinc-800 px-2.5 py-1 rounded-lg text-gray-700 dark:text-gray-300">
                           <Clock className="w-3.5 h-3.5" />
                           {selectedDish.estimatedDeliveryTime || "30 mins"}
                        </div>
                     </div>
                     
                     {(selectedDish.matchedDishDescription || selectedDish.description) && (
                       <p className="text-gray-600 dark:text-gray-400 text-sm mb-6 leading-relaxed bg-gray-50 dark:bg-zinc-800/50 p-4 rounded-2xl">
                         {selectedDish.matchedDishDescription || selectedDish.description}
                       </p>
                     )}
                 </div>
                 
                 <div className="p-4 bg-white dark:bg-zinc-900 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
                    <div className="flex flex-col">
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Price</span>
                      <span className="text-2xl font-black text-gray-900 dark:text-white">
                         {selectedDish.matchedDishPrice ? `₹${Number(selectedDish.matchedDishPrice).toFixed(2)}` : (selectedDish.price ? `₹${Number(selectedDish.price).toFixed(2)}` : '₹-')}
                      </span>
                    </div>
                    <Link 
                      to={`/user/restaurants/${selectedDish.slug || selectedDish.originalRestaurantId || selectedDish._id}${selectedDish.matchedDishId ? `?dish=${selectedDish.matchedDishId}` : ''}`} 
                      className="px-8 py-3.5 bg-primary text-white font-black uppercase tracking-wider text-sm rounded-2xl shadow-xl shadow-primary/30 hover:scale-105 active:scale-95 transition-all"
                    >
                       View & Add
                    </Link>
                 </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isListening && (
            <motion.div 
              className="fixed inset-0 z-[10000] bg-[#050505] flex flex-col items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Back Button */}
              <button 
                onClick={stopListening}
                className="absolute top-6 left-6 p-3 rounded-full bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-6 h-6" />
              </button>

              {/* Central Animation Area */}
              <div className="relative flex items-center justify-center w-full max-w-[280px] aspect-square mb-12 mt-10">
                
                {/* Thin dashed outer circle */}
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 rounded-full border border-red-600/30 border-dashed"
                />
                
                {/* Solid inner circle */}
                <motion.div 
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-8 rounded-full border-[1px] border-red-600/80"
                />

                {/* Soundwaves - Left (Butterfly Wing) */}
                <div className="absolute left-[-40px] flex items-center justify-end gap-1.5 h-24 w-20 opacity-90">
                  {[6, 12, 20, 32, 48, 36, 24, 14, 8].map((h, i) => (
                    <motion.div 
                      key={`l-${i}`}
                      animate={{ height: [h, h*1.5, h] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.1 }}
                      className="w-1.5 bg-red-600 rounded-full shadow-[0_0_8px_rgba(220,38,38,0.6)]"
                    />
                  ))}
                </div>

                {/* Soundwaves - Right (Butterfly Wing) */}
                <div className="absolute right-[-40px] flex items-center justify-start gap-1.5 h-24 w-20 opacity-90">
                  {[6, 12, 20, 32, 48, 36, 24, 14, 8].map((h, i) => (
                    <motion.div 
                      key={`r-${i}`}
                      animate={{ height: [h, h*1.5, h] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: (8-i) * 0.1 }}
                      className="w-1.5 bg-red-600 rounded-full shadow-[0_0_8px_rgba(220,38,38,0.6)]"
                    />
                  ))}
                </div>

                {/* Center Button */}
                <div className="relative z-10 w-36 h-36 rounded-full bg-gradient-to-b from-[#2a2a2a] to-[#0a0a0a] border-[4px] border-[#111] shadow-[0_0_0_2px_rgba(220,38,38,0.8),0_0_60px_rgba(220,38,38,0.3)] flex items-center justify-center">
                  <motion.div
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <Mic className="w-14 h-14 text-red-500 fill-red-500" strokeWidth={1} />
                  </motion.div>
                </div>
              </div>

              {/* Text */}
              <div className="text-center space-y-4 px-6 mt-4">
                <motion.h2 
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="text-[22px] font-bold text-red-500 tracking-wide"
                >
                  Listening...
                </motion.h2>
                <p className="text-gray-400 text-[15px] font-medium leading-relaxed max-w-[200px] mx-auto">
                  How can we help<br/>you with your order?
                </p>
              </div>

              {/* Loading Dots */}
              <div className="flex gap-3 mt-10">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
                    className={`rounded-full ${i === 1 ? 'bg-red-500 w-2.5 h-2.5' : 'bg-[#441111] w-2 h-2 mt-[1px]'}`}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </>,
      document.body
    )}
  </div>
)
}
