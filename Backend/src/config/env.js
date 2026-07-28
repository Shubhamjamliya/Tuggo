import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendEnvPath = path.resolve(__dirname, '../../.env');

dotenv.config();
dotenv.config({ path: backendEnvPath, override: false });

export const config = {
    // Basic server config
    port: process.env.PORT || 5000,
    socketPort: process.env.SOCKET_PORT || 5001,
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',

    // Database
    mongodbUri: process.env.MONGO_URI || process.env.MONGODB_URI,

    // JWT
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',

    // OTP
    otpExpiry: process.env.OTP_EXPIRY || '5m',
    otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
    otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES || 10),
    otpExpirySeconds: Number(process.env.OTP_EXPIRY_SECONDS || 300),
    otpRateLimit: Number(process.env.OTP_RATE_LIMIT || 3),
    otpRateWindow: Number(process.env.OTP_RATE_WINDOW || 600),
    useDefaultOtp: process.env.USE_DEFAULT_OTP === 'true',

    // MSG91
    msg91AuthKey: process.env.MSG91_AUTH_KEY,
    msg91TemplateId: process.env.MSG91_TEMPLATE_ID,

    // Rate limiting
    rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW || 15),
    rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX || 100),
    authRateLimitWindowMinutes: Number(process.env.AUTH_RATE_LIMIT_WINDOW || 15),
    authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),

    // Security
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),

    // Uploads
    uploadPath: process.env.UPLOAD_DIR || process.env.UPLOAD_PATH || 'uploads/',

    // Redis
    redisEnabled: process.env.REDIS_ENABLED === 'true',
    redisUrl: process.env.REDIS_URL,

    // BullMQ
    bullmqEnabled: process.env.BULLMQ_ENABLED === 'true',



    // Firebase / FCM
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
    firebaseDatabaseUrl: process.env.VITE_FIREBASE_DATABASE_URL,
    firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
    firebaseWebApiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
    firebaseWebAuthDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
    firebaseWebStorageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
    firebaseWebMessagingSenderId:
        process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
    firebaseWebAppId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
    firebaseWebMeasurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID,
    firebaseWebVapidKey: process.env.VITE_FIREBASE_VAPID_KEY || process.env.FIREBASE_VAPID_KEY,

    // Apple VoIP / APNs
    apnsVoipPfxPath: process.env.APNS_VOIP_PFX_PATH || process.env.APNS_VOIP_CERT_PATH,
    apnsVoipCertPassword: process.env.APNS_VOIP_CERT_PASSWORD || process.env.VOIP_CERT_PASSWORD,
    apnsVoipTopic: process.env.APNS_VOIP_TOPIC || process.env.APNS_TOPIC,
    apnsVoipTopicRestaurant: process.env.APNS_VOIP_TOPIC_RESTAURANT || process.env.APNS_TOPIC_RESTAURANT,
    apnsVoipTopicDelivery: process.env.APNS_VOIP_TOPIC_DELIVERY || process.env.APNS_TOPIC_DELIVERY,
    apnsProduction: process.env.APNS_PRODUCTION || 'true',

    // Socket.io
    socketCorsOrigin: process.env.SOCKET_CORS_ORIGIN || '*',

    // Razorpay (payments)
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET, // ✅ NEW

    // Email (SMTP) – for admin forgot password OTP etc.
    emailHost: process.env.EMAIL_HOST,
    emailPort: Number(process.env.EMAIL_PORT) || 587,
    emailUser: process.env.EMAIL_USER,
    emailPass: process.env.EMAIL_PASS ? String(process.env.EMAIL_PASS).replace(/\s/g, '') : '',
    emailFrom: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@example.com',



    // Google Maps
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY
};

