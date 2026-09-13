import mongoose from 'mongoose';
import { logger } from '../../../../utils/logger.js';
import {
  sendNotificationToOwner,
  sendNotificationToOwners,
} from "../../../../core/notifications/firebase.service.js";
import {
  sendUrgentOrderNotificationToOwner,
  sendUrgentOrderNotificationsToOwners,
  sendVoipNotificationToOwner,
  listOwnerUrgentPushTargets,
} from "../../../../core/notifications/voip.service.js";
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';

export function enqueueOrderEvent(action, payload = {}) {
  try {
    void addOrderJob({ action, ...payload }).catch((err) => {
      logger.warn(`BullMQ enqueue order event failed: ${action} - ${err?.message || err}`);
    });
  } catch (err) {
    logger.warn(`BullMQ enqueue order event failed (sync): ${action} - ${err?.message || err}`);
  }
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c) * 1.35; // Apply routing multiplier for road distance approximation
}

export function generateFourDigitDeliveryOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function sanitizeOrderForExternal(orderDoc) {
  const o = orderDoc?.toObject ? orderDoc.toObject() : { ...(orderDoc || {}) };
  delete o.deliveryOtp;
  delete o.pickupOtp;
  const dv = o.deliveryVerification;
  if (dv) {
    const d = dv.dropOtp || {};
    const p = dv.pickupOtp || {};
    o.deliveryVerification = {
      ...dv,
      dropOtp: {
        required: Boolean(d.required),
        verified: Boolean(d.verified),
      },
      pickupOtp: {
        required: Boolean(p.required !== false),
        verified: Boolean(p.verified),
      }
    };
  }
  o.orderMongoId = (o._id || orderDoc?._id || "").toString();
  // Ensure orderId field for UI always contains the pretty ID
  o.orderId = o.order_id || o.orderMongoId; 
  return o;
}

export function emitDeliveryDropOtpToUser(order, plainOtp, options = {}) {
  try {
    const rawUserId = order?.userId?._id || order?.userId;
    if (!plainOtp || !rawUserId) return;
    const userIdStr = String(rawUserId);

    const orderIdentifier = String(order.order_id || order.orderId || order._id || '');
    const orderMongoId = (order._id || '').toString();

    const io = getIO();
    if (io) {
      const socketPayload = {
        orderMongoId,
        orderId: orderIdentifier,
        otp: plainOtp,
        message:
          "Share this OTP with your delivery partner to hand over the order.",
      };
      io.to(rooms.user(userIdStr)).emit("delivery_drop_otp", socketPayload);
      if (orderIdentifier) {
        io.to(rooms.tracking(orderIdentifier)).emit("delivery_drop_otp", socketPayload);
      }
      if (orderMongoId && orderMongoId !== orderIdentifier) {
        io.to(rooms.tracking(orderMongoId)).emit("delivery_drop_otp", socketPayload);
      }
    }

    const isResend = Boolean(options.isResend);
    const title = isResend ? `Delivery OTP: ${plainOtp}` : `Your Delivery OTP: ${plainOtp}`;
    const body = isResend
      ? `Here is your delivery verification code: ${plainOtp}. Share it with your delivery partner for Order #${orderIdentifier}.`
      : `Your delivery partner has reached your location! Share OTP ${plainOtp} to collect Order #${orderIdentifier}.`;

    void notifyOwnerSafely(
      { ownerType: 'USER', ownerId: userIdStr },
      {
        title,
        body,
        data: {
          type: 'delivery_drop_otp',
          orderId: orderIdentifier,
          orderMongoId,
          otp: String(plainOtp),
          link: `/food/user/orders/${orderIdentifier}/tracking`,
        },
      }
    );
  } catch (e) {
    logger.warn(`emitDeliveryDropOtpToUser failed: ${e?.message || e}`);
  }
}

