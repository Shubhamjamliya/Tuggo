import { config } from '../../../../config/env.js';
import EnvSetting from '../../../../models/EnvSetting.js';
import { decrypt } from '../../../../utils/encryption.js';

const sanitize = (value) => (value ? String(value).trim().replace(/^['"]|['"]$/g, '') : '');

async function resolveGoogleMapsKey() {
    const fromConfig =
        sanitize(config.googleMapsApiKey) ||
        sanitize(process.env.VITE_GOOGLE_MAPS_API_KEY) ||
        sanitize(process.env.GOOGLE_MAPS_API_KEY);

    if (fromConfig) return fromConfig;

    try {
        const setting = await EnvSetting.findOne({ key: 'GOOGLE_MAPS_API_KEY' }).lean();
        if (setting?.value) {
            const raw = setting.isEncrypted ? decrypt(setting.value) : String(setting.value);
            const key = sanitize(raw);
            if (key) return key;
        }
    } catch {
        /* fall through */
    }

    return '';
}

/**
 * Public environment variables for frontend runtime.
 * IMPORTANT: Only expose non-secret keys safe for clients.
 */
export const getPublicEnvController = async (_req, res, next) => {
    try {
        const googleMapsKey = await resolveGoogleMapsKey();
        const firebaseApiKey = sanitize(config.firebaseWebApiKey);
        const firebaseAuthDomain = sanitize(config.firebaseWebAuthDomain);
        const firebaseProjectId = sanitize(config.firebaseProjectId);
        const firebaseStorageBucket = sanitize(config.firebaseWebStorageBucket);
        const firebaseMessagingSenderId = sanitize(config.firebaseWebMessagingSenderId);
        const firebaseAppId = sanitize(config.firebaseWebAppId);
        const firebaseMeasurementId = sanitize(config.firebaseWebMeasurementId);
        const firebaseVapidKey = sanitize(config.firebaseWebVapidKey);

        return res.status(200).json({
            success: true,
            message: 'Public environment variables fetched',
            data: {
                VITE_GOOGLE_MAPS_API_KEY: googleMapsKey || '',
                GOOGLE_MAPS_API_KEY: googleMapsKey || '',
                VITE_FIREBASE_API_KEY: firebaseApiKey,
                VITE_FIREBASE_AUTH_DOMAIN: firebaseAuthDomain,
                VITE_FIREBASE_PROJECT_ID: firebaseProjectId,
                VITE_FIREBASE_STORAGE_BUCKET: firebaseStorageBucket,
                VITE_FIREBASE_MESSAGING_SENDER_ID: firebaseMessagingSenderId,
                VITE_FIREBASE_APP_ID: firebaseAppId,
                VITE_FIREBASE_MEASUREMENT_ID: firebaseMeasurementId,
                VITE_FIREBASE_VAPID_KEY: firebaseVapidKey,
                FIREBASE_API_KEY: firebaseApiKey,
                FIREBASE_AUTH_DOMAIN: firebaseAuthDomain,
                FIREBASE_PROJECT_ID: firebaseProjectId,
                FIREBASE_STORAGE_BUCKET: firebaseStorageBucket,
                FIREBASE_MESSAGING_SENDER_ID: firebaseMessagingSenderId,
                FIREBASE_APP_ID: firebaseAppId,
                FIREBASE_MEASUREMENT_ID: firebaseMeasurementId,
                FIREBASE_VAPID_KEY: firebaseVapidKey,
                NODE_ENV: config.nodeEnv || 'development'
            }
        });
    } catch (error) {
        next(error);
    }
};

