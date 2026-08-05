import mongoose from 'mongoose';
import { FoodOrder, FoodSettings } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodDeliveryCashDeposit } from '../../delivery/models/foodDeliveryCashDeposit.model.js';
import { FoodDeliveryCashLimit } from '../../admin/models/deliveryCashLimit.model.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { sendVoipPushNotification } from '../../../../core/notifications/voip.service.js';
import { config } from '../../../../config/env.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob, cancelDispatchTimeoutJob } from '../../../../queues/producers/order.producer.js';
import {
  buildDeliverySocketPayload,
  buildOrderIdentityFilter,
  haversineKm,
  notifyOwnerSafely,
  notifyOwnersSafely,
  notifyOwnersUrgentlySafely,
} from './order.helpers.js';
import {
  publishDeliveryOfferToFirebase,
  removeDeliveryOffersForPartners,
  clearDeliveryOffersForOrder,
} from './order-dispatch.firebase.js';

function isPointInPolygon(lat, lng, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

async function getBusyDeliveryPartnerIds() {
  const busyPartners = await FoodOrder.distinct('dispatch.deliveryPartnerId', {
    'dispatch.status': 'accepted',
    'dispatch.deliveryPartnerId': { $ne: null },
    orderStatus: {
      $in: ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'reached_drop'],
    },
  });

  return new Set(
    busyPartners
      .filter(Boolean)
      .map((id) => String(id)),
  );
}

function upsertPartnerOffer(order, entry) {
  if (!order.dispatch.offeredTo) order.dispatch.offeredTo = [];
  const partnerIdStr = String(entry.partnerId);
  const existing = order.dispatch.offeredTo.find(
    (offer) => String(offer.partnerId) === partnerIdStr,
  );
  if (existing) {
    existing.action = 'offered';
    existing.at = entry.at || new Date();
    existing.allowOverLimit = Boolean(entry.allowOverLimit);
    existing.requiredCashForOrder = Number(entry.requiredCashForOrder || 0);
    return;
  }
  order.dispatch.offeredTo.push(entry);
}

async function filterPartnersByCashLimit(partners = [], options = {}) {
  // Since we are removing cash limit checks, we simply map partners to ensure they have expected shape.
  // We allow all partners to bypass cash limit.
  if (!Array.isArray(partners) || partners.length === 0) return [];
  
  return partners.map((p) => ({
    ...p,
    availableCashLimit: Number.MAX_SAFE_INTEGER,
    allowOverLimit: true,
    requiredCashForOrder: 0,
  }));
}

async function listNearbyOnlineDeliveryPartners(
  restaurantId,
  {
    maxKm = 15,
    limit = null,
    requiredAmount = 0,
    allowOverLimitFallback = true,
    zoneOnly = true,
  } = {},
) {
  const rId = (restaurantId?._id || restaurantId).toString();
  const restaurant = await FoodRestaurant.findById(rId)
    .select('location zoneId')
    .lean();

  if (!restaurant?.location?.coordinates?.length) {
    logger.warn(`listNearbyOnlineDeliveryPartners: Restaurant ${rId} has no location coordinates. Skipping dispatch.`);
    return { restaurant: null, partners: [] };
  }

  let zonePolygon = null;
  if (zoneOnly && restaurant.zoneId) {
    const zoneDoc = await FoodZone.findById(restaurant.zoneId)
      .select('coordinates isActive')
      .lean();
    if (
      zoneDoc?.isActive !== false &&
      Array.isArray(zoneDoc?.coordinates) &&
      zoneDoc.coordinates.length >= 3
    ) {
      zonePolygon = zoneDoc.coordinates;
    }
  }

  const [rLng, rLat] = restaurant.location.coordinates;
  const busyIds = await getBusyDeliveryPartnerIds();
  const allOnline = await FoodDeliveryPartner.find({
    availabilityStatus: 'online',
    status: 'approved',
  })
    .select('_id status lastLat lastLng lastLocationAt name')
    .lean();

  const radiusEligible = [];
  const zoneEligible = [];

  for (const p of allOnline) {
    if (busyIds.has(String(p._id))) continue;

    const hasCoords = p.lastLat != null && p.lastLng != null;

    if (hasCoords) {
      const d = haversineKm(rLat, rLng, p.lastLat, p.lastLng);
      if (!Number.isFinite(d) || d > maxKm) continue;

      const entry = {
        partnerId: p._id,
        distanceKm: d,
        status: p.status,
        locationUnknown: false,
      };
      radiusEligible.push(entry);

      if (!zonePolygon || isPointInPolygon(p.lastLat, p.lastLng, zonePolygon)) {
        zoneEligible.push(entry);
      }
      continue;
    }

    // Riders without saved GPS still receive offers — location is tracked live in Firebase.
    const entry = {
      partnerId: p._id,
      distanceKm: null,
      status: p.status,
      locationUnknown: true,
    };
    radiusEligible.push(entry);
    zoneEligible.push(entry);
  }

  let scored = radiusEligible;
  if (zoneOnly && zonePolygon) {
    scored = zoneEligible.length > 0 ? zoneEligible : radiusEligible;
    if (zoneEligible.length === 0 && radiusEligible.length > 0) {
      logger.info(
        `[Dispatch] Zone polygon matched 0 riders for restaurant ${rId}; falling back to ${radiusEligible.length} radius-eligible riders`,
      );
    }
  }

  scored.sort((a, b) => {
    if (a.distanceKm == null && b.distanceKm == null) return 0;
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  });

  const picked = Number.isFinite(limit) && limit > 0
    ? scored.slice(0, limit)
    : scored;

  if (picked.length === 0) {
    logger.warn(
      `[Dispatch] No eligible riders for restaurant ${rId}: online=${allOnline.length}, busy=${busyIds.size}, radiusKm=${maxKm}, zoneFilter=${Boolean(zonePolygon && zoneOnly)}`,
    );
    return { partners: [] };
  }

  const cashEligibleFinal = await filterPartnersByCashLimit(picked, {
    requiredAmount,
    allowOverLimitFallback,
  });

  return { partners: cashEligibleFinal };
}