export async function notifyOwnersSafely(targets, payload) {
  try {
    return await sendNotificationToOwners(targets, payload);
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

export async function notifyOwnerSafely(target, payload) {
  try {
    await sendNotificationToOwner({ ...target, payload });
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

export async function notifyOwnersUrgentlySafely(targets, payload) {
  try {
    await sendUrgentOrderNotificationsToOwners(targets, payload);
  } catch (error) {
    logger.warn(`Urgent notification failed: ${error?.message || error}`);
  }
}

export async function notifyOwnerUrgentlySafely(target, payload) {
  try {
    await sendUrgentOrderNotificationToOwner({ ...target, payload });
  } catch (error) {
    logger.warn(`Urgent notification failed: ${error?.message || error}`);
  }
}

export async function notifyOwnerVoipOnlySafely(target, payload) {
  try {
    await sendVoipNotificationToOwner({ ...target, payload });
  } catch (error) {
    logger.warn(`VoIP notification failed: ${error?.message || error}`);
  }
}

export function buildOrderIdentityFilter(orderIdOrMongoId) {
  const raw = String(orderIdOrMongoId || "").trim();
  if (!raw) return null;
  if (mongoose.isValidObjectId(raw))
    return { _id: new mongoose.Types.ObjectId(raw) };
  
  // Search BOTH underscore and camelCase variants for robust lookup
  return { 
    $or: [
        { order_id: raw },
        { orderId: raw }
    ]
  };
}

export function toGeoPoint(lat, lng) {
  if (lat == null || lng == null) return undefined;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return { type: "Point", coordinates: [b, a] };
}

export function pushStatusHistory(order, { byRole, byId, from, to, note = "" }) {
  order.statusHistory.push({
    at: new Date(),
    byRole,
    byId: byId || undefined,
    from,
    to,
    note,
  });
}

export function normalizeOrderForClient(orderDoc) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const mongoId = (order._id || orderDoc?._id || "").toString();
  const displayId = order.order_id || mongoId;
  return {
    ...order,
    orderMongoId: mongoId,
    orderId: displayId,
    status: order?.orderStatus || order?.status || "",
    deliveredAt:
      order?.deliveryState?.deliveredAt || order?.deliveredAt || null,
    deliveryPartnerId:
      order?.dispatch?.deliveryPartnerId || order?.deliveryPartnerId || null,
    rating: order?.ratings?.restaurant?.rating ?? order?.rating ?? null,
    restaurantNote: order?.restaurantNote || "",
    cancellationReason: (order?.orderStatus?.includes('cancel') || order?.status?.includes('cancel')) 
      ? (order.statusHistory?.findLast(h => h.to?.includes('cancel'))?.note || "")
      : null,
    deliveryState: {
      ...(order?.deliveryState || {}),
      currentLocation: order?.lastRiderLocation?.coordinates?.length >= 2 ? {
        lat: order.lastRiderLocation.coordinates[1],
        lng: order.lastRiderLocation.coordinates[0]
      } : (order?.deliveryState?.currentLocation || null)
    }
  };
}

export async function applyAggregateRating(model, entityId, newRating) {
  if (!entityId) return;
  const doc = await model.findById(entityId).select("rating totalRatings");
  if (!doc) return;

  const totalRatings = Number(doc.totalRatings || 0);
  const currentAverage = Number(doc.rating || 0);
  const nextTotal = totalRatings + 1;
  const nextAverage = Number(
    ((currentAverage * totalRatings + Number(newRating)) / nextTotal).toFixed(1),
  );

  doc.totalRatings = nextTotal;
  doc.rating = nextAverage;
  await doc.save();
}

export function buildDeliverySocketPayload(orderDoc, restaurantDoc = null) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const restaurant = restaurantDoc || order?.restaurantId || null;
  const restaurantLocation = restaurant?.location || order?.restaurantLocation || {};
  const deliveryAddress = order?.deliveryAddress || order?.address || {};

  const customerAddressParts = [
    deliveryAddress.street,
    deliveryAddress.additionalDetails,
    deliveryAddress.landmark,
    deliveryAddress.area,
    deliveryAddress.city,
    deliveryAddress.state,
    deliveryAddress.zipCode || deliveryAddress.pincode,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  const customerAddress =
    (customerAddressParts.length ? customerAddressParts.join(', ') : '') ||
    deliveryAddress.formattedAddress ||
    deliveryAddress.address ||
    order.customerAddress ||
    order.customer_address ||
    order.address?.formattedAddress ||
    order.address ||
    '';

  const orderMongoId =
    orderDoc?._id?.toString?.() || order?._id?.toString?.() || order?._id;
  const displayOrderId = order?.order_id || orderMongoId;

  // Resolve restaurant coordinates [lng, lat] or latitude/longitude
  const rLat =
    restaurantLocation?.latitude ??
    restaurantLocation?.lat ??
    order?.restaurantLat ??
    order?.restaurant_lat ??
    (Array.isArray(restaurantLocation?.coordinates) && restaurantLocation.coordinates.length >= 2
      ? Number(restaurantLocation.coordinates[1])
      : undefined);

  const rLng =
    restaurantLocation?.longitude ??
    restaurantLocation?.lng ??
    order?.restaurantLng ??
    order?.restaurant_lng ??
    (Array.isArray(restaurantLocation?.coordinates) && restaurantLocation.coordinates.length >= 2
      ? Number(restaurantLocation.coordinates[0])
      : undefined);

  const restaurantAddress =
    restaurantLocation?.address ||
    restaurantLocation?.formattedAddress ||
    restaurant?.addressLine1 ||
    restaurant?.address ||
    order?.restaurantAddress ||
    order?.restaurant_address ||
    [restaurantLocation?.area || restaurant?.area, restaurantLocation?.city || restaurant?.city].filter(Boolean).join(', ') ||
    '';

  // Resolve customer coordinates [lng, lat] or latitude/longitude
  const cLat =
    (Array.isArray(deliveryAddress?.location?.coordinates) && deliveryAddress.location.coordinates.length >= 2
      ? Number(deliveryAddress.location.coordinates[1])
      : undefined) ??
    order?.customerLocation?.lat ??
    order?.customerLocation?.latitude ??
    order?.deliveryLocation?.lat ??
    order?.deliveryLocation?.latitude ??
    order?.customerLat ??
    order?.customer_lat;

  const cLng =
    (Array.isArray(deliveryAddress?.location?.coordinates) && deliveryAddress.location.coordinates.length >= 2
      ? Number(deliveryAddress.location.coordinates[0])
      : undefined) ??
    order?.customerLocation?.lng ??
    order?.customerLocation?.longitude ??
    order?.deliveryLocation?.lng ??
    order?.deliveryLocation?.longitude ??
    order?.customerLng ??
    order?.customer_lng;

  return {
    _id: orderMongoId,
    orderMongoId,
    orderId: displayOrderId,
    status: orderDoc?.orderStatus || order?.orderStatus,
    items: order?.items || [],
    pricing: order?.pricing,
    total: order?.pricing?.total,
    payment: order?.payment,
    paymentMethod: order?.payment?.method,
    restaurantId:
      order?.restaurantId?._id?.toString?.() ||
      order?.restaurantId?.toString?.() ||
      order?.restaurantId,
    restaurantName:
      restaurant?.restaurantName ||
      restaurant?.name ||
      order?.restaurantName ||
      order?.restaurant_name ||
      'Restaurant',
    restaurantAddress,
    restaurantPhone: restaurant?.phone || order?.restaurantPhone || '',
    restaurantLat: rLat,
    restaurantLng: rLng,
    restaurant_lat: rLat,
    restaurant_lng: rLng,
    restaurantLocation: {
      latitude: rLat,
      longitude: rLng,
      lat: rLat,
      lng: rLng,
      coordinates: rLng != null && rLat != null ? [rLng, rLat] : restaurantLocation?.coordinates,
      address: restaurantAddress,
      formattedAddress: restaurantLocation?.formattedAddress || restaurantAddress,
      area: restaurantLocation?.area || restaurant?.area || '',
      city: restaurantLocation?.city || restaurant?.city || '',
      state: restaurantLocation?.state || restaurant?.state || '',
    },
    deliveryAddress: {
      ...deliveryAddress,
      formattedAddress: deliveryAddress.formattedAddress || customerAddress,
      address: deliveryAddress.address || customerAddress,
    },
    customerAddress,
    customerLocation:
      cLat != null && cLng != null
        ? {
            lat: Number(cLat),
            lng: Number(cLng),
            latitude: Number(cLat),
            longitude: Number(cLng),
            coordinates: [Number(cLng), Number(cLat)],
          }
        : null,
    customerLat: cLat,
    customerLng: cLng,
    customer_lat: cLat,
    customer_lng: cLng,
    customerName:
      order?.customerName ||
      order?.deliveryAddress?.fullName ||
      order?.deliveryAddress?.name ||
      order?.userId?.name ||
      '',
    customerPhone:
      order?.customerPhone ||
      order?.deliveryAddress?.phone ||
      order?.userId?.phone ||
      '',
    userName:
      order?.customerName ||
      order?.deliveryAddress?.fullName ||
      order?.deliveryAddress?.name ||
      order?.userId?.name ||
      '',
    userPhone:
      order?.customerPhone ||
      order?.deliveryAddress?.phone ||
      order?.userId?.phone ||
      '',
    note: order?.note || '',
    riderEarning: order?.riderEarning || 0,
    deliveryBonusAmount: order?.deliveryBonusAmount || 0,
    earnings: order?.riderEarning || order?.pricing?.deliveryFee || 0,
    deliveryFee: order?.pricing?.deliveryFee || 0,
    deliveryFleet: order?.deliveryFleet,
    dispatch: order?.dispatch,
    createdAt: order?.createdAt,
    updatedAt: order?.updatedAt,
  };
}

export function canExposeOrderToRestaurant(orderLike) {
  const method = String(orderLike?.payment?.method || "").toLowerCase();
  const status = String(orderLike?.payment?.status || "").toLowerCase();
  if (["cash", "wallet"].includes(method)) return true;
  return ["paid", "authorized", "captured", "settled"].includes(status);
}

export async function notifyRestaurantNewOrder(orderDoc) {
  try {
    if (!orderDoc || !canExposeOrderToRestaurant(orderDoc)) return;

    const io = getIO();
    if (io) {
      const payload = {
        ...orderDoc.toObject(),
        orderMongoId: orderDoc._id?.toString?.() || undefined,
        orderId: orderDoc.order_id || orderDoc._id?.toString?.(),
      };
      logger.info(
        `[RestaurantOrders] Emitting new_order to ${rooms.restaurant(orderDoc.restaurantId)} for order ${orderDoc._id?.toString?.() || ''}`,
      );
      io.to(rooms.restaurant(orderDoc.restaurantId)).emit("new_order", payload);
    }

    const pushTargets = await listOwnerUrgentPushTargets({ ownerType: "RESTAURANT", ownerId: orderDoc.restaurantId });
    if (String(process.env.PUSH_DEBUG || "").toLowerCase() === "true") {
      logger.info(
        `[PushDebug][RestaurantOrder] order=${orderDoc._id?.toString?.() || ""} restaurant=${orderDoc.restaurantId?.toString?.() || ""} voip=${pushTargets.iosVoipTokens?.length || 0} fcm=${pushTargets.fcmTokens?.length || 0} voipPreview=${pushTargets.iosVoipTokens?.[0] ? `${String(pushTargets.iosVoipTokens[0]).slice(0, 8)}...` : "none"} fcmPreview=${pushTargets.fcmTokens?.[0] ? `${String(pushTargets.fcmTokens[0]).slice(0, 8)}...` : "none"}`
      );
    }

    await notifyOwnerUrgentlySafely(
      { ownerType: "RESTAURANT", ownerId: orderDoc.restaurantId },
      {
        title: "New order received",
        body: `Order #${orderDoc.order_id || orderDoc._id} is waiting for review.`,
        sound: "default",
        data: {
          type: "new_order",
          orderId: orderDoc._id.toString(),
          orderMongoId: orderDoc._id?.toString?.() || "",
          link: `/restaurant/orders/${orderDoc._id?.toString?.() || ""}`,
        },
      },
    );
    const { scheduleRestaurantResponseDelayAlert } = await import('../../admin/services/restaurantDelayAlert.service.js');
    await scheduleRestaurantResponseDelayAlert(orderDoc);
  } catch {
    // Do not block order/payment flow if notification fails.
  }
}

export const STATUS_PRIORITY = {
  created: 10,
  confirmed: 20,
  preparing: 30,
  ready_for_pickup: 40,
  reached_pickup: 50,
  picked_up: 60,
  reached_drop: 70,
  delivered: 80,
  cancelled_by_user: 100,
  cancelled_by_restaurant: 100,
  cancelled_by_admin: 100,
  dead: 100,
};

/**
 * Returns true if the next status is a valid forward progression from the current status.
 * Prevents "reversing" order status (e.g. from Preparing back to Created).
 */
export function isStatusAdvance(current, next) {
  // If current status is missing, it's effectively 'created' or start of flow
  if (!current) return true;
  
  const currentPrio = STATUS_PRIORITY[current] || 0;
  const nextPrio = STATUS_PRIORITY[next] || 0;

  // Terminal states (100) cannot transition to anything else
  if (currentPrio >= 100) return false;
  
  // Delivered (80) cannot transition to anything (except maybe cancellation if allowed, but here we say no)
  if (currentPrio === 80) return false;

  // Special case: Cancellation is almost always an advance unless already delivered
  if (nextPrio === 100 && currentPrio < 80) return true;

  return nextPrio > currentPrio;
}
