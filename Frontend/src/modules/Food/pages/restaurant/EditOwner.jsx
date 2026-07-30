import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import Lenis from "lenis"
import {
  ArrowLeft,
  User,
  Edit,
  Trash2,
  Clock,
  Loader2,
  MapPin,
  Search,
  Save,
  Check,
  ChevronDown
} from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { restaurantAPI, zoneAPI } from "@food/api"
import OptimizedImage from "@food/components/OptimizedImage"
import { clearModuleAuth } from "@food/utils/auth"
import { firebaseAuth, ensureFirebaseInitialized } from "@food/firebase"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@food/components/ui/select"

import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"
import { toast } from "sonner"
import { getImageValidationError, getUploadErrorMessage } from '@/shared/utils/uploadErrors.js'
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const STORAGE_KEY = "restaurant_owner_contact"

export default function EditOwner() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [ownerData, setOwnerData] = useState({
    restaurantName: "",
    primaryContactNumber: "",
    pureVegRestaurant: false,
    panNumber: "",
    nameOnPan: "",
    accountNumber: "",
    ifscCode: "",
    accountHolderName: "",
    accountType: "",
    upiId: "",
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
    }
  })
  
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    photo: null,
    restaurantName: "",
    primaryContactNumber: "",
    pureVegRestaurant: false,
    panNumber: "",
    nameOnPan: "",
    accountNumber: "",
    ifscCode: "",
    accountHolderName: "",
    accountType: "",
    upiId: "",
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
    }
  })
  const [hasChanges, setHasChanges] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profileImageFile, setProfileImageFile] = useState(null)
  const fileInputRef = useRef(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false)
  const [zones, setZones] = useState([])
  const [zonesLoading, setZonesLoading] = useState(false)
  const [restaurantStatus, setRestaurantStatus] = useState({
    status: '',
    pendingUpdateReason: '',
    approvedAt: null
  })
  
  const locationSearchInputRef = useRef(null)
  const mapsScriptLoadedRef = useRef(false)
  const [locationSearchValue, setLocationSearchValue] = useState("")
  const [locationSuggestions, setLocationSuggestions] = useState([])
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)

  // Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })

    function raf(time) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }

    requestAnimationFrame(raf)

    return () => {
      lenis.destroy()
    }
  }, [])

  // Fetch restaurant data from backend on mount
  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        setLoading(true)
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        if (data) {
          const ownerDataFromBackend = {
            name: data.ownerName || data.name || "",
            phone: data.ownerPhone || data.primaryContactNumber || data.phone || "",
            email: data.ownerEmail || data.email || "",
            photo: data.profileImage?.url || null,
            restaurantName: data.restaurantName || "",
            primaryContactNumber: data.primaryContactNumber || "",
            pureVegRestaurant: !!data.pureVegRestaurant,
            panNumber: data.panNumber || "",
            nameOnPan: data.nameOnPan || "",
            accountNumber: data.accountNumber || "",
            ifscCode: data.ifscCode || "",
            accountHolderName: data.accountHolderName || "",
            accountType: data.accountType || "",
            upiId: data.upiId || "",
            zoneId: data.zoneId || "",
            location: {
              formattedAddress: data.location?.formattedAddress || data.address || "",
              addressLine1: data.location?.addressLine1 || "",
              addressLine2: data.location?.addressLine2 || "",
              area: data.location?.area || data.area || "",
              city: data.location?.city || data.city || "",
              state: data.location?.state || data.state || "",
              pincode: data.location?.pincode || data.pincode || "",
              landmark: data.location?.landmark || data.landmark || "",
              latitude: data.location?.latitude || "",
              longitude: data.location?.longitude || "",
            }
          }
          setOwnerData(ownerDataFromBackend)
          setFormData(ownerDataFromBackend)
          setRestaurantStatus({
            status: data.status || '',
            pendingUpdateReason: data.pendingUpdateReason || '',
            approvedAt: data.approvedAt || null
          })
        }
      } catch (error) {
        // Only log error if it's not a network/timeout error (backend might be down/slow)
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching restaurant data:", error)
        }
        // Fallback to localStorage
        try {
          const saved = localStorage.getItem(STORAGE_KEY)
          if (saved) {
            const parsed = JSON.parse(saved)
            setOwnerData(parsed)
            setFormData(parsed)
          }
        } catch (e) {
          debugError("Error loading owner data from localStorage:", e)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()
  }, [])

  // Load zones
  useEffect(() => {
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
  }, [])

  // Google Maps Autocomplete logic
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      let inputElement = null
      for (let i = 0; i < 50; i++) {
        if (locationSearchInputRef.current) {
          inputElement = locationSearchInputRef.current
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      if (!inputElement || cancelled) return

      const loadMaps = async () => {
        if (window.google?.maps?.places?.Autocomplete) {
          mapsScriptLoadedRef.current = true
          return true
        }
        const apiKey = await getGoogleMapsApiKey()
        if (!apiKey) return false

        return new Promise((resolve) => {
          if (document.getElementById("google-maps-sdk")) {
             // Script exists but might not be loaded yet
             let check = setInterval(() => {
                if (window.google?.maps?.places?.Autocomplete) {
                   clearInterval(check)
                   resolve(true)
                }
             }, 100)
             setTimeout(() => { clearInterval(check); resolve(false) }, 5000)
             return
          }
          const script = document.createElement("script")
          script.id = "google-maps-sdk"
          script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly`
          script.async = true
          script.defer = true
          script.onload = () => resolve(!!window.google?.maps?.places?.Autocomplete)
          script.onerror = () => resolve(false)
          document.head.appendChild(script)
        })
      }

      const ok = await loadMaps()
      if (!ok || cancelled) return

      const autocomplete = new window.google.maps.places.Autocomplete(inputElement, {
        componentRestrictions: { country: "in" },
        fields: ["address_components", "geometry", "formatted_address"],
      })

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace()
        if (!place.geometry) return

        const formattedAddress = place.formatted_address || ""
        const lat = place.geometry.location.lat()
        const lng = place.geometry.location.lng()
        const comps = place.address_components || []
        const get = (types) => comps.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || ""

        const area = get(["sublocality_level_1", "sublocality", "neighborhood"])
        const city = get(["locality", "administrative_area_level_2"])
        const state = get(["administrative_area_level_1"])
        const pincode = get(["postal_code"])

        setFormData((prev) => ({
          ...prev,
          location: {
            ...prev.location,
            formattedAddress,
            addressLine1: formattedAddress,
            area: area || prev.location.area,
            city: city || prev.location.city,
            state: state || prev.location.state,
            pincode: pincode || prev.location.pincode,
            latitude: lat,
            longitude: lng,
          },
        }))
        setLocationSearchValue(formattedAddress)
      })
    }

    init()
    return () => { cancelled = true }
  }, [])

  // Nominatim Fallback
  useEffect(() => {
    const q = String(locationSearchValue || "").trim()
    if (q.length < 3 || mapsScriptLoadedRef.current) {
      setLocationSuggestions([])
      return
    }

    const t = setTimeout(async () => {
      try {
        setIsSearchingLocation(true)
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=4&q=${encodeURIComponent(q)}&countrycodes=in`
        const res = await fetch(url, { headers: { Accept: "application/json" } })
        const json = await res.json()
        const mapped = (Array.isArray(json) ? json : []).map(r => ({
          id: r.place_id,
          display: r.display_name || "",
          lat: Number(r.lat),
          lng: Number(r.lon),
          addr: r.address || {},
        }))
        setLocationSuggestions(mapped)
      } catch (e) {
        debugError("Nominatim search failed:", e)
      } finally {
        setIsSearchingLocation(false)
      }
    }, 600)

    return () => clearTimeout(t)
  }, [locationSearchValue])

  // Check for changes
  useEffect(() => {
    const changed = 
      formData.name !== ownerData.name ||
      formData.email !== ownerData.email ||
      formData.restaurantName !== ownerData.restaurantName ||
      formData.primaryContactNumber !== ownerData.primaryContactNumber ||
      formData.pureVegRestaurant !== ownerData.pureVegRestaurant ||
      formData.panNumber !== ownerData.panNumber ||
      formData.nameOnPan !== ownerData.nameOnPan ||
      formData.accountNumber !== ownerData.accountNumber ||
      formData.ifscCode !== ownerData.ifscCode ||
      formData.accountHolderName !== ownerData.accountHolderName ||
      formData.accountType !== ownerData.accountType ||
      formData.upiId !== ownerData.upiId ||
      formData.zoneId !== ownerData.zoneId ||
      JSON.stringify(formData.location) !== JSON.stringify(ownerData.location) ||
      profileImageFile !== null
    setHasChanges(changed)
  }, [formData.name, formData.email, formData.restaurantName, formData.primaryContactNumber, formData.pureVegRestaurant, formData.panNumber, formData.nameOnPan, formData.accountNumber, formData.ifscCode, formData.accountHolderName, formData.accountType, formData.upiId, formData.zoneId, formData.location, ownerData.name, ownerData.email, ownerData.restaurantName, ownerData.primaryContactNumber, ownerData.pureVegRestaurant, ownerData.panNumber, ownerData.nameOnPan, ownerData.accountNumber, ownerData.ifscCode, ownerData.accountHolderName, ownerData.accountType, ownerData.upiId, ownerData.zoneId, ownerData.location, profileImageFile])

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handlePhotoClick = () => {
    if (isFlutterBridgeAvailable()) {
      setIsPhotoPickerOpen(true)
    } else {
      fileInputRef.current?.click()
    }
  }

  const handlePhotoSelect = (file) => {
    if (file) {
      const imageValidationError = getImageValidationError(file)
      if (imageValidationError) {
        toast.error(imageValidationError)
        return
      }
      setProfileImageFile(file)
      const reader = new FileReader()
      reader.onload = (e) => {
        const photoData = e.target?.result
        setFormData(prev => ({
          ...prev,
          photo: photoData
        }))
      }
      reader.readAsDataURL(file)
    }
  }

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0]
    handlePhotoSelect(file)
  }

  const handleSave = async () => {
    try {
      setSaving(true)

      // First, upload profile image if changed
      if (profileImageFile) {
        try {
          const imageResponse = await restaurantAPI.uploadProfileImage(profileImageFile)
          const imageData = imageResponse?.data?.data?.image || imageResponse?.data?.image
          if (imageData?.url) {
            formData.photo = imageData.url
          }
        } catch (error) {
          debugError("Error uploading profile image:", error)
          toast.error(getUploadErrorMessage(error, { fallback: 'Failed to upload profile image.' }))
          setSaving(false)
          return
        }
      }

      // Update owner details in backend
      const updatePayload = {
        ownerName: formData.name.trim(),
        ownerEmail: formData.email.trim(),
        ownerPhone: formData.phone.trim(),
        restaurantName: formData.restaurantName.trim(),
        primaryContactNumber: formData.primaryContactNumber.trim(),
        pureVegRestaurant: formData.pureVegRestaurant,
        panNumber: formData.panNumber.trim(),
        nameOnPan: formData.nameOnPan.trim(),
        accountNumber: formData.accountNumber.trim(),
        ifscCode: formData.ifscCode.trim(),
        accountHolderName: formData.accountHolderName.trim(),
        accountType: formData.accountType,
        upiId: formData.upiId.trim(),
        zoneId: formData.zoneId,
        ...formData.location
      }

      // If profile image was uploaded, include it
      if (profileImageFile && formData.photo) {
        // Extract publicId from the uploaded image response if available
        // For now, we'll let the backend handle it via the profileImage field
        // The uploadProfileImage already updates it, so we might not need to send it again
      }

      const response = await restaurantAPI.updateProfile(updatePayload)
      
      if (response?.data?.success) {
        // Save to localStorage as backup
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(formData))
        } catch (e) {
          debugError("Error saving to localStorage:", e)
        }
        
        // Dispatch event to notify parent page
        window.dispatchEvent(new Event("ownerDataUpdated"))
        
        toast.success("Update submitted for admin approval!")
        
        // Update local state
        setOwnerData({ ...formData })
        setProfileImageFile(null)
        setHasChanges(false)
        setRestaurantStatus(prev => ({ ...prev, status: 'pending' }))
        
        // Navigate back after a short delay
        setTimeout(() => goBack(), 1500)
      } else {
        throw new Error("Invalid response from server")
      }
    } catch (error) {
      debugError("Error saving owner data:", error)
      alert(`Failed to save owner details: ${error.response?.data?.message || error.message || "Please try again."}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (isDeleting) return // Prevent multiple clicks
    
    setIsDeleting(true)
    
    try {
      // Call backend API to delete the account
      await restaurantAPI.deleteAccount()
      
      // Sign out from Firebase if restaurant logged in via Google
      try {
        const { signOut } = await import("firebase/auth")
        // Firebase Auth is lazy-initialized now; ensure it before accessing firebaseAuth.currentUser
        ensureFirebaseInitialized({ enableAuth: true, enableRealtimeDb: false })
        const currentUser = firebaseAuth.currentUser
        if (currentUser) {
          await signOut(firebaseAuth)
        }
      } catch (firebaseError) {
        // Continue even if Firebase logout fails
        debugWarn("Firebase logout failed, continuing with cleanup:", firebaseError)
      }

      // Clear restaurant module authentication data
      clearModuleAuth("restaurant")
      
      // Clear all restaurant-related localStorage data
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem("restaurant_onboarding")
      localStorage.removeItem("restaurant_accessToken")
      localStorage.removeItem("restaurant_authenticated")
      localStorage.removeItem("restaurant_user")
      localStorage.removeItem("restaurant_invited_users")
      
      // Clear sessionStorage
      sessionStorage.removeItem("restaurantAuthData")
      
      // Dispatch auth change event to notify other components
      window.dispatchEvent(new Event("restaurantAuthChanged"))
      
      setShowDeleteDialog(false)
      
      // Navigate to welcome page
      setTimeout(() => {
        navigate("/restaurant/welcome", { replace: true })
      }, 300)
    } catch (error) {
      debugError("Error deleting account:", error)
      alert(`Failed to delete account: ${error.response?.data?.message || error.message || "Please try again."}`)
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className="min-h-full bg-white overflow-x-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-50">
          <div className="flex items-center gap-3">
            <button
              onClick={goBack}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-6 h-6 text-gray-900" />
            </button>
            <h1 className="text-lg font-bold text-gray-900">Contact details</h1>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 py-6 space-y-6">
          {/* Pending Update Banner */}
          {restaurantStatus.status === 'pending' && (restaurantStatus.approvedAt || (restaurantStatus.pendingUpdateReason && restaurantStatus.pendingUpdateReason !== 'New Registration')) && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
              <div className="bg-amber-100 p-2 rounded-xl flex-shrink-0">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-900">{restaurantStatus.pendingUpdateReason || "Update Pending"}</p>
                <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                  Your restaurant <strong>{restaurantStatus.pendingUpdateReason || "profile update"}</strong> is pending approval. Please wait for admin response.
                </p>
              </div>
            </div>
          )}

          {/* Profile Photo Section */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
                {loading ? (
                  <User className="w-12 h-12 text-gray-500" />
                ) : formData.photo ? (
                  <OptimizedImage
                    src={formData.photo}
                    alt="Owner profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-12 h-12 text-gray-500" />
                )}
              </div>
            </div>
            <button
              disabled={loading || saving}
              className="text-blue-600 text-sm font-normal hover:text-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Photo View
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
              disabled={loading || saving}
            />
          </div>

          {/* Editable Fields */}
          <div className="space-y-4">
            {/* Restaurant Name Field */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Restaurant Name</label>
              <div className="relative">
                <Input
                  type="text"
                  value={loading ? "Loading..." : formData.restaurantName}
                  onChange={(e) => handleInputChange("restaurantName", e.target.value)}
                  placeholder="Enter restaurant name"
                  className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                  disabled={loading || saving}
                />
                
              </div>
            </div>

            {/* Pure Veg Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 border-2 rounded-sm flex items-center justify-center ${formData.pureVegRestaurant ? 'border-green-600' : 'border-red-600'}`}>
                  <div className={`w-2 h-2 rounded-full ${formData.pureVegRestaurant ? 'bg-green-600' : 'bg-red-600'}`} />
                </div>
                <span className="text-sm font-semibold text-gray-700">Pure Veg Restaurant</span>
              </div>
              <button
                disabled={true}
                className={`w-12 h-6 rounded-full transition-colors relative ${formData.pureVegRestaurant ? 'bg-green-600' : 'bg-red-600'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${formData.pureVegRestaurant ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {/* Name Field */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Owner Name</label>
              <div className="relative">
                <Input
                  type="text"
                  value={loading ? "Loading..." : formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  placeholder="Enter owner name"
                  className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                  disabled={loading || saving}
                />
                
              </div>
            </div>

            {/* Phone Number Field (Read Only) */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Login Phone Number</label>
              <Input
                type="tel"
                value={loading ? "Loading..." : formData.phone}
                placeholder="Enter phone number"
                className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed"
                readOnly
                disabled={loading || saving}
              />
              <p className="text-[10px] text-gray-400 mt-1">* Login number cannot be changed from here.</p>
            </div>

            {/* Primary Contact Number Field */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Primary Contact Number</label>
              <div className="relative">
                <Input
                  type="tel"
                  value={loading ? "Loading..." : formData.primaryContactNumber}
                  onChange={(e) => handleInputChange("primaryContactNumber", e.target.value)}
                  placeholder="Enter contact number"
                  className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                  disabled={loading || saving}
                />
                
              </div>
            </div>

            {/* Email Field */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Email Address</label>
              <div className="relative">
                <Input
                  type="email"
                  value={loading ? "Loading..." : formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  placeholder="Enter email address"
                  className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                  disabled={loading || saving}
                />
                
              </div>
            </div>

            <div className="pt-6 pb-2 border-t border-gray-100">
              <h3 className="text-base font-bold text-gray-900">Restaurant Location</h3>
              <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-black">ZONE & ADDRESS</p>
            </div>

            {/* Service Zone */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Service Zone*</label>
              <select
                value={formData.zoneId || ""}
                onChange={(e) => handleInputChange("zoneId", e.target.value)}
                className="w-full h-10 rounded-md border border-gray-200 bg-gray-50 text-gray-500 px-3 text-sm focus:outline-none cursor-not-allowed appearance-none"
                disabled={true}
              >
                <option value="">{zonesLoading ? "Loading zones..." : "Select a zone"}</option>
                {zones.map((z) => {
                  const id = String(z?._id || z?.id || "")
                  const label = z?.name || z?.zoneName || z?.serviceLocation || id
                  return <option key={id} value={id}>{label}</option>
                })}
              </select>
            </div>



            {/* Manual Address Fields */}
            <div className="grid grid-cols-1 gap-4">
              <Input
                value={formData.location?.addressLine1 || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, location: { ...prev.location, addressLine1: e.target.value } }))}
                placeholder="Shop no. / building no."
                className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                disabled={loading || saving}
              />
              <Input
                value={formData.location?.area || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, location: { ...prev.location, area: e.target.value } }))}
                placeholder="Area / Sector / Locality*"
                className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                disabled={loading || saving}
              />
              
              <div className="grid grid-cols-2 gap-3">
                <Select disabled={true} value={formData.location?.city || ""}
                  onValueChange={(val) => setFormData(prev => ({ ...prev, location: { ...prev.location, city: val } }))}
                >
                  <SelectTrigger className="bg-gray-50 text-gray-500 cursor-not-allowed [&>svg]:hidden text-sm">
                    <SelectValue placeholder="Select City*" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Indore">Indore</SelectItem>
                    <SelectItem value="Bhopal">Bhopal</SelectItem>
                    <SelectItem value="Mumbai">Mumbai</SelectItem>
                    <SelectItem value="Pune">Pune</SelectItem>
                    <SelectItem value="Delhi">Delhi</SelectItem>
                    <SelectItem value="Bangalore">Bangalore</SelectItem>
                  </SelectContent>
                </Select>

                <Input
                  value={formData.location?.pincode || ""}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: { ...prev.location, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) } }))}
                  placeholder="Pincode*"
                  className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                  disabled={loading || saving}
                />
              </div>
            </div>

            <div className="pt-6 pb-2 border-t border-gray-100">
              <h3 className="text-base font-bold text-gray-900">Financial Details</h3>
              <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-black">PAN & BANK ACCOUNT</p>
            </div>

            {/* PAN Number */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">PAN Number</label>
              <div className="relative">
                <Input
                  type="text"
                  value={loading ? "Loading..." : formData.panNumber}
                  onChange={(e) => handleInputChange("panNumber", e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                  disabled={loading || saving}
                />
                
              </div>
            </div>

            {/* Name on PAN */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Name on PAN Card</label>
              <div className="relative">
                <Input
                  type="text"
                  value={loading ? "Loading..." : formData.nameOnPan}
                  onChange={(e) => handleInputChange("nameOnPan", e.target.value)}
                  placeholder="Enter name as per PAN"
                  className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                  disabled={loading || saving}
                />
                
              </div>
            </div>

            {/* Account Number */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Bank Account Number</label>
              <div className="relative">
                <Input
                  type="text"
                  value={loading ? "Loading..." : formData.accountNumber}
                  onChange={(e) => handleInputChange("accountNumber", e.target.value)}
                  placeholder="Enter account number"
                  className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                  disabled={loading || saving}
                />
                
              </div>
            </div>

            {/* Account Type */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Account Type</label>
              <Select disabled={true} value={formData.accountType || ""}
                onValueChange={(val) => handleInputChange("accountType", val)}
              >
                <SelectTrigger className="w-full bg-gray-50 text-gray-500 cursor-not-allowed [&>svg]:hidden focus:ring-0 focus:border-black">
                  <SelectValue placeholder="Select account type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Savings">Savings</SelectItem>
                  <SelectItem value="Current">Current</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* IFSC Code */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">IFSC Code</label>
              <div className="relative">
                <Input
                  type="text"
                  value={loading ? "Loading..." : formData.ifscCode}
                  onChange={(e) => handleInputChange("ifscCode", e.target.value.toUpperCase())}
                  placeholder="SBIN0001234"
                  className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                  disabled={loading || saving}
                />
                
              </div>
            </div>

            {/* UPI ID */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">UPI ID (Optional)</label>
              <div className="relative">
                <Input
                  type="text"
                  value={loading ? "Loading..." : formData.upiId}
                  onChange={(e) => handleInputChange("upiId", e.target.value)}
                  placeholder="name@okaxis"
                  className="w-full bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed" readOnly
                  disabled={loading || saving}
                />
                
              </div>
            </div>
          </div>

          
        </div>

        {/* Delete Account Confirmation Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="restaurant-modal-inline sm:max-w-md p-4">
            <DialogHeader className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <span className="text-2xl leading-none text-red-600">!</span>
              </div>
              <DialogTitle className="text-base font-semibold text-gray-900 text-center">
                You are about to delete your Tuggo account
              </DialogTitle>
              <DialogHeader className="mt-2 text-sm text-gray-600">
                All information associated with your account will be deleted, and you will lose access to your restaurant permanently.
                This information cannot be recovered once the account is deleted. Are you sure you want to proceed?
              </DialogHeader>
            </DialogHeader>
            <DialogFooter className="flex flex-col gap-2 sm:flex-col">
              <Button
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? "Deleting..." : "Confirm"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
                className="w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        </div>

      <ImageSourcePicker
        isOpen={isPhotoPickerOpen}
        onClose={() => setIsPhotoPickerOpen(false)}
        onFileSelect={handlePhotoSelect}
        title="Update owner photo"
        description="Choose how to upload your owner profile photo"
        fileNamePrefix="owner-photo"
        galleryInputRef={fileInputRef}
      />
    </>
  )
}