async function notifyDeliveryPartnerOffer({
  partner,
  order,
  payload,
  attempt,
  maxKm,
  offeredAt,
  io,
}) {
  const eventPayload = {
    ...payload,
    pickupDistanceKm: partner.distanceKm ?? null,
    locationUnknown: Boolean(partner.locationUnknown),
    attempt,
    maxKm,
  };

  const firebaseOk = await publishDeliveryOfferToFirebase(
    partner.partnerId,
    order._id.toString(),
    {
      ...eventPayload,
      type: 'new_order_available',
      offeredAt,
      channel: 'firebase',
    },
  );

  if (!firebaseOk) {
    const roomName = rooms.delivery(partner.partnerId);
    if (io) {
      io.to(roomName).emit('new_order_available', {
        ...eventPayload,
        channel: 'socket_fallback',
      });
      logger.info(
        `[Dispatch] Firebase unavailable — socket fallback for partner ${partner.partnerId} order ${order._id}`,
      );
      return { firebase: false, socket: true };
    }

    logger.warn(
      `[Dispatch] Offer delivery failed for partner ${partner.partnerId} order ${order._id} (Firebase and socket unavailable)`,
    );
    return { firebase: false, socket: false };
  }

  return { firebase: true, socket: false };
}

export async function getDispatchSettings() {
  return { dispatchMode: "auto" };
}

export async function updateDispatchSettings(dispatchMode, adminId) {
  // Always set to auto
  await FoodSettings.findOneAndUpdate(
    { key: "dispatch" },
    {
      $set: {
        dispatchMode: "auto",
        updatedBy: { role: "ADMIN", adminId, at: new Date() },
      },
    },
    { upsert: true, new: true },
  );
  return getDispatchSettings();
}

