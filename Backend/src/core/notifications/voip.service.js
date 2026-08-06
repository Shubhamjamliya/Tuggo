import { existsSync, readFileSync } from 'fs';
import http2 from 'http2';
import jwt from 'jsonwebtoken';
import { resolve } from 'path';
import { FoodUser } from '../users/user.model.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';
import { FoodAdmin } from '../admin/admin.model.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { sendPushNotification } from './firebase.service.js';

const OWNER_MODELS = {
    USER: FoodUser,
    RESTAURANT: FoodRestaurant,
    DELIVERY_PARTNER: FoodDeliveryPartner,
    ADMIN: FoodAdmin,
};

const APNS_AUTHORITY = {
    production: 'https://api.push.apple.com',
    sandbox: 'https://api.sandbox.push.apple.com',
};

let cachedApnsClient = null;
let cachedApnsClientMode = null;

const sanitizeString = (value) => String(value ?? '').trim().replace(/^["']|["']$/g, '');

const getOwnerModel = (ownerType) => OWNER_MODELS[String(ownerType || '').trim().toUpperCase()] || null;

const normalizeTokenList = (tokens = []) => {
    const normalized = [...new Set((Array.isArray(tokens) ? tokens : [tokens]).map(sanitizeString).filter(Boolean))];
    return normalized.slice(-20);
};

const normalizeVoipTopic = (topic) => {
    const normalized = sanitizeString(topic);
    if (!normalized) return '';
    return normalized.endsWith('.voip') ? normalized : `${normalized}.voip`;
};

const getVoipTopic = (ownerType) => {
    const normalizedOwnerType = String(ownerType || '').trim().toUpperCase();
    const baseTopic = normalizedOwnerType === 'RESTAURANT'
        ? sanitizeString(config.apnsVoipTopicRestaurant || process.env.APNS_VOIP_TOPIC_RESTAURANT || process.env.APNS_TOPIC_RESTAURANT)
        : normalizedOwnerType === 'DELIVERY_PARTNER'
            ? sanitizeString(config.apnsVoipTopicDelivery || process.env.APNS_VOIP_TOPIC_DELIVERY || process.env.APNS_TOPIC_DELIVERY)
            : '';

    const fallbackTopic = sanitizeString(config.apnsVoipTopic || process.env.APNS_VOIP_TOPIC || process.env.APNS_TOPIC);
    const resolvedTopic = normalizeVoipTopic(baseTopic || fallbackTopic);
    if (!resolvedTopic) {
        throw new Error(`APNS VoIP topic is not configured for ${normalizedOwnerType || 'UNKNOWN'} and no fallback APNS_VOIP_TOPIC is set.`);
    }
    return resolvedTopic;
};

const getApnsAuthority = () => {
    const useProduction = String(config.apnsProduction ?? process.env.APNS_PRODUCTION ?? 'true').toLowerCase() === 'true';
    return useProduction ? APNS_AUTHORITY.production : APNS_AUTHORITY.sandbox;
};

let apnsJwtToken = null;
let apnsJwtTokenExpiry = 0;

const getApnsJwtToken = () => {
    const now = Math.floor(Date.now() / 1000);
    if (apnsJwtToken && apnsJwtTokenExpiry > now) {
        return apnsJwtToken;
    }

    const teamId = sanitizeString(process.env.APNS_TEAM_ID);
    const keyId = sanitizeString(process.env.APNS_KEY_ID);
    const keyPathValue = sanitizeString(process.env.APNS_VOIP_P8_PATH || process.env.APNS_AUTH_KEY_PATH);

    if (!teamId || !keyId || !keyPathValue) {
        throw new Error('APNS_TEAM_ID, APNS_KEY_ID, and APNS_VOIP_P8_PATH must be set in .env for token-based APNs.');
    }

    // Try absolute path first, then relative to cwd, then relative stripping "Backend"
    const candidatePaths = [
        keyPathValue,
        resolve(process.cwd(), keyPathValue),
        resolve(process.cwd(), keyPathValue.replace(/^Backend[\\/]/i, ''))
    ];
    const keyPath = candidatePaths.find((candidate) => existsSync(candidate));
    if (!keyPath) {
        throw new Error(`APNS Auth Key (.p8) not found. Tried: ${candidatePaths.join(', ')}`);
    }

    const privateKey = readFileSync(keyPath, 'utf8');

    apnsJwtToken = jwt.sign(
        {
            iss: teamId,
            iat: now,
        },
        privateKey,
        {
            algorithm: 'ES256',
            header: {
                alg: 'ES256',
                kid: keyId,
            },
        }
    );
    apnsJwtTokenExpiry = now + 3000; // valid for 50 mins
    return apnsJwtToken;
};

const getApnsClient = () => {
    const authority = getApnsAuthority();
    if (cachedApnsClient && cachedApnsClientMode === authority) {
        return cachedApnsClient;
    }

    const client = http2.connect(authority);
    client.on('error', (error) => {
        logger.warn(`APNS VoIP client error: ${error?.message || error}`);
    });
    client.on('close', () => {
        if (cachedApnsClient === client) {
            cachedApnsClient = null;
            cachedApnsClientMode = null;
        }
    });

    cachedApnsClient = client;
    cachedApnsClientMode = authority;
    return client;
};

const parsePushDevices = (doc) => (Array.isArray(doc?.pushDevices) ? doc.pushDevices : []);

export const logVoipConfigurationWarnings = () => {
    const restaurantTopic = normalizeVoipTopic(config.apnsVoipTopicRestaurant || process.env.APNS_VOIP_TOPIC_RESTAURANT || process.env.APNS_TOPIC_RESTAURANT);
    const deliveryTopic = normalizeVoipTopic(config.apnsVoipTopicDelivery || process.env.APNS_VOIP_TOPIC_DELIVERY || process.env.APNS_TOPIC_DELIVERY);
    const fallbackTopic = normalizeVoipTopic(config.apnsVoipTopic || process.env.APNS_VOIP_TOPIC || process.env.APNS_TOPIC);

    if (!restaurantTopic && !fallbackTopic) {
        logger.warn('[VoIP] Restaurant topic is missing. Set APNS_VOIP_TOPIC_RESTAURANT for the restaurant wrapper or APNS_VOIP_TOPIC as fallback.');
    }

    if (!deliveryTopic && !fallbackTopic) {
        logger.warn('[VoIP] Delivery topic is missing. Set APNS_VOIP_TOPIC_DELIVERY for the delivery wrapper or APNS_VOIP_TOPIC as fallback.');
    }

    if (restaurantTopic || deliveryTopic || fallbackTopic) {
        logger.info(`[VoIP] APNs topic readiness: restaurant=${restaurantTopic || fallbackTopic || 'missing'} delivery=${deliveryTopic || fallbackTopic || 'missing'} user=optional`);
    }
};

export const listOwnerUrgentPushTargets = async ({ ownerType, ownerId } = {}) => {
    if (!ownerType || !ownerId) return { iosVoipTokens: [], fcmTokens: [] };
    const model = getOwnerModel(ownerType);
    if (!model) return { iosVoipTokens: [], fcmTokens: [] };

    const doc = await model.findById(ownerId).select('pushDevices fcmTokens fcmTokenMobile').lean();
    if (!doc) return { iosVoipTokens: [], fcmTokens: [] };

    const pushDevices = parsePushDevices(doc);
    const iosVoipTokens = normalizeTokenList(
        pushDevices
            .filter((device) => device?.devicePlatform === 'ios' && device?.pushPlatform === 'mobile')
            .map((device) => device?.voipToken)
    );

    const iosFcmTokens = normalizeTokenList(
        pushDevices
            .filter((device) => device?.devicePlatform === 'ios' && device?.fcmToken)
            .map((device) => device?.fcmToken)
    );

    const androidFcmTokens = normalizeTokenList(
        pushDevices
            .filter((device) => device?.devicePlatform !== 'ios' && device?.fcmToken)
            .map((device) => device?.fcmToken)
    );

    logger.info(`[VoIP-Trace] Fetched DB tokens for ${ownerType}:${ownerId} -> VoIP(iOS): ${iosVoipTokens.length}, FCM(iOS): ${iosFcmTokens.length}, FCM(Android): ${androidFcmTokens.length}`);

    if (pushDevices.length > 0) {
        return { iosVoipTokens, iosFcmTokens, androidFcmTokens, fcmTokens: [] };
    }

    const legacyFcmTokens = normalizeTokenList([
        ...(Array.isArray(doc.fcmTokens) ? doc.fcmTokens : []),
        ...(Array.isArray(doc.fcmTokenMobile) ? doc.fcmTokenMobile : []),
    ]);
    return { iosVoipTokens, iosFcmTokens: [], androidFcmTokens: [], fcmTokens: legacyFcmTokens };
};

export const sendVoipPushNotification = async (tokens, payload = {}, options = {}) => {
    const uniqueTokens = normalizeTokenList(tokens);
    if (!uniqueTokens.length) {
        return { successCount: 0, failureCount: 0, results: [] };
    }

    const client = getApnsClient();
    const topic = getVoipTopic(options.ownerType);
    
    logger.info(`[VoIP-Trace] Preparing to send VoIP to ${uniqueTokens.length} devices for ${options.ownerType}. Topic: ${topic}, Env: ${getApnsAuthority()}`);
    
    const apsAlertTitle = sanitizeString(payload.title || payload.notification?.title || 'New order request');
    const apsAlertBody = sanitizeString(payload.body || payload.notification?.body || 'You have a new order request.');
    const bodyPayload = {
        aps: {
            alert: {
                title: apsAlertTitle,
                body: apsAlertBody,
            },
            sound: payload.sound || 'default',
            'content-available': 1,
        },
        ...((payload.data && typeof payload.data === 'object') ? payload.data : {}),
        type: sanitizeString(payload.type || payload.data?.type || 'voip_ring'),
        title: apsAlertTitle,
        body: apsAlertBody,
    };

    const results = await Promise.all(uniqueTokens.map((token) => new Promise((resolveResult) => {
        const req = client.request({
            ':method': 'POST',
            ':path': `/3/device/${token}`,
            'apns-topic': topic,
            'apns-push-type': 'voip',
            'apns-priority': '10',
            'content-type': 'application/json',
            'authorization': `bearer ${getApnsJwtToken()}`,
        });

        let responseBody = '';
        let statusCode = 0;

        req.setEncoding('utf8');
        req.on('response', (headers) => {
            statusCode = Number(headers[':status'] || 0);
        });
        req.on('data', (chunk) => {
            responseBody += chunk;
        });
        req.on('end', () => {
            if (statusCode >= 200 && statusCode < 300) {
                logger.info(`[VoIP-Trace] Apple APNs Success [${statusCode}] for token ...${token.slice(-6)}`);
                resolveResult({ token, ok: true, response: responseBody || 'ok' });
                return;
            }
            logger.warn(`[VoIP-Trace] Apple APNs Rejected [${statusCode}] for token ...${token.slice(-6)}. Response: ${responseBody}`);
            resolveResult({
                token,
                ok: false,
                remove: statusCode === 400 || statusCode === 410,
                error: responseBody || `APNS send failed (${statusCode || 'unknown'})`,
            });
        });
        req.on('error', (error) => {
            resolveResult({ token, ok: false, remove: false, error: error?.message || String(error) });
        });
        req.end(JSON.stringify(bodyPayload));
    })));

    const successCount = results.filter((result) => result.ok).length;
    const failureCount = results.length - successCount;
    logger.info(`[VoIP-Trace] VoIP Batch Complete: ${successCount} succeeded, ${failureCount} failed.`);
    return { successCount, failureCount, results };
};

export const sendVoipNotificationToOwner = async ({ ownerType, ownerId, payload } = {}) => {
    const { iosVoipTokens } = await listOwnerUrgentPushTargets({ ownerType, ownerId });

    if (!iosVoipTokens.length) {
        return {
            voip: {
                successCount: 0,
                failureCount: 0,
                results: [],
                skipped: true,
                reason: 'No iOS VoIP tokens registered for this account.',
            },
        };
    }

    return {
        voip: await sendVoipPushNotification(iosVoipTokens, payload, { ownerType }),
    };
};

export const sendUrgentOrderNotificationToOwner = async ({ ownerType, ownerId, payload } = {}) => {
    const { iosVoipTokens, iosFcmTokens, androidFcmTokens, fcmTokens } = await listOwnerUrgentPushTargets({ ownerType, ownerId });
    const responses = {
        voip: { successCount: 0, failureCount: 0, results: [] },
        iosFcm: { successCount: 0, failureCount: 0, results: [] },
        fcm: { successCount: 0, failureCount: 0, results: [] },
    };

    logger.info(`[VoIP-Trace] Initiating Urgent Push for ${ownerType}:${ownerId}`);

    if (iosVoipTokens.length > 0) {
        try {
            responses.voip = await sendVoipPushNotification(iosVoipTokens, payload, { ownerType });
        } catch (error) {
            logger.warn(`VoIP push failed for ${ownerType}:${ownerId} - ${error?.message || error}`);
        }
    }

    /* 
    if (iosFcmTokens && iosFcmTokens.length > 0) {
        try {
            // iOS drops `dataOnly: true` (background pushes) when app is killed. 
            // We force `dataOnly: false` so it shows up natively in the Notification Center!
            responses.iosFcm = await sendPushNotification(iosFcmTokens, { ...payload, dataOnly: false });
        } catch (error) {
            logger.warn(`iOS FCM fallback failed for ${ownerType}:${ownerId} - ${error?.message || error}`);
        }
    }
    */

    const standardFcmTokens = androidFcmTokens && androidFcmTokens.length > 0 ? androidFcmTokens : fcmTokens;
    if (standardFcmTokens && standardFcmTokens.length > 0) {
        try {
            // Android uses the original payload (usually dataOnly: true for SW interception)
            responses.fcm = await sendPushNotification(standardFcmTokens, payload);
        } catch (error) {
            logger.warn(`Android FCM fallback failed for ${ownerType}:${ownerId} - ${error?.message || error}`);
        }
    }

    return responses;
};

export const sendUrgentOrderNotificationsToOwners = async (targets = [], payload = {}) => {
    const results = [];
    for (const target of Array.isArray(targets) ? targets : []) {
        if (!target?.ownerType || !target?.ownerId) continue;
        results.push(await sendUrgentOrderNotificationToOwner({ ownerType: target.ownerType, ownerId: target.ownerId, payload }));
    }
    return results;
};


