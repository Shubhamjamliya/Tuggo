import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurantDelayAlertSettings } from '../../admin/models/restaurantDelayAlertSettings.model.js';
import { triggerObdVoiceCall } from '../../../../services/obd.service.js';
import { autoCancelUnresponsiveOrder } from './order.service.js';
import { config } from '../../../../config/env.js';
import { logger } from '../../../../utils/logger.js';

let isPollingActive = false;

/**
 * Get active OBD call alert configuration from database with fallbacks.
 */
export async function getCallAlertConfig() {
    try {
        const settings = await FoodRestaurantDelayAlertSettings.findOne({ key: 'global' }).lean();
        const obd = settings?.obdCallAlert;

        return {
            enabled: obd?.enabled !== undefined ? Boolean(obd.enabled) : true,
            delayMinutes: Math.max(1, Number(obd?.delayMinutes || 3)),
            escalationDelaySeconds: Math.max(30, Number(obd?.escalationDelaySeconds || 90)),
            voiceFile: String(obd?.voiceFile || config.obd?.voicefile || 'Ravi.wav').trim(),
            autoCancelEnabled: obd?.autoCancelEnabled !== undefined ? Boolean(obd.autoCancelEnabled) : true,
            autoCancelDelaySeconds: Math.max(30, Number(obd?.autoCancelDelaySeconds || 90))
        };
    } catch (err) {
        logger.error(`[CallAlert] Error reading call alert config: ${err.message}`);
        return {
            enabled: true,
            delayMinutes: 3,
            escalationDelaySeconds: 90,
            voiceFile: config.obd?.voicefile || 'Ravi.wav',
            autoCancelEnabled: true,
            autoCancelDelaySeconds: 90
        };
    }
}

/**
 * Poll database for unaccepted orders and trigger primary/secondary calls.
 * Runs atomically every 30 seconds to ensure zero duplicate calls.
 */
