import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Clean and extract a 10-digit Indian mobile number.
 * @param {string|number} inputPhone
 * @returns {string|null} 10-digit phone string or null if invalid
 */
export function normalizeIndianPhoneNumber(inputPhone) {
    if (!inputPhone) return null;
    const digits = String(inputPhone).replace(/\D/g, '');

    // If starts with 91 and has 12 digits total
    if (digits.length === 12 && digits.startsWith('91')) {
        const last10 = digits.slice(2);
        return /^[6-9]\d{9}$/.test(last10) ? last10 : null;
    }

    // If starts with 0 and has 11 digits total
    if (digits.length === 11 && digits.startsWith('0')) {
        const last10 = digits.slice(1);
        return /^[6-9]\d{9}$/.test(last10) ? last10 : null;
    }

    // Direct 10 digits
    if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
        return digits;
    }

    return null;
}

/**
 * Trigger an OBD (Outbound Dialer) voice call to a phone number.
 * @param {object} params
 * @param {string} params.phoneNumber - Restaurant phone number
 * @param {string} [params.voiceFile] - Optional custom voicefile name (.wav)
 * @param {object} [params.meta] - Optional tracking metadata (e.g. orderId, orderMongoId, attempt)
 * @returns {Promise<{ success: boolean, statusCode?: number, response?: any, error?: string, msisdn?: string }>}
 */
export async function triggerObdVoiceCall({ phoneNumber, voiceFile = null, meta = {} }) {
    const cleanPhone = normalizeIndianPhoneNumber(phoneNumber);
    if (!cleanPhone) {
        logger.warn(`[OBD] Invalid phone number provided for call alert: "${phoneNumber}" meta=${JSON.stringify(meta)}`);
        return {
            success: false,
            error: `Invalid 10-digit phone number: "${phoneNumber}"`,
            msisdn: phoneNumber
        };
    }

    const {
        apiUrl,
        ukey,
        serviceno,
        voicefile: defaultVoiceFile,
        sourcetype,
        campaigntype,
        filetype,
        ivrtemplateid,
        retryduration,
        dtmflength,
        waitduration
    } = config.obd;

    if (!apiUrl || !ukey || !serviceno) {
        logger.error('[OBD] Missing OBD configuration (apiUrl, ukey, or serviceno in env)');
        return {
            success: false,
            error: 'OBD configuration incomplete on server',
            msisdn: cleanPhone
        };
    }

    const payload = {
        sourcetype: String(sourcetype ?? '0'),
        campaigntype: String(campaigntype ?? '4'),
        filetype: String(filetype ?? '2'),
        voicefile: String(voiceFile || defaultVoiceFile || 'Ravi.wav'),
        ukey: String(ukey),
        serviceno: String(serviceno),
        ivrtemplateid: String(ivrtemplateid ?? '1'),
        retryduration: Number(retryduration ?? 0),
        dtmflength: String(dtmflength ?? '1'),
        waitduration: String(waitduration ?? '5'),
        msisdn: [cleanPhone]
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
        logger.info(`[OBD] Initiating call to ${cleanPhone} (voicefile: ${payload.voicefile}) meta=${JSON.stringify(meta)}`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        let parsedBody;
        const text = await response.text();
        try {
            parsedBody = JSON.parse(text);
        } catch {
            parsedBody = text;
        }

        const isSuccessStatus = response.ok && (
            (typeof parsedBody === 'object' && parsedBody !== null && (parsedBody.status === 'success' || parsedBody.status === '1' || parsedBody.code === 200 || !parsedBody.error)) ||
            (typeof parsedBody === 'string' && !/error|invalid|failed|unauthorized/i.test(parsedBody))
        );

        logger.info(`[OBD] Gateway response for ${cleanPhone} [HTTP ${response.status}]: ${typeof parsedBody === 'object' ? JSON.stringify(parsedBody) : parsedBody}`);

        return {
            success: isSuccessStatus,
            statusCode: response.status,
            response: parsedBody,
            msisdn: cleanPhone
        };
    } catch (err) {
        clearTimeout(timeoutId);
        const isTimeout = err?.name === 'AbortError';
        const errMsg = isTimeout ? 'OBD gateway request timed out (8s)' : err.message;
        logger.error(`[OBD] Failed to dial ${cleanPhone}: ${errMsg}`);
        return {
            success: false,
            error: errMsg,
            msisdn: cleanPhone
        };
    }
}