export async function tryAutoAssign(orderId, options = {}) {
  let attempt = options.attempt || 1;
  const lockTimeout = 60000; // 60 seconds lock interval

  const dispatchableStatuses = new Set([
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'ready',
    'picked_up',
  ]);

  const order = await FoodOrder.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(orderId),
      orderStatus: { $in: Array.from(dispatchableStatuses) },
      $or: [
        { 'dispatch.status': 'unassigned' },
        {
          'dispatch.status': 'assigned',
          'dispatch.acceptedAt': { $exists: false },
          'dispatch.assignedAt': { $lt: new Date(Date.now() - lockTimeout) }
        }
      ],
      'dispatch.dispatchingAt': { $exists: false }
    },
    {
      $set: { 'dispatch.dispatchingAt': new Date() }
    },
    { new: true }
  ).populate(['restaurantId', 'userId']);

  if (!order) {
    logger.info(`tryAutoAssign: Skip for ${orderId} (not dispatchable, already dispatching, accepted, or multi-attempt lock active).`);
    return null;
  }

  try {
    const paymentMethod = String(order.payment?.method || 'cash').toLowerCase();
    const isCashOrder = paymentMethod === 'cash';
    const requiredAmount = isCashOrder ? Number(order?.pricing?.total || 0) : 0;

    // RADIUS EXPANSION LOGIC
    const feeSettings = await FoodFeeSettings.findOne({ isActive: true }).lean();
    let radiusTiers = feeSettings?.dispatchRadiusTiers || [];
    if (!radiusTiers.length) {
      radiusTiers = [2, 4, 6, 8, 10, 15]; // Exact tiers requested: 2, 4, 6, 8, 10, 15
    }

    // CYCLE RESTART LOGIC: If we exceeded the maximum tiers, restart the cycle from 2km
    if (attempt > radiusTiers.length) {
      logger.info(`[Dispatch] Order ${order._id}: All ${radiusTiers.length} tiers exhausted (attempt was ${attempt}). Restarting cycle from 2km.`);
      attempt = 1;
      order.dispatch.offeredTo = []; // Clear history so all riders get a fresh chance
      order.dispatch.dispatchAttempt = 1;
      await order.save();
    }

    const maxKm = options.blastAll ? radiusTiers[radiusTiers.length - 1] : radiusTiers[attempt - 1];
    order.dispatch.dispatchAttempt = attempt;

    const searchOptions = {
      maxKm,
      requiredAmount: 0,
      allowOverLimitFallback: true,
    };
    
    logger.info(`[Dispatch] Order ${order._id} attempt=${attempt} maxKm=${maxKm}`);
    const { partners } = await listNearbyOnlineDeliveryPartners(order.restaurantId, searchOptions);

    // Re-broadcast to every rider in this radius each attempt, including previously offered riders.
    const eligible = partners;

    if (eligible.length === 0) {
      logger.info(`[Dispatch] No eligible partners in ${maxKm}km for order ${order._id} (Attempt ${attempt}). Advancing to next tier.`);
      
      // No new riders in this radius. Advance to the next tier immediately.
      order.dispatch.status = 'unassigned';
      order.dispatch.deliveryPartnerId = null;
      await order.save();

      // Re-queue to check the next tier after a short delay (60s)
      await addOrderJob({
        action: 'DISPATCH_TIMEOUT_CHECK',
        orderMongoId: order._id.toString(),
        orderId: order._id.toString(),
        attempt: attempt + 1
      }, { delay: 60000 });

      return order;
    }

    const io = getIO();
    const payload = buildDeliverySocketPayload(order, order.restaurantId);

    logger.info(`[DeliveryPopupServer] dispatch start order=${order.order_id || order._id} attempt=${attempt} riders=${eligible.length} maxKm=${maxKm} ioAvailable=${Boolean(io)} dispatchStatus=${order.dispatch?.status || 'unassigned'}`);

    // Broadcast to ALL eligible riders in this tier (Firebase first, socket fallback).
    logger.info(`[PM2 LOG] [Dispatch] Broadcasting order ${order._id} to ${eligible.length} riders at ${maxKm}km.`);
    const offeredAt = Date.now();
    for (const p of eligible) {
      const roomName = rooms.delivery(p.partnerId);
      const eventPayload = {
        ...payload,
        pickupDistanceKm: p.distanceKm,
        offeredAt,
        isResend: Boolean(options.isResend),
      };

      logger.info(`[DeliveryPopupServer] dispatch target order=${order.order_id || order._id} rider=${String(p.partnerId)} room=${roomName} distanceKm=${Number(p.distanceKm || 0).toFixed(2)}`);

      // 1. Firebase RTDB (Primary Frontend Channel)
      const fbSuccess = await publishDeliveryOfferToFirebase(
        p.partnerId,
        order._id.toString(),
        eventPayload,
      );
      if (fbSuccess) {
        logger.info(`[PM2 LOG] [Firebase DB] Published order ${order._id} to rider ${p.partnerId}`);
      } else {
        logger.warn(`[PM2 LOG] [Firebase DB] Failed to publish order ${order._id} to rider ${p.partnerId}`);
      }

      // 2. Socket.IO (Fallback)
      if (io) {
        io.to(roomName).emit('new_order_available', eventPayload);
        logger.info(`[PM2 LOG] [Socket.IO] Emitted order ${order._id} to room ${roomName}`);
      }
    }

    // FCM Push for background/closed apps
    const notifyList = eligible.map(p => ({
      ownerType: 'DELIVERY_PARTNER',
      ownerId: p.partnerId,
    }));
    logger.info(`[FCM-Dispatch] Sending new_order push to ${notifyList.length} delivery partner(s) for order ${order._id}: [${notifyList.map(n => n.ownerId).join(', ')}]`);
    try {
      const fcmResults = await notifyOwnersUrgentlySafely(
        notifyList,
        {
          title: '🚴 New Order Nearby!',
          body: `Order #${order.order_id || order._id} is waiting. Be the first to accept!`,
          dataOnly: true,
          data: { type: 'new_order', orderId: order._id.toString() },
        },
      );
      logger.info(`[FCM-Dispatch] new_order push results for order ${order._id}: ${JSON.stringify(fcmResults?.map?.(r => ({ success: r?.successCount, fail: r?.failureCount })) || 'void')}`);
    } catch (err) {
      logger.warn(`Push notifications failed for batch: ${err.message}`);
    }

    // Record or refresh offers for every rider notified in this attempt.
    for (const p of eligible) {
      upsertPartnerOffer(order, {
        partnerId: p.partnerId,
        at: new Date(),
        action: 'offered',
        allowOverLimit: Boolean(p.allowOverLimit),
        requiredCashForOrder: Number(p.requiredCashForOrder || requiredAmount || 0),
      });
    }

    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = null;
    order.markModified('dispatch.offeredTo');
    await order.save();

    // Re-check in 60s if no one accepts
    await addOrderJob({
      action: 'DISPATCH_TIMEOUT_CHECK',
      orderMongoId: order._id.toString(),
      orderId: order._id.toString(),
      attempt: attempt + 1
    }, { delay: 60000 });

    return order;
  } finally {
    await FoodOrder.findByIdAndUpdate(orderId, {
      $unset: { 'dispatch.dispatchingAt': '' },
    });
  }
}

