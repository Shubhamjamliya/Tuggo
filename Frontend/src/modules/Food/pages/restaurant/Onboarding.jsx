import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Input } from "@food/components/ui/input"
import { Button } from "@food/components/ui/button"
import { Label } from "@food/components/ui/label"
import { Image as ImageIcon, Upload, Clock, Calendar as CalendarIcon, Sparkles, X, LogOut, FileText } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@food/components/ui/popover"
import { Calendar } from "@food/components/ui/calendar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@food/components/ui/select"
import { restaurantAPI, zoneAPI, uploadAPI, api } from "@food/api"
import { TimePicker } from "@mui/x-date-pickers/TimePicker"
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider"
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs"
import dayjs from "dayjs"
import { determineStepToShow } from "@food/utils/onboardingUtils"
import { toast } from "sonner"
import { getImageValidationError, getUploadErrorMessage } from '@/shared/utils/uploadErrors.js'
import { useCompanyName } from "@food/hooks/useCompanyName"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import { clearModuleAuth, clearAuthData } from "@food/utils/auth"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { EMAIL_REGEX } from "@/shared/utils/emailValidation"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const ONBOARDING_STORAGE_KEY = "restaurant_onboarding_data"
const PAN_NUMBER_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GST_NUMBER_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const FSSAI_NUMBER_REGEX = /^\d{14}$/
const BANK_ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/
const IFSC_CODE_REGEX = /^[A-Z0-9]{11}$/
const OWNER_NAME_REGEX = /^[A-Za-z ]+$/
const ACCOUNT_HOLDER_NAME_REGEX = /^[A-Za-z ]+$/
const GST_LEGAL_NAME_REGEX = /^[A-Za-z ]+$/
const LOCAL_IMAGE_FILE_ACCEPT = "image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
const LOCAL_PDF_FILE_ACCEPT = ".pdf,application/pdf"
const GALLERY_IMAGE_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
let onboardingFileCache = {
  step2: {
    menuImages: [],
    profileImage: null,
    menuPdf: null,
  },
  step3: {
    panImage: null,
    gstImage: null,
    fssaiImage: null,
  },
}

// IndexedDB helpers for persistent file storage
const ONBOARDING_FILES_DB = "RestaurantOnboardingFiles"
const FILES_STORE = "files"

const openOnboardingFilesDB = () => {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(ONBOARDING_FILES_DB, 1)
      request.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains(FILES_STORE)) {
          db.createObjectStore(FILES_STORE)
        }
      }
      request.onsuccess = (e) => resolve(e.target.result)
      request.onerror = (e) => reject(e.target.error)
    } catch (err) {
      reject(err)
    }
  })
}

const saveFileToDB = async (key, file) => {
  if (!file || !isUploadableFile(file)) return
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readwrite")
    tx.objectStore(FILES_STORE).put(file, key)
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write transaction failed"))
      tx.onabort = () => reject(tx.error || new Error("IndexedDB write transaction aborted"))
    })
  } catch (err) {
    debugError("IndexedDB save failed:", err)
  }
}

const getFileFromDB = async (key) => {
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readonly")
    const request = tx.objectStore(FILES_STORE).get(key)
    return new Promise((resolve) => {
      request.onsuccess = () => {
        resolve(request.result || null)
      }
      request.onerror = () => resolve(null)
    })
  } catch (err) {
    debugError("IndexedDB load failed:", err)
    return null
  }
}

const getAllFilesFromDB = async (keys) => {
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readonly")
    const store = tx.objectStore(FILES_STORE)
    
    const results = await Promise.all(
      keys.map(key => new Promise(resolve => {
        const req = store.get(key)
        req.onsuccess = () => resolve(req.result || null)
        req.onerror = () => resolve(null)
      }))
    )
    return results
  } catch (err) {
    debugError("IndexedDB bulk load failed:", err)
    return keys.map(() => null)
  }
}

const deleteFileFromDB = async (key) => {
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readwrite")
    tx.objectStore(FILES_STORE).delete(key)
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete transaction failed"))
      tx.onabort = () => reject(tx.error || new Error("IndexedDB delete transaction aborted"))
    })
  } catch (err) {
    debugError("IndexedDB delete failed:", err)
  }
}

const clearAllFilesFromDB = async () => {
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readwrite")
    tx.objectStore(FILES_STORE).clear()
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error || new Error("IndexedDB clear transaction failed"))
      tx.onabort = () => reject(tx.error || new Error("IndexedDB clear transaction aborted"))
    })
  } catch (err) {
    debugError("IndexedDB clear failed:", err)
  }
}

const getUploadableMenuFiles = (menuImages = []) =>
  (Array.isArray(menuImages) ? menuImages : [])
    .filter((img) => isUploadableFile(img))
    .slice(0, 10)

const persistMenuImagesToDB = async (menuImages = []) => {
  const uploadableMenuFiles = getUploadableMenuFiles(menuImages)
  for (let i = 0; i < 10; i++) {
    const file = uploadableMenuFiles[i]
    if (file) {
      await saveFileToDB(`menuImage_${i}`, file)
    } else {
      await deleteFileFromDB(`menuImage_${i}`)
    }
  }
}

const persistMenuPdfToDB = async (menuPdf) => {
  if (menuPdf && isUploadableFile(menuPdf)) {
    await saveFileToDB("menuPdf", menuPdf)
  } else {
    await deleteFileFromDB("menuPdf")
  }
}

const isUploadableFile = (value) => {
  if (!value || typeof value !== "object") return false

  if (typeof File !== "undefined" && value instanceof File) return true
  if (typeof Blob !== "undefined" && value instanceof Blob) return true

  return (
    typeof value.size === "number" &&
    (typeof value.slice === "function" || typeof value.arrayBuffer === "function")
  )
}

const normalizePhoneDigits = (value) => {
  const digits = String(value || "").replace(/\D/g, "")
  // For India, users often provide 12 digits (starting with 91). 
  // We strictly need the last 10 digits for the national mobile number.
  return digits.slice(-10)
}

const normalizePincode = (value) => String(value || "").replace(/\D/g, "").slice(0, 6)

const getVerifiedPhoneFromStoredRestaurant = () => {
  try {
    const pending = localStorage.getItem("restaurant_pendingPhone")
    if (pending && pending.trim()) {
      return pending.trim()
    }

    const storedUser = localStorage.getItem("restaurant_user")
    if (!storedUser) return ""
    const user = JSON.parse(storedUser)
    const candidates = [
      user?.ownerPhone,
      user?.primaryContactNumber,
      user?.phone,
      user?.phoneNumber,
      user?.mobile,
      user?.contactNumber,
      user?.contact?.phone,
      user?.owner?.phone,
      user?.restaurant?.phone,
    ]
    const phone = candidates.find((value) => typeof value === "string" && value.trim())
    return phone ? phone.trim() : ""
  } catch {
    return ""
  }
}

const normalizeEmail = (val) => {
  let email = String(val || "").toLowerCase().trim()
  // Auto-correct common Gmail typos
  email = email.replace(/@(gnail|gamil|gimail|gnil)\.com$/i, "@gmail.com")
  return email
}

const normalizeAccountTypeValue = (value) => {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "saving" || normalized === "savings") return "Saving"
  if (normalized === "current") return "Current"
  return ""
}

const formatNameToCapital = (str) => {
  if (!str) return ""
  return str.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ")
}

const normalizeIFSC = (val) => String(val || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11)
const normalizePAN = (val) => String(val || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)
const normalizeGST = (val) => String(val || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15)
const normalizeBankAcc = (val) => String(val || "").replace(/\D/g, "").slice(0, 18)

const getTodayLocalYMD = () => formatDateToLocalYMD(new Date())

const findZoneForLocation = (lat, lng, zonesList) => {
  if (!lat || !lng || !zonesList || !zonesList.length) return null;
  const isPointInPolygon = (latitude, longitude, polygon) => {
    let isInside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].latitude, yi = polygon[i].longitude;
      const xj = polygon[j].latitude, yj = polygon[j].longitude;
      const intersect = ((yi > longitude) !== (yj > longitude)) &&
          (latitude < (xj - xi) * (longitude - yi) / (yj - yi) + xi);
      if (intersect) isInside = !isInside;
    }
    return isInside;
  };
  for (const zone of zonesList) {
    if (zone.coordinates && zone.coordinates.length >= 3) {
      if (isPointInPolygon(lat, lng, zone.coordinates)) {
        return String(zone._id || zone.id);
      }
    }
  }
  return null;
}

// Helper functions for localStorage
const saveOnboardingToLocalStorage = (step1, step2, step3, currentStep) => {
  try {
    // Persist only stable URL-based values. File/Blob objects are not serializable and
    // restoring metadata-only placeholders breaks preview/upload flows.
    const serializableStep2 = {
      ...step2,
      menuImages: (step2.menuImages || []).filter(
        (img) => !isUploadableFile(img) && (img?.url || (typeof img === "string" && img.trim()))
      ),
      profileImage:
        !isUploadableFile(step2.profileImage) &&
        (step2.profileImage?.url || (typeof step2.profileImage === "string" && step2.profileImage.trim()))
          ? step2.profileImage
          : null,
      menuPdf:
        !isUploadableFile(step2.menuPdf) &&
        (step2.menuPdf?.url || (typeof step2.menuPdf === "string" && step2.menuPdf.trim()))
          ? step2.menuPdf
          : null,
    }

    const serializableStep3 = {
      ...step3,
      panImage:
        !isUploadableFile(step3.panImage) &&
        (step3.panImage?.url || (typeof step3.panImage === "string" && step3.panImage.trim()))
          ? step3.panImage
          : null,
      gstImage:
        !isUploadableFile(step3.gstImage) &&
        (step3.gstImage?.url || (typeof step3.gstImage === "string" && step3.gstImage.trim()))
          ? step3.gstImage
          : null,
      fssaiImage:
        !isUploadableFile(step3.fssaiImage) &&
        (step3.fssaiImage?.url || (typeof step3.fssaiImage === "string" && step3.fssaiImage.trim()))
          ? step3.fssaiImage
          : null,
    }

    const dataToSave = {
      step1,
      step2: serializableStep2,
      step3: serializableStep3,
      currentStep,
      timestamp: Date.now(),
      loginPhone: getVerifiedPhoneFromStoredRestaurant(),
    }
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(dataToSave))
  } catch (error) {
    debugError("Failed to save onboarding data to localStorage:", error)
  }
}

