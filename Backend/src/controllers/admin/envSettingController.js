import EnvSetting from '../../models/EnvSetting.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { updateConfig } from '../../config/env.js';

// Define which keys are allowed to be managed via DB
export const ALLOWED_ENV_KEYS = [
    'PORT', 'NODE_ENV', 'MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_ACCESS_EXPIRES',
    'JWT_REFRESH_SECRET', 'JWT_REFRESH_EXPIRES', 'FRONTEND_URL', 'REDIS_ENABLED',
    'REDIS_URL', 'BULLMQ_ENABLED', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_WINDOW',
    'RATE_LIMIT_MAX', 'BCRYPT_SALT_ROUNDS', 'UPLOAD_PATH', 'HUGGINGFACE_API_KEY',
    'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_FROM',
    'GOOGLE_MAPS_API_KEY', 'ADMIN_REGISTRATION_CODE', 'ADMIN_NOTIFICATION_EMAILS',
    'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
    'PASSWORD_RESET_OTP_EXPIRY_MINUTES', 'PASSWORD_RESET_MAX_ATTEMPTS',
    'PASSWORD_RESET_TOKEN_EXPIRY_MINUTES', 'SOCKET_CORS_ORIGIN',
    'VITE_FIREBASE_DATABASE_URL', 'FIREBASE_SERVICE_ACCOUNT',
    'USE_DEFAULT_OTP', 'SMSWALA_API_URL', 'SMSWALA_API_KEY',
    'SMSWALA_CAMPAIGN_ID', 'SMSWALA_ROUTE_ID', 'SMSWALA_SENDER_ID',
    'SMSWALA_TEMPLATE_ID', 'SMSWALA_PE_ID',
    'OTP_EXPIRY_MINUTES', 'OTP_EXPIRY_SECONDS', 'OTP_MAX_ATTEMPTS',
    'OTP_RATE_LIMIT', 'OTP_RATE_WINDOW', 'OTP_EXPIRY'
];

export const getAllEnvSettings = async (req, res) => {
    try {
        const settings = await EnvSetting.find({});
        const settingsMap = {};
        
        settings.forEach(setting => {
            if (setting.value !== undefined && setting.value !== null) {
                settingsMap[setting.key] = setting.isEncrypted ? decrypt(setting.value) : setting.value;
            }
        });

        // Merge with process.env for keys that don't exist in DB yet
        const result = {};
        ALLOWED_ENV_KEYS.forEach(key => {
            // Priority: DB value > process.env value
            const dbValue = settingsMap[key];
            const envValue = process.env[key];
            
            result[key] = {
                value: dbValue !== undefined ? dbValue : (envValue || ''),
                isOverridden: dbValue !== undefined
            };
        });

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateEnvSettings = async (req, res) => {
    try {
        const updates = req.body;
        
        for (const [key, value] of Object.entries(updates)) {
            if (ALLOWED_ENV_KEYS.includes(key)) {
                if (value === null || value === undefined || value === '') {
                    // If empty, remove from DB to fallback to .env file
                    await EnvSetting.deleteOne({ key });
                } else {
                    const encryptedValue = encrypt(String(value));
                    await EnvSetting.findOneAndUpdate(
                        { key },
                        { value: encryptedValue, isEncrypted: true },
                        { upsert: true, new: true }
                    );
                    // Update in-memory process.env so it reflects immediately
                    process.env[key] = String(value);
                }
            }
        }
        
        // Update the app config object
        updateConfig();
        
        res.status(200).json({ success: true, message: 'Environment settings updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