export async function pollAndTriggerRestaurantCallAlerts() {
    if (isPollingActive) {
        logger.debug('[CallAlert] Previous polling run still in progress, skipping cycle');
        return { status: 'busy' };
    }

    isPollingActive = true;
    const stats = { primaryCalls: 0, secondaryCalls: 0, skipped: 0 };

    try {
        const alertConfig = await getCallAlertConfig();
        if (!alertConfig.enabled) {
            return { status: 'disabled' };
        }

        const now = Date.now();
        const primaryCutoff = new Date(now - alertConfig.delayMinutes * 60 * 1000);
        const escalationCutoff = new Date(now - alertConfig.escalationDelaySeconds * 1000);
        // Do not call for orders older than 2 hours (safety margin)
        const safetyMinDate = new Date(now - 2 * 60 * 60 * 1000);

        // ==========================================
        // 1. PRIMARY CALLS (First Number)
        // ==========================================
        const unacceptedOrders = await FoodOrder.find({
            orderStatus: 'created',
            createdAt: { $lte: primaryCutoff, $gte: safetyMinDate },
            'callAlert.primaryCallStatus': { $in: [null, 'none'] }
        })
            .select('_id order_id orderId restaurantId createdAt callAlert')
            .limit(10)
            .lean();

        for (const order of unacceptedOrders) {
            // Atomic lock claiming this order for primary call
            const claimed = await FoodOrder.findOneAndUpdate(
                {
                    _id: order._id,
                    orderStatus: 'created',
                    'callAlert.primaryCallStatus': { $in: [null, 'none'] }
                },
                {
                    $set: {
                        'callAlert.primaryCallStatus': 'in_progress',
                        'callAlert.primaryCalledAt': new Date()
                    }
                },
                { new: true }
            ).populate('restaurantId', 'restaurantName primaryContactNumber ownerPhone secondaryContactNumber');

            if (!claimed) continue; // Concurrently claimed or order status changed

            const restaurant = claimed.restaurantId;
            const primaryPhone = restaurant?.primaryContactNumber || restaurant?.ownerPhone;

            if (!primaryPhone) {
                logger.warn(`[CallAlert] Restaurant "${restaurant?.restaurantName}" has no phone for order ${claimed.order_id || claimed._id}`);
                await FoodOrder.updateOne(
                    { _id: claimed._id },
                    {
                        $set: {
                            'callAlert.primaryCallStatus': 'skipped',
                            'callAlert.primaryCampaignResponse': { error: 'No phone number available' }
                        }
                    }
                );
                stats.skipped++;
                continue;
            }

            const callResult = await triggerObdVoiceCall({
                phoneNumber: primaryPhone,
                voiceFile: alertConfig.voiceFile,
                meta: {
                    orderId: claimed.order_id || claimed.orderId,
                    orderMongoId: String(claimed._id),
                    restaurantId: String(restaurant?._id || ''),
                    attempt: 'primary'
                }
            });

            await FoodOrder.updateOne(
                { _id: claimed._id },
                {
                    $set: {
                        'callAlert.primaryCallStatus': callResult.success ? 'completed' : 'failed',
                        'callAlert.primaryPhoneNumber': callResult.msisdn || primaryPhone,
                        'callAlert.primaryCampaignResponse': callResult.response || { error: callResult.error }
                    }
                }
            );

            stats.primaryCalls++;
            logger.info(`[CallAlert] Primary call dispatched for order #${claimed.order_id || claimed._id} to ${primaryPhone} (Success: ${callResult.success})`);
        }

        // ==========================================
        // 2. SECONDARY ESCALATION CALLS (Second Number)
        // ==========================================
        const ordersForEscalation = await FoodOrder.find({
            orderStatus: 'created',
            'callAlert.primaryCallStatus': 'completed',
            'callAlert.primaryCalledAt': { $lte: escalationCutoff, $gte: safetyMinDate },
            'callAlert.secondaryCallStatus': { $in: [null, 'none'] }
        })
            .select('_id order_id orderId restaurantId createdAt callAlert')
            .limit(10)
            .lean();

        for (const order of ordersForEscalation) {
            // Atomic lock claiming this order for secondary call
            const claimed = await FoodOrder.findOneAndUpdate(
                {
                    _id: order._id,
                    orderStatus: 'created',
                    'callAlert.primaryCallStatus': 'completed',
                    'callAlert.secondaryCallStatus': { $in: [null, 'none'] }
                },
                {
                    $set: {
                        'callAlert.secondaryCallStatus': 'in_progress',
                        'callAlert.secondaryCalledAt': new Date()
                    }
                },
                { new: true }
            ).populate('restaurantId', 'restaurantName primaryContactNumber ownerPhone secondaryContactNumber');

            if (!claimed) continue; // Order was accepted or claimed

            const restaurant = claimed.restaurantId;
            const primaryUsed = claimed.callAlert?.primaryPhoneNumber;

            // Resolve secondary phone: explicit secondaryContactNumber or ownerPhone (if different)
            let secondaryPhone = restaurant?.secondaryContactNumber;
            if (!secondaryPhone && restaurant?.ownerPhone && restaurant.ownerPhone !== primaryUsed) {
                secondaryPhone = restaurant.ownerPhone;
            }

            if (!secondaryPhone || secondaryPhone === primaryUsed) {
                logger.info(`[CallAlert] No alternate/secondary number available for order ${claimed.order_id || claimed._id}. Skipping secondary call.`);
                await FoodOrder.updateOne(
                    { _id: claimed._id },
                    {
                        $set: {
                            'callAlert.secondaryCallStatus': 'skipped',
                            'callAlert.secondaryCampaignResponse': { note: 'No alternate secondary number found' }
                        }
                    }
                );
                stats.skipped++;
                continue;
            }

            const callResult = await triggerObdVoiceCall({
                phoneNumber: secondaryPhone,
                voiceFile: alertConfig.voiceFile,
                meta: {
                    orderId: claimed.order_id || claimed.orderId,
                    orderMongoId: String(claimed._id),
                    restaurantId: String(restaurant?._id || ''),
                    attempt: 'secondary'
                }
            });

            await FoodOrder.updateOne(
                { _id: claimed._id },
                {
                    $set: {
                        'callAlert.secondaryCallStatus': callResult.success ? 'completed' : 'failed',
                        'callAlert.secondaryPhoneNumber': callResult.msisdn || secondaryPhone,
                        'callAlert.secondaryCampaignResponse': callResult.response || { error: callResult.error }
                    }
                }
            );

            stats.secondaryCalls++;
            logger.info(`[CallAlert] Secondary escalation call dispatched for order #${claimed.order_id || claimed._id} to ${secondaryPhone} (Success: ${callResult.success})`);
        }

        // ==========================================
        // 3. AUTO-CANCELLATION (When Restaurant does not pickup/accept after Call 2)
        // ==========================================
        if (alertConfig.autoCancelEnabled) {
            const autoCancelCutoff = new Date(now - alertConfig.autoCancelDelaySeconds * 1000);

            const ordersForAutoCancel = await FoodOrder.find({
                orderStatus: 'created',
                'callAlert.secondaryCallStatus': { $in: ['completed', 'failed', 'skipped'] },
                'callAlert.secondaryCalledAt': { $lte: autoCancelCutoff, $gte: safetyMinDate },
                'callAlert.autoCancelStatus': { $in: [null, 'none'] }
            })
                .select('_id order_id orderId restaurantId createdAt callAlert')
                .limit(10)
                .lean();

            for (const order of ordersForAutoCancel) {
                // Atomic lock claiming this order for auto-cancel
                const claimed = await FoodOrder.findOneAndUpdate(
                    {
                        _id: order._id,
                        orderStatus: 'created',
                        'callAlert.autoCancelStatus': { $in: [null, 'none'] }
                    },
                    {
                        $set: {
                            'callAlert.autoCancelStatus': 'in_progress'
                        }
                    },
                    { new: true }
                );

                if (!claimed) continue; // Concurrently claimed or order was accepted

                logger.warn(`[CallAlert] Auto-cancelling order #${claimed.order_id || claimed._id}: Restaurant did not respond to OBD Call 2 within ${alertConfig.autoCancelDelaySeconds}s`);

                const cancelResult = await autoCancelUnresponsiveOrder(
                    claimed._id,
                    `Restaurant did not respond to automated call alerts within ${alertConfig.autoCancelDelaySeconds} seconds after second call.`
                );

                if (cancelResult.success) {
                    stats.autoCancelled = (stats.autoCancelled || 0) + 1;
                } else {
                    logger.error(`[CallAlert] Auto-cancel failed for order ${claimed._id}: ${cancelResult.error}`);
                    // Revert status lock if failed so it can be retried or inspected
                    await FoodOrder.updateOne(
                        { _id: claimed._id, 'callAlert.autoCancelStatus': 'in_progress' },
                        { $set: { 'callAlert.autoCancelStatus': 'none' } }
                    );
                }
            }
        }

        return { status: 'ok', ...stats };
    } catch (err) {
        logger.error(`[CallAlert] Polling cycle failed: ${err.message}`);
        return { status: 'error', error: err.message };
    } finally {
        isPollingActive = false;
    }
}