export const updateConfig = () => {
    config.port = process.env.PORT || config.port;
    config.socketPort = process.env.SOCKET_PORT || config.socketPort;
    config.host = process.env.HOST || config.host;
    config.nodeEnv = process.env.NODE_ENV || config.nodeEnv;
    config.mongodbUri = process.env.MONGO_URI || process.env.MONGODB_URI || config.mongodbUri;
    config.jwtAccessSecret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || config.jwtAccessSecret;
    config.jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || config.jwtRefreshSecret;
    config.jwtAccessExpiresIn = process.env.JWT_ACCESS_EXPIRES || config.jwtAccessExpiresIn;
    config.jwtRefreshExpiresIn = process.env.JWT_REFRESH_EXPIRES || config.jwtRefreshExpiresIn;
    config.otpExpiry = process.env.OTP_EXPIRY || config.otpExpiry;
    config.otpMaxAttempts = Number(process.env.OTP_MAX_ATTEMPTS || config.otpMaxAttempts);
    config.otpExpiryMinutes = Number(process.env.OTP_EXPIRY_MINUTES || config.otpExpiryMinutes);
    config.otpExpirySeconds = Number(process.env.OTP_EXPIRY_SECONDS || config.otpExpirySeconds);
    config.otpRateLimit = Number(process.env.OTP_RATE_LIMIT || config.otpRateLimit);
    config.otpRateWindow = Number(process.env.OTP_RATE_WINDOW || config.otpRateWindow);
    config.useDefaultOtp = process.env.USE_DEFAULT_OTP === 'true';
    config.msg91AuthKey = process.env.MSG91_AUTH_KEY || config.msg91AuthKey;
    config.msg91TemplateId = process.env.MSG91_TEMPLATE_ID || config.msg91TemplateId;
    config.rateLimitWindowMinutes = Number(process.env.RATE_LIMIT_WINDOW || config.rateLimitWindowMinutes);
    config.rateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX || config.rateLimitMaxRequests);
    config.authRateLimitWindowMinutes = Number(process.env.AUTH_RATE_LIMIT_WINDOW || config.authRateLimitWindowMinutes);
    config.authRateLimitMax = Number(process.env.AUTH_RATE_LIMIT_MAX || config.authRateLimitMax);
    config.bcryptSaltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || config.bcryptSaltRounds);
    config.uploadPath = process.env.UPLOAD_DIR || process.env.UPLOAD_PATH || config.uploadPath;
    config.redisEnabled = process.env.REDIS_ENABLED === 'true';
    config.redisUrl = process.env.REDIS_URL || config.redisUrl;
    config.bullmqEnabled = process.env.BULLMQ_ENABLED === 'true';

    config.firebaseProjectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || config.firebaseProjectId;
    config.firebaseDatabaseUrl = process.env.VITE_FIREBASE_DATABASE_URL || config.firebaseDatabaseUrl;
    config.firebaseServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || config.firebaseServiceAccountPath;
    config.firebaseServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT || config.firebaseServiceAccount;
    config.firebaseWebApiKey = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || config.firebaseWebApiKey;
    config.firebaseWebAuthDomain = process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || config.firebaseWebAuthDomain;
    config.firebaseWebStorageBucket = process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || config.firebaseWebStorageBucket;
    config.firebaseWebMessagingSenderId = process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || config.firebaseWebMessagingSenderId;
    config.firebaseWebAppId = process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || config.firebaseWebAppId;
    config.firebaseWebMeasurementId = process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID || config.firebaseWebMeasurementId;
    config.firebaseWebVapidKey = process.env.VITE_FIREBASE_VAPID_KEY || process.env.FIREBASE_VAPID_KEY || config.firebaseWebVapidKey;
    config.apnsVoipPfxPath = process.env.APNS_VOIP_PFX_PATH || process.env.APNS_VOIP_CERT_PATH || config.apnsVoipPfxPath;
    config.apnsVoipCertPassword = process.env.APNS_VOIP_CERT_PASSWORD || process.env.VOIP_CERT_PASSWORD || config.apnsVoipCertPassword;
    config.apnsVoipTopic = process.env.APNS_VOIP_TOPIC || process.env.APNS_TOPIC || config.apnsVoipTopic;
    config.apnsVoipTopicRestaurant = process.env.APNS_VOIP_TOPIC_RESTAURANT || process.env.APNS_TOPIC_RESTAURANT || config.apnsVoipTopicRestaurant;
    config.apnsVoipTopicDelivery = process.env.APNS_VOIP_TOPIC_DELIVERY || process.env.APNS_TOPIC_DELIVERY || config.apnsVoipTopicDelivery;
    config.apnsProduction = process.env.APNS_PRODUCTION || config.apnsProduction;
    config.socketCorsOrigin = process.env.SOCKET_CORS_ORIGIN || config.socketCorsOrigin;
    config.razorpayKeyId = process.env.RAZORPAY_KEY_ID || config.razorpayKeyId;
    config.razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || config.razorpayKeySecret;
    config.razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || config.razorpayWebhookSecret;
    config.emailHost = process.env.EMAIL_HOST || config.emailHost;
    config.emailPort = Number(process.env.EMAIL_PORT) || config.emailPort;
    config.emailUser = process.env.EMAIL_USER || config.emailUser;
    config.emailPass = process.env.EMAIL_PASS ? String(process.env.EMAIL_PASS).replace(/\s/g, '') : config.emailPass;
    config.emailFrom = process.env.EMAIL_FROM || process.env.EMAIL_USER || config.emailFrom;
    config.petpoojaSyncEnabled = process.env.PETPOOJA_SYNC_ENABLED === 'true';
    config.petpoojaAppKey = process.env.PETPOOJA_APP_KEY || config.petpoojaAppKey;
    config.petpoojaAppSecret = process.env.PETPOOJA_APP_SECRET || config.petpoojaAppSecret;
    config.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || config.googleMapsApiKey;
};


