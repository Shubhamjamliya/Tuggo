import { useState, useEffect } from "react";
import { adminAPI } from "@food/api";
import { toast } from "sonner";
import { Save, AlertCircle, RefreshCw } from "lucide-react";

export default function EnvManagements() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getEnvSettings();
      if (response?.data?.success) {
        setSettings(response.data.data);
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load environment settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleInputChange = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        value: value,
        isOverridden: true // Mark as overridden if user edits it
      }
    }));
  };

  const handleResetToEnv = (key) => {
    setSettings((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        value: "",
        isOverridden: false
      }
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      
      // Prepare payload: only send keys that have a value
      const payload = {};
      Object.keys(settings).forEach((key) => {
        // If it's overridden, send the new value (or empty string to delete)
        if (settings[key].isOverridden || settings[key].value === "") {
          payload[key] = settings[key].value;
        }
      });

      const response = await adminAPI.updateEnvSettings(payload);
      if (response?.data?.success) {
        toast.success("Environment variables saved successfully. Server config updated.");
        fetchSettings(); // Refresh to get correct statuses
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Groups for UI rendering
  const groups = {
    "Server & Database": ["PORT", "NODE_ENV", "MONGODB_URI", "SOCKET_CORS_ORIGIN", "FRONTEND_URL", "UPLOAD_PATH"],
    "Authentication (JWT)": ["JWT_ACCESS_SECRET", "JWT_ACCESS_EXPIRES", "JWT_REFRESH_SECRET", "JWT_REFRESH_EXPIRES", "BCRYPT_SALT_ROUNDS"],
    "Admin Auth": ["ADMIN_REGISTRATION_CODE", "ADMIN_NOTIFICATION_EMAILS", "PASSWORD_RESET_OTP_EXPIRY_MINUTES", "PASSWORD_RESET_MAX_ATTEMPTS", "PASSWORD_RESET_TOKEN_EXPIRY_MINUTES"],
    "Redis & Queues": ["REDIS_ENABLED", "REDIS_URL", "BULLMQ_ENABLED"],
    "Rate Limiting": ["RATE_LIMIT_WINDOW_MS", "RATE_LIMIT_WINDOW", "RATE_LIMIT_MAX"],
    "Email (SMTP)": ["EMAIL_HOST", "EMAIL_PORT", "EMAIL_USER", "EMAIL_PASS", "EMAIL_FROM"],
    "Payment (Razorpay)": ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"],
    "SMS & OTP (SMSWala)": ["USE_DEFAULT_OTP", "SMSWALA_API_URL", "SMSWALA_API_KEY", "SMSWALA_CAMPAIGN_ID", "SMSWALA_ROUTE_ID", "SMSWALA_SENDER_ID", "SMSWALA_TEMPLATE_ID", "SMSWALA_PE_ID", "OTP_EXPIRY_MINUTES", "OTP_EXPIRY_SECONDS", "OTP_MAX_ATTEMPTS", "OTP_RATE_LIMIT", "OTP_RATE_WINDOW", "OTP_EXPIRY"],
    "Cloudinary & Uploads": ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
    "Firebase": ["VITE_FIREBASE_DATABASE_URL", "FIREBASE_SERVICE_ACCOUNT"],
    "External APIs": ["GOOGLE_MAPS_API_KEY", "HUGGINGFACE_API_KEY"]
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Environment Managements</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage your environment variables safely. Values set here override the `.env` file. Data is encrypted in the database.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 font-medium transition-all shadow-lg shadow-primary/25"
        >
          {saving ? (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800 dark:text-blue-300">
          <p className="font-semibold mb-1">How it works:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Variables modified here are saved securely (encrypted) in the database.</li>
            <li>Database values always take priority over the <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded text-blue-900 dark:text-blue-200">.env</code> file.</li>
            <li>To revert to the <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded text-blue-900 dark:text-blue-200">.env</code> file value, click the "Reset" button to clear the database override.</li>
          </ul>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {Object.entries(groups).map(([groupName, keys]) => (
          <div key={groupName} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
            <div className="bg-gray-50/80 dark:bg-slate-800/80 px-6 py-4 border-b border-gray-100 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white">{groupName}</h2>
            </div>
            
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {keys.map((key) => {
                const setting = settings[key] || { value: "", isOverridden: false };
                
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate pr-2">
                        {key}
                      </label>
                      {setting.isOverridden && (
                        <span className="text-[10px] font-semibold tracking-wide bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          DB Override
                        </span>
                      )}
                    </div>
                    
                    <div className="relative">
                      <input
                        type={key.includes("SECRET") || key.includes("PASS") || key.includes("KEY") ? "password" : "text"}
                        value={setting.value || ""}
                        onChange={(e) => handleInputChange(key, e.target.value)}
                        placeholder="Fallback to .env"
                        className={`w-full px-3 py-2 border rounded-lg outline-none transition-all text-sm
                          ${setting.isOverridden 
                            ? "bg-orange-50/50 border-orange-200 focus:border-primary focus:ring-1 focus:ring-primary dark:bg-slate-900 dark:border-slate-600 dark:text-white" 
                            : "bg-gray-50 border-gray-200 focus:border-primary focus:ring-1 focus:ring-primary dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                          }
                        `}
                      />
                      {setting.isOverridden && (
                        <button
                          type="button"
                          onClick={() => handleResetToEnv(key)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-red-500 transition-colors tooltip-wrapper"
                          title="Clear DB override and use .env"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Add extra padding at bottom so button isn't completely hidden by footer */}
        <div className="h-10"></div>
      </form>
    </div>
  );
}
