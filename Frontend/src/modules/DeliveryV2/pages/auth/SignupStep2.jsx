import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Upload, X, Check, Camera, Image as ImageIcon } from "lucide-react"
import { deliveryAPI } from "@food/api"
import { toast } from "sonner"
import { getImageValidationError } from '@/shared/utils/uploadErrors.js'
import { isFlutterBridgeAvailable, openCamera } from "@food/utils/imageUploadUtils"
import useDeliveryBackNavigation from "../../hooks/useDeliveryBackNavigation"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const createEmptyUploadedDocs = () => ({
  profilePhoto: null,
  aadharFrontPhoto: null,
  aadharBackPhoto: null,
  panPhoto: null,
  drivingLicenseFrontPhoto: null,
  drivingLicenseBackPhoto: null,
  rcPhoto: null
})

// IndexedDB helpers for persistent file storage
const DELIVERY_FILES_DB = "DeliverySignupFiles"
const FILES_STORE = "files"

const openDeliveryFilesDB = () => {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DELIVERY_FILES_DB, 1)
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
  if (!file) return
  try {
    const db = await openDeliveryFilesDB()
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
    const db = await openDeliveryFilesDB()
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

const deleteFileFromDB = async (key) => {
  try {
    const db = await openDeliveryFilesDB()
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
    const db = await openDeliveryFilesDB()
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

const sanitizeUploadedDocValue = (value) => {
  if (!value) return null

  if (typeof value === "string") {
    return value.startsWith("blob:") ? null : value
  }

  if (typeof value === "object") {
    const url = typeof value.url === "string" ? value.url : ""
    if (url.startsWith("blob:")) {
      return null
    }
    return value
  }

  return null
}

const sanitizeUploadedDocs = (docs) => ({
  profilePhoto: sanitizeUploadedDocValue(docs?.profilePhoto),
  aadharFrontPhoto: sanitizeUploadedDocValue(docs?.aadharFrontPhoto),
  aadharBackPhoto: sanitizeUploadedDocValue(docs?.aadharBackPhoto),
  panPhoto: sanitizeUploadedDocValue(docs?.panPhoto),
  drivingLicenseFrontPhoto: sanitizeUploadedDocValue(docs?.drivingLicenseFrontPhoto),
  drivingLicenseBackPhoto: sanitizeUploadedDocValue(docs?.drivingLicenseBackPhoto),
  rcPhoto: sanitizeUploadedDocValue(docs?.rcPhoto)
})

const compressImageToWebP = (file, maxWidth = 1024, quality = 0.8) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target.result
      img.onload = () => {
        const canvas = document.createElement("canvas")
        let width = img.width
        let height = img.height

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width)
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL("image/webp", quality)
        resolve(dataUrl)
      }
      img.onerror = (error) => reject(error)
    }
    reader.onerror = (error) => reject(error)
  })
}

const getFriendlyRegistrationError = (error) => {
  const rawMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    ""

  if (/E11000 duplicate key error/i.test(rawMessage)) {
    if (/vehicleNumber_1/i.test(rawMessage) || /vehicleNumber/i.test(rawMessage)) {
      return "This vehicle number is already registered. Please use a different vehicle number."
    }

    if (/panNumber_1/i.test(rawMessage) || /panNumber/i.test(rawMessage)) {
      return "This PAN number is already registered."
    }

    if (/aadharNumber_1/i.test(rawMessage) || /aadharNumber/i.test(rawMessage)) {
      return "This Aadhar number is already registered."
    }

    if (/drivingLicense/i.test(rawMessage)) {
      return "This driving license number is already registered."
    }

    return "This account detail is already registered. Please check your information."
  }

  return rawMessage || "Failed to register. Please try again."
}