export async function processDispatchTimeout(orderId, partnerId, options = {}) {
  const order = await FoodOrder.findById(orderId);
  if (!order) return;

  if (order.dispatch?.status === 'accepted') {
    return; // Already accepted, stop hunting.
  }

  const stillAssigned = order.dispatch?.status === 'assigned' &&
    String(order.dispatch?.deliveryPartnerId) === String(partnerId) &&
    !order.dispatch?.acceptedAt;

  if (stillAssigned) {
    logger.info(`[Dispatch] Timeout for assigned partner ${partnerId} on order ${orderId}. Moving to next tier.`);
    const offer = order.dispatch.offeredTo.find(
      o => String(o.partnerId) === String(partnerId) && o.action === 'offered'
    );
    if (offer) offer.action = 'timeout';
    
    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = null;
    await order.save();
    
    await removeDeliveryOffersForPartners([partnerId], orderId);
    logger.info(`[PM2 LOG] [Firebase DB] Removed timed-out offer from rider ${partnerId}`);

    const attempt = options.attempt || (order.dispatch?.offeredTo?.length || 0) + 1;
    await tryAutoAssign(orderId, { attempt });

  } else if (order.dispatch?.status === 'unassigned') {
    // Broadcast timeout: Mark ALL currently 'offered' riders as 'timeout'
    let updated = false;
    const timeoutPartnerIds = [];

    for (const entry of (order.dispatch?.offeredTo || [])) {
      if (entry.action === 'offered') {
        entry.action = 'timeout';
        timeoutPartnerIds.push(entry.partnerId.toString());
        updated = true;
      }
    }
    
    if (updated) {
      logger.info(`[PM2 LOG] [Dispatch] Marked broadcasted offers as timeout for order ${orderId}. Advancing cycle.`);
      await order.save();

      // Remove from Firebase RTDB so the frontend popup closes if it hasn't already
      if (timeoutPartnerIds.length > 0) {
        await removeDeliveryOffersForPartners(timeoutPartnerIds, orderId);
        logger.info(`[PM2 LOG] [Firebase DB] Cleaned up offers for ${timeoutPartnerIds.length} timed-out riders.`);
      }
    }

    const attempt = options.attempt || 1;
    await tryAutoAssign(orderId, { attempt });
  }
}


