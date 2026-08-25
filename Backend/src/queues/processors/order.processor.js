import { logger } from '../../utils/logger.js';
import { connectDB } from '../../config/db.js';

let isDBConnected = false;

async function ensureDB() {
    if (isDBConnected) return;
    await connectDB();
    isDBConnected = true;
}

/**
 * BullMQ processor for order lifecycle jobs.
 *
 * Current implementation is intentionally logging-only to avoid changing API behavior.
 * @param {import('bullmq').Job} job
 */
export const processOrderJob = async (job) => {
    await ensureDB();

    const data = job?.data || {};
    const action = data.action || 'unknown';
    const orderId = data.orderId || '';
    const orderMongoId = data.orderMongoId || '';

    logger.info(
        `[BullMQ:order] action=${action} jobId=${job.id} orderId=${orderId} orderMongoId=${orderMongoId}`
    );

    // Handle Smart Dispatch Timeout
    if (action === 'DISPATCH_TIMEOUT_CHECK') {
        try {
            const { processDispatchTimeout } = await import('../../modules/food/orders/services/order.service.js');
            // Pass full data object to allow attempt count and other options
            await processDispatchTimeout(orderMongoId, data.partnerId, data);
        } catch (err) {
            logger.error(`[BullMQ:order] DISPATCH_TIMEOUT_CHECK failed: ${err.message}`);
        }
    }

    if (action === 'RESTAURANT_RESPONSE_DELAY_ALERT') {
        try {
            const { processRestaurantResponseDelayAlert } = await import('../../modules/food/admin/services/restaurantDelayAlert.service.js');
            await processRestaurantResponseDelayAlert(orderMongoId, data.configuredDelayMinutes);
        } catch (err) {
            logger.error(`[BullMQ:order] RESTAURANT_RESPONSE_DELAY_ALERT failed: ${err.message}`);
        }
    }



    return { processed: true, action, jobId: job.id };
};
