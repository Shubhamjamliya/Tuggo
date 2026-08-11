import { useState, useRef, useEffect } from "react";
import { Info, Phone, Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { adminAPI } from "@food/api";
import { setCachedSettings, updateFavicon, updateTitle, normalizeSettingsUrls } from "@food/utils/businessSettings";
import { EMAIL_REGEX } from "@/shared/utils/emailValidation";
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function BusinessSetup() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState(null);
  const [userLogoPreview, setUserLogoPreview] = useState(null);
  const [restaurantLogoPreview, setRestaurantLogoPreview] = useState(null);
  const [deliveryLogoPreview, setDeliveryLogoPreview] = useState(null);
  const [faviconPreview, setFaviconPreview] = useState(null);
  const [termsPdfUrl, setTermsPdfUrl] = useState(null);

  const [logoFile, setLogoFile] = useState(null);
  const [userLogoFile, setUserLogoFile] = useState(null);
  const [restaurantLogoFile, setRestaurantLogoFile] = useState(null);
  const [deliveryLogoFile, setDeliveryLogoFile] = useState(null);
  const [faviconFile, setFaviconFile] = useState(null);
  const [termsPdfFile, setTermsPdfFile] = useState(null);

  const logoInputRef = useRef(null);
  const userLogoInputRef = useRef(null);
  const restaurantLogoInputRef = useRef(null);
  const deliveryLogoInputRef = useRef(null);
  const faviconInputRef = useRef(null);
  const termsPdfInputRef = useRef(null);

  const [formData, setFormData] = useState({
    companyName: "",
    email: "",
    phoneCountryCode: "+91",
    phoneNumber: "",
    address: "",
    state: "",
    pincode: "",
    region: "",
    supportEmail: "",
    supportPhone: "",
    supportHours: "",
    fssai: "",
    gstin: "",
  });

  // Fetch business settings on mount
  useEffect(() => {
    fetchBusinessSettings();
  }, []);

  const fetchBusinessSettings = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getBusinessSettings();
      let settings = response?.data?.data || response?.data;
      settings = normalizeSettingsUrls(settings);

      if (settings) {
        setFormData({
          companyName: settings.companyName || "",
          email: settings.email || "",
          phoneCountryCode: settings.phone?.countryCode || "+91",
          phoneNumber: settings.phone?.number || "",
          address: settings.address || "",
          state: settings.state || "",
          pincode: settings.pincode || "",
          region: settings.region || "India",
          supportEmail: settings.supportEmail || "",
          supportPhone: settings.supportPhone || "",
          supportHours: settings.supportHours || "",
          fssai: settings.fssai || "",
          gstin: settings.gstin || "",
        });

        // Set logo and favicon previews
        setLogoPreview(settings.logo?.url || null);
        setUserLogoPreview(settings.userLogo?.url || null);
        setRestaurantLogoPreview(settings.restaurantLogo?.url || null);
        setDeliveryLogoPreview(settings.deliveryLogo?.url || null);
        setFaviconPreview(settings.favicon?.url || null);
        setTermsPdfUrl(settings.termsAndConditionsPdf?.url || null);
      }
    } catch (error) {
      debugError("Error fetching business settings:", error);
      toast.error(error?.response?.data?.message || "Failed to load business settings");
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSave = async () => {
    try {
      // Validate required fields
      if (!formData.companyName.trim()) {
        toast.error("Company name is required");
        return;
      }
      if (formData.companyName.trim().length < 2) {
        toast.error("Company name must be at least 2 characters long");
        return;
      }

      if (!formData.email.trim()) {
        toast.error("Email is required");
        return;
      }
      
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(formData.email.trim())) {
        toast.error("Please enter a valid email address");
        return;
      }
      
      const emailDomain = formData.email.trim().split('@')[1]?.toLowerCase();
      const invalidDomains = ['gnali.com', 'gmai.com', 'gamil.com', 'gmail.con', 'gmail.comm', 'yahoo.comm', 'yahoo.con', 'hotmal.com', 'hotmail.con'];
      if (invalidDomains.includes(emailDomain) || emailDomain?.endsWith('.comm')) {
        toast.error("Invalid email domain. Please check for typos (e.g., gnali.com, .comm).");
        return;
      }

      if (!formData.phoneNumber.trim()) {
        toast.error("Phone number is required");
        return;
      }
      if (!/^\d{10}$/.test(formData.phoneNumber.trim())) {
        toast.error("Phone number must be exactly 10 digits");
        return;
      }

      if (!formData.state.trim()) {
        toast.error("State is required");
        return;
      }

      if (!formData.pincode.trim()) {
        toast.error("Pincode is required");
        return;
      }
      if (!/^\d{4,10}$/.test(formData.pincode.trim())) {
        toast.error("Please enter a valid pincode (4-10 digits)");
        return;
      }
      
      if (formData.supportEmail?.trim()) {
        const sEmail = formData.supportEmail.trim();
        if (!emailRegex.test(sEmail)) {
          toast.error("Please enter a valid support email address");
          return;
        }
        const sDomain = sEmail.split('@')[1]?.toLowerCase();
        if (invalidDomains.includes(sDomain) || sDomain?.endsWith('.comm')) {
          toast.error("Invalid support email domain. Please check for typos.");
          return;
        }
      }
      
      if (formData.supportPhone?.trim()) {
        const sPhone = formData.supportPhone.trim().replace(/\D/g, "");
        if (!/^\d{10}$/.test(sPhone)) {
          toast.error("Support phone number must be exactly 10 digits");
          return;
        }
      }
      
      if (!logoPreview && !logoFile) {
        toast.error("Company logo picture is required. Please upload a logo.");
        return;
      }

      setSaving(true);

      // Prepare form data
      const dataToSend = {
        companyName: formData.companyName.trim(),
        email: formData.email.trim(),
        phoneCountryCode: formData.phoneCountryCode,
        phoneNumber: formData.phoneNumber.trim(),
        address: formData.address.trim(),
        state: formData.state.trim(),
        pincode: formData.pincode.trim(),
        region: formData.region,
        supportEmail: formData.supportEmail?.trim(),
        supportPhone: formData.supportPhone?.trim(),
        supportHours: formData.supportHours?.trim(),
        fssai: formData.fssai?.trim(),
        gstin: formData.gstin?.trim(),
        logo: logoFile ? undefined : (logoPreview || ''),
        userLogo: userLogoFile ? undefined : (userLogoPreview || ''),
        restaurantLogo: restaurantLogoFile ? undefined : (restaurantLogoPreview || ''),
        deliveryLogo: deliveryLogoFile ? undefined : (deliveryLogoPreview || ''),
        favicon: faviconFile ? undefined : (faviconPreview || ''),
      };

      // Prepare files
      const files = {};
      if (logoFile) files.logo = logoFile;
      if (userLogoFile) files.userLogo = userLogoFile;
      if (restaurantLogoFile) files.restaurantLogo = restaurantLogoFile;
      if (deliveryLogoFile) files.deliveryLogo = deliveryLogoFile;
      if (faviconFile) files.favicon = faviconFile;
      if (termsPdfFile) files.termsAndConditionsPdf = termsPdfFile;

      const response = await adminAPI.updateBusinessSettings(dataToSend, files);
      let updatedSettings = response?.data?.data || response?.data;
      updatedSettings = normalizeSettingsUrls(updatedSettings);

      if (updatedSettings) {
        // Update global cache immediately
        setCachedSettings(updatedSettings);

        // Update previews with updated URLs
        setLogoPreview(updatedSettings.logo?.url || null);
        setUserLogoPreview(updatedSettings.userLogo?.url || null);
        setRestaurantLogoPreview(updatedSettings.restaurantLogo?.url || null);
        setDeliveryLogoPreview(updatedSettings.deliveryLogo?.url || null);
        setFaviconPreview(updatedSettings.favicon?.url || null);
        setTermsPdfUrl(updatedSettings.termsAndConditionsPdf?.url || null);

        setLogoFile(null);
        setUserLogoFile(null);
        setRestaurantLogoFile(null);
        setDeliveryLogoFile(null);
        setFaviconFile(null);
        setTermsPdfFile(null);
      }

      toast.success("Business settings saved successfully");

      // Dispatch custom event to notify other components (like Sidebar)
      window.dispatchEvent(new CustomEvent('businessSettingsUpdated'));
    } catch (error) {
      debugError("Error saving business settings:", error);
      toast.error(error?.response?.data?.message || "Failed to save business settings");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    fetchBusinessSettings();
    setLogoFile(null);
    setUserLogoFile(null);
    setRestaurantLogoFile(null);
    setDeliveryLogoFile(null);
    setFaviconFile(null);
    setTermsPdfFile(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
    if (userLogoInputRef.current) userLogoInputRef.current.value = "";
    if (restaurantLogoInputRef.current) restaurantLogoInputRef.current.value = "";
    if (deliveryLogoInputRef.current) deliveryLogoInputRef.current.value = "";
    if (faviconInputRef.current) faviconInputRef.current.value = "";
    if (termsPdfInputRef.current) termsPdfInputRef.current.value = "";
    toast.info("Form reset to saved values");
  };


  if (loading) {
    return (
      <div className="p-4 lg:p-6 bg-slate-50 min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      {/* Page header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Business setup</h1>
          <p className="text-xs lg:text-sm text-slate-500 mt-1">
            Manage your company information, general configuration and business rules.
          </p>
        </div>

        {/* Note card (top-right) */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3 max-w-md">
          <div className="mt-0.5">
            <Info className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xs lg:text-sm text-slate-700">
            <p className="font-semibold text-amber-700 mb-0.5">Note</p>
            <p>Don&apos;t forget to click the &quot;Save Information&quot; button below to save changes.</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Company info */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
          {/* Company information */}
          <div className="px-4 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <span>Company Information</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Company name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter Your Company Name"
                  value={formData.companyName}
                  maxLength={50}
                  onChange={(e) => handleInputChange("companyName", e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  placeholder="Enter Your Email"
                  value={formData.email}
                  maxLength={100}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Region <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.region}
                  onChange={(e) => handleInputChange("region", e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="India">India</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Phone <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <div className="relative w-32">
                    <select
                      value={formData.phoneCountryCode}
                      onChange={(e) => handleInputChange("phoneCountryCode", e.target.value)}
                      className="w-full pl-8 pr-6 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none"
                    >
                      <option value="+91">+91 (IN)</option>
                    </select>
                    <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 pointer-events-none">
                      ?
                    </span>
                  </div>
                  <input
                    type="text"
                    placeholder="Enter Your Phone Number"
                    value={formData.phoneNumber}
                    maxLength={10}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      handleInputChange("phoneNumber", val);
                    }}
                    className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Address
                </label>
                <textarea
                  rows={2}
                  placeholder="Enter Your Addresss"
                  value={formData.address}
                  maxLength={250}
                  onChange={(e) => handleInputChange("address", e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  State <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter Your State"
                  value={formData.state}
                  maxLength={50}
                  onChange={(e) => handleInputChange("state", e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Pincode <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter Your Pincode"
                  value={formData.pincode}
                  maxLength={10}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    handleInputChange("pincode", val);
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  FSSAI License
                </label>
                <input
                  type="text"
                  placeholder="Enter FSSAI License Number"
                  value={formData.fssai}
                  maxLength={14}
                  onChange={(e) => handleInputChange("fssai", e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  GSTIN
                </label>
                <input
                  type="text"
                  placeholder="Enter GSTIN Number"
                  value={formData.gstin}
                  maxLength={15}
                  onChange={(e) => handleInputChange("gstin", e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="md:col-span-2 border-t pt-4 mt-2">
                <h4 className="text-sm font-bold text-slate-800 mb-3">Support Information (Dynamic Support Page)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Support Email
                    </label>
                    <input
                      type="email"
                      placeholder="support@tuggo.com"
                      value={formData.supportEmail || ""}
                      onChange={(e) => handleInputChange("supportEmail", e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Support Phone
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 1234567890"
                      value={formData.supportPhone || ""}
                      maxLength={10}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "");
                        handleInputChange("supportPhone", val);
                      }}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Support Availability Hours
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., 24/7 Availability"
                      value={formData.supportHours || ""}
                      onChange={(e) => handleInputChange("supportHours", e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Logo, favicon & T&C PDF upload */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Main Logo (Admin / Default)</label>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
                    if (!allowedTypes.includes(file.type)) {
                      toast.error("Invalid file type. Please upload PNG, JPG, JPEG, or WEBP.");
                      return;
                    }

                    const maxSize = 5 * 1024 * 1024;
                    if (file.size > maxSize) {
                      toast.error("File size exceeds 5MB limit.");
                      return;
                    }

                    setLogoFile(file);
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setLogoPreview(reader.result);
                    };
                    reader.readAsDataURL(file);
                  }}
                  className="hidden"
                />
                <div
                  onClick={() => logoInputRef.current?.click()}
                  className="border border-dashed border-slate-300 rounded-lg bg-slate-50/60 h-28 flex items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors relative overflow-hidden"
                >
                  {logoPreview ? (
                    <>
                      <img
                        src={logoPreview}
                        alt="Main Logo preview"
                        className="w-full h-full object-contain p-2"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLogoPreview(null);
                          setLogoFile(null);
                          if (logoInputRef.current) logoInputRef.current.value = "";
                        }}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <div className="text-center">
                      <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                      <p className="text-xs text-slate-400">Click to upload main logo</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">User App Logo</label>
                <input
                  ref={userLogoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
                    if (!allowedTypes.includes(file.type)) {
                      toast.error("Invalid file type. Please upload PNG, JPG, JPEG, or WEBP.");
                      return;
                    }

                    const maxSize = 5 * 1024 * 1024;
                    if (file.size > maxSize) {
                      toast.error("File size exceeds 5MB limit.");
                      return;
                    }

                    setUserLogoFile(file);
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setUserLogoPreview(reader.result);
                    };
                    reader.readAsDataURL(file);
                  }}
                  className="hidden"
                />
                <div
                  onClick={() => userLogoInputRef.current?.click()}
                  className="border border-dashed border-slate-300 rounded-lg bg-slate-50/60 h-28 flex items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors relative overflow-hidden"
                >
                  {userLogoPreview ? (
                    <>
                      <img
                        src={userLogoPreview}
                        alt="User Logo preview"
                        className="w-full h-full object-contain p-2"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setUserLogoPreview(null);
                          setUserLogoFile(null);
                          if (userLogoInputRef.current) userLogoInputRef.current.value = "";
                        }}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <div className="text-center">
                      <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                      <p className="text-xs text-slate-400">Upload User Panel Logo</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Restaurant Panel Logo</label>
                <input
                  ref={restaurantLogoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
                    if (!allowedTypes.includes(file.type)) {
                      toast.error("Invalid file type. Please upload PNG, JPG, JPEG, or WEBP.");
                      return;
                    }

                    const maxSize = 5 * 1024 * 1024;
                    if (file.size > maxSize) {
                      toast.error("File size exceeds 5MB limit.");
                      return;
                    }

                    setRestaurantLogoFile(file);
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setRestaurantLogoPreview(reader.result);
                    };
                    reader.readAsDataURL(file);
                  }}
                  className="hidden"
                />
                <div
                  onClick={() => restaurantLogoInputRef.current?.click()}
                  className="border border-dashed border-slate-300 rounded-lg bg-slate-50/60 h-28 flex items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors relative overflow-hidden"
                >
                  {restaurantLogoPreview ? (
                    <>
                      <img
                        src={restaurantLogoPreview}
                        alt="Restaurant Logo preview"
                        className="w-full h-full object-contain p-2"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRestaurantLogoPreview(null);
                          setRestaurantLogoFile(null);
                          if (restaurantLogoInputRef.current) restaurantLogoInputRef.current.value = "";
                        }}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <div className="text-center">
                      <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                      <p className="text-xs text-slate-400">Upload Restaurant Panel Logo</p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Delivery / Rider Panel Logo</label>
                <input
                  ref={deliveryLogoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
                    if (!allowedTypes.includes(file.type)) {
                      toast.error("Invalid file type. Please upload PNG, JPG, JPEG, or WEBP.");
                      return;
                    }

                    const maxSize = 5 * 1024 * 1024;
                    if (file.size > maxSize) {
                      toast.error("File size exceeds 5MB limit.");
                      return;
                    }

                    setDeliveryLogoFile(file);
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setDeliveryLogoPreview(reader.result);
                    };
                    reader.readAsDataURL(file);
                  }}
                  className="hidden"
                />
                <div
                  onClick={() => deliveryLogoInputRef.current?.click()}
                  className="border border-dashed border-slate-300 rounded-lg bg-slate-50/60 h-28 flex items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors relative overflow-hidden"
                >
                  {deliveryLogoPreview ? (
                    <>
                      <img
                        src={deliveryLogoPreview}
                        alt="Delivery Logo preview"
                        className="w-full h-full object-contain p-2"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeliveryLogoPreview(null);
                          setDeliveryLogoFile(null);
                          if (deliveryLogoInputRef.current) deliveryLogoInputRef.current.value = "";
                        }}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <div className="text-center">
                      <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                      <p className="text-xs text-slate-400">Upload Delivery Panel Logo</p>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Favicon</label>
                <input
                  ref={faviconInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/x-icon"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    // Validate file type
                    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/x-icon"];
                    if (!allowedTypes.includes(file.type)) {
                      toast.error("Invalid file type. Please upload PNG, JPG, JPEG, WEBP, or ICO.");
                      return;
                    }

                    // Validate file size (max 5MB)
                    const maxSize = 5 * 1024 * 1024; // 5MB
                    if (file.size > maxSize) {
                      toast.error("File size exceeds 5MB limit.");
                      return;
                    }

                    setFaviconFile(file);
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setFaviconPreview(reader.result);
                    };
                    reader.readAsDataURL(file);
                  }}
                  className="hidden"
                />
                <div
                  onClick={() => faviconInputRef.current?.click()}
                  className="border border-dashed border-slate-300 rounded-lg bg-slate-50/60 h-28 flex items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors relative overflow-hidden"
                >
                  {faviconPreview ? (
                    <>
                      <img
                        src={faviconPreview}
                        alt="Favicon preview"
                        className="w-full h-full object-contain"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFaviconPreview(null);
                          setFaviconFile(null);
                          if (faviconInputRef.current) {
                            faviconInputRef.current.value = "";
                          }
                        }}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <div className="text-center">
                      <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                      <p className="text-xs text-slate-400">Click to upload favicon</p>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">T&C PDF (For Restaurant Onboarding)</label>
                <input
                  ref={termsPdfInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    if (file.type !== "application/pdf") {
                      toast.error("Invalid file type. Please upload a PDF.");
                      return;
                    }

                    const maxSize = 10 * 1024 * 1024; // 10MB
                    if (file.size > maxSize) {
                      toast.error("File size exceeds 10MB limit.");
                      return;
                    }

                    setTermsPdfFile(file);
                  }}
                  className="hidden"
                />
                <div
                  onClick={() => termsPdfInputRef.current?.click()}
                  className="border border-dashed border-slate-300 rounded-lg bg-slate-50/60 h-28 flex items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors relative overflow-hidden p-2"
                >
                  {termsPdfFile || termsPdfUrl ? (
                    <div className="flex flex-col items-center justify-center w-full h-full text-center px-4">
                      <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center mb-2">
                        <span className="text-red-500 font-bold text-[10px]">PDF</span>
                      </div>
                      <p className="text-[10px] text-slate-700 font-medium truncate w-full px-2">
                        {termsPdfFile ? termsPdfFile.name : "Current T&C Document"}
                      </p>
                      {termsPdfUrl && !termsPdfFile && (
                         <a 
                           href={termsPdfUrl} 
                           target="_blank" 
                           rel="noreferrer" 
                           onClick={(e) => e.stopPropagation()}
                           className="text-[10px] text-blue-600 hover:underline mt-1 relative z-10"
                         >
                           View Document
                         </a>
                      )}
                      
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (termsPdfFile) {
                            setTermsPdfFile(null);
                            if (termsPdfInputRef.current) {
                              termsPdfInputRef.current.value = "";
                            }
                          } else {
                            termsPdfInputRef.current?.click();
                          }
                        }}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors z-10"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Upload className="w-5 h-5 text-slate-400 mx-auto mb-1" />
                      <p className="text-xs text-slate-400">Click to upload T&C PDF</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Save Button Section */}
          <div className="px-4 py-4 border-t border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-[11px] text-slate-500">
                Changes will only be applied after clicking the <span className="font-semibold">Save Information</span> button.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Information"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({ initial = false }) {
  const [enabled, setEnabled] = useState(initial);

  return (
    <button
      type="button"
      onClick={() => setEnabled((prev) => !prev)}
      className={`inline-flex items-center w-10 h-5 rounded-full border transition-all ${enabled ? "bg-blue-600 border-blue-600 justify-end" : "bg-slate-200 border-slate-300 justify-start"
        }`}
    >
      <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
    </button>
  );
}