export default function SignupStep2() {
  const navigate = useNavigate()
  const goBack = useDeliveryBackNavigation()
  const isMobileDevice =
    typeof navigator !== "undefined" &&
    /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || "")
  const fileInputRefs = useRef({
    profilePhoto: null,
    aadharFrontPhoto: null,
    aadharBackPhoto: null,
    panPhoto: null,
    drivingLicenseFrontPhoto: null,
    drivingLicenseBackPhoto: null,
    rcPhoto: null
  })
  const [documents, setDocuments] = useState({
    profilePhoto: null,
    aadharFrontPhoto: null,
    aadharBackPhoto: null,
    panPhoto: null,
    drivingLicenseFrontPhoto: null,
    drivingLicenseBackPhoto: null,
    rcPhoto: null
  })
  const [uploadedDocs, setUploadedDocs] = useState(() => {
    const saved = localStorage.getItem("deliverySignupDocs")
    if (saved) {
      try {
        return sanitizeUploadedDocs(JSON.parse(saved))
      } catch (e) {
        debugError("Error parsing saved docs:", e)
      }
    }
    return createEmptyUploadedDocs()
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploading, setUploading] = useState({})
  const [isSuccess, setIsSuccess] = useState(false)

  // Hydrate files from IndexedDB on load
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    
    const loadFiles = async () => {
      const [prof, aadharFront, aadharBack, pan, dlFront, dlBack, rc] = await Promise.all([
        getFileFromDB("profilePhoto"),
        getFileFromDB("aadharFrontPhoto"),
        getFileFromDB("aadharBackPhoto"),
        getFileFromDB("panPhoto"),
        getFileFromDB("drivingLicenseFrontPhoto"),
        getFileFromDB("drivingLicenseBackPhoto"),
        getFileFromDB("rcPhoto")
      ])
      
      setDocuments(prev => ({
        ...prev,
        ...(prof && { profilePhoto: prof }),
        ...(aadharFront && { aadharFrontPhoto: aadharFront }),
        ...(aadharBack && { aadharBackPhoto: aadharBack }),
        ...(pan && { panPhoto: pan }),
        ...(dlFront && { drivingLicenseFrontPhoto: dlFront }),
        ...(dlBack && { drivingLicenseBackPhoto: dlBack }),
        ...(rc && { rcPhoto: rc })
      }))

      setUploadedDocs(prev => ({
        ...prev,
        ...(prof && { profilePhoto: { file: true } }),
        ...(aadharFront && { aadharFrontPhoto: { file: true } }),
        ...(aadharBack && { aadharBackPhoto: { file: true } }),
        ...(pan && { panPhoto: { file: true } }),
        ...(dlFront && { drivingLicenseFrontPhoto: { file: true } }),
        ...(dlBack && { drivingLicenseBackPhoto: { file: true } }),
        ...(rc && { rcPhoto: { file: true } })
      }))
    }
    loadFiles()
  }, [])

  // Save uploaded docs metadata to session storage whenever they change
  useEffect(() => {
    localStorage.setItem("deliverySignupDocs", JSON.stringify(uploadedDocs))
  }, [uploadedDocs])

  // Removed incorrect URL.revokeObjectURL cleanup that was breaking image previews

  const getPreviewSrc = (docType) => {
    const uploaded = uploadedDocs[docType]
    if (typeof uploaded === "string") return uploaded
    if (uploaded?.url) return uploaded.url

    const localFile = documents[docType]
    if (typeof localFile === "string" && localFile.startsWith("data:")) {
      return localFile
    }
    if (localFile) {
      if (!localFile._previewUrl) {
        try {
          const blob = (localFile instanceof Blob || localFile instanceof File) 
            ? localFile 
            : new Blob([localFile], { type: localFile.type || "image/webp" })
          localFile._previewUrl = URL.createObjectURL(blob)
        } catch (e) {
          return null
        }
      }
      return localFile._previewUrl
    }
    return null
  }

  const handleOpenUploadOptions = (docType) => {
    fileInputRefs.current[docType]?.click()
  }

  const handleFileSelect = async (docType, file) => {
    if (!file) return

    const imageValidationError = getImageValidationError(file)
    if (imageValidationError) {
      toast.error(imageValidationError)
      return
    }

    try {
      // Compress to WebP (max width 1024px, 80% quality)
      const compressedDataUrl = await compressImageToWebP(file, 1024, 0.8)

      setDocuments((prev) => ({ ...prev, [docType]: compressedDataUrl }))
      setUploadedDocs((prev) => ({ ...prev, [docType]: { file: true } }))
      await saveFileToDB(docType, compressedDataUrl)
      toast.success(`${docType.replace(/([A-Z])/g, " $1").trim()} selected`)
    } catch (error) {
      debugError("Image compression failed:", error)
      toast.error("Failed to process image. Please try another one.")
    }
  }

  const handleTakeCameraPhoto = (docType, label) => {
    openCamera({
      onSelectFile: (file) => handleFileSelect(docType, file),
      fileNamePrefix: `signup-${docType}`
    })
  }

  const handlePickFromGallery = (docType) => {
    fileInputRefs.current[docType]?.click()
  }

  const handleRemove = async (docType) => {
    setDocuments(prev => ({
      ...prev,
      [docType]: null
    }))
    setUploadedDocs(prev => ({
      ...prev,
      [docType]: null
    }))
    await deleteFileFromDB(docType)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const raw = localStorage.getItem("deliverySignupDetails")
    if (!raw) {
      toast.error("Session expired. Please start from Create Account.")
      navigate("/food/delivery/signup", { replace: true })
      return
    }

    let details
    try {
      details = JSON.parse(raw)
    } catch {
      toast.error("Invalid session. Please start from Create Account.")
      navigate("/food/delivery/signup", { replace: true })
      return
    }

    if (!documents.profilePhoto) {
      toast.error("Profile Photo is required")
      return
    }
    if (!documents.aadharFrontPhoto) {
      toast.error("Aadhar Card (Front) is required")
      return
    }
    if (!documents.aadharBackPhoto) {
      toast.error("Aadhar Card (Back) is required")
      return
    }
    if (!documents.panPhoto) {
      toast.error("PAN Card Photo is required")
      return
    }
    if (!documents.rcPhoto) {
      toast.error("RC (Registration Certificate) is required")
      return
    }

    const formData = new FormData()
    formData.append("name", details.name || "")
    formData.append("phone", String(details.phone || "").replace(/\D/g, "").slice(0, 15))
    if (details.email) formData.append("email", String(details.email).trim())
    if (details.ref) formData.append("ref", String(details.ref).trim())
    if (details.countryCode) formData.append("countryCode", details.countryCode)
    if (details.address) formData.append("address", details.address)
    if (details.city) formData.append("city", details.city)
    if (details.state) formData.append("state", details.state)
    if (details.vehicleType) formData.append("vehicleType", details.vehicleType)
    if (details.vehicleName) formData.append("vehicleName", details.vehicleName)
    if (details.vehicleNumber) formData.append("vehicleNumber", details.vehicleNumber)
    if (details.drivingLicenseNumber) {
      formData.append("drivingLicenseNumber", details.drivingLicenseNumber)
      formData.append("documents[drivingLicense][number]", details.drivingLicenseNumber)
    }
    if (details.panNumber) formData.append("panNumber", details.panNumber)
    if (details.aadharNumber) formData.append("aadharNumber", details.aadharNumber)

    const appendFileToForm = (formData, key, fileData, filename) => {
      if (!fileData) return;
      if (typeof fileData === 'string' && fileData.startsWith('data:')) {
        const arr = fileData.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        formData.append(key, new File([u8arr], filename, { type: mime }));
      } else {
        formData.append(key, fileData);
      }
    };

    appendFileToForm(formData, "profilePhoto", documents.profilePhoto, "profile.webp");
    appendFileToForm(formData, "aadharFrontPhoto", documents.aadharFrontPhoto, "aadhar_front.webp");
    appendFileToForm(formData, "aadharBackPhoto", documents.aadharBackPhoto, "aadhar_back.webp");
    appendFileToForm(formData, "panPhoto", documents.panPhoto, "pan.webp");
    appendFileToForm(formData, "drivingLicenseFrontPhoto", documents.drivingLicenseFrontPhoto, "dl_front.webp");
    appendFileToForm(formData, "drivingLicenseBackPhoto", documents.drivingLicenseBackPhoto, "dl_back.webp");
    appendFileToForm(formData, "rcPhoto", documents.rcPhoto, "rc.webp");

    // Try to get FCM token before registering
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
      debugWarn("Failed to get FCM token during signup", e);
    }

    if (fcmToken) {
      formData.append("fcmToken", fcmToken);
      formData.append("platform", platform);
    }

    const isCompleteProfile = localStorage.getItem("deliveryNeedsRegistration") === "true"

    setIsSubmitting(true)

    try {
      // New number (OTP ke baad pehli baar): DB me abhi partner nahi hai,
      // is case me register hi call karna hai (no auth token needed).
      const response = isCompleteProfile
        ? await deliveryAPI.register(formData)
        : await deliveryAPI.completeProfile(formData)

      if (response?.data?.success) {
        localStorage.removeItem("deliverySignupDetails")
        localStorage.removeItem("deliverySignupDocs")
        await clearAllFilesFromDB()
        localStorage.removeItem("deliveryNeedsRegistration")
        setIsSuccess(true)
      }
    } catch (error) {
      debugError("Error submitting registration:", error)
      const message = getFriendlyRegistrationError(error)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const DocumentUpload = ({ docType, label, required = true }) => {
    const uploaded = uploadedDocs[docType]
    const isUploading = uploading[docType]
    const src = getPreviewSrc(docType)

    return (
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label} {required && <span className="text-red-500">*</span>}
        </label>

        {uploaded ? (
          <div className="relative">
            {src ? (
              <img
                src={src}
                alt={label}
                className="w-full h-48 object-cover rounded-lg"
              />
            ) : (
              <div className="w-full h-48 bg-gray-100 rounded-lg flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
              </div>
            )}
            <button
              type="button"
              onClick={() => handleRemove(docType)}
              className="absolute top-2 right-2 bg-red-500 text-white p-2 rounded-full hover:bg-red-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="absolute bottom-2 left-2 bg-green-500 text-white px-3 py-1 rounded-full flex items-center gap-1 text-sm">
              <Check className="w-4 h-4" />
              <span>Uploaded</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-500 transition-colors px-4">
            <div className="flex flex-col items-center justify-center pt-5 pb-3">
              {isUploading ? (
                <>
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mb-2"></div>
                  <p className="text-sm text-gray-500">Uploading...</p>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <p className="text-sm text-gray-500 mb-1">Upload document</p>
                  <p className="text-xs text-gray-400">PNG, JPG up to 5MB</p>
                </>
              )}
            </div>

            {!isUploading && (
              <div className="w-full grid grid-cols-2 gap-2 pb-4">
                <button
                  type="button"
                  onClick={() => handleTakeCameraPhoto(docType, label)}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-bold cursor-pointer hover:bg-black transition-all active:scale-95"
                >
                  <Camera className="w-4 h-4" />
                  <span>Take Photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePickFromGallery(docType)}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[#00B761] text-white text-xs font-bold cursor-pointer hover:bg-[#00A055] transition-all active:scale-95"
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>Gallery</span>
                </button>
              </div>
            )}

            <input
              ref={(node) => {
                fileInputRefs.current[docType] = node
              }}
              type="file"
              className="hidden"
              accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
              onClick={(e) => {
                e.target.value = ""
              }}
              onChange={(e) => {
                const selectedFile = e.target.files[0]
                if (selectedFile) {
                  handleFileSelect(docType, selectedFile)
                }
                e.target.value = ""
              }}
              disabled={isUploading}
            />
          </div>
        )}
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-xl border border-gray-100">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
            <Check className="w-10 h-10 text-amber-500" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-3 tracking-tight">Profile Under Review</h2>
          <p className="text-gray-500 font-medium leading-relaxed mb-8">
            Your profile has been submitted successfully. It is currently under review by the admin. We will notify you once your request is approved.
          </p>
          <button
            onClick={() => navigate("/food/delivery/login", { replace: true })}
            className="w-full py-4 bg-gray-900 text-white rounded-xl font-bold text-base hover:bg-black transition-all active:scale-95 shadow-lg shadow-gray-900/20"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white px-4 py-3 flex items-center gap-4 border-b border-gray-200">
        <button
          onClick={goBack}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-medium">Upload Documents</h1>
      </div>

      {/* Content */}
      <div className="px-4 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Document Verification</h2>
          <p className="text-sm text-gray-600">Please upload clear photos of your documents</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <DocumentUpload docType="profilePhoto" label="Profile Photo" required={true} />
          <DocumentUpload docType="aadharFrontPhoto" label="Aadhar Card (Front)" required={true} />
          <DocumentUpload docType="aadharBackPhoto" label="Aadhar Card (Back)" required={true} />
          <DocumentUpload docType="panPhoto" label="PAN Card Photo" required={true} />
          
          <DocumentUpload docType="drivingLicenseFrontPhoto" label="Driving License (Front)" required={false} />
          <DocumentUpload docType="drivingLicenseBackPhoto" label="Driving License (Back)" required={false} />
          
          <DocumentUpload docType="rcPhoto" label="RC (Registration Certificate)" required={true} />

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full py-4 rounded-lg font-bold text-white text-base transition-colors mt-6 ${isSubmitting
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-[#00B761] hover:bg-[#00A055]"
              }`}
          >
            {isSubmitting ? "Submitting..." : "Complete Signup"}
          </button>
        </form>
      </div>

    </div>
  )
}