const loadOnboardingFromLocalStorage = () => {
  try {
    const stored = localStorage.getItem(ONBOARDING_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    debugError("Failed to load onboarding data from localStorage:", error)
  }
  return null
}

const clearOnboardingFromLocalStorage = () => {
  try {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY)
  } catch (error) {
    debugError("Failed to clear onboarding data from localStorage:", error)
  }
}

const syncOnboardingFileCache = (step2, step3) => {
  onboardingFileCache = {
    step2: {
      menuImages: (step2?.menuImages || []).filter((img) => isUploadableFile(img)),
      profileImage: isUploadableFile(step2?.profileImage) ? step2.profileImage : null,
      menuPdf: isUploadableFile(step2?.menuPdf) ? step2.menuPdf : null,
    },
    step3: {
      panImage: isUploadableFile(step3?.panImage) ? step3.panImage : null,
      gstImage: isUploadableFile(step3?.gstImage) ? step3.gstImage : null,
      fssaiImage: isUploadableFile(step3?.fssaiImage) ? step3.fssaiImage : null,
    },
  }
}

const clearOnboardingFileCache = () => {
  onboardingFileCache = {
    step2: {
      menuImages: [],
      profileImage: null,
      menuPdf: null,
    },
    step3: {
      panImage: null,
      gstImage: null,
      fssaiImage: null,
    },
  }
}

// Helper function to convert "HH:mm" string to Date object
const stringToTime = (timeString) => {
  const normalized = normalizeTimeValue(timeString)
  if (!normalized || !normalized.includes(":")) {
    return null
  }
  const [hours, minutes] = normalized.split(":").map(Number)
  return new Date(2000, 0, 1, hours || 0, minutes || 0)
}

// Helper function to convert Date object to "HH:mm" string
const timeToString = (date) => {
  if (!date) return ""
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

const normalizeTimeValue = (value) => {
  if (!value) return ""

  const raw = String(value).trim()
  if (!raw) return ""

  const to24Hour = (h, m, period) => {
    let hours = Number(h)
    const minutes = Number(m)
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return ""
    if (minutes < 0 || minutes > 59) return ""
    const p = String(period || "").toUpperCase()
    if (p === "AM") {
      if (hours === 12) hours = 0
    } else if (p === "PM") {
      if (hours !== 12) hours += 12
    }
    if (hours < 0 || hours > 23) return ""
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  }

  // Already in HH:mm format
  if (/^\d{2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":").map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      return ""
    }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }

  // Handle H:mm by zero-padding hour
  if (/^\d{1}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":")
    return to24Hour(h, m, "")
  }

  // Handle 12-hour format (e.g. "10:00 AM", "9:30pm")
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/)
  if (ampm) {
    return to24Hour(ampm[1], ampm[2], ampm[3])
  }

  // Fallback for ISO / Date-like strings
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return timeToString(parsed)
  }

  return ""
}

