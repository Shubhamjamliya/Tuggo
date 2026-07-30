import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { ArrowLeft, Star, ChevronRight } from "lucide-react"
import { restaurantAPI } from "@food/api"
import { toast } from "sonner"
import { getImageValidationError, getUploadErrorMessage } from '@/shared/utils/uploadErrors.js'
import { Button } from "@food/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@food/components/ui/dialog"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"

const debugLog = (...args) => {}
const debugError = (...args) => {}

export default function OutletInfo() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  
  // State management
  const [restaurantData, setRestaurantData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [restaurantName, setRestaurantName] = useState("")
  const [mainImage, setMainImage] = useState("https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=400&fit=crop")
  const [thumbnailImage, setThumbnailImage] = useState("https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&h=200&fit=crop")
  const [coverImages, setCoverImages] = useState([])
  const [restaurantId, setRestaurantId] = useState("")
  const [restaurantMongoId, setRestaurantMongoId] = useState("")
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageType, setImageType] = useState(null)
  const [uploadingCount, setUploadingCount] = useState(0)
  
  const profileImageInputRef = useRef(null)
  const menuImageInputRef = useRef(null)
  const [activePicker, setActivePicker] = useState(null)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editSection, setEditSection] = useState(null)
  const [editFormData, setEditFormData] = useState({})
  const [savingEdit, setSavingEdit] = useState(false)

  // Fetch restaurant data on mount
  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        setLoading(true)
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        if (data) {
          setRestaurantData(data)
          setRestaurantName(data.name || data.restaurantName || "")
          setRestaurantId(data.restaurantId || data.id || "")
          const mongoId = String(data.id || data._id || "")
          setRestaurantMongoId(mongoId)
          
          if (data.profileImage?.url) {
            setThumbnailImage(data.profileImage.url)
          }
          if (data.coverImages && Array.isArray(data.coverImages) && data.coverImages.length > 0) {
            setCoverImages(data.coverImages.map(img => ({
              url: img.url || img,
              publicId: img.publicId
            })))
            setMainImage(data.coverImages[0].url || data.coverImages[0])
          } else if (data.menuImages && Array.isArray(data.menuImages) && data.menuImages.length > 0) {
            setCoverImages(data.menuImages.map(img => ({
              url: img.url,
              publicId: img.publicId
            })))
            setMainImage(data.menuImages[0].url)
          } else {
            setCoverImages([])
          }
        }
      } catch (error) {
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching restaurant data:", error)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()

    const handleUpdate = () => fetchRestaurantData()
    window.addEventListener("ownerDataUpdated", handleUpdate)
    window.addEventListener("cuisinesUpdated", handleUpdate)
    window.addEventListener("addressUpdated", handleUpdate)
    
    return () => {
      window.removeEventListener("ownerDataUpdated", handleUpdate)
      window.removeEventListener("cuisinesUpdated", handleUpdate)
      window.removeEventListener("addressUpdated", handleUpdate)
    }
  }, [])

  // Handle profile image replacement
  const handleProfileImageReplace = async (file) => {
    if (!file) return
    try {
      setUploadingImage(true)
      setImageType('profile')
      const uploadResponse = await restaurantAPI.uploadProfileImage(file)
      const uploadedImage = uploadResponse?.data?.data?.profileImage || uploadResponse?.data?.profileImage
      if (uploadedImage?.url) {
        setThumbnailImage(uploadedImage.url)
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        if (data) setRestaurantData(data)
      }
    } catch (error) {
      debugError("Error uploading profile image:", error)
      toast.error(getUploadErrorMessage(error, { fallback: "Failed to upload image." }))
    } finally {
      setUploadingImage(false)
      setImageType(null)
    }
  }

  // Handle multiple cover images addition
  const handleCoverImageAdd = async (files) => {
    if (!files || (Array.isArray(files) && files.length === 0)) return
    const fileArray = Array.isArray(files) ? files : [files]
    try {
      setUploadingImage(true)
      setImageType('menu')
      setUploadingCount(fileArray.length)

      const currentResponse = await restaurantAPI.getCurrentRestaurant()
      const currentData = currentResponse?.data?.data?.restaurant || currentResponse?.data?.restaurant
      const existingImages = currentData?.menuImages && Array.isArray(currentData.menuImages)
        ? currentData.menuImages.map(img => ({ url: img.url, publicId: img.publicId }))
        : []

      const uploadedImageData = []
      for (let i = 0; i < fileArray.length; i++) {
        try {
          const uploadResponse = await restaurantAPI.uploadMenuImage(fileArray[i])
          const uploadedImage = uploadResponse?.data?.data?.menuImage || uploadResponse?.data?.menuImage
          if (uploadedImage?.url) {
            uploadedImageData.push({ url: uploadedImage.url, publicId: uploadedImage.publicId || null })
          }
        } catch (error) {
          debugError("Upload failed", error)
          toast.error(getUploadErrorMessage(error, { fallback: `Failed to upload image ${i + 1}.` }))
        }
      }

      if (uploadedImageData.length > 0) {
        const allImages = [...existingImages]
        uploadedImageData.forEach(uploaded => {
          if (!allImages.find(img => img.url === uploaded.url)) allImages.push(uploaded)
        })

        try {
          await restaurantAPI.updateProfile({ menuImages: allImages })
          toast.success(`Successfully uploaded ${uploadedImageData.length} image(s)`)
        } catch (updateError) {
          toast.error("Images uploaded but failed to save.")
        }
        setCoverImages(allImages)
        if (allImages.length > 0) setMainImage(allImages[0].url)
      }
    } catch (error) {
      toast.error(getUploadErrorMessage(error, { fallback: "Failed to upload images." }))
    } finally {
      setUploadingImage(false)
      setImageType(null)
      setUploadingCount(0)
    }
  }

  const handleImageClick = (type, ref, title, multiple = false) => {
    if (isFlutterBridgeAvailable()) {
      setActivePicker({ type, ref, title, multiple })
    } else {
      ref.current?.click()
    }
  }

  const handleEditClick = (section) => {
    setEditSection(section)
    setEditFormData({...restaurantData})
    setEditModalOpen(true)
  }

  const handleEditSave = async () => {
    try {
      setSavingEdit(true)
      const payload = {}
      if (editSection === 'restaurantName') {
        payload.restaurantName = editFormData.restaurantName || editFormData.name
      } else if (editSection === 'basic') {
        payload.ownerName = editFormData.ownerName
        payload.primaryContactNumber = editFormData.primaryContactNumber
        payload.ownerEmail = editFormData.ownerEmail || editFormData.email
        payload.pureVegRestaurant = editFormData.pureVegRestaurant
      } else if (editSection === 'compliance') {
        payload.panNumber = editFormData.panNumber
        payload.gstNumber = editFormData.gstNumber
        payload.fssaiNumber = editFormData.fssaiNumber
        payload.fssaiExpiry = editFormData.fssaiExpiry
      } else if (editSection === 'bank') {
        payload.accountHolderName = editFormData.accountHolderName
        payload.accountNumber = editFormData.accountNumber
        payload.ifscCode = editFormData.ifscCode
        payload.upiId = editFormData.upiId
      }
      
      await restaurantAPI.updateProfile(payload)
      toast.success('Details updated successfully!')
      
      // refresh data
      const response = await restaurantAPI.getCurrentRestaurant()
      const data = response?.data?.data?.restaurant || response?.data?.restaurant
      if (data) {
        setRestaurantData(data)
        if (data.name || data.restaurantName) setRestaurantName(data.name || data.restaurantName)
      }
      
      setEditModalOpen(false)
      window.dispatchEvent(new Event('ownerDataUpdated'))
    } catch (error) {
      toast.error('Failed to update details.')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleCoverImageDelete = async (indexToDelete) => {
    if (!window.confirm("Are you sure you want to delete this cover image?")) return
    try {
      setUploadingImage(true)
      setImageType('menu')
      const updatedImages = coverImages.filter((_, index) => index !== indexToDelete)
      const menuImagesForBackend = updatedImages.map(img => ({ url: img.url, publicId: img.publicId || null }))
      await restaurantAPI.updateProfile({ menuImages: menuImagesForBackend })
      setCoverImages(updatedImages)
      if (indexToDelete === 0 && updatedImages.length > 0) {
        setMainImage(updatedImages[0].url)
      } else if (updatedImages.length === 0) {
        setMainImage("https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=400&fit=crop")
      }
      toast.success("Image deleted successfully")
    } catch (error) {
      toast.error("Failed to delete image.")
    } finally {
      setUploadingImage(false)
      setImageType(null)
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return "N/A"
    const d = new Date(dateString)
    return isNaN(d.getTime()) ? "N/A" : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const capitalize = (str) => {
    if (!str) return ""
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
  }

  return (
    <div className="min-h-full bg-gray-50 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="p-1">
            <ArrowLeft className="w-6 h-6 text-gray-900" />
          </button>
          <h1 className="text-[17px] font-bold text-gray-900">Outlet info</h1>
        </div>
        <p className="text-[13px] text-gray-600">
          Restaurant id: {loading ? "..." : (restaurantMongoId && restaurantMongoId.length >= 5 ? restaurantMongoId.slice(-5) : (restaurantId || "N/A"))}
        </p>
      </div>

      <div className="bg-white">
        {/* Cover Image */}
        <div className="relative w-full h-56 bg-gray-100">
          {mainImage && (
            <img src={mainImage} alt="Cover" className="w-full h-full object-cover" />
          )}
          <div className="absolute bottom-4 right-4 flex gap-2.5">
            <button 
              disabled={uploadingImage}
              className="bg-[#111827] text-white px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-70 transition-colors shadow-sm" 
              onClick={() => handleImageClick('cover', menuImageInputRef, "Add Cover Image", true)}
            >
              {uploadingImage && imageType === 'menu' ? 'Uploading...' : 'Add image'}
            </button>
            {mainImage && (
              <button 
                disabled={uploadingImage}
                className="bg-[#FF3B4D] text-white px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-70 transition-colors shadow-sm" 
                onClick={() => handleCoverImageDelete(0)}
              >
                Remove
              </button>
            )}
            <input
              ref={menuImageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleCoverImageAdd(Array.from(e.target.files || []))}
            />
          </div>
        </div>

        {/* Profile Image */}
        <div className="px-4 py-5 border-b border-gray-100">
          <div className="flex items-center justify-between bg-white border border-gray-100/80 rounded-3xl p-3.5 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
            <div className="w-[88px] h-[88px] bg-gray-100 rounded-[1.25rem] overflow-hidden shrink-0 border border-gray-100 shadow-sm">
              <img src={thumbnailImage} alt="Profile" className="w-full h-full object-cover" />
            </div>
            <div className="flex gap-2.5">
              <button 
                disabled={uploadingImage}
                className="bg-[#111827] text-white px-4 py-2.5 rounded-xl text-[13px] font-bold disabled:opacity-70 shadow-sm transition-colors" 
                onClick={() => handleImageClick('profile', profileImageInputRef, "Update Profile Photo")}
              >
                {uploadingImage && imageType === 'profile' ? 'Uploading...' : 'Add image'}
              </button>
              {thumbnailImage && (
                <button 
                  className="bg-[#FF3B4D] text-white px-4 py-2.5 rounded-xl text-[13px] font-bold shadow-sm transition-colors"
                  // onClick={() => {/* handle profile image delete if needed */}}
                >
                  Delete
                </button>
              )}
              <input
                ref={profileImageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleProfileImageReplace(e.target.files?.[0])}
              />
            </div>
          </div>
        </div>

        {/* Ratings */}
        <div className="px-4 py-4 border-b border-gray-100 flex items-center gap-3.5">
          <div className="bg-[#E91E63] px-2 py-1 rounded-[6px] flex items-center gap-1 shadow-sm">
            <span className="text-white font-black text-sm">{restaurantData?.rating?.toFixed(1) || "5.0"}</span>
            <Star className="w-3.5 h-3.5 text-white fill-white mb-[1px]" />
          </div>
          <div className="flex items-center text-[#E91E63] font-black text-sm uppercase tracking-wide cursor-pointer hover:underline" onClick={() => navigate("/food/restaurant/feedback")}>
            {restaurantData?.totalRatings || 1} DELIVERY REVIEWS
            <ChevronRight className="w-4 h-4 ml-0.5" />
          </div>
        </div>
      </div>

      <div className="p-4 bg-[#F8F9FA]">
        <div className="mb-4">
          <h2 className="text-[17px] font-bold text-gray-900 tracking-tight">Restaurant Information</h2>
          <p className="text-[13px] text-gray-500 mt-1 font-medium">All onboarding and profile details at one place.</p>
        </div>

        <div className="space-y-3.5">
          {/* Card 1: Restaurant Name */}
          <div className="bg-white rounded-3xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-gray-100/50">
            <div className="flex flex-col mb-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <p className="text-[13px] text-gray-500 font-semibold">Restaurant name</p>
                  <span className="px-2.5 py-0.5 bg-[#FFEAF0] text-[#E91E63] rounded-full text-[10px] font-bold tracking-wide">{capitalize(restaurantData?.status || 'Approved')}</span>
                </div>
                <button onClick={() => handleEditClick('restaurantName')} className="text-[#2563EB] text-sm font-bold hover:underline">Edit</button>
              </div>
            </div>
            <p className="text-base font-black text-gray-900 mt-0.5">{restaurantName || "N/A"}</p>
          </div>

          {/* Card 2: Basic Details */}
          <div className="bg-white rounded-3xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-gray-100/50">
            <div className="flex flex-col mb-4.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <p className="text-base font-bold text-gray-900">Basic details</p>
                  <span className="px-2.5 py-0.5 bg-[#FFEAF0] text-[#E91E63] rounded-full text-[10px] font-bold tracking-wide">{capitalize(restaurantData?.status || 'Approved')}</span>
                </div>
                <button onClick={() => handleEditClick('basic')} className="text-[#2563EB] text-sm font-bold hover:underline">Edit</button>
              </div>
            </div>
            
            <div className="space-y-4">
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">Owner name</p>
                <p className="text-[15px] font-bold text-gray-900">{restaurantData?.ownerName || "N/A"}</p>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">Primary contact</p>
                <p className="text-[15px] font-bold text-gray-900">{restaurantData?.primaryContactNumber || restaurantData?.ownerPhone || "N/A"}</p>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">Email</p>
                <p className="text-[15px] font-bold text-gray-900">{restaurantData?.email || restaurantData?.ownerEmail || "N/A"}</p>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">Restaurant type</p>
                <p className="text-[15px] font-bold text-gray-900">{restaurantData?.pureVegRestaurant ? "Pure Veg" : "Veg & Non-Veg"}</p>
              </div>
            </div>
          </div>

          {/* Card 3: Compliance Details */}
          <div className="bg-white rounded-3xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-gray-100/50">
            <div className="flex flex-col mb-4.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <p className="text-base font-bold text-gray-900">Compliance details</p>
                  <span className="px-2.5 py-0.5 bg-[#FFEAF0] text-[#E91E63] rounded-full text-[10px] font-bold tracking-wide">{capitalize(restaurantData?.status || 'Approved')}</span>
                </div>
                <button onClick={() => handleEditClick('compliance')} className="text-[#2563EB] text-sm font-bold hover:underline">Edit</button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">PAN number</p>
                <p className="text-[15px] font-bold text-gray-900 uppercase">{restaurantData?.panNumber || "N/A"}</p>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">GST registered</p>
                <p className="text-[15px] font-bold text-gray-900">{restaurantData?.gstNumber ? "Yes" : "No"}</p>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">FSSAI number</p>
                <p className="text-[15px] font-bold text-gray-900">{restaurantData?.fssaiNumber || "N/A"}</p>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">FSSAI expiry</p>
                <p className="text-[15px] font-bold text-gray-900">{formatDate(restaurantData?.fssaiExpiry)}</p>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">FSSAI document</p>
                <div className="flex gap-4 mt-1.5">
                  <button className="text-[#2563EB] text-[15px] font-bold hover:underline tracking-tight" onClick={() => window.open(restaurantData?.fssaiImage?.url || restaurantData?.fssaiImage, "_blank")}>View image</button>
                  <button className="text-[#2563EB] text-[15px] font-bold hover:underline tracking-tight">Upload</button>
                </div>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">PAN document</p>
                <div className="flex gap-4 mt-1.5">
                  <button className="text-[#2563EB] text-[15px] font-bold hover:underline tracking-tight" onClick={() => window.open(restaurantData?.panImage?.url || restaurantData?.panImage, "_blank")}>View image</button>
                  <button className="text-[#2563EB] text-[15px] font-bold hover:underline tracking-tight">Upload</button>
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Bank and UPI Details */}
          <div className="bg-white rounded-3xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-gray-100/50">
            <div className="flex flex-col mb-4.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <p className="text-base font-bold text-gray-900">Bank and UPI details</p>
                  <span className="px-2.5 py-0.5 bg-[#FFEAF0] text-[#E91E63] rounded-full text-[10px] font-bold tracking-wide">{capitalize(restaurantData?.status || 'Approved')}</span>
                </div>
                <button onClick={() => handleEditClick('bank')} className="text-[#2563EB] text-sm font-bold hover:underline">Edit</button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">Account holder</p>
                <p className="text-[15px] font-bold text-gray-900">{restaurantData?.accountHolderName || restaurantData?.nameOnPan || "N/A"}</p>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">Account number</p>
                <p className="text-[15px] font-bold text-gray-900 tracking-wider">
                  {restaurantData?.accountNumber ? `.... .... ${restaurantData.accountNumber.slice(-4)}` : "N/A"}
                </p>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">IFSC code</p>
                <p className="text-[15px] font-bold text-gray-900 uppercase">{restaurantData?.ifscCode || "N/A"}</p>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">UPI ID</p>
                <p className="text-[15px] font-bold text-gray-900">{restaurantData?.upiId || "N/A"}</p>
              </div>
              <div>
                <p className="text-[13px] text-gray-500 font-medium mb-0.5">UPI QR image</p>
                <p className="text-[15px] font-bold text-gray-900">{restaurantData?.upiImage ? "Uploaded" : "Not uploaded"}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="w-[calc(100vw-32px)] max-w-[425px] rounded-[24px] p-0 overflow-hidden bg-white shadow-2xl border-0 gap-0 mx-auto">
          <DialogHeader className="px-6 py-5 border-b border-gray-100 bg-gray-50/50">
            <DialogTitle className="text-[19px] font-black text-gray-900 tracking-tight text-left">
              Edit {editSection === 'restaurantName' ? 'Restaurant Name' : editSection === 'basic' ? 'Basic Details' : editSection === 'compliance' ? 'Compliance Details' : 'Bank Details'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
            {editSection === 'restaurantName' && (
              <div>
                <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">Restaurant Name</label>
                <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400" value={editFormData.restaurantName || editFormData.name || ''} onChange={e => setEditFormData({...editFormData, restaurantName: e.target.value})} placeholder="Enter restaurant name" />
              </div>
            )}
            {editSection === 'basic' && (
              <>
                <div>
                  <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">Owner Name</label>
                  <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400" value={editFormData.ownerName || ''} onChange={e => setEditFormData({...editFormData, ownerName: e.target.value})} placeholder="Enter owner name" />
                </div>
                <div>
                  <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">Primary Contact</label>
                  <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400" value={editFormData.primaryContactNumber || editFormData.ownerPhone || ''} onChange={e => setEditFormData({...editFormData, primaryContactNumber: e.target.value})} placeholder="Enter contact number" />
                </div>
                <div>
                  <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">Email</label>
                  <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400" value={editFormData.email || editFormData.ownerEmail || ''} onChange={e => setEditFormData({...editFormData, email: e.target.value})} placeholder="Enter email address" />
                </div>
                <div className="flex items-center gap-3 mt-4 bg-gray-50 p-3 rounded-xl border border-gray-100">
                  <input type="checkbox" id="pureVeg" checked={!!editFormData.pureVegRestaurant} onChange={e => setEditFormData({...editFormData, pureVegRestaurant: e.target.checked})} className="w-5 h-5 rounded border-gray-300 text-[#E91E63] focus:ring-[#E91E63]" />
                  <label htmlFor="pureVeg" className="text-[14px] font-bold text-gray-800 cursor-pointer">Pure Veg Restaurant</label>
                </div>
              </>
            )}
            {editSection === 'compliance' && (
              <>
                <div>
                  <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">PAN Number</label>
                  <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400 uppercase" value={editFormData.panNumber || ''} onChange={e => setEditFormData({...editFormData, panNumber: e.target.value})} placeholder="Enter PAN number" />
                </div>
                <div>
                  <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">GST Number</label>
                  <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400 uppercase" value={editFormData.gstNumber || ''} onChange={e => setEditFormData({...editFormData, gstNumber: e.target.value})} placeholder="Enter GST number (if any)" />
                </div>
                <div>
                  <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">FSSAI Number</label>
                  <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400" value={editFormData.fssaiNumber || ''} onChange={e => setEditFormData({...editFormData, fssaiNumber: e.target.value})} placeholder="Enter FSSAI number" />
                </div>
                <div>
                  <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">FSSAI Expiry</label>
                  <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400" type="date" value={editFormData.fssaiExpiry ? new Date(editFormData.fssaiExpiry).toISOString().split('T')[0] : ''} onChange={e => setEditFormData({...editFormData, fssaiExpiry: e.target.value})} />
                </div>
              </>
            )}
            {editSection === 'bank' && (
              <>
                <div>
                  <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">Account Holder</label>
                  <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400" value={editFormData.accountHolderName || editFormData.nameOnPan || ''} onChange={e => setEditFormData({...editFormData, accountHolderName: e.target.value})} placeholder="Enter account holder name" />
                </div>
                <div>
                  <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">Account Number</label>
                  <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400" value={editFormData.accountNumber || ''} onChange={e => setEditFormData({...editFormData, accountNumber: e.target.value})} placeholder="Enter bank account number" />
                </div>
                <div>
                  <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">IFSC Code</label>
                  <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400 uppercase" value={editFormData.ifscCode || ''} onChange={e => setEditFormData({...editFormData, ifscCode: e.target.value})} placeholder="Enter IFSC code" />
                </div>
                <div>
                  <label className="text-[13px] font-bold text-gray-700 mb-1.5 block tracking-wide">UPI ID</label>
                  <input className="w-full h-12 rounded-xl bg-gray-50 border border-gray-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E91E63]/20 focus:border-[#E91E63] transition-all text-[15px] text-gray-900 px-4 placeholder:text-gray-400" value={editFormData.upiId || ''} onChange={e => setEditFormData({...editFormData, upiId: e.target.value})} placeholder="Enter UPI ID (optional)" />
                </div>
              </>
            )}
          </div>
          
          <div className="px-6 py-4 bg-gray-50/80 border-t border-gray-100 flex gap-3">
            <button 
              className="flex-1 px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-50 transition-colors shadow-sm"
              onClick={() => setEditModalOpen(false)}
            >
              Cancel
            </button>
            <button 
              className="flex-1 px-5 py-2.5 bg-[#E91E63] text-white rounded-xl font-bold text-sm hover:bg-[#D81B60] transition-colors shadow-sm disabled:opacity-70 flex justify-center items-center"
              onClick={handleEditSave} 
              disabled={savingEdit}
            >
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      
      <ImageSourcePicker
        isOpen={!!activePicker}
        onClose={() => setActivePicker(null)}
        onFileSelect={(file) => {
          if (activePicker?.type === 'profile') {
            handleProfileImageReplace(file)
          } else {
            handleCoverImageAdd(file)
          }
        }}
        title={activePicker?.title}
        description={`Choose how to upload your ${activePicker?.type} photo`}
        fileNamePrefix={`outlet-${activePicker?.type}`}
        galleryInputRef={activePicker?.ref}
      />
    </div>
  )
}