async function resendDeliveryNotificationForOrder(order, options = {}) {
  const activeStatuses = ['confirmed', 'preparing', 'ready_for_pickup'];
  if (!activeStatuses.includes(order.orderStatus)) {
    throw new ValidationError(`Cannot resend notification for order in status: ${order.orderStatus}`);
  }

  if (order.dispatch?.status === 'accepted' && order.dispatch?.deliveryPartnerId) {
    throw new ValidationError('A delivery partner has already accepted this order.');
  }

  const feeSettings = await FoodFeeSettings.findOne({ isActive: true }).lean();
  let radiusTiers = feeSettings?.dispatchRadiusTiers || [];
  if (!radiusTiers.length) {
    radiusTiers = [2, 4, 6, 8, 10, 15];
  }
  const maxZoneRadius = radiusTiers[radiusTiers.length - 1];

  const paymentMethod = String(order.payment?.method || 'cash').toLowerCase();
  const requiredAmount = paymentMethod === 'cash' ? Number(order?.pricing?.total || 0) : 0;
  const preview = await listNearbyOnlineDeliveryPartners(order.restaurantId, {
    maxKm: maxZoneRadius,
    requiredAmount,
    allowOverLimitFallback: true,
    zoneOnly: true,
  });
  const shortlistedCount = Array.isArray(preview?.partners) ? preview.partners.length : 0;

  await clearDeliveryOffersForOrder(order, { includeAssignedPartner: true });
  const voipToken = String(options?.voipToken || '').trim();
  await resetDispatchForFreshHunt(order._id);

  let dispatchResult = await tryAutoAssign(order._id, {
    attempt: 1,
    blastAll: true,
    isResend: true,
  });

  if (!dispatchResult) {
    logger.warn(`[Dispatch] Resend retry for order ${order._id} after clearing dispatch lock`);
    await FoodOrder.findByIdAndUpdate(order._id, {
      $unset: { 'dispatch.dispatchingAt': '' },
    });
    dispatchResult = await tryAutoAssign(order._id, {
      attempt: 1,
      blastAll: true,
      isResend: true,
    });
  }

  if (!dispatchResult && shortlistedCount > 0) {
    logger.error(
      `[Dispatch] Resend failed to broadcast order ${order._id} despite ${shortlistedCount} shortlisted partners`,
    );
  }

  const refreshed = await FoodOrder.findById(order._id)
    .select('dispatch.offeredTo dispatch.status dispatch.deliveryPartnerId')
    .lean();
  const notifiedCount = Array.isArray(refreshed?.dispatch?.offeredTo)
    ? refreshed.dispatch.offeredTo.filter((entry) => entry?.action === 'offered').length
    : 0;
  const notifiedPartnerIds = Array.isArray(refreshed?.dispatch?.offeredTo)
    ? refreshed.dispatch.offeredTo
        .filter((entry) => entry?.action === 'offered' && entry?.partnerId)
        .map((entry) => String(entry.partnerId))
    : [];
  const io = getIO();
  const connectedSocketCount = io
    ? notifiedPartnerIds.reduce((count, pid) => {
        const roomName = rooms.delivery(pid);
        const roomSize = io?.sockets?.adapter?.rooms?.get(roomName)?.size || 0;
        return count + roomSize;
      }, 0)
    : 0;

  return {
    success: true,
    notifiedCount,
    shortlistedCount,
    requiredAmount,
    connectedSocketCount,
    searchRadiusKm: maxZoneRadius,
    dispatchStatus: refreshed?.dispatch?.status || 'unassigned',
  };
}

export async function resendDeliveryNotificationRestaurant(orderId, restaurantId, options = {}) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne({
    ...identity,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  });

  if (!order) throw new NotFoundError('Order not found');
  return resendDeliveryNotificationForOrder(order, options);
}

export async function resendDeliveryNotificationAdmin(orderId, options = {}) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError('Order not found');
  return resendDeliveryNotificationForOrder(order, options);
}

/** Cancel any queued dispatch timeout job for an order. */
export async function cancelPendingDispatchJob(orderId) {
  await cancelDispatchTimeoutJob(String(orderId));
}

/** Reset dispatch hunt state when restaurant first accepts an order. */
export async function resetDispatchForFreshHunt(orderId) {
  await cancelDispatchTimeoutJob(String(orderId));
  await FoodOrder.findByIdAndUpdate(orderId, {
    $set: {
      'dispatch.status': 'unassigned',
      'dispatch.dispatchAttempt': 1,
      'dispatch.offeredTo': [],
    },
    $unset: {
      'dispatch.dispatchingAt': '',
      'dispatch.deliveryPartnerId': '',
      'dispatch.assignedAt': '',
    },
  });
}
