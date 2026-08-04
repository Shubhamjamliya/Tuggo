import { logger } from '../../utils/logger.js';
import { notifyOwnersSafely } from '../../core/notifications/firebase.service.js';
import { sendVoipPushNotification } from '../../core/notifications/voip.service.js';

/**
 * Process notification jobs asynchronously.
 * @param {import('bullmq').Job} job
 */
export const processNotificationJob = async (job) => {
    logger.info(`Processing notification job ${job.id}`);
    const type = String(job?.data?.type || '').trim();

    if (type === 'admin-broadcast-delivery') {
        const targets = Array.isArray(job.data?.targets) ? job.data.targets : [];
        const payload = job.data?.payload && typeof job.data.payload === 'object' ? job.data.payload : {};
        const voipTokens = Array.isArray(job.data?.voipTokens) ? job.data.voipTokens : [];

        const [pushResults, voipResult] = await Promise.all([
            notifyOwnersSafely(targets, payload),
            voipTokens.length > 0
                ? sendVoipPushNotification(
                    voipTokens,
                    {
                        title: payload.title,
                        body: payload.body,
                        sound: 'default',
                        type: payload?.data?.type || 'admin_broadcast',
                        data: payload.data || {},
                    },
                    { ownerType: 'RESTAURANT' }
                )
                : Promise.resolve(null)
        ]);

        return {
            processed: true,
            jobId: job.id,
            type,
            pushTargetCount: targets.length,
            voipTokenCount: voipTokens.length,
            pushResultsCount: Array.isArray(pushResults) ? pushResults.length : 0,
            voipResult
        };
    }

    return { processed: true, jobId: job.id, type: type || 'unknown' };
};