const timeStringToMinutes = (value) => {
  const normalized = normalizeTimeValue(value)
  if (!normalized || !/^\d{2}:\d{2}$/.test(normalized)) return null
  const [hours, minutes] = normalized.split(":").map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

const formatTime12Hour = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string" || !timeStr.includes(":")) return "--:-- --"
  const [h, m] = timeStr.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return timeStr
  const period = h >= 12 ? "PM" : "AM"
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, "0")} ${period}`
}

const formatDateToLocalYMD = (date) => {
  if (!date || Number.isNaN(date.getTime?.())) return ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const parseLocalYMDDate = (value) => {
  if (!value || typeof value !== "string") return undefined
  const parts = value.split("-").map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return undefined
  const [year, month, day] = parts
  return new Date(year, month - 1, day)
}

function TimeSelector({ label, value, onChange }) {
  const timeValue = (() => {
    const normalized = normalizeTimeValue(value)
    if (!normalized) return null
    const [hours, minutes] = normalized.split(":").map(Number)
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
    return dayjs().hour(hours).minute(minutes).second(0).millisecond(0)
  })()

  const applyTimeValue = (newValue) => {
    if (newValue === null) {
      onChange("")
      return
    }
    if (!newValue || (typeof newValue.isValid === "function" && !newValue.isValid())) {
      return
    }

    if (typeof newValue.format === "function") {
      onChange(newValue.format("HH:mm"))
      return
    }

    const timeString = timeToString(newValue?.toDate?.() || newValue)
    if (timeString) {
      onChange(timeString)
    }
  }

  return (
    <div className="border border-gray-200 rounded-md px-3 py-2 bg-gray-50/60">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-gray-800" />
        <span className="text-xs font-medium text-gray-900">{label}</span>
      </div>
      <TimePicker 
        ampm={true}
        value={timeValue}
        onChange={applyTimeValue}
        onAccept={applyTimeValue}
        slotProps={{
          textField: {
            variant: "outlined",
            size: "small",
            placeholder: "Select time",
            sx: {
              "& .MuiOutlinedInput-root": {
                height: "36px",
                fontSize: "12px",
                backgroundColor: "white",
                "& fieldset": {
                  borderColor: "#e5e7eb",
                },
                "&:hover fieldset": {
                  borderColor: "#d1d5db",
                },
                "&.Mui-focused fieldset": {
                  borderColor: "#000",
                },
              },
              "& .MuiInputBase-input": {
                padding: "8px 12px",
                fontSize: "12px",
              },
            },
          },
        }}
        format="hh:mm a"
      />
    </div>
  )
}

export default function RestaurantOnboarding() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState(() => {
    try {
      const stepParam = searchParams.get("step")
      if (stepParam) {
        const s = parseInt(stepParam, 10)
        if (s >= 1 && s <= 3) return s
      }
      const stored = localStorage.getItem(ONBOARDING_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed.currentStep) {
          return Math.min(3, Math.max(1, Number(parsed.currentStep)))
        }
      }
    } catch (e) {}
    return 1
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    try {
      let fcmToken = null;
      let platform = "web";
      try {
        if (typeof window !== "undefined") {
          if (window.flutter_inappwebview) {
            platform = "mobile";
            const handlerNames = ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"];
            for (const handlerName of handlerNames) {
              try {
                const t = await Promise.race([
                  window.flutter_inappwebview.callHandler(handlerName, { module: "restaurant" }),
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
            if (!fcmToken) {
              fcmToken = localStorage.getItem("fcm_web_registered_token_restaurant") || null;
            }
          } else {
            fcmToken = localStorage.getItem("fcm_web_registered_token_restaurant") || null;
          }
        }
      } catch (e) {
        console.warn("Failed to get FCM token during logout", e);
      }

      // Add explicit call to removeFcmToken API before logout
      if (fcmToken) {
        try {
          await restaurantAPI.removeFcmToken(fcmToken, platform);
        } catch (e) {
          console.warn("Failed to remove FCM token directly", e);
        }
      }
      
      await restaurantAPI.logout(null, fcmToken, platform)
      clearModuleAuth("restaurant")
      clearAuthData()
      // Clear onboarding data and files
      clearOnboardingFromLocalStorage()
      await clearAllFilesFromDB()
      
      window.dispatchEvent(new Event("restaurantAuthChanged"))
      navigate("/food/restaurant/login", { replace: true })
    } catch (error) {
      debugError("Logout failed:", error)
      clearModuleAuth("restaurant")
      navigate("/food/restaurant/login", { replace: true })
    } finally {
      setIsLoggingOut(false)
    }
  }

  const [verifiedPhoneNumber, setVerifiedPhoneNumber] = useState("")
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [isEditing, setIsEditing] = useState(true)
  const [hasExistingRestaurantProfile, setHasExistingRestaurantProfile] = useState(false)
  const [isFssaiCalendarOpen, setIsFssaiCalendarOpen] = useState(false)
  const [zones, setZones] = useState([])
  const zonesRef = useRef([])
  const [zonesLoading, setZonesLoading] = useState(false)
  const [isOnboardingHydrated, setIsOnboardingHydrated] = useState(false)

  useEffect(() => {
    zonesRef.current = zones
  }, [zones])

  const [step1, setStep1] = useState({
    restaurantName: "",
    pureVegRestaurant: null,
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    primaryContactNumber: "",
    zoneId: "",
    location: {
      formattedAddress: "",
      addressLine1: "",
      addressLine2: "",
      area: "",
      city: "",
      state: "",
      pincode: "",
      landmark: "",
      latitude: "",
      longitude: "",
    },
  })

  const [step2, setStep2] = useState({
    menuImages: [],
    menuPdf: null,
    profileImage: null,
    cuisines: [],
    estimatedDeliveryTime: "",
    openingTime: "",
    closingTime: "",
    openDays: [],
  })

  const [step3, setStep3] = useState({
    panNumber: "",
    nameOnPan: "",
    panImage: null,
    gstRegistered: false,
    gstNumber: "",
    gstLegalName: "",
    gstAddress: "",
    gstImage: null,
    fssaiNumber: "",
    fssaiExpiry: "",
    fssaiImage: null,
    accountNumber: "",
    confirmAccountNumber: "",
    ifscCode: "",
    accountHolderName: "",
    accountType: "",
  })

  const previewUrlCacheRef = useRef(new Map())
  const locationSearchInputRef = useRef(null)
  const placesAutocompleteRef = useRef(null)
  const mapsScriptLoadedRef = useRef(false)
  const menuImagesInputRef = useRef(null)
  const menuPdfInputRef = useRef(null)
  const profileImageInputRef = useRef(null)
  const panImageInputRef = useRef(null)
  const gstImageInputRef = useRef(null)
  const fssaiImageInputRef = useRef(null)
  const zoneDetectTimerRef = useRef(null)
  const lastZoneDetectKeyRef = useRef(null)
  const lastOutOfZoneToastKeyRef = useRef(null)
  const [sourcePicker, setSourcePicker] = useState({
    isOpen: false,
    title: "",
    onSelectFile: null,
    fileNamePrefix: "camera-image",
    fallbackInputRef: null,
  })

  // Manual search states for fallback
  const [locationSearchValue, setLocationSearchValue] = useState("")
  const [locationSuggestions, setLocationSuggestions] = useState([])
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)
  const justSelectedRef = useRef(false)
  const googleMapsReadyRef = useRef(false)

  const handleLocationSelect = (parsed) => {
    let matchedZoneId = "";
    if (parsed.latitude && parsed.longitude && zonesRef.current.length > 0) {
      matchedZoneId = findZoneForLocation(parsed.latitude, parsed.longitude, zonesRef.current) || "";
      if (!matchedZoneId) {
        toast.error("This address is not in our service zone. Please select a valid location.", { id: 'out-of-zone' });
      }
    }

    setStep1((prev) => ({
      ...prev,
      zoneId: matchedZoneId || prev.zoneId,
      location: {
        ...prev.location,
        formattedAddress: parsed.formattedAddress || prev.location.formattedAddress,
        addressLine1: parsed.formattedAddress || prev.location.addressLine1 || "",
        area: parsed.area || prev.location.area,
        city: parsed.city || prev.location.city,
        state: parsed.state || prev.location.state,
        pincode: parsed.pincode || prev.location.pincode,
        latitude: parsed.latitude !== "" ? parsed.latitude : prev.location.latitude,
        longitude: parsed.longitude !== "" ? parsed.longitude : prev.location.longitude,
      },
    }))
    
    setLocationSearchValue(parsed.formattedAddress)
    setLocationSuggestions([])
  }

  const getPreviewImageUrl = (value) => {
    if (!value) return null
    if (typeof value === "string") return value
    if (value?.url && typeof value.url === "string") return value.url

    if (isUploadableFile(value)) {
      const cache = previewUrlCacheRef.current
      const cached = cache.get(value)
      if (cached) return cached
      try {
        const objectUrl = URL.createObjectURL(value)
        cache.set(value, objectUrl)
        return objectUrl
      } catch {
        return null
      }
    }

    return null
  }

  const openImageSourcePicker = ({ title, onSelectFile, fileNamePrefix, fallbackInputRef }) => {
    setSourcePicker({
      isOpen: true,
      title: title || "Select image source",
      onSelectFile,
      fileNamePrefix: fileNamePrefix || "camera-image",
      fallbackInputRef: fallbackInputRef || null,
    })
  }

  const closeImageSourcePicker = () => {
    setSourcePicker((prev) => ({ ...prev, isOpen: false }))
  }

  const handleMenuImagesSelected = (files = []) => {
    if (!files.length) return
    const nextMenuImages = [...(step2.menuImages || []), ...files]
    setStep2((prev) => ({
      ...prev,
      menuImages: nextMenuImages,
    }))
    void persistMenuImagesToDB(nextMenuImages)
  }

  const isPdfFile = (file) => {
    if (!isUploadableFile(file)) return false
    const type = String(file.type || "").toLowerCase()
    if (type === "application/pdf") return true
    const name = String(file.name || "").toLowerCase()
    return name.endsWith(".pdf")
  }

  const handleMenuPdfSelected = async (file) => {
    if (!file) return
    if (!isPdfFile(file)) {
      toast.error("Only PDF files are allowed for menu upload")
      return
    }
    setStep2((prev) => ({ ...prev, menuPdf: file }))
    await persistMenuPdfToDB(file)
  }

  const handleRemoveMenuPdf = async () => {
    setStep2((prev) => ({ ...prev, menuPdf: null }))
    await persistMenuPdfToDB(null)
  }

  const handleProfileImageSelected = (file) => {
    if (!file) return
    setStep2((prev) => ({
      ...prev,
      profileImage: file,
    }))
    void saveFileToDB("profileImage", file)
  }

  const handlePanImageSelected = (file) => {
    if (!file) return
    setStep3((prev) => ({ ...prev, panImage: file }))
  }

  const handleGstImageSelected = (file) => {
    if (!file) return
    setStep3((prev) => ({ ...prev, gstImage: file }))
  }

  const handleFssaiImageSelected = (file) => {
    if (!file) return
    setStep3((prev) => ({ ...prev, fssaiImage: file }))
  }

  const isPersistedImageValue = (value) =>
    !isUploadableFile(value) &&
    ((typeof value === "string" && value.trim()) ||
      (value?.url && typeof value.url === "string"))

  const getPersistedImagePayload = (value) => {
    if (typeof value === "string" && value.trim()) {
      return { url: value.trim(), publicId: null }
    }

    if (value?.url && typeof value.url === "string" && value.url.trim()) {
      return {
        url: value.url.trim(),
        publicId: value.publicId || null,
      }
    }

    return null
  }

  const toPersistedMenuImagesPayload = (menuImages = []) =>
    (Array.isArray(menuImages) ? menuImages : [])
      .filter((img) => isPersistedImageValue(img))
      .map((img) =>
        typeof img === "string"
          ? img
          : {
              url: img.url,
              publicId: img.publicId || null,
            },
      )

  const handleRemoveMenuImage = async (indexToRemove) => {
    const currentMenuImages = step2.menuImages || []
    const imageToRemove = currentMenuImages[indexToRemove]
    const nextMenuImages = currentMenuImages.filter((_, i) => i !== indexToRemove)

    setStep2((prev) => ({
      ...prev,
      menuImages: nextMenuImages,
    }))
    await persistMenuImagesToDB(nextMenuImages)

    if (!isPersistedImageValue(imageToRemove)) {
      return
    }

    try {
      await restaurantAPI.updateProfile({
        menuImages: toPersistedMenuImagesPayload(nextMenuImages),
      })
      toast.success("Menu image removed")
    } catch (error) {
      setStep2((prev) => ({
        ...prev,
        menuImages: currentMenuImages,
      }))
      await persistMenuImagesToDB(currentMenuImages)
      toast.error(error?.response?.data?.message || "Failed to remove menu image")
    }
  }

  const handleRemoveProfileImage = async () => {
    const currentProfileImage = step2.profileImage
    setStep2((prev) => ({
      ...prev,
      profileImage: null,
    }))

    if (!isPersistedImageValue(currentProfileImage)) {
      return
    }

    try {
      await restaurantAPI.updateProfile({ profileImage: "" })
      toast.success("Profile image removed")
    } catch (error) {
      setStep2((prev) => ({
        ...prev,
        profileImage: currentProfileImage,
      }))
      toast.error(error?.response?.data?.message || "Failed to remove profile image")
    }
  }

  const resolveImageForProfileUpdate = async (value, folder) => {
    if (!value) return null

    if (isUploadableFile(value)) {
      const uploaded = await handleUpload(value, folder)
      return uploaded || null
    }

    return getPersistedImagePayload(value)
  }

  const resolveMenuPdfForProfileUpdate = async (value) => {
    if (!value) return null

    if (isUploadableFile(value)) {
      if (!isPdfFile(value)) {
        throw new Error("Only PDF files are allowed for menu upload")
      }
      const uploaded = await handleFileUpload(value, "food/restaurants/menu-pdf")
      return uploaded || null
    }

    return getPersistedImagePayload(value)
  }

  const resolveMenuImagesForProfileUpdate = async (menuImages = []) => {
    const items = Array.isArray(menuImages) ? menuImages : []
    const resolved = await Promise.all(
      items.map(async (image) => {
        if (isUploadableFile(image)) {
          return handleUpload(image, "food/restaurants/menu")
        }

        return getPersistedImagePayload(image)
      }),
    )

    return resolved.filter((image) => image?.url)
  }


  // Separate effect to handle URL step changes without reloading data
  useEffect(() => {
    const stepParam = searchParams.get("step")
    if (stepParam) {
      const stepNum = parseInt(stepParam, 10)
      if (stepNum >= 1 && stepNum <= 3) {
        setStep(stepNum)
      }
    }
  }, [searchParams])

  // Separate effect for background zone fetching to prevent UI blocking
  useEffect(() => {
    const fetchZones = async () => {
      try {
        setZonesLoading(true)
        const zoneRes = await zoneAPI.getPublicZones()
        if (zoneRes.data?.success) {
          setZones(zoneRes.data.data?.zones || zoneRes.data.data || [])
        }
      } catch (zErr) {
        debugError("Failed to fetch zones:", zErr)
      } finally {
        setZonesLoading(false)
      }
    }
    fetchZones()
  }, [])

  // Load from localStorage on mount
  useEffect(() => {
    setVerifiedPhoneNumber(getVerifiedPhoneFromStoredRestaurant())

    const loadData = async () => {
      const stepParam = searchParams.get("step")
      let loadingTimer = null
      try {
        setLoading(true)
        if (typeof window !== "undefined") {
          loadingTimer = window.setTimeout(() => {
            setLoading(false)
          }, 8000)
        }

        const currentPhone = getVerifiedPhoneFromStoredRestaurant()
        const localData = loadOnboardingFromLocalStorage()
        
        // 1. First fetch API data to have the latest backend state (only if authenticated)
        let apiData = null;

        // 2. Hydrate from API if exists
        if (apiData) {
          setHasExistingRestaurantProfile(true)
          const onboarding = apiData.onboarding || {}
          const s1 = onboarding.step1 || {}
          const s2 = onboarding.step2 || {}
          const s3 = onboarding.step3 || {}
          const loc = s1.location || apiData.location || {}
          const pay = s3.bank || apiData.bankAccount || {}

          setStep1(prev => ({
            ...prev,
            restaurantName: s1.restaurantName || apiData.name || "",
            pureVegRestaurant: typeof s1.pureVegRestaurant === 'boolean' ? s1.pureVegRestaurant : (apiData.pureVegRestaurant ?? null),
            ownerName: s1.ownerName || apiData.ownerName || "",
            ownerEmail: s1.ownerEmail || apiData.email || "",
            ownerPhone: s1.ownerPhone || apiData.phone || "",
            primaryContactNumber: s1.primaryContactNumber || apiData.primaryContactNumber || "",
            zoneId: s1.zoneId || apiData.zoneId || "",
            location: {
              ...prev.location,
              formattedAddress: loc.formattedAddress || loc.address || apiData.address || "",
              addressLine1: loc.addressLine1 || "",
              addressLine2: loc.addressLine2 || "",
              area: loc.area || apiData.area || "",
              city: loc.city || apiData.city || "",
              state: loc.state || apiData.state || "",
              pincode: loc.pincode || apiData.pincode || "",
              landmark: loc.landmark || "",
              latitude: loc.latitude || "",
              longitude: loc.longitude || "",
            }
          }))

          setStep2(prev => ({
            ...prev,
            menuImages: Array.isArray(s2.menuImageUrls) ? s2.menuImageUrls : (Array.isArray(apiData.menuImages) ? apiData.menuImages : []),
            menuPdf: s2.menuPdfUrl || apiData.menuPdf || null,
            profileImage: s2.profileImageUrl || apiData.profileImage || null,
            cuisines: Array.isArray(s2.cuisines) ? s2.cuisines : (Array.isArray(apiData.cuisines) ? apiData.cuisines : []),
            estimatedDeliveryTime: s2.estimatedDeliveryTime || apiData.estimatedDeliveryTime || "",
            openingTime: normalizeTimeValue(s2.openingTime || apiData.openingTime),
            closingTime: normalizeTimeValue(s2.closingTime || apiData.closingTime),
            openDays: Array.isArray(s2.openDays) ? s2.openDays : (Array.isArray(apiData.openDays) ? apiData.openDays : []),
          }))

          setStep3(prev => ({
            ...prev,
            panNumber: s3.pan?.panNumber || apiData.panNumber || "",
            nameOnPan: s3.pan?.nameOnPan || apiData.nameOnPan || "",
            panImage: s3.pan?.image || apiData.panImage || null,
            gstRegistered: s3.gst?.isRegistered ?? apiData.gstRegistered ?? false,
            gstNumber: s3.gst?.gstNumber || apiData.gstNumber || "",
            gstLegalName: s3.gst?.legalName || apiData.gstLegalName || "",
            gstAddress: s3.gst?.address || apiData.gstAddress || "",
            gstImage: s3.gst?.image || apiData.gstImage || null,
            fssaiNumber: s3.fssai?.registrationNumber || apiData.fssaiNumber || "",
            fssaiExpiry: s3.fssai?.expiryDate ? String(s3.fssai.expiryDate).split('T')[0] : (apiData.fssaiExpiry ? String(apiData.fssaiExpiry).split('T')[0] : ""),
            fssaiImage: s3.fssai?.image || apiData.fssaiImage || null,
            accountNumber: pay.accountNumber || apiData.accountNumber || "",
            confirmAccountNumber: pay.accountNumber || apiData.accountNumber || "",
            ifscCode: normalizeIFSC(pay.ifscCode || apiData.ifscCode),
            accountHolderName: pay.accountHolderName || apiData.accountHolderName || "",
            accountType: normalizeAccountTypeValue(pay.accountType || apiData.accountType),
          }))
        }

        // 3. APPLY LOCAL OVERRIDES (The "Persistence" fix)
        // If localStorage has unsaved changes for this user, apply them over the API/Initial state.
        if (localData) {
          const savedLoginPhone = normalizePhoneDigits(localData.loginPhone || "")
          const savedOwnerPhone = normalizePhoneDigits(localData.step1?.ownerPhone || "")
          const checkPhone = savedLoginPhone || savedOwnerPhone
          const normalizedCurrent = normalizePhoneDigits(currentPhone)
          
          // Only use local data if it belongs to the same user or if the phone was not saved yet
          if (!checkPhone || !normalizedCurrent || checkPhone === normalizedCurrent) {
            debugLog("? Matching local session found. Resuming with unsaved changes.")
            
            if (localData.step1) {
              setStep1(prev => ({ ...prev, ...localData.step1, location: { ...prev.location, ...localData.step1.location } }));
            }
            if (localData.step2) {
              // Note: Files/Images must be re-hydrated from IndexedDB (handled below)
              setStep2(prev => ({ 
                ...prev, 
                ...localData.step2,
                openingTime: normalizeTimeValue(localData.step2.openingTime),
                closingTime: normalizeTimeValue(localData.step2.closingTime),
              }));
            }
            if (localData.step3) {
              setStep3(prev => ({ ...prev, ...localData.step3 }));
            }

            // Restore Step
            if (localData.currentStep && !stepParam) {
              setStep(Math.min(3, Math.max(1, Number(localData.currentStep))))
            }
          } else {
             debugLog("? Phone mismatch, data belongs to different user. Clearing local cache.")
             clearOnboardingFromLocalStorage()
             await clearAllFilesFromDB()
          }
        }

        // 4. Finally re-hydrate heavy files from IndexedDB if they exist 
        // (IndexedDB is reliable for large files which don't fit in localStorage)
        const fileKeys = [
          "profileImage",
          "panImage",
          "gstImage",
          "fssaiImage",
          "menuPdf",
          ...Array.from({ length: 10 }, (_, i) => `menuImage_${i}`)
        ];
        
        const [prof, pan, gst, fs, pdf, ...menuImages] = await getAllFilesFromDB(fileKeys);

        if (prof) setStep2(p => ({ ...p, profileImage: prof }));
        if (pan) setStep3(p => ({ ...p, panImage: pan }));
        if (gst) setStep3(p => ({ ...p, gstImage: gst }));
        if (fs) setStep3(p => ({ ...p, fssaiImage: fs }));
        if (pdf) setStep2(p => ({ ...p, menuPdf: pdf }));

        const restoredMenuImages = menuImages.filter(Boolean)
        if (restoredMenuImages.length) {
          setStep2(p => ({ ...p, menuImages: [...p.menuImages.filter(im => !isUploadableFile(im)), ...restoredMenuImages] }));
        }

        // If step is explicitly in URL, use it
        if (stepParam) {
          const s = parseInt(stepParam, 10);
          if (s >= 1 && s <= 3) setStep(s);
        }

      } catch (err) {
        debugError("Onboarding hydration failed:", err)
      } finally {
        setIsOnboardingHydrated(true)
        setLoading(false)
        if (loadingTimer) {
          window.clearTimeout(loadingTimer)
        }
      }
    }

    loadData()
  }, []) // Empty dependency array to prevent data wipe on URL changes

  useEffect(() => {
    if (!verifiedPhoneNumber) return
    setStep1((prev) => ({
      ...prev,
      ownerPhone: verifiedPhoneNumber,
    }))
  }, [verifiedPhoneNumber])

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return undefined

    const updateInset = () => {
      const vv = window.visualViewport
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height))
      setKeyboardInset(inset > 120 ? inset : 0)
    }

    updateInset()
    window.visualViewport.addEventListener("resize", updateInset)
    window.visualViewport.addEventListener("scroll", updateInset)
    return () => {
      window.visualViewport.removeEventListener("resize", updateInset)
      window.visualViewport.removeEventListener("scroll", updateInset)
    }
  }, [])

  // Save to localStorage whenever step data changes
  useEffect(() => {
    if (!isOnboardingHydrated) return
    saveOnboardingToLocalStorage(step1, step2, step3, step)
    
    // Save images to IndexedDB
    const saveFiles = async () => {
      if (step2.profileImage && isUploadableFile(step2.profileImage)) {
        await saveFileToDB("profileImage", step2.profileImage)
      } else if (!step2.profileImage) {
        await deleteFileFromDB("profileImage")
      }
      if (step3.panImage && isUploadableFile(step3.panImage)) {
        await saveFileToDB("panImage", step3.panImage)
      }
      if (step3.gstImage && isUploadableFile(step3.gstImage)) {
        await saveFileToDB("gstImage", step3.gstImage)
      }
      if (step3.fssaiImage && isUploadableFile(step3.fssaiImage)) {
        await saveFileToDB("fssaiImage", step3.fssaiImage)
      }
      
      await persistMenuImagesToDB(step2.menuImages || [])
      await persistMenuPdfToDB(step2.menuPdf || null)
    }
    saveFiles()
  }, [isOnboardingHydrated, step1, step2, step3, step])

  useEffect(() => {
    syncOnboardingFileCache(step2, step3)
  }, [step2, step3])

  useEffect(() => {
    return () => {
      previewUrlCacheRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url)
        } catch {
          // Ignore revoke errors
        }
      })
      previewUrlCacheRef.current.clear()
    }
  }, [])

  // REMOVED redundancy: The hydration is now handled in a single loadData effect above 
  // to avoid race conditions between localStorage and API data.

  const handleUpload = async (file, folder) => {
    try {
      const imageValidationError = getImageValidationError(file)
      if (imageValidationError) {
        throw new Error(imageValidationError)
      }

      const response = await uploadAPI.uploadMedia(file, { folder })
      const uploadedImage = response?.data?.data

      if (!uploadedImage?.url) {
        throw new Error("Uploaded image URL was not returned")
      }

      return uploadedImage
    } catch (err) {
      // Provide more informative error message for upload failures
      const errorMsg = getUploadErrorMessage(err, { fallback: "Failed to upload image." })
      debugError("Upload error:", errorMsg, err)
      throw new Error(`Image upload failed: ${errorMsg}`)
    }
  }

  const handleFileUpload = async (file, folder) => {
    try {
      if (!isUploadableFile(file)) {
        throw new Error("Invalid file")
      }

      const response = await uploadAPI.uploadFile(file, { folder })
      const uploadedFile = response?.data?.data

      if (!uploadedFile?.url) {
        throw new Error("Uploaded file URL was not returned")
      }

      return uploadedFile
    } catch (err) {
      const errorMsg = getUploadErrorMessage(err, { fallback: "Failed to upload file." })
      debugError("Upload error:", errorMsg, err)
      throw new Error(`File upload failed: ${errorMsg}`)
    }
  }

  // Validation functions for each step
  const validateStep1 = () => {
    const errors = []

    if (!step1.restaurantName?.trim()) {
      errors.push("Restaurant name is required")
    }
    if (typeof step1.pureVegRestaurant !== "boolean") {
      errors.push("Please select whether your restaurant is pure veg")
    }
    if (!step1.ownerName?.trim()) {
      errors.push("Owner name is required")
    } else if (!OWNER_NAME_REGEX.test(step1.ownerName.trim())) {
      errors.push("Owner name must contain only letters")
    }
    if (!step1.ownerEmail?.trim()) {
      errors.push("Owner email is required")
    } else if (!EMAIL_REGEX.test(step1.ownerEmail.trim())) {
      errors.push("Please enter a valid email address")
    } else if (step1.ownerEmail.toLowerCase().includes("@gnail.com") || step1.ownerEmail.toLowerCase().includes("@gnil.com")) {
      errors.push("Invalid email domain. Did you mean '@gmail.com'?")
    }
    if (!step1.ownerPhone?.trim()) {
      errors.push("Owner phone number is required")
    } else if (!/^\d{10}$/.test(normalizePhoneDigits(step1.ownerPhone))) {
      errors.push("Owner phone number must be exactly 10 digits")
    }
    if (!step1.primaryContactNumber?.trim()) {
      errors.push("Primary contact number is required")
    } else if (!/^\d{10}$/.test(normalizePhoneDigits(step1.primaryContactNumber))) {
       errors.push("Primary contact number must be exactly 10 digits")
    }
    if (!step1.zoneId?.trim()) {
      errors.push("Service zone is required")
    }
    if (!step1.location?.area?.trim()) {
      errors.push("Area/Sector/Locality is required")
    }
    if (!step1.location?.city?.trim()) {
      errors.push("City is required")
    }
    if (!step1.location?.pincode?.trim()) {
      errors.push("Pincode is required")
    } else if (!/^\d{6}$/.test(normalizePincode(step1.location.pincode))) {
      errors.push("Pincode must be exactly 6 digits")
    }

    return errors
  }

  const validateStep2 = () => {
    const errors = []



    // Check profile image - must be a File or existing URL
    if (!step2.profileImage) {
      errors.push("Restaurant profile image is required")
    } else {
      // Verify profile image is either a File or has a valid URL
      const isValidProfileImage =
        isUploadableFile(step2.profileImage) ||
        (step2.profileImage?.url && typeof step2.profileImage.url === 'string') ||
        (typeof step2.profileImage === 'string' && step2.profileImage.trim())
      if (!isValidProfileImage) {
        errors.push("Please upload a valid restaurant profile image")
      }
    }



    if (!step2.openingTime?.trim()) {
      errors.push("Opening time is required")
    }
    if (!step2.closingTime?.trim()) {
      errors.push("Closing time is required")
    }
    const openingMinutes = timeStringToMinutes(step2.openingTime)
    const closingMinutes = timeStringToMinutes(step2.closingTime)
    if (openingMinutes !== null && closingMinutes !== null) {
      if (openingMinutes === closingMinutes) {
        errors.push("Opening time and closing time cannot be same")
      } else if (closingMinutes < openingMinutes) {
        errors.push("Closing time cannot be less than opening time")
      }
    }
    if (!step2.openDays || step2.openDays.length === 0) {
      errors.push("Please select at least one open day")
    }
    if (!step2.estimatedDeliveryTime?.trim()) {
      errors.push("Estimated delivery time is required")
    }

    return errors
  }

  const validateStep3 = () => {
    const errors = []

    if (!step3.panNumber?.trim()) {
      errors.push("PAN number is required")
    } else if (!PAN_NUMBER_REGEX.test(step3.panNumber.trim().toUpperCase())) {
      errors.push("PAN number must be valid (e.g., ABCDE1234F)")
    }
    if (!step3.nameOnPan?.trim()) {
      errors.push("Name on PAN is required")
    }
    // Validate PAN image - must be a File or existing URL
    if (!step3.panImage) {
      errors.push("PAN image is required")
    } else {
      const isValidPanImage =
        isUploadableFile(step3.panImage) ||
        (step3.panImage?.url && typeof step3.panImage.url === 'string') ||
        (typeof step3.panImage === 'string' && step3.panImage.trim())
      if (!isValidPanImage) {
        errors.push("Please upload a valid PAN image")
      }
    }

    if (!step3.fssaiNumber?.trim()) {
      errors.push("FSSAI number is required")
    } else if (!FSSAI_NUMBER_REGEX.test(step3.fssaiNumber.trim())) {
      errors.push("FSSAI number must contain exactly 14 digits")
    }
    if (!step3.fssaiExpiry?.trim()) {
      errors.push("FSSAI expiry date is required")
    } else if (step3.fssaiExpiry < getTodayLocalYMD()) {
      errors.push("FSSAI expiry date cannot be in the past")
    }
    // Validate FSSAI image - must be a File or existing URL
    if (!step3.fssaiImage) {
      errors.push("FSSAI image is required")
    } else {
      const isValidFssaiImage =
        isUploadableFile(step3.fssaiImage) ||
        (step3.fssaiImage?.url && typeof step3.fssaiImage.url === 'string') ||
        (typeof step3.fssaiImage === 'string' && step3.fssaiImage.trim())
      if (!isValidFssaiImage) {
        errors.push("Please upload a valid FSSAI image")
      }
    }

    // Validate GST details if GST registered
    if (step3.gstRegistered) {
      if (!step3.gstNumber?.trim()) {
        errors.push("GST number is required when GST registered")
      } else if (!GST_NUMBER_REGEX.test(step3.gstNumber.trim().toUpperCase())) {
        errors.push("GST number must be a valid 15-character GSTIN")
      }
      if (!step3.gstLegalName?.trim()) {
        errors.push("GST legal name is required when GST registered")
      } else if (!GST_LEGAL_NAME_REGEX.test(step3.gstLegalName.trim())) {
        errors.push("GST legal name must contain only letters")
      }
      if (!step3.gstAddress?.trim()) {
        errors.push("GST registered address is required when GST registered")
      }
      // Validate GST image if GST registered
      if (!step3.gstImage) {
        errors.push("GST image is required when GST registered")
      } else {
        const isValidGstImage =
          isUploadableFile(step3.gstImage) ||
          (step3.gstImage?.url && typeof step3.gstImage.url === 'string') ||
          (typeof step3.gstImage === 'string' && step3.gstImage.trim())
        if (!isValidGstImage) {
          errors.push("Please upload a valid GST image")
        }
      }
    }

    if (!step3.accountNumber?.trim()) {
      errors.push("Account number is required")
    } else if (!BANK_ACCOUNT_NUMBER_REGEX.test(step3.accountNumber.trim())) {
      errors.push("Account number must contain 9 to 18 digits only")
    }
    if (!step3.confirmAccountNumber?.trim()) {
      errors.push("Please confirm your account number")
    } else if (!BANK_ACCOUNT_NUMBER_REGEX.test(step3.confirmAccountNumber.trim())) {
      errors.push("Confirm account number must contain 9 to 18 digits only")
    }
    if (step3.accountNumber && step3.confirmAccountNumber && step3.accountNumber !== step3.confirmAccountNumber) {
      errors.push("Account number and confirmation do not match")
    }
    if (!step3.ifscCode?.trim()) {
      errors.push("IFSC code is required")
    } else if (!IFSC_CODE_REGEX.test(step3.ifscCode.trim().toUpperCase())) {
      errors.push("IFSC code must contain exactly 11 alphanumeric characters")
    }
    if (!step3.accountHolderName?.trim()) {
      errors.push("Account holder name is required")
    } else if (!ACCOUNT_HOLDER_NAME_REGEX.test(step3.accountHolderName.trim())) {
      errors.push("Account holder name must contain only letters")
    }
    if (!step3.accountType?.trim()) {
      errors.push("Account type is required")
    } else if (!["Saving", "Current"].includes(step3.accountType.trim())) {
      errors.push("Account type must be either Saving or Current")
    }

    return errors
  }

  // Fill dummy data for testing (development mode only)




  const handleNext = async () => {
    setError("")

    // Validate current step before proceeding
    let validationErrors = []
    if (step === 1) {
      validationErrors = validateStep1()
    } else if (step === 2) {
      validationErrors = validateStep2()
    } else if (step === 3) {
      validationErrors = validateStep3()
    }

    if (validationErrors.length > 0) {
      // Surface only the first error so validation proceeds top-to-bottom.
      toast.error(validationErrors[0], {
        duration: 4000,
      })
      debugLog('? Validation failed:', validationErrors)
      return
    }

    setSaving(true)
    try {
      if (step === 1) {
        setStep(2)
        window.scrollTo({ top: 0, behavior: "instant" })
      } else if (step === 2) {
        setStep(3)
        window.scrollTo({ top: 0, behavior: "instant" })
      } else if (step === 3) {
        if (hasExistingRestaurantProfile) {
          const [
            profileImagePayload,
            panImagePayload,
            gstImagePayload,
            fssaiImagePayload,
          ] = await Promise.all([
            resolveImageForProfileUpdate(step2.profileImage, "food/restaurants/profile"),
            resolveImageForProfileUpdate(step3.panImage, "food/restaurants/pan"),
            step3.gstRegistered
              ? resolveImageForProfileUpdate(step3.gstImage, "food/restaurants/gst")
              : Promise.resolve(null),
            resolveImageForProfileUpdate(step3.fssaiImage, "food/restaurants/fssai"),
          ])

          const updatePayload = {
            restaurantName: step1.restaurantName || "",
            pureVegRestaurant: step1.pureVegRestaurant === true,
            ownerName: step1.ownerName || "",
            ownerEmail: (step1.ownerEmail || "").trim(),
            ownerPhone: normalizePhoneDigits(step1.ownerPhone),
            primaryContactNumber: normalizePhoneDigits(step1.primaryContactNumber),
            zoneId: step1.zoneId || "",
            location: {
              formattedAddress: step1.location?.formattedAddress || "",
              addressLine1: step1.location?.addressLine1 || "",
              addressLine2: step1.location?.addressLine2 || "",
              area: step1.location?.area || "",
              city: step1.location?.city || "",
              state: step1.location?.state || "",
              pincode: step1.location?.pincode || "",
              landmark: step1.location?.landmark || "",
              latitude: step1.location?.latitude || "",
              longitude: step1.location?.longitude || "",
            },
            cuisines: Array.isArray(step2.cuisines) ? step2.cuisines : [],
            estimatedDeliveryTime: (step2.estimatedDeliveryTime || "").trim(),
            openingTime: normalizeTimeValue(step2.openingTime) || "",
            closingTime: normalizeTimeValue(step2.closingTime) || "",
            openDays: Array.isArray(step2.openDays) ? step2.openDays : [],
            profileImage: profileImagePayload || "",
            panNumber: step3.panNumber || "",
            nameOnPan: step3.nameOnPan || "",
            panImage: panImagePayload || "",
            gstRegistered: Boolean(step3.gstRegistered),
            gstNumber: step3.gstRegistered ? step3.gstNumber || "" : "",
            gstLegalName: step3.gstRegistered ? step3.gstLegalName || "" : "",
            gstAddress: step3.gstRegistered ? step3.gstAddress || "" : "",
            gstImage: step3.gstRegistered ? (gstImagePayload || "") : "",
            fssaiNumber: step3.fssaiNumber || "",
            fssaiExpiry: step3.fssaiExpiry || "",
            fssaiImage: fssaiImagePayload || "",
            accountNumber: step3.accountNumber || "",
            ifscCode: (step3.ifscCode || "").toUpperCase(),
            accountHolderName: step3.accountHolderName || "",
            accountType: step3.accountType || "",
          }

          await restaurantAPI.updateProfile(updatePayload)

          clearOnboardingFromLocalStorage()
          clearOnboardingFileCache()
          await clearAllFilesFromDB()

          toast.success("Profile updated successfully", { duration: 4000 })
          navigate("/food/restaurant/explore", { replace: true })
          return
        }

        // Final submit: create restaurant in DB using backend multipart endpoint.
        const formData = new FormData()

        // Step 1
        formData.append("restaurantName", step1.restaurantName || "")
        formData.append(
          "pureVegRestaurant",
          step1.pureVegRestaurant === true ? "true" : "false",
        )
        formData.append("ownerName", step1.ownerName || "")
        formData.append("ownerEmail", (step1.ownerEmail || "").trim())
        formData.append("ownerPhone", normalizePhoneDigits(step1.ownerPhone))
        formData.append("primaryContactNumber", normalizePhoneDigits(step1.primaryContactNumber))
        formData.append("zoneId", step1.zoneId || "")
        formData.append("addressLine1", step1.location?.addressLine1 || "")
        formData.append("addressLine2", step1.location?.addressLine2 || "")
        formData.append("area", step1.location?.area || "")
        formData.append("city", step1.location?.city || "")
        formData.append("state", step1.location?.state || "")
        formData.append("pincode", step1.location?.pincode || "")
        formData.append("landmark", step1.location?.landmark || "")
        formData.append("formattedAddress", step1.location?.formattedAddress || "")
        formData.append("latitude", String(step1.location?.latitude || ""))
        formData.append("longitude", String(step1.location?.longitude || ""))

        // Step 2
        formData.append("cuisines", (step2.cuisines || []).join(","))
        formData.append("estimatedDeliveryTime", (step2.estimatedDeliveryTime || "").trim())
        formData.append("openingTime", normalizeTimeValue(step2.openingTime) || "")
        formData.append("closingTime", normalizeTimeValue(step2.closingTime) || "")
        formData.append("openDays", (step2.openDays || []).join(","))


        if (!isUploadableFile(step2.profileImage)) {
          throw new Error("Restaurant profile image is required")
        }
        formData.append("profileImage", step2.profileImage)

        // Step 3
        formData.append("panNumber", step3.panNumber || "")
        formData.append("nameOnPan", step3.nameOnPan || "")
        if (!isUploadableFile(step3.panImage)) {
          throw new Error("PAN image is required")
        }
        formData.append("panImage", step3.panImage)

        formData.append("gstRegistered", step3.gstRegistered ? "true" : "false")
        if (step3.gstRegistered) {
          formData.append("gstNumber", step3.gstNumber || "")
          formData.append("gstLegalName", step3.gstLegalName || "")
          formData.append("gstAddress", step3.gstAddress || "")
          if (!isUploadableFile(step3.gstImage)) {
            throw new Error("GST image is required when GST registered")
          }
          formData.append("gstImage", step3.gstImage)
        }

        formData.append("fssaiNumber", step3.fssaiNumber || "")
        formData.append("fssaiExpiry", step3.fssaiExpiry || "")
        if (!isUploadableFile(step3.fssaiImage)) {
          throw new Error("FSSAI image is required")
        }
        formData.append("fssaiImage", step3.fssaiImage)

        formData.append("accountNumber", step3.accountNumber || "")
        formData.append("ifscCode", (step3.ifscCode || "").toUpperCase())
        formData.append("accountHolderName", step3.accountHolderName || "")
        formData.append("accountType", step3.accountType || "")

        await restaurantAPI.register(formData)

        // Clear localStorage when onboarding is complete
        clearOnboardingFromLocalStorage()
        clearOnboardingFileCache()
        try {
          localStorage.setItem("restaurant_pendingPhone", normalizePhoneDigits(step1.ownerPhone))
        } catch {}

        toast.success("Registration submitted. Awaiting admin approval.", { duration: 4000 })
        navigate("/food/restaurant/pending-verification", {
          replace: true,
          state: {
            phone: normalizePhoneDigits(step1.ownerPhone),
          },
        })
      }
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to save onboarding data"
      setError(msg)
    } finally {
      setSaving(false)
    }
  }



  const toggleDay = (day) => {
    setStep2((prev) => {
      const exists = prev.openDays.includes(day)
      if (exists) {
        return { ...prev, openDays: prev.openDays.filter((d) => d !== day) }
      }
      return { ...prev, openDays: [...prev.openDays, day] }
    })
  }

  const renderStep1 = () => (
    <div className="space-y-6">
      <section className="bg-white p-4 sm:p-6 rounded-md">
        <h2 className="text-lg font-semibold text-black mb-4">Restaurant information</h2>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-gray-700">Restaurant name*</Label>
            <Input
              value={step1.restaurantName || ""}
              onChange={(e) => setStep1({ ...step1, restaurantName: formatNameToCapital(e.target.value) })}
              className="mt-1 bg-white text-sm"
              placeholder="Customers will see this name"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Pure veg restaurant?*</Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => isEditing && setStep1({ ...step1, pureVegRestaurant: true })}
                className={`px-3 py-1.5 text-xs rounded-full border ${
                  step1.pureVegRestaurant === true
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-white text-gray-700 border-gray-200"
                } ${!isEditing ? "opacity-70 cursor-not-allowed" : ""}`}
              >
                Yes, Pure Veg
              </button>
              <button
                type="button"
                onClick={() => isEditing && setStep1({ ...step1, pureVegRestaurant: false })}
                className={`px-3 py-1.5 text-xs rounded-full border ${
                  step1.pureVegRestaurant === false
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-700 border-gray-200"
                } ${!isEditing ? "opacity-70 cursor-not-allowed" : ""}`}
              >
                No, Mixed Menu
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              This helps users filter restaurants by dietary preference.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md">
        <h2 className="text-lg font-semibold text-black mb-4">Owner details</h2>
        <p className="text-sm text-gray-600 mb-4">
          These details will be used for all business communications and updates.
        </p>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-gray-700">Full name*</Label>
            <Input
              value={step1.ownerName || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  ownerName: formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, "")),
                })
              }
              className="mt-1 bg-white text-sm"
              placeholder="Owner full name"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Email address*</Label>
            <Input
              type="email"
              value={step1.ownerEmail || ""}
              onChange={(e) => setStep1({ ...step1, ownerEmail: normalizeEmail(e.target.value) })}
              className="mt-1 bg-white text-sm"
              placeholder="ritu@gmail.com"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Phone number*</Label>
            <Input
              value={step1.ownerPhone || ""}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 10)
                setStep1({ ...step1, ownerPhone: val })
              }}
              readOnly={Boolean(verifiedPhoneNumber)}
              className="mt-1 bg-white text-sm"
              placeholder="10 digit mobile number"
              disabled={!isEditing}
            />
          </div>
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">Restaurant contact & location</h2>
        <div>
          <Label className="text-xs text-gray-700">Primary contact number*</Label>
          <Input
            value={step1.primaryContactNumber || ""}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "").slice(0, 10)
              setStep1({ ...step1, primaryContactNumber: val })
            }}
            onKeyDown={(e) => {
              const allowed = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab", "Enter"]
              if (!allowed.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault()
              if (/^\d$/.test(e.key) && (step1.primaryContactNumber || "").length >= 10) e.preventDefault()
            }}
            onPaste={(e) => {
              e.preventDefault()
              const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 10)
              setStep1({ ...step1, primaryContactNumber: pasted })
            }}
            inputMode="numeric"
            className="mt-1 bg-white text-sm"
            placeholder="Restaurant's primary contact number"
            disabled={!isEditing}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Customers, delivery partners and {companyName} may call on this number for order
            support.
          </p>
        </div>
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Add your restaurant's location for order pick-up.
          </p>
          <div className="relative">
            <Label className="text-xs text-gray-700">Search location</Label>
            <div className="relative">
              <Input
                ref={locationSearchInputRef}
                value={locationSearchValue}
                onChange={(e) => setLocationSearchValue(e.target.value)}
                className="mt-1 bg-white text-sm text-black! dark:text-white! placeholder:text-gray-500 dark:placeholder:text-gray-400 caret-black dark:caret-white"
                style={{ color: "#000", WebkitTextFillColor: "#000" }}
                placeholder="Start typing your restaurant address..."
                disabled={!isEditing}
              />
              {isSearchingLocation && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                   <div className="animate-spin rounded-full h-4 w-4 border-2 border-orange-500 border-t-transparent" />
                </div>
              )}
            </div>

            {/* Fallback suggestions dropdown */}
            {locationSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-xl z-[999999] overflow-hidden max-h-60 overflow-y-auto">
                {locationSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={async () => {
                      // Prevent re-search after selecting
                      justSelectedRef.current = true
                      setLocationSuggestions([])

                      if (s.isGoogle) {
                        // Fetch details from Google Places API
                        try {
                          const dummyNode = document.createElement("div")
                          const service = new window.google.maps.places.PlacesService(dummyNode)
                          service.getDetails(
                            { placeId: s.id, fields: ["formatted_address", "address_components", "geometry"] },
                            (place, status) => {
                              if (status === window.google.maps.places.PlacesServiceStatus.OK && place) {
                                const comps = Array.isArray(place.address_components) ? place.address_components : []
                                const get = (types) => comps.find(c => types.some(t => c.types?.includes(t)))?.long_name || ""

                                handleLocationSelect({
                                  formattedAddress: place.formatted_address || s.display,
                                  area: get(["sublocality_level_1", "sublocality", "neighborhood"]) || get(["locality"]),
                                  city: get(["locality"]) || get(["administrative_area_level_2"]),
                                  state: get(["administrative_area_level_1"]) || get(["administrative_area_level_2"]),
                                  pincode: get(["postal_code"]),
                                  latitude: place.geometry?.location?.lat?.() || "",
                                  longitude: place.geometry?.location?.lng?.() || ""
                                })
                              } else {
                                handleLocationSelect({ formattedAddress: s.display })
                              }
                            }
                          )
                        } catch (err) {
                          handleLocationSelect({ formattedAddress: s.display })
                        }
                      } else {
                        // Handle Nominatim selection
                        const { lat, lng, display, addr } = s
                        const area = addr.suburb || addr.neighbourhood || addr.city_district || addr.locality || ""
                        const city = addr.city || addr.town || addr.village || ""
                        const state = addr.state || ""
                        const pincode = addr.postcode || ""

                        handleLocationSelect({
                          formattedAddress: display,
                          area,
                          city,
                          state,
                          pincode,
                          latitude: lat,
                          longitude: lng
                        })
                      }

                      // Reset flag after debounce window
                      setTimeout(() => { justSelectedRef.current = false }, 600)
                    }}
                    className="w-full px-4 py-2 text-left text-[13px] hover:bg-orange-50 border-b border-gray-100 last:border-none font-medium text-gray-700"
                  >
                    <span className="truncate">{s.display}</span>
                  </button>
                ))}
              </div>
            )}
            
            <p className="text-[11px] text-gray-500 mt-1">
              Select a suggestion to auto-fill area/city/state/pincode and coordinates.
            </p>
          </div>
          <Input
            value={step1.location?.addressLine1 || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, addressLine1: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Shop no. / building no. (optional)"
            disabled={!isEditing}
          />
          <Input
            value={step1.location?.addressLine2 || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, addressLine2: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Floor / tower (optional)"
            disabled={!isEditing}
          />
          <Input
            value={step1.location?.landmark || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, landmark: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Nearby landmark (optional)"
            disabled={!isEditing}
          />
          <Input
            value={step1.location?.area || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, area: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Area / Sector / Locality*"
            disabled={!isEditing}
          />
          <Input
            value={step1.location?.city || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, city: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="City*"
            disabled={!isEditing}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              value={step1.location?.state || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  location: { ...step1.location, state: e.target.value },
                })
              }
              className="bg-white text-sm"
              placeholder="State"
              disabled={!isEditing}
            />
            <Input
              value={step1.location?.pincode || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  location: { ...step1.location, pincode: normalizePincode(e.target.value) },
                })
              }
              className="bg-white text-sm"
              placeholder="Pincode"
              disabled={!isEditing}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Please ensure that this address is the same as mentioned on your FSSAI license.
          </p>

          <div className="pt-2">
            <Label className="text-xs text-gray-700">Service zone*</Label>
            <select
              value={step1.zoneId || ""}
              onChange={(e) => setStep1({ ...step1, zoneId: e.target.value })}
              className="mt-1 w-full h-9 rounded-md border border-input bg-white px-3 text-sm disabled:opacity-50"
              disabled={zonesLoading || !isEditing || !!step1.location?.latitude}
            >
              <option value="">{zonesLoading ? "Loading zones..." : "Select a zone"}</option>
              {zones.map((z) => {
                const id = String(z?._id || z?.id || "")
                const label = z?.name || z?.zoneName || z?.serviceLocation || id
                return (
                  <option key={id} value={id}>
                    {label}
                  </option>
                )
              })}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Choose the service zone where your restaurant will be available.
            </p>
          </div>
        </div>
      </section>
    </div>
  )


  // ── Load Google Maps Script (No UI widget, just API) ──────────────

  useEffect(() => {
    if (step !== 1) return
    let cancelled = false

    const loadMaps = async () => {
      if (window.google?.maps?.places?.AutocompleteService) {
        googleMapsReadyRef.current = true
        return
      }

      const apiKey = await getGoogleMapsApiKey()
      if (!apiKey) return

      window.gm_authFailure = () => {
        debugError("Google Maps auth failed.")
        googleMapsReadyRef.current = false
      }

      const scripts = Array.from(document.getElementsByTagName("script"))
      const mapsScript = scripts.find(s => s.src?.includes("maps.googleapis.com/maps/api/js"))
      
      if (mapsScript && !mapsScript.src.includes("libraries=places")) {
        mapsScript.remove()
      } else if (mapsScript && mapsScript.src.includes("libraries=places")) {
         for (let i = 0; i < 60; i++) {
           if (window.google?.maps?.places?.AutocompleteService) {
             googleMapsReadyRef.current = true
             return
           }
           if (cancelled) return
           await new Promise(r => setTimeout(r, 100))
         }
      }

      const script = document.createElement("script")
      script.id = "google-maps-sdk"
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly`
      script.async = true
      script.defer = true
      script.onload = () => {
        setTimeout(() => {
          if (window.google?.maps?.places?.AutocompleteService) {
            googleMapsReadyRef.current = true
          }
        }, 200)
      }
      document.head.appendChild(script)
    }

    loadMaps().catch(() => {})
    return () => { cancelled = true }
  }, [step])

  // ── Unified Search (Google Places API primary, Nominatim fallback) ────────

  useEffect(() => {
    if (step !== 1) return
    if (justSelectedRef.current) return

    const q = String(locationSearchValue || "").trim()
    if (q.length < 3) {
      setLocationSuggestions([])
      setIsSearchingLocation(false)
      return
    }

    const t = setTimeout(async () => {
      if (justSelectedRef.current) return

      setIsSearchingLocation(true)

      // Try Google Places AutocompleteService first
      if (googleMapsReadyRef.current && window.google?.maps?.places?.AutocompleteService) {
        try {
          const service = new window.google.maps.places.AutocompleteService()
          service.getPlacePredictions(
            { input: q, componentRestrictions: { country: "in" } },
            (predictions, status) => {
              if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
                const mapped = predictions.map(p => ({
                  id: p.place_id,
                  display: p.description,
                  isGoogle: true
                }))
                setLocationSuggestions(mapped)
                setIsSearchingLocation(false)
              } else {
                // If ZERO_RESULTS or error, we could fallback, but let's just show empty
                setLocationSuggestions([])
                setIsSearchingLocation(false)
              }
            }
          )
          return // Exit here, callback handles state
        } catch (e) {
          debugError("Google AutocompleteService failed:", e)
        }
      }

      // Fallback to Nominatim if Google Maps isn't loaded/failed
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(q)}&countrycodes=in`
        const res = await fetch(url, { headers: { Accept: "application/json" } })
        const json = await res.json()
        const mapped = (Array.isArray(json) ? json : []).map(r => ({
          id: r.place_id,
          display: r.display_name || "",
          lat: Number(r.lat),
          lng: Number(r.lon),
          addr: r.address || {},
          isGoogle: false
        }))
        setLocationSuggestions(mapped)
      } catch (e) {
        debugError("Nominatim search failed:", e)
      } finally {
        setIsSearchingLocation(false)
      }
    }, 400)

    return () => clearTimeout(t)
  }, [locationSearchValue, step])



  useEffect(() => {
    if (step !== 1) return

    const lat = Number(step1.location?.latitude)
    const lng = Number(step1.location?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
    if (lastZoneDetectKeyRef.current === key) return

    if (zoneDetectTimerRef.current) {
      clearTimeout(zoneDetectTimerRef.current)
    }

    zoneDetectTimerRef.current = setTimeout(async () => {
      lastZoneDetectKeyRef.current = key
      try {
        const res = await zoneAPI.detectZone(lat, lng)
        const payload = res?.data?.data

        if (res?.data?.success && payload) {
          if (payload.status === "IN_SERVICE" && payload.zoneId) {
            setStep1((prev) =>
              prev.zoneId === payload.zoneId ? prev : { ...prev, zoneId: payload.zoneId },
            )
            lastOutOfZoneToastKeyRef.current = null
          } else {
            if (lastOutOfZoneToastKeyRef.current !== key) {
              if (justSelectedRef.current) {
                toast.error("Selected location is outside all service zones")
              }
              lastOutOfZoneToastKeyRef.current = key
            }
            setStep1((prev) => (prev.zoneId ? { ...prev, zoneId: "" } : prev))
          }
        }
      } catch (err) {
        debugError("Zone detect failed:", err)
      }
    }, 350)

    return () => {
      if (zoneDetectTimerRef.current) {
        clearTimeout(zoneDetectTimerRef.current)
        zoneDetectTimerRef.current = null
      }
    }
  }, [step, step1.location?.latitude, step1.location?.longitude])

  // Load zones for onboarding dropdown (public endpoint).
  useEffect(() => {
    if (step !== 1) return
    let cancelled = false
    setZonesLoading(true)
    zoneAPI.getPublicZones()
      .then((res) => {
        const list = res?.data?.data?.zones || res?.data?.zones || []
        if (!cancelled) setZones(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setZones([])
      })
      .finally(() => {
        if (!cancelled) setZonesLoading(false)
      })
    return () => { cancelled = true }
  }, [step])


  const renderStep2 = () => (
    <div className="space-y-6">
      {/* Images section */}
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-5">
        <h2 className="text-lg font-semibold text-black">Restaurant photo</h2>
        <p className="text-xs text-gray-500">
          Add a clear primary profile image for your restaurant. This helps customers recognize your brand.
        </p>



        {/* Profile image */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-700">Restaurant profile image</Label>
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border border-gray-200">
                {step2.profileImage ? (
                  (() => {
                    const imageSrc = getPreviewImageUrl(step2.profileImage)

                    return imageSrc ? (
                      <img
                        src={imageSrc}
                        alt="Restaurant profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-gray-500" />
                    );
                  })()
                ) : (
                  <ImageIcon className="w-6 h-6 text-gray-500" />
                )}
              </div>
              {step2.profileImage && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await handleRemoveProfileImage()
                  }}
                  className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors z-10"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex-1 flex-col flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-gray-900">Upload profile image</span>
                <span className="text-[11px] text-gray-500">
                  This will be shown on your listing card and restaurant page.
                </span>
              </div>

            </div>

          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full text-xs"
            onClick={() =>
              openImageSourcePicker({
                title: "Upload profile image",
                fileNamePrefix: "profile-image",
                fallbackInputRef: profileImageInputRef,
                onSelectFile: handleProfileImageSelected,
              })
            }
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <input
            id="profileImageInput"
            type="file"
            accept={LOCAL_IMAGE_FILE_ACCEPT}
            className="hidden"
            ref={profileImageInputRef}
            onChange={(e) => {
              const file = e.target.files?.[0] || null
              if (file) {
                debugLog('?? Profile image selected:', file.name)
                handleProfileImageSelected(file)
              }
              // Reset input to allow selecting same file again
              e.target.value = ''
            }}
          />
        </div>
      </section>

      {/* Operational details */}
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-5">
        {/* Timings with popover time selectors */}
        <div className="space-y-3">
          <Label className="text-xs text-gray-700">Outlet timings</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TimeSelector
              label="Opening time"
              value={step2.openingTime || ""}
              onChange={(val) => {
                const nextOpening = normalizeTimeValue(val) || ""
                setStep2((prev) => ({ ...prev, openingTime: nextOpening }))
              }}
            />
            <TimeSelector
              label="Closing time"
              value={step2.closingTime || ""}
              onChange={(val) => {
                const nextClosing = normalizeTimeValue(val) || ""
                setStep2((prev) => ({ ...prev, closingTime: nextClosing }))
              }}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Estimated delivery time*</Label>
            <Input
              value={step2.estimatedDeliveryTime || ""}
              onChange={(e) =>
                setStep2((prev) => ({ ...prev, estimatedDeliveryTime: e.target.value }))
              }
              className="mt-1 bg-white text-sm"
              placeholder="e.g., 25-30 mins"
            />
          </div>
        </div>

        {/* Open days in a calendar-like grid */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-700 flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5 text-gray-800" />
            <span>Open days</span>
          </Label>
          <p className="text-[11px] text-gray-500">
            Select the days your restaurant accepts delivery orders.
          </p>
          <div className="mt-1 grid grid-cols-7 gap-1.5 sm:gap-2">
            {daysOfWeek.map((day) => {
              const active = step2.openDays.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`aspect-square flex items-center justify-center rounded-md text-[11px] font-medium ${active ? "bg-black text-white" : "bg-gray-100 text-gray-800"
                    }`}
                >
                  {day.charAt(0)}
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )

  const renderStep3 = () => (
    <div className="space-y-6">
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">PAN details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-gray-700">PAN number</Label>
            <Input
              value={step3.panNumber || ""}
              onChange={(e) => setStep3({ ...step3, panNumber: normalizePAN(e.target.value) })}
              className="mt-1 bg-white text-sm"
              placeholder="ABCDE1234F"
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">PAN Card Holder Name</Label>
            <Input
              value={step3.nameOnPan || ""}
              onChange={(e) =>
                setStep3({
                  ...step3,
                  nameOnPan: formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, "")),
                })
              }
              className="mt-1 bg-white text-sm"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs text-gray-700">PAN image</Label>
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full text-xs"
            onClick={() =>
              openImageSourcePicker({
                title: "Upload PAN image",
                fileNamePrefix: "pan-image",
                fallbackInputRef: panImageInputRef,
                onSelectFile: handlePanImageSelected,
              })
            }
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <input
            type="file"
            accept={GALLERY_IMAGE_ACCEPT}
            className="hidden"
            ref={panImageInputRef}
            onChange={(e) => {
              handlePanImageSelected(e.target.files?.[0] || null)
              e.target.value = ""
            }}
          />
          {step3.panImage && (
            <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
              {getPreviewImageUrl(step3.panImage) ? (
                <img
                  src={getPreviewImageUrl(step3.panImage)}
                  alt="PAN document"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                  Preview unavailable
                </div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setStep3((prev) => ({ ...prev, panImage: null }))
                }}
                className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">GST details</h2>
        <div className="flex gap-4 items-center text-sm">
          <span className="text-gray-700">GST registered?</span>
          <button
            type="button"
            onClick={() => setStep3({ ...step3, gstRegistered: true })}
            className={`px-3 py-1.5 text-xs rounded-full ${step3.gstRegistered ? "bg-black text-white" : "bg-gray-100 text-gray-800"
              }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => setStep3({ ...step3, gstRegistered: false })}
            className={`px-3 py-1.5 text-xs rounded-full ${!step3.gstRegistered ? "bg-black text-white" : "bg-gray-100 text-gray-800"
              }`}
          >
            No
          </button>
        </div>
        {step3.gstRegistered && (
          <div className="space-y-3">
            <Input
              value={step3.gstNumber || ""}
              onChange={(e) => setStep3({ ...step3, gstNumber: normalizeGST(e.target.value) })}
              className="bg-white text-sm"
              placeholder="GST number (15 characters)"
            />
            <Input
              value={step3.gstLegalName || ""}
              onChange={(e) =>
                setStep3({
                  ...step3,
                  gstLegalName: formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, "")),
                })
              }
              className="bg-white text-sm"
              placeholder="Legal name"
            />
            <Input
              value={step3.gstAddress || ""}
              onChange={(e) => setStep3({ ...step3, gstAddress: e.target.value })}
              className="bg-white text-sm"
              placeholder="Registered address"
            />
            <Button
              type="button"
              variant="outline"
              className="w-full text-xs"
              onClick={() =>
                openImageSourcePicker({
                  title: "Upload GST image",
                  fileNamePrefix: "gst-image",
                  fallbackInputRef: gstImageInputRef,
                  onSelectFile: handleGstImageSelected,
                })
              }
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Upload
            </Button>
            <input
              type="file"
              accept={GALLERY_IMAGE_ACCEPT}
              className="hidden"
              ref={gstImageInputRef}
              onChange={(e) => {
                handleGstImageSelected(e.target.files?.[0] || null)
                e.target.value = ""
              }}
            />
            {step3.gstImage && (
              <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
                {getPreviewImageUrl(step3.gstImage) ? (
                  <img
                    src={getPreviewImageUrl(step3.gstImage)}
                    alt="GST document"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                    Preview unavailable
                  </div>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setStep3((prev) => ({ ...prev, gstImage: null }))
                  }}
                  className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">FSSAI details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.fssaiNumber || ""}
            onChange={(e) =>
              setStep3({ ...step3, fssaiNumber: e.target.value.replace(/\D/g, "").slice(0, 14) })
            }
            className="bg-white text-sm"
            placeholder="FSSAI number (14 digits)"
          />
          <div>
            <Label className="text-xs text-gray-700 mb-1 block">FSSAI expiry date</Label>
            <Popover open={isFssaiCalendarOpen} onOpenChange={setIsFssaiCalendarOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={() => setIsFssaiCalendarOpen(true)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md bg-white text-sm text-left flex items-center justify-between hover:bg-gray-50"
                >
                  <span className={step3.fssaiExpiry ? "text-gray-900" : "text-gray-500"}>
                    {step3.fssaiExpiry
                      ? parseLocalYMDDate(step3.fssaiExpiry)?.toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                      : "Select expiry date"}
                  </span>
                  <CalendarIcon className="w-4 h-4 text-gray-500" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-100" align="start">
                <div className="bg-white rounded-md shadow-lg border border-gray-200">
                  <Calendar
                    mode="single"
                    selected={parseLocalYMDDate(step3.fssaiExpiry)}
                    disabled={(date) => formatDateToLocalYMD(date) < getTodayLocalYMD()}
                    onSelect={(date) => {
                      if (date && formatDateToLocalYMD(date) >= getTodayLocalYMD()) {
                        const formattedDate = formatDateToLocalYMD(date)
                        setStep3({ ...step3, fssaiExpiry: formattedDate })
                        setIsFssaiCalendarOpen(false)
                      }
                    }}
                    initialFocus
                    classNames={{
                      today: "bg-transparent text-foreground border-none", // Remove today highlight
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full text-xs"
          onClick={() =>
            openImageSourcePicker({
              title: "Upload FSSAI image",
              fileNamePrefix: "fssai-image",
              fallbackInputRef: fssaiImageInputRef,
              onSelectFile: handleFssaiImageSelected,
            })
          }
        >
          <Upload className="w-4 h-4 mr-1.5" />
          Upload
        </Button>
        <input
          type="file"
          accept={GALLERY_IMAGE_ACCEPT}
          className="hidden"
          ref={fssaiImageInputRef}
          onChange={(e) => {
            handleFssaiImageSelected(e.target.files?.[0] || null)
            e.target.value = ""
          }}
        />
        {step3.fssaiImage && (
          <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
            {getPreviewImageUrl(step3.fssaiImage) ? (
              <img
                src={getPreviewImageUrl(step3.fssaiImage)}
                alt="FSSAI document"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                Preview unavailable
              </div>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setStep3((prev) => ({ ...prev, fssaiImage: null }))
              }}
              className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">Bank account details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.accountNumber || ""}
            onChange={(e) => setStep3({ ...step3, accountNumber: normalizeBankAcc(e.target.value) })}
            className="bg-white text-sm"
            placeholder="Account number"
          />
          <Input
            value={step3.confirmAccountNumber || ""}
            onChange={(e) => setStep3({ ...step3, confirmAccountNumber: normalizeBankAcc(e.target.value) })}
            className="bg-white text-sm"
            placeholder="Re-enter account number"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.ifscCode || ""}
            onChange={(e) => setStep3({ ...step3, ifscCode: normalizeIFSC(e.target.value) })}
            className="bg-white text-sm"
            placeholder="IFSC code"
          />
          <Select
            value={step3.accountType || ""}
            onValueChange={(value) => setStep3({ ...step3, accountType: value })}
          >
            <SelectTrigger className="bg-white text-sm">
              <SelectValue placeholder="Select account type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Saving">Saving</SelectItem>
              <SelectItem value="Current">Current</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input
          value={step3.accountHolderName || ""}
          onChange={(e) =>
            setStep3({
              ...step3,
              accountHolderName: formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, "")),
            })
          }
          className="bg-white text-sm"
          placeholder="Account holder name"
        />
      </section>
    </div>
  )

  const renderStep = () => {
    if (step === 1) return renderStep1()
    if (step === 2) return renderStep2()
    return renderStep3()
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <div className="min-h-full bg-gray-100 flex flex-col">
        <header className="px-4 py-4 sm:px-6 sm:py-5 bg-white flex items-center justify-between border-b">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/food/restaurant/explore")}
              className="p-1 hover:bg-gray-100 rounded-full transition-colors"
              aria-label="Close onboarding"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
            <div className="text-sm font-semibold text-black">Restaurant onboarding</div>
          </div>
          <div className="flex items-center gap-3">
            {!loading && !isEditing && (
              <Button
                onClick={() => setIsEditing(true)}
                variant="outline"
                size="sm"
                className="text-xs bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100 flex items-center gap-1.5"
                title="Edit Details"
              >
                <Sparkles className="w-3 h-3" />
                Edit Details
              </Button>
            )}
            <div className="flex items-center gap-3">
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider text-right">
                Step {step} of 3
              </div>
              <Button
                onClick={handleLogout}
                disabled={isLoggingOut}
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-red-600 hover:text-red-700 hover:bg-red-50"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>

        </header>

        <main
          className="flex-1 px-4 sm:px-6 py-4 space-y-4"
          style={{ paddingBottom: keyboardInset ? `${keyboardInset + 20}px` : undefined }}
          onFocusCapture={(e) => {
            const target = e.target
            if (!(target instanceof HTMLElement)) return
            if (!target.matches("input, textarea, select")) return
            window.setTimeout(() => {
              target.scrollIntoView({ behavior: "smooth", block: "center" })
            }, 250)
          }}
        >
          {loading ? (
            <p className="text-sm text-gray-600">Loading...</p>
          ) : (
            <div className={!isEditing ? "pointer-events-none select-none" : ""}>
              {renderStep()}
            </div>
          )}
        </main>

        <ImageSourcePicker
          isOpen={sourcePicker.isOpen}
          onClose={closeImageSourcePicker}
          onFileSelect={sourcePicker.onSelectFile}
          title={sourcePicker.title}
          fileNamePrefix={sourcePicker.fileNamePrefix}
          galleryInputRef={sourcePicker.fallbackInputRef}
        />

        {error && (
          <div className="px-4 sm:px-6 pb-2 text-xs text-red-600">
            {error}
          </div>
        )}

        <footer className={`px-4 sm:px-6 py-3 bg-white ${keyboardInset ? "hidden" : ""}`}>
          <div className="flex justify-between items-center">
            <Button
              variant="ghost"
              disabled={step === 1 || saving}
              onClick={() => { setStep((s) => Math.max(1, s - 1)); window.scrollTo({ top: 0, behavior: "instant" }) }}
              className="text-sm text-gray-700 bg-transparent"
            >
              Back
            </Button>
            <Button
              onClick={handleNext}
              disabled={saving || (step === 3 && !isEditing)}
              className={`text-sm bg-black text-white px-6 ${(step === 3 && !isEditing) ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {step === 3 ? (saving ? "Uploading Documents..." : "Submit Profile") : saving ? "Saving..." : "Continue"}
            </Button>
          </div>
        </footer>
      </div>
    </LocalizationProvider>
  )
}



