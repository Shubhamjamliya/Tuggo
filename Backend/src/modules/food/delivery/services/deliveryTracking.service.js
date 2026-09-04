import mongoose from 'mongoose';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { DeliveryLocationLog } from '../models/deliveryLocationLog.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { getRedisClient } from '../../../../config/redis.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Normalizes and processes batched driver GPS coordinates.
 * Supports batch payloads, deduplication, historical logs, live state broadcast,
 * and returns dynamic tracking configuration for the Flutter client.
 */
export const processDriverLocationBatch = async (deliveryPartnerId, payload = {}) => {
    if (!deliveryPartnerId) {
        throw new Error('Delivery partner ID is required');
    }

    const partnerObjectId = new mongoose.Types.ObjectId(deliveryPartnerId);

    // 1. Normalize locations array (supports both single object and batch array)
    let rawLocations = [];
    if (Array.isArray(payload.locations)) {
        rawLocations = payload.locations;
    } else if (Array.isArray(payload)) {
        rawLocations = payload;
    } else if (payload.lat != null && payload.lng != null) {
        rawLocations = [payload];
    } else if (payload.locations && typeof payload.locations === 'object') {
        rawLocations = [payload.locations];
    }

    // 2. Fetch driver profile & active order in parallel
    const [partner, activeOrder] = await Promise.all([
        FoodDeliveryPartner.findById(deliveryPartnerId).select('status availabilityStatus lastLocationAt').lean(),
        FoodOrder.findOne({
            'dispatch.deliveryPartnerId': partnerObjectId,
            orderStatus: { $in: ['accepted', 'confirmed', 'reached_pickup', 'picked_up', 'out_for_delivery', 'reached_drop'] }
        }).select('_id orderId orderStatus user restaurantId').lean()
    ]);

    if (!partner) {
        throw new Error('Delivery partner not found');
    }

    // 3. Filter & validate incoming coordinates
    const validPoints = [];
    for (const item of rawLocations) {
        const lat = Number(item.lat ?? item.latitude);
        const lng = Number(item.lng ?? item.longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

        // Parse capturedAt timestamp
        let capturedAt = item.capturedAt ? new Date(item.capturedAt) : new Date();
        if (isNaN(capturedAt.getTime())) {
            capturedAt = new Date();
        }

        const pointOrderId = item.orderId 
            ? (mongoose.Types.ObjectId.isValid(item.orderId) ? new mongoose.Types.ObjectId(item.orderId) : null)
            : (activeOrder?._id || null);

        validPoints.push({
            deliveryPartnerId: partnerObjectId,
            orderId: pointOrderId,
            location: {
                type: 'Point',
                coordinates: [lng, lat]
            },
            lat,
            lng,
            speed: item.speed != null ? Number(item.speed) : null,
            heading: item.heading != null ? Number(item.heading) : (item.bearing != null ? Number(item.bearing) : null),
            accuracy: item.accuracy != null ? Number(item.accuracy) : null,
            altitude: item.altitude != null ? Number(item.altitude) : null,
            battery: item.battery != null ? Number(item.battery) : null,
            capturedAt
        });
    }

    // Sort valid points chronologically (oldest to newest)
    validPoints.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

    let processedCount = 0;

    if (validPoints.length > 0) {
        // 4. Bulk Upsert Breadcrumbs to MongoDB (Deduplicated on deliveryPartnerId + capturedAt)
        try {
            const bulkOps = validPoints.map(pt => ({
                updateOne: {
                    filter: {
                        deliveryPartnerId: pt.deliveryPartnerId,
                        capturedAt: pt.capturedAt
                    },
                    update: {
                        $setOnInsert: {
                            deliveryPartnerId: pt.deliveryPartnerId,
                            orderId: pt.orderId,
                            location: pt.location,
                            speed: pt.speed,
                            heading: pt.heading,
                            accuracy: pt.accuracy,
                            altitude: pt.altitude,
                            battery: pt.battery,
                            capturedAt: pt.capturedAt
                        }
                    },
                    upsert: true
                }
            }));

            const bulkRes = await DeliveryLocationLog.bulkWrite(bulkOps, { ordered: false });
            processedCount = (bulkRes.upsertedCount || 0) + (bulkRes.modifiedCount || 0) + (bulkRes.matchedCount || 0);
        } catch (dbErr) {
            logger.warn(`[LocationBatch] Non-critical bulk log insert notice: ${dbErr.message}`);
            processedCount = validPoints.length;
        }

        // 5. Identify the newest point in the batch
        const newestPoint = validPoints[validPoints.length - 1];
        const lastKnownTime = partner.lastLocationAt ? new Date(partner.lastLocationAt).getTime() : 0;
        const isNewest = newestPoint.capturedAt.getTime() >= lastKnownTime;

        if (isNewest) {
            const now = newestPoint.capturedAt.getTime();
            const coordPayload = {
                lat: newestPoint.lat,
                lng: newestPoint.lng,
                speed: newestPoint.speed,
                heading: newestPoint.heading,
                accuracy: newestPoint.accuracy,
                timestamp: now
            };

            // A. Update MongoDB Driver Location
            FoodDeliveryPartner.findByIdAndUpdate(deliveryPartnerId, {
                $set: {
                    lastLat: newestPoint.lat,
                    lastLng: newestPoint.lng,
                    lastLocation: newestPoint.location,
                    lastLocationAt: newestPoint.capturedAt
                }
            }).catch(e => logger.error(`[LocationBatch] Error updating driver last location: ${e.message}`));

            // B. Update Redis Hot Cache
            try {
                const redis = getRedisClient();
                if (redis) {
                    const coordString = JSON.stringify(coordPayload);
                    const redisOps = [
                        redis.hSet('rider:locations:hot', String(deliveryPartnerId), coordString)
                    ];
                    if (activeOrder) {
                        redisOps.push(redis.hSet('order:locations:hot', String(activeOrder.orderId || activeOrder._id), coordString));
                    }
                    await Promise.all(redisOps);
                }
            } catch (rErr) {
                logger.warn(`[LocationBatch] Redis hot cache error: ${rErr.message}`);
            }

            // C. Update Firebase Realtime Database
            try {
                const firebaseDB = getFirebaseDB();
                if (firebaseDB) {
                    // Update delivery boy node
                    const boyRef = firebaseDB.ref(`delivery_boys/${deliveryPartnerId}`);
                    boyRef.update({
                        lat: newestPoint.lat,
                        lng: newestPoint.lng,
                        heading: newestPoint.heading || 0,
                        speed: newestPoint.speed || 0,
                        accuracy: newestPoint.accuracy || 0,
                        last_updated: now,
                        is_online: partner.availabilityStatus === 'online',
                        active_order_id: activeOrder ? String(activeOrder.orderId || activeOrder._id) : null
                    }).catch(e => logger.warn(`[LocationBatch] Firebase boy update: ${e.message}`));

                    // Update active order node if on trip
                    if (activeOrder) {
                        const orderKey = String(activeOrder.orderId || activeOrder._id);
                        const orderRef = firebaseDB.ref(`active_orders/${orderKey}`);
                        orderRef.update({
                            lat: newestPoint.lat,
                            lng: newestPoint.lng,
                            heading: newestPoint.heading || 0,
                            speed: newestPoint.speed || 0,
                            accuracy: newestPoint.accuracy || 0,
                            last_updated: now,
                            status: activeOrder.orderStatus || 'on_the_way'
                        }).catch(e => logger.warn(`[LocationBatch] Firebase order update: ${e.message}`));
                    }
                }
            } catch (fErr) {
                logger.warn(`[LocationBatch] Firebase sync error: ${fErr.message}`);
            }

            // D. Broadcast via Socket.IO if clients are connected
            try {
                const io = getIO();
                if (io) {
                    const trackingBroadcast = {
                        orderId: activeOrder?.orderId || activeOrder?._id,
                        driverId: deliveryPartnerId,
                        ...coordPayload,
                        status: activeOrder?.orderStatus || 'on_the_way'
                    };

                    if (activeOrder?.orderId) {
                        io.to(rooms.order(activeOrder.orderId)).emit('location-update', trackingBroadcast);
                    }
                    if (activeOrder?.user) {
                        const userId = activeOrder.user?._id || activeOrder.user;
                        io.to(rooms.user(userId)).emit('location-update', trackingBroadcast);
                    }
                    if (activeOrder?.restaurantId) {
                        io.to(rooms.restaurant(activeOrder.restaurantId)).emit('location-update', trackingBroadcast);
                    }
                }
            } catch (sErr) {
                logger.warn(`[LocationBatch] Socket emit error: ${sErr.message}`);
            }
        }
    }

    // 6. Compute Dynamic Configuration for Flutter Driver App
    const isApproved = partner.status === 'approved';
    const isOnline = partner.availabilityStatus === 'online';
    const hasActiveTrip = Boolean(activeOrder);

    let mode = 'idle';
    let stopTracking = false;
    let intervalMs = 10000;
    let distanceFilterMeters = 30;

    if (!isApproved || (!isOnline && !hasActiveTrip)) {
        stopTracking = true;
        mode = 'offline';
        intervalMs = 30000;
        distanceFilterMeters = 100;
    } else if (hasActiveTrip) {
        mode = 'onTrip';
        stopTracking = false;
        intervalMs = 5000; // 5s cadence on active trip
        distanceFilterMeters = 15; // 15m filter
    } else {
        mode = 'idle';
        stopTracking = false;
        intervalMs = 15000; // 15s cadence when idle online
        distanceFilterMeters = 40; // 40m filter
    }

    return {
        processedCount: validPoints.length,
        totalReceived: rawLocations.length,
        activeOrderId: activeOrder ? (activeOrder.orderId || activeOrder._id) : null,
        config: {
            stopTracking,
            mode,
            intervalMs,
            distanceFilterMeters
        }
    };
};
