import mongoose from 'mongoose';
import { FoodOrder, FoodSettings } from '../models/order.model.js';
// import { paymentSnapshotFromOrder } from './foodOrderPayment.service.js';
import { logger } from '../../../../utils/logger.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import { FoodBusinessSettings } from '../../admin/models/businessSettings.model.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../../core/auth/errors.js';
import { buildPaginationOptions, buildPaginatedResult, parseQueryLimit, parseQueryPage } from '../../../../utils/helpers.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { FoodDeliveryCommissionRule } from '../../admin/models/deliveryCommissionRule.model.js';
import { FoodRestaurantCommission } from '../../admin/models/restaurantCommission.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodSupportTicket } from '../../user/models/supportTicket.model.js';
import { config } from '../../../../config/env.js';
import {
    createRazorpayOrder,
    verifyPaymentSignature,
    getRazorpayKeyId,
    isRazorpayConfigured,
    initiateRazorpayRefund
} from '../helpers/razorpay.helper.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import { fetchPolyline } from '../utils/googleMaps.js';
import { getDrivingDistances } from '../../../../services/googleMaps.service.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import * as foodTransactionService from './foodTransaction.service.js';
import * as userWalletService from '../../user/services/userWallet.service.js';
import { calculateOrderPricing } from './order-pricing.service.js';
import * as dispatchService from './order-dispatch.service.js';
import { clearDeliveryOffersForOrder } from './order-dispatch.firebase.js';
import * as deliveryService from './order-delivery.service.js';
import * as paymentService from './order-payment.service.js';
import {
  enqueueOrderEvent,
  haversineKm,
  generateFourDigitDeliveryOtp,
  sanitizeOrderForExternal,
  emitDeliveryDropOtpToUser,
  notifyOwnersSafely,
  notifyOwnerSafely,
  buildOrderIdentityFilter,
  toGeoPoint,
  pushStatusHistory,
  normalizeOrderForClient,
  applyAggregateRating,
  buildDeliverySocketPayload,
  notifyRestaurantNewOrder,
  isStatusAdvance,
} from './order.helpers.js';




const COMMISSION_CACHE_MS = 10 * 1000;
let commissionRulesCache = null;
let commissionRulesLoadedAt = 0;

async function getActiveCommissionRules() {
  const now = Date.now();
  if (
    commissionRulesCache &&
    now - commissionRulesLoadedAt < COMMISSION_CACHE_MS
  ) {
    return commissionRulesCache;
  }
  const list = await FoodDeliveryCommissionRule.find({
    status: { $ne: false },
  }).lean();
  commissionRulesCache = list || [];
  commissionRulesLoadedAt = now;
  return commissionRulesCache;
}

// 🗑️ Moved to foodTransaction.service.js to centralize finance logic.


async function getRiderEarning(distanceKm) {
  const d = Number(distanceKm);
  if (!Number.isFinite(d) || d <= 0) return 0;
  const rules = await getActiveCommissionRules();
  if (!rules.length) return 0;

  const sorted = [...rules].sort(
    (a, b) => (a.minDistance || 0) - (b.minDistance || 0),
  );
  const baseRule = sorted.find((r) => Number(r.minDistance || 0) === 0) || null;
  if (!baseRule) return 0;

  let earning = Number(baseRule.basePayout || 0);

  for (const r of sorted) {
    const perKm = Number(r.commissionPerKm || 0);
    if (!Number.isFinite(perKm) || perKm <= 0) continue;
    const min = Number(r.minDistance || 0);
    const max = r.maxDistance == null ? null : Number(r.maxDistance);
    if (d <= min) continue;
    const upper = max == null ? d : Math.min(d, max);
    const kmInSlab = Math.max(0, upper - min);
    if (kmInSlab > 0) {
      earning += kmInSlab * perKm;
    }
  }

  if (!Number.isFinite(earning) || earning <= 0) return 0;
  return Math.round(earning);
}

/** Append-only food_order_payments row; never blocks main flow on failure */
// 🗑️ Deprecated in favor of FoodTransaction system.

// ----- Settings -----
export async function getDispatchSettings() {
  return dispatchService.getDispatchSettings();
}

export async function updateDispatchSettings(dispatchMode, adminId) {
  return dispatchService.updateDispatchSettings(dispatchMode, adminId);
}

// ----- Calculate (validation + return pricing from payload) -----
export async function calculateOrder(userId, dto) {
  return calculateOrderPricing(userId, dto);
}

// ----- Create order -----
export async function createOrder(userId, dto) {
  const restaurant = await FoodRestaurant.findById(dto.restaurantId)
    .select("status restaurantName zoneId location isAcceptingOrders")
    .lean();
  if (!restaurant) throw new ValidationError("Restaurant not found");

  const businessSettings = await FoodBusinessSettings.findOne().select('maintenanceMode').lean();
  if (businessSettings?.maintenanceMode) {
    let isIndore = false;
    if (restaurant.zoneId) {
      const zone = await FoodZone.findById(restaurant.zoneId).select('name').lean();
      if (zone && zone.name && zone.name.toLowerCase() === 'indore') {
        isIndore = true;
      }
    }
    if (!isIndore) {
      throw new ValidationError('Ordering is temporarily unavailable due to maintenance. Please try again later.');
    }
  }

  if (restaurant.status !== "approved")
    throw new ValidationError("Restaurant not accepting orders");
  if (restaurant.isAcceptingOrders === false)
    throw new ValidationError("Restaurant not accepting orders");


  const settings = await getDispatchSettings();
  const dispatchMode = settings.dispatchMode;

  const deliveryAddress = {
    label: dto.address?.label || "Home",
    name: dto.address?.name || dto.address?.fullName || dto.customerName || "",
    fullName: dto.address?.fullName || dto.address?.name || dto.customerName || "",
    street: dto.address?.street || "",
    additionalDetails: dto.address?.additionalDetails || "",
    city: dto.address?.city || "",
    state: dto.address?.state || "",
    zipCode: dto.address?.zipCode || "",
    phone: dto.address?.phone || "",
    location: dto.address?.location?.coordinates
      ? { type: "Point", coordinates: dto.address.location.coordinates }
      : undefined,
  };

  const paymentMethod =
    dto.paymentMethod === "card" ? "razorpay" : dto.paymentMethod;
  const isCash = paymentMethod === "cash";
  const isWallet = paymentMethod === "wallet";

  // Ensure pricing is present and consistent.
  const computedSubtotal = (dto.items || []).reduce((sum, item) => {
    const price = Number(item?.price);
    const qty = Number(item?.quantity);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
    return sum + Math.max(0, price) * Math.max(0, qty);
  }, 0);
  const normalizedPricing = {
    subtotal: Number(dto.pricing?.subtotal ?? computedSubtotal),
    tax: Number(dto.pricing?.tax ?? 0),
    packagingFee: Number(dto.pricing?.packagingFee ?? 0),
    deliveryFee: Number(dto.pricing?.deliveryFee ?? 0),
    platformFee: Number(dto.pricing?.platformFee ?? 0),
    discount: Number(dto.pricing?.discount ?? 0),
    total: Number(dto.pricing?.total ?? 0),
    currency: String(dto.pricing?.currency || "INR"),
  };
  const computedTotal = Math.max(
    0,
    (Number.isFinite(normalizedPricing.subtotal)
      ? normalizedPricing.subtotal
      : 0) +
      (Number.isFinite(normalizedPricing.tax) ? normalizedPricing.tax : 0) +
      (Number.isFinite(normalizedPricing.packagingFee)
        ? normalizedPricing.packagingFee
        : 0) +
      (Number.isFinite(normalizedPricing.deliveryFee)
        ? normalizedPricing.deliveryFee
        : 0) +
      (Number.isFinite(normalizedPricing.platformFee)
        ? normalizedPricing.platformFee
        : 0) -
      (Number.isFinite(normalizedPricing.discount)
        ? normalizedPricing.discount
        : 0),
  );
  if (
    !Number.isFinite(normalizedPricing.total) ||
    normalizedPricing.total <= 0
  ) {
    normalizedPricing.total = computedTotal;
  }

  const payment = {
    method: paymentMethod,
    status: isCash ? "cod_pending" : isWallet ? "paid" : "created",
    amountDue: normalizedPricing.total ?? 0,
    razorpay: {},
    qr: {},
  };

  let distanceKm = null;
  if (
    restaurant.location?.coordinates?.length === 2 &&
    dto.address?.location?.coordinates?.length === 2
  ) {
    const [rLng, rLat] = restaurant.location.coordinates;
    const [dLng, dLat] = dto.address.location.coordinates;
    try {
      const origin = { lat: rLat, lng: rLng };
      const dests = [{ id: "delivery", lat: dLat, lng: dLng }];
      const distances = await getDrivingDistances(origin, dests);
      const distInfo = distances.get("delivery");
      
      if (distInfo && distInfo.distanceValue) {
        distanceKm = distInfo.distanceValue / 1000;
      } else {
        const d = haversineKm(rLat, rLng, dLat, dLng);
        distanceKm = Number.isFinite(d) ? d : null;
      }
    } catch (err) {
      const d = haversineKm(rLat, rLng, dLat, dLng);
      distanceKm = Number.isFinite(d) ? d : null;
    }
  } else {
    console.warn(
      `Food order: distance not available, rider earning set to 0`,
    );
  }

  let riderEarning = await getRiderEarning(distanceKm);
  
  // Apply delivery bonus from fee settings
  const feeSettings = await FoodFeeSettings.findOne({ isActive: true }).lean();
  const deliveryBonusAmount = Number(feeSettings?.deliveryBonusAmount || 0);
  if (deliveryBonusAmount > 0) {
    riderEarning += deliveryBonusAmount;
  }
  
  // Calculate restaurant commission and taxes from subtotal
  const commissionSnapshot = await foodTransactionService.getRestaurantCommissionSnapshot({
    pricing: normalizedPricing,
    restaurantId: dto.restaurantId
  });

  normalizedPricing.restaurantCommission = commissionSnapshot.commissionAmount || 0;
  normalizedPricing.gstOnItem = commissionSnapshot.gstOnItem || 0;
  normalizedPricing.gstOnCommission = commissionSnapshot.gstOnCommission || 0;
  normalizedPricing.paymentGatewayFee = commissionSnapshot.paymentGatewayFee || 0;
  normalizedPricing.tcs = commissionSnapshot.tcs || 0;

  const platformProfit = Math.max(
    0,
    (Number.isFinite(normalizedPricing.deliveryFee) ? normalizedPricing.deliveryFee : 0) +
      (Number.isFinite(normalizedPricing.platformFee) ? normalizedPricing.platformFee : 0) +
      normalizedPricing.restaurantCommission + 
      normalizedPricing.gstOnItem +
      normalizedPricing.paymentGatewayFee + 
      normalizedPricing.tcs -
      riderEarning,
  );

  const order = new FoodOrder({
    userId: new mongoose.Types.ObjectId(userId),
    restaurantId: new mongoose.Types.ObjectId(dto.restaurantId),
    zoneId: dto.zoneId
      ? new mongoose.Types.ObjectId(dto.zoneId)
      : restaurant.zoneId,
    items: dto.items,
    deliveryAddress,
    customerName: dto.customerName || deliveryAddress.fullName || "",
    customerPhone: dto.customerPhone || deliveryAddress.phone || "",
    pricing: normalizedPricing,
    payment,
    orderStatus: "created",
    dispatch: { modeAtCreation: dispatchMode, status: "unassigned" },
    statusHistory: [
      {
        at: new Date(),
        byRole: "SYSTEM",
        from: "",
        to: "created",
        note: "Order placed",
      },
    ],
    note: dto.note || "",
    restaurantNote: dto.restaurantNote || "",
    sendCutlery: dto.sendCutlery !== false,
    deliveryFleet: dto.deliveryFleet || "standard",
    scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
    riderEarning,
    deliveryBonusAmount,
    platformProfit,
  });

  let razorpayPayload = null;

  if (paymentMethod === "razorpay" && isRazorpayConfigured()) {
    const amountPaise = Math.round((normalizedPricing.total ?? 0) * 100);
    if (amountPaise < 100)
      throw new ValidationError("Amount too low for online payment");
    try {
      const rzOrder = await createRazorpayOrder(amountPaise, "INR", order._id.toString());
      razorpayPayload = {
        key: getRazorpayKeyId(),
        orderId: rzOrder.id,
        amount: rzOrder.amount,
        currency: rzOrder.currency || "INR",
      };
      // Store Razorpay order id in local payment snapshot (ledger will store it)
      payment.razorpay = { orderId: rzOrder.id, paymentId: "", signature: "" };
      payment.status = "created";
    } catch (err) {
      throw new ValidationError(err?.message || "Payment gateway error");
    }
  }

  await order.save();

  if (isWallet) {
    try {
      await userWalletService.deductWalletBalance(userId, order.pricing.total, `Payment for order #${order.order_id || order._id}`, { orderId: order._id });
    } catch (err) {
      // If wallet deduction fails (e.g. insufficient balance), we should not have saved the order or we should delete/cancel it.
      // But since we already saved it, let's at least throw the error so the user knows.
      // Ideally this should be in a transaction.
      await FoodOrder.deleteOne({ _id: order._id });
      throw err;
    }
  }

  // Phase 2: store financials in ledger only.
  await foodTransactionService.createInitialTransaction({
    ...(order.toObject?.() || order),
    pricing: normalizedPricing,
    payment,
  });

  if (paymentMethod === "razorpay" && payment?.razorpay?.orderId) {
    // Audit can still happen here or via FinanceService events
  }

  // Realtime + push notifications.
  try {
    // Notify customer. For online payments, order is created but awaits payment confirmation.
    const isAwaitingOnlinePayment =
      String(paymentMethod || "").toLowerCase() === "razorpay" &&
      String(payment?.status || "").toLowerCase() !== "paid";
    await notifyOwnersSafely([{ ownerType: "USER", ownerId: userId }], {
      title: isAwaitingOnlinePayment
        ? "Complete Payment to Confirm Order"
        : "Order Confirmed! 🍔",
      body: isAwaitingOnlinePayment
        ? `Order #${order.order_id || order._id} is created. Please complete payment to send it to ${restaurant.restaurantName || "the restaurant"}.`
        : `Your order #${order.order_id || order._id} from ${restaurant.restaurantName || "the restaurant"} has been placed successfully.`,
      image: "https://i.ibb.co/3m2Yh7r/Tuggo-Brand-Image.png",
      data: {
        type: isAwaitingOnlinePayment
          ? "order_created_pending_payment"
          : "order_created",
        orderId: String(order._id),
        orderMongoId: order._id?.toString?.() || "",
        link: `/food/user/orders/${order._id?.toString?.() || ""}`,
      },
    });

    // Restaurant gets new-order request only when payment is already settled.
    // For Razorpay (online) payments, we skip here because verifyPayment() will
    // call notifyRestaurantNewOrder() AFTER payment is confirmed — preventing a
    // duplicate FCM push to the restaurant for the same order.
    if (!isAwaitingOnlinePayment) {
      await notifyRestaurantNewOrder(order);
    }
  } catch {
    // Don't block order placement on socket failures.
  }
  const couponCode = dto.pricing?.couponCode
    ? String(dto.pricing.couponCode).trim().toUpperCase()
    : "";
  if (couponCode) {
    const offer = await FoodOffer.findOne({ couponCode }).lean();
    if (offer) {
      await FoodOffer.updateOne({ _id: offer._id }, { $inc: { usedCount: 1 } });
      if (userId) {
        await FoodOfferUsage.updateOne(
          { offerId: offer._id, userId: new mongoose.Types.ObjectId(userId) },
          { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
          { upsert: true },
        );
      }
    } else {
      const { default: Promocode } = await import('../../../../models/Promocode.js');
      await Promocode.updateOne(
        { code: couponCode, restaurantId: dto.restaurantId },
        { $inc: { usageCount: 1 } }
      );
    }
  }

  const dispatchableStatuses = [
    "confirmed",
    "preparing",
    "ready_for_pickup",
    "ready",
    "picked_up",
  ];
  if (
    dispatchMode === "auto" &&
    (isCash ||
      order.payment.status === "paid" ||
      order.payment.status === "cod_pending") &&
    dispatchableStatuses.includes(order.orderStatus)
  ) {
    try {
      await tryAutoAssign(order._id);
    } catch {
      // leave unassigned
    }
  }

  const saved = normalizeOrderForClient(order);
  return { order: saved, razorpay: razorpayPayload };
}

// ----- Verify payment -----
export async function verifyPayment(userId, dto) {
  const identity = buildOrderIdentityFilter(dto.orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  if (order.payment.status === "paid")
    return { order: normalizeOrderForClient(order), payment: order.payment };

  const valid = verifyPaymentSignature(
    dto.razorpayOrderId,
    dto.razorpayPaymentId,
    dto.razorpaySignature,
  );
  if (!valid) throw new ValidationError("Payment verification failed");

  order.payment.status = "paid";
  order.payment.razorpay.paymentId = dto.razorpayPaymentId;
  order.payment.razorpay.signature = dto.razorpaySignature;
  pushStatusHistory(order, {
    byRole: "USER",
    byId: userId,
    from: order.orderStatus,
    to: "created",
    note: "Payment verified",
  });
  await order.save();

  await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
    status: 'captured',
    razorpayPaymentId: dto.razorpayPaymentId,
    razorpaySignature: dto.razorpaySignature,
    recordedByRole: "USER",
    recordedById: new mongoose.Types.ObjectId(userId)
  });

    // After online payment is verified, now notify restaurant about the new order.
  await notifyRestaurantNewOrder(order);

  // Notify Customer about payment success
  await notifyOwnersSafely([{ ownerType: "USER", ownerId: userId }], {
    title: "Payment Successful! ✅",
    body: `We have received your payment of ₹${order.payment.amountDue} for Order #${order._id.toString()}.`,
    image: "https://i.ibb.co/3m2Yh7r/Tuggo-Brand-Image.png",
    data: {
      type: "payment_success",
      orderId: String(order._id.toString()),
      orderMongoId: String(order._id),
    },
  });

  const settings = await getDispatchSettings();
  const dispatchableStatuses = [
    "confirmed",
    "preparing",
    "ready_for_pickup",
    "ready",
    "picked_up",
  ];
  if (settings.dispatchMode === "auto" && dispatchableStatuses.includes(order.orderStatus)) {
    try {
      await tryAutoAssign(order._id);
    } catch {}
  }

  return { order: normalizeOrderForClient(order), payment: order.payment };
}

// ----- Auto-assign -----

/**
 * Start or continue a smart cascading dispatch.
 * @param {string} orderId - Mongo ID of the order.
 * @param {object} options - Options (retry count, etc)
 */
export async function tryAutoAssign(orderId, options = {}) {
    return dispatchService.tryAutoAssign(orderId, options);
}

/**
 * Triggered by worker after 60 seconds of zero response.
 */
export async function processDispatchTimeout(orderId, partnerId, options = {}) {
    return dispatchService.processDispatchTimeout(orderId, partnerId, options);
}

// ----- User: list, get, cancel -----
export async function listOrdersUser(userId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = {
    userId: new mongoose.Types.ObjectId(userId),
    // Exclude unpaid Razorpay orders (payment failed / user closed gateway)
    $nor: [
      { "payment.method": "razorpay", "payment.status": "created" }
    ]
  };
  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .populate(
        "restaurantId",
        "restaurantName profileImage area city location rating totalRatings",
      )
      .populate("dispatch.deliveryPartnerId", "name phone rating totalRatings")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  return buildPaginatedResult({
    docs: docs.map((doc) => normalizeOrderForClient(doc)),
    total,
    page,
    limit,
  });
}

export async function getOrderById(
  orderId,
  { userId, restaurantId, deliveryPartnerId, admin } = {},
) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");
  const order = await FoodOrder.findOne(identity)
    .populate(
      "restaurantId",
      "restaurantName ownerPhone profileImage area city location rating totalRatings primaryContactNumber",
    )
    .populate("dispatch.deliveryPartnerId", "name fullName phone phoneNumber rating totalRatings profileImage avatar")
    .populate("userId", "name fullName phone email")
    .select("+deliveryOtp +pickupOtp")
    .lean();
  if (!order) throw new NotFoundError("Order not found");

  if (admin) return normalizeOrderForClient(order);

  const orderUserId = order.userId?._id?.toString() || order.userId?.toString();
  const orderRestaurantId = order.restaurantId?._id?.toString() || order.restaurantId?.toString();
  const orderPartnerId = order.dispatch?.deliveryPartnerId?._id?.toString() || order.dispatch?.deliveryPartnerId?.toString();

  if (userId && orderUserId !== userId.toString())
    throw new ForbiddenError("Not your order");
  if (restaurantId && orderRestaurantId !== restaurantId.toString())
    throw new ForbiddenError("Not your restaurant order");
  if (deliveryPartnerId && orderPartnerId !== deliveryPartnerId.toString())
    throw new ForbiddenError("Not assigned to you");

  if (deliveryPartnerId || restaurantId) {
    const sanitized = sanitizeOrderForExternal(order);
    if (restaurantId && order.pickupOtp) {
      sanitized.pickupOtp = order.pickupOtp;
    }
    return sanitized;
  }

  if (userId) {
    const drop = order.deliveryVerification?.dropOtp || {};
    const secret = String(order.deliveryOtp || "").trim();
    const out = normalizeOrderForClient(order);
    delete out.deliveryOtp;
    out.deliveryVerification = {
      ...(order.deliveryVerification || {}),
      dropOtp: {
        required: Boolean(drop.required),
        verified: Boolean(drop.verified),
      },
    };
    if (secret && !["delivered", "cancelled_by_user", "cancelled_by_restaurant", "cancelled_by_admin", "dead"].includes(order.orderStatus)) {
      out.handoverOtp = secret;
    }
    return out;
  }

  return sanitizeOrderForExternal(order);
}

export async function getDropOtpUser(orderId, userId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");
  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  }).select("+deliveryOtp");
  if (!order) throw new NotFoundError("Order not found");

  const phase = order.deliveryState?.currentPhase;
  const isEligible = phase === "at_drop";

  if (!isEligible) {
    throw new ValidationError(
      "OTP will appear once the delivery partner requests it at your location."
    );
  }

  if (!String(order.deliveryOtp || "").trim()) {
    throw new ValidationError(
      "OTP is not available yet. Ask the delivery partner to request OTP again."
    );
  }

  return { otp: order.deliveryOtp };
}

/**
 * Watchdog: Recovers orders stuck in 'assigned' or 'preparing' status for too long.
 * Should be called on server startup.
 */
export async function recoverStuckOrders() {
  const now = new Date();
  const FIVE_MIN = 5 * 60 * 1000;
  const TWO_MIN = 2 * 60 * 1000;

  try {
    // 1. Stuck in 'assigned' (partner never accepted) for > 2m
    const stuckAssigned = await FoodOrder.find({
      'dispatch.status': 'assigned',
      'dispatch.acceptedAt': { $exists: false },
      'dispatch.assignedAt': { $lt: new Date(now - TWO_MIN) },
      orderStatus: { $nin: ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant'] }
    });

    if (stuckAssigned.length > 0) {
      logger.info(`Watchdog: Healing ${stuckAssigned.length} stuck assigned orders.`);
      for (const order of stuckAssigned) {
        order.dispatch.status = 'unassigned';
        order.dispatch.deliveryPartnerId = null;
        await order.save();
        await dispatchService.cancelPendingDispatchJob(order._id);
        const resumeAttempt = Math.max(1, Number(order.dispatch?.dispatchAttempt || 1));
        await tryAutoAssign(order._id, { attempt: resumeAttempt });
      }
    }

    // 2. Clear old dispatching locks (cleanup in case of crash)
    await FoodOrder.updateMany(
      { 'dispatch.dispatchingAt': { $lt: new Date(now - FIVE_MIN) } },
      { $unset: { 'dispatch.dispatchingAt': '' } }
    );

    // 3. Auto-cancel stale unpaid Razorpay orders (payment never completed)
    const FIFTEEN_MIN = 15 * 60 * 1000;
    const staleUnpaidResult = await FoodOrder.updateMany(
      {
        'payment.method': 'razorpay',
        'payment.status': 'created',
        orderStatus: 'created',
        createdAt: { $lt: new Date(now - FIFTEEN_MIN) }
      },
      {
        $set: {
          orderStatus: 'cancelled_by_user',
          'payment.status': 'failed'
        },
        $push: {
          statusHistory: {
            at: now,
            byRole: 'SYSTEM',
            from: 'created',
            to: 'cancelled_by_user',
            note: 'Auto-cancelled: payment was never completed (15 min timeout)'
          }
        }
      }
    );
    if (staleUnpaidResult.modifiedCount > 0) {
      logger.info(`Watchdog: Auto-cancelled ${staleUnpaidResult.modifiedCount} stale unpaid Razorpay orders.`);
    }

    // 4. Removed 1-hour auto-kill limit as per user request to allow infinite dispatch hunt.

  } catch (err) {
    logger.error(`Watchdog recovery error: ${err.message}`);
  }
}

export async function resyncState(userId, role) {
  const DELIVERY_RESYNC_OFFER_TTL_MS = 60 * 1000;
  if (role === "USER") {
    const order = await FoodOrder.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      orderStatus: {
        $nin: [
          "delivered",
          "cancelled_by_user",
          "cancelled_by_restaurant",
          "cancelled_by_admin",
          "dead"
        ],
      },
      // Exclude unpaid Razorpay orders (payment failed / user closed gateway)
      $nor: [
        { "payment.method": "razorpay", "payment.status": "created" }
      ]
    })
      .select("+deliveryOtp")
      .sort({ createdAt: -1 })
      .lean();

    if (order) {
      const out = normalizeOrderForClient(order);
      // Re-add handover OTP if order is picked up
      if (
        (order.deliveryState?.currentPhase === "at_drop" || order.orderStatus === "picked_up") &&
        order.deliveryOtp
      ) {
        out.handoverOtp = order.deliveryOtp;
      }
      return { activeOrder: out };
    }
    return { activeOrder: null };
  }

  if (role === "DELIVERY_PARTNER") {
    const activeOrder = await FoodOrder.findOne({
      "dispatch.deliveryPartnerId": new mongoose.Types.ObjectId(userId),
      "dispatch.status": { $in: ["assigned", "accepted"] },
      orderStatus: {
        $nin: ["delivered", "cancelled_by_user", "cancelled_by_restaurant"],
      },
    })
      .populate("restaurantId")
      .lean();

    const pendingOfferDocs = await FoodOrder.find({
      "dispatch.status": "unassigned",
      orderStatus: { $in: ["confirmed", "preparing", "ready_for_pickup"] },
      "dispatch.offeredTo.partnerId": new mongoose.Types.ObjectId(userId),
    })
      .populate("restaurantId")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    logger.info(`[DeliveryPopupServer] resyncState start rider=${userId} activeOrder=${activeOrder ? (activeOrder.order_id || activeOrder._id?.toString?.() || activeOrder._id) : 'none'} pendingOfferDocs=${pendingOfferDocs.length}`);

    const pendingOffers = [];
    for (const doc of pendingOfferDocs || []) {
      const offers = Array.isArray(doc?.dispatch?.offeredTo) ? doc.dispatch.offeredTo : [];
      const partnerOffers = offers.filter(
        (entry) => String(entry?.partnerId || "") === String(userId),
      );

      if (!partnerOffers.length) {
        logger.info(`[DeliveryPopupServer] resync skip order=${doc.order_id || doc._id} rider=${userId} reason=no_partner_offer_entry`);
        continue;
      }

      const latest = partnerOffers[partnerOffers.length - 1];
      const latestAction = String(latest?.action || "");
      const offeredAt = latest?.at ? new Date(latest.at).getTime() : 0;
      const offerAgeMs = offeredAt && !Number.isNaN(offeredAt) ? Date.now() - offeredAt : null;

      if (latestAction !== "offered") {
        logger.info(`[DeliveryPopupServer] resync skip order=${doc.order_id || doc._id} rider=${userId} reason=latest_action_${latestAction || 'missing'} offerAgeMs=${offerAgeMs ?? 'na'}`);
        continue;
      }

      if (!offeredAt || Number.isNaN(offeredAt)) {
        logger.info(`[DeliveryPopupServer] resync skip order=${doc.order_id || doc._id} rider=${userId} reason=invalid_offer_timestamp`);
        continue;
      }

      if (offerAgeMs > DELIVERY_RESYNC_OFFER_TTL_MS) {
        logger.info(`[DeliveryPopupServer] resync skip order=${doc.order_id || doc._id} rider=${userId} reason=offer_expired offerAgeMs=${offerAgeMs} ttlMs=${DELIVERY_RESYNC_OFFER_TTL_MS}`);
        continue;
      }

      pendingOffers.push(buildDeliverySocketPayload(doc, doc.restaurantId));
      logger.info(`[DeliveryPopupServer] resync include order=${doc.order_id || doc._id} rider=${userId} offerAgeMs=${offerAgeMs}`);
    }

    logger.info(`[DeliveryPopupServer] resyncState result rider=${userId} pendingOffers=${pendingOffers.length}`);

    return {
      activeOrder: activeOrder ? sanitizeOrderForExternal(activeOrder) : null,
      pendingOffers,
    };
  }

  return {};
}

export async function cancelOrder(orderId, userId, reason, refundDestination = "source") {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");

  const allowed = ["created"];
  const timeSinceCreation = Date.now() - new Date(order.createdAt).getTime();
  const isWithin60Seconds = timeSinceCreation <= 65000; // 65 seconds grace period
  
  if (!allowed.includes(order.orderStatus) && !isWithin60Seconds) {
    throw new ValidationError("Order cannot be cancelled after 60 seconds");
  }
  
  if (["delivered", "picked_up", "cancelled_by_user", "cancelled_by_restaurant"].includes(order.orderStatus)) {
      throw new ValidationError("Order cannot be cancelled in its current state");
  }

  const from = order.orderStatus;
  order.orderStatus = "cancelled_by_user";
  pushStatusHistory(order, {
    byRole: "USER",
    byId: userId,
    from,
    to: "cancelled_by_user",
    note: reason || "",
  });

  const paymentMethod = String(order.payment?.method || "cash").toLowerCase();
  const paymentStatus = String(order.payment?.status || "cod_pending").toLowerCase();
  const normalizedRefundDestination =
    String(refundDestination || "source").toLowerCase() === "wallet"
      ? "wallet"
      : "source";
  const hasRefundProcessed =
    String(order.payment?.refund?.status || "none").toLowerCase() === "processed";

  // ✅ NEW: Automated Razorpay Refund on User Cancel
  if (
    paymentStatus === "paid" &&
    paymentMethod === "razorpay" &&
    order.payment?.razorpay?.paymentId &&
    !hasRefundProcessed
  ) {
    try {
      if (normalizedRefundDestination === "wallet") {
        await userWalletService.refundWalletBalance(
          userId,
          order.pricing.total,
          `Refund for cancelled order #${order.order_id || order._id}`,
          { orderId: order._id, source: "order_refund_wallet" },
        );
        order.payment.status = "refunded";
        order.payment.refund = {
          status: "processed",
          destination: "wallet",
          amount: order.pricing.total,
          refundId: "",
          processedAt: new Date()
        };
      } else {
        const refundResult = await initiateRazorpayRefund(
          order.payment.razorpay.paymentId,
          order.pricing.total
        );

        if (refundResult.success) {
          order.payment.status = "refunded";
          order.payment.refund = {
            status: "processed",
            destination: "source",
            amount: order.pricing.total,
            refundId: refundResult.refundId,
            processedAt: new Date()
          };
        } else {
          // Log failure but let order cancellation proceed
          order.payment.refund = {
            status: "failed",
            destination: "source",
            amount: order.pricing.total
          };
        }
      }
    } catch (err) {
      console.error(`Refund processing error for Order ${orderId}:`, err);
      order.payment.refund = {
        status: "failed",
        destination: normalizedRefundDestination,
        amount: order.pricing.total,
      };
    }
  } else if (
    paymentStatus === "paid" &&
    paymentMethod === "wallet" &&
    !hasRefundProcessed
  ) {
    try {
      await userWalletService.refundWalletBalance(userId, order.pricing.total, `Refund for cancelled order #${order.order_id || order._id}`, { orderId: order._id });
      order.payment.status = "refunded";
      order.payment.refund = {
        status: "processed",
        destination: "wallet",
        amount: order.pricing.total,
        processedAt: new Date()
      };
    } catch (err) {
      console.error(`Wallet refund processing error for Order ${orderId}:`, err);
      order.payment.refund = { status: "failed", destination: "wallet", amount: order.pricing.total };
    }
  }

  await order.save();

  enqueueOrderEvent("order_cancelled_by_user", {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    userId,
    reason: reason || "",
  });

  // Sync transaction status
  try {
    const finalPaymentMethod = String(order.payment?.method || paymentMethod || "cash").toLowerCase();
    const finalPaymentStatus = String(order.payment?.status || paymentStatus || "cod_pending").toLowerCase();
    const isOnlinePaid =
      finalPaymentMethod === "razorpay" &&
      (finalPaymentStatus === "paid" || finalPaymentStatus === "refunded");
    await foodTransactionService.updateTransactionStatus(order._id, 'cancelled_by_user', {
        status: isOnlinePaid ? 'refunded' : 'failed',
        note: `Order cancelled by user: ${reason || "No reason"}`,
        recordedByRole: 'USER',
        recordedById: userId
    });
  } catch (err) {
    logger.warn(`cancelOrder transaction sync failed: ${err?.message || err}`);
  }

  // Notify User and Restaurant about the cancellation
  const finalPaymentMethod = String(order.payment?.method || paymentMethod || "cash").toLowerCase();
  const finalPaymentStatus = String(order.payment?.status || paymentStatus || "cod_pending").toLowerCase();
  const isOnlinePaid =
    finalPaymentMethod === "razorpay" &&
    (finalPaymentStatus === "paid" || finalPaymentStatus === "refunded");
  const settledRefundDestination =
    String(order.payment?.refund?.destination || normalizedRefundDestination || "source").toLowerCase() === "wallet"
      ? "wallet"
      : "source";
  const refundDetail = isOnlinePaid
    ? settledRefundDestination === "wallet"
      ? ` Your refund of ₹${order.pricing.total} has been credited to your wallet.`
      : ` Your refund of ₹${order.pricing.total} is being processed and will be credited to your original payment method within 5-7 working days.`
    : "";
  
  await notifyOwnersSafely(
    [
      { ownerType: "USER", ownerId: userId },
      { ownerType: "RESTAURANT", ownerId: order.restaurantId },
    ],
    {
      title: "Order Cancelled ❌",
      body: `Order #${order.order_id || order._id} has been cancelled by the customer. Reason: ${reason || "No reason provided"}.${refundDetail}`,
      image: "https://i.ibb.co/3m2Yh7r/Tuggo-Brand-Image.png",
      data: {
        type: "order_cancelled",
        orderId: String(order._id.toString()),
        orderMongoId: String(order._id),
      },
    },
  );

  // Real-time: status update via socket
  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        message: `Order #${order.order_id || order._id} has been cancelled by the customer. Reason: ${reason || "No reason provided"}.${refundDetail}`
      };
      io.to(rooms.user(userId)).emit("order_status_update", payload);
      io.to(rooms.restaurant(order.restaurantId)).emit("order_status_update", payload);
      
      const assignedRiderId = order.dispatch?.deliveryPartnerId;
      if (assignedRiderId) {
          io.to(rooms.delivery(assignedRiderId)).emit("order_status_update", payload);
      } else if (Array.isArray(order.dispatch?.offeredTo)) {
          // If cancelled before a rider accepts it, dismiss the popup for everyone it was offered to
          const claimedPayload = {
            orderId: order._id.toString(),
            orderMongoId: order._id?.toString?.(),
            claimedBy: 'cancelled',
          };
          for (const offer of order.dispatch.offeredTo) {
            io.to(rooms.delivery(offer.partnerId)).emit('order_claimed', claimedPayload);
          }
      }
    }
  } catch (err) {
    logger.warn(`cancelOrder socket emit failed: ${err?.message || err}`);
  }

  return normalizeOrderForClient(order);
}

export async function submitOrderRatings(orderId, userId, dto) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  if (String(order.orderStatus) !== "delivered") {
    throw new ValidationError("You can rate only delivered orders");
  }

  const hasDeliveryPartner = !!order.dispatch?.deliveryPartnerId;
  if (hasDeliveryPartner && !dto.deliveryPartnerRating) {
    throw new ValidationError("Delivery partner rating is required");
  }

  const restaurantAlreadyRated = Number.isFinite(
    Number(order?.ratings?.restaurant?.rating),
  );
  const deliveryAlreadyRated = Number.isFinite(
    Number(order?.ratings?.deliveryPartner?.rating),
  );
  if (restaurantAlreadyRated || (hasDeliveryPartner && deliveryAlreadyRated)) {
    throw new ValidationError("Ratings already submitted for this order");
  }

  const now = new Date();
  order.ratings = order.ratings || {};
  order.ratings.restaurant = {
    rating: dto.restaurantRating,
    comment: dto.restaurantComment || "",
    ratedAt: now,
  };

  if (hasDeliveryPartner) {
    order.ratings.deliveryPartner = {
      rating: dto.deliveryPartnerRating,
      comment: dto.deliveryPartnerComment || "",
      ratedAt: now,
    };
  }

  await Promise.all([
    applyAggregateRating(
      FoodRestaurant,
      order.restaurantId,
      dto.restaurantRating,
    ),
    hasDeliveryPartner
      ? applyAggregateRating(
          FoodDeliveryPartner,
          order.dispatch.deliveryPartnerId,
          dto.deliveryPartnerRating,
        )
      : Promise.resolve(),
  ]);

    await order.save();
    enqueueOrderEvent('order_ratings_submitted', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        userId,
        restaurantRating: dto.restaurantRating,
        deliveryPartnerRating: hasDeliveryPartner ? dto.deliveryPartnerRating : null
    });
}

export async function updateOrderInstructions(orderId, userId, instructions) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  
  const allowedStatuses = ['created', 'confirmed', 'preparing'];
  if (!allowedStatuses.includes(order.orderStatus)) {
    throw new ValidationError("Instructions can no longer be updated for this order");
  }

  order.note = String(instructions || "").trim();
  await order.save();
  return order;
}

// ----- Restaurant -----
function applyRestaurantOrderStatusFilter(filter, statusRaw) {
  const status = typeof statusRaw === "string" ? statusRaw.trim().toLowerCase() : "";
  if (!status || status === "all") return;

  switch (status) {
    case "new":
      filter.orderStatus = { $in: ["created", "confirmed"] };
      break;
    case "preparing":
      filter.orderStatus = "preparing";
      break;
    case "ready":
    case "ready_for_pickup":
      filter.orderStatus = "ready_for_pickup";
      break;
    case "out_for_delivery":
    case "picked_up":
      filter.orderStatus = "picked_up";
      break;
    case "scheduled":
      filter.scheduledAt = { $ne: null };
      filter.orderStatus = {
        $in: ["created", "confirmed", "preparing", "ready_for_pickup"],
      };
      break;
    case "completed":
    case "delivered":
      filter.orderStatus = { $in: ["delivered", "completed"] };
      break;
    case "cancelled":
    case "canceled":
      filter.orderStatus = {
        $in: [
          "cancelled_by_user",
          "cancelled_by_restaurant",
          "cancelled_by_admin",
        ],
      };
      break;
    case "dead":
      filter.orderStatus = "dead";
      break;
    default:
      break;
  }
}

export async function listOrdersRestaurant(restaurantId, query) {
  const page = parseQueryPage(query.page, 1);
  const limit = parseQueryLimit(query.limit, 30, 100);
  const skip = (page - 1) * limit;
  const filter = {
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    $or: [
      { "payment.method": { $in: ["cash", "wallet"] } },
      { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } },
    ],
  };
  applyRestaurantOrderStatusFilter(filter, query.status);
  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .populate("userId", "name phone email profileImage")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('+pickupOtp')
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  const paginated = buildPaginatedResult({
    docs: docs.map((d) => {
      const o = normalizeOrderForClient(d);
      if (d.pickupOtp) o.pickupOtp = d.pickupOtp;
      return o;
    }),
    total,
    page,
    limit,
  });
  return { ...paginated, orders: paginated.data };
}

export async function updateOrderStatusRestaurant(
  orderId,
  restaurantId,
  orderStatus,
  note = ""
) {
  const identity = buildOrderIdentityFilter(orderId);
  let order = await FoodOrder.findOne({
    ...identity,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  });
  if (!order) throw new NotFoundError("Order not found");
  const from = order.orderStatus;
  if (!isStatusAdvance(from, orderStatus)) {
      throw new ValidationError(`Current order status '${from}' is further ahead than '${orderStatus}'. Order cannot be moved backwards.`);
  }
  order.orderStatus = orderStatus;
  pushStatusHistory(order, {
    byRole: "RESTAURANT",
    byId: restaurantId,
    from,
    to: orderStatus,
    note: note || ""
  });
  await order.save();

  // Custom messages / titles for status updates
  let title = `Order ${order._id.toString()} updated`;
  let body = `Status changed to ${String(orderStatus).replace(/_/g, " ")}`;

  if (orderStatus === "confirmed") {
    title = "Order Accepted! 🧑‍🍳";
    body = "The restaurant has accepted your order and is starting to prepare it.";
  } else if (orderStatus === "preparing") {
    title = "Food is being prepared! 🍳";
    body = "Your food is currently being prepared by the restaurant.";
  } else if (orderStatus === "ready_for_pickup") {
    title = "Food is ready! 🛍️";
    body = "Your order is ready and waiting to be picked up.";
  } else if (String(orderStatus).includes("cancel")) {
    const isOnlinePaid = order.payment.method === "razorpay" && (order.payment.status === "paid" || order.payment.status === "refunded");
    const refundDetail = isOnlinePaid ? ` Your refund of ₹${order.pricing.total} is being processed and will be credited to your original payment method within 5-7 working days.` : "";
    
    title = "Order Cancelled ❌";
    body = `Unfortunately, your order has been cancelled by the restaurant.${refundDetail}`;
  }

  // Real-time: status update to restaurant room.
  try {
    const io = getIO();
    if (io) {
      console.log(
        `[DEBUG] Emitting status update to restaurant ${restaurantId} and user ${order.userId}: ${orderStatus}`,
      );
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        deliveryState: order.deliveryState,
        deliveryVerification:
          order.deliveryVerification?.toObject?.() || order.deliveryVerification,
        dispatch: order.dispatch,
        title,
        message: body,
      };
      
      const restRoom = rooms.restaurant(restaurantId);
      const userRoom = rooms.user(order.userId);
      
      console.log(`[DEBUG] Emitting order_status_update to rooms: ${restRoom}, ${userRoom}`);
      io.to(restRoom).emit("order_status_update", payload);
      io.to(userRoom).emit("order_status_update", payload);
      
      // Notify assigned rider via socket if they exist
      const assignedRiderId = order.dispatch?.deliveryPartnerId;
      if (assignedRiderId) {
          const riderRoom = rooms.delivery(assignedRiderId);
          console.log(`[DEBUG] Emitting order_status_update to rider room: ${riderRoom}`);
          io.to(riderRoom).emit("order_status_update", payload);
      } else if (String(orderStatus).includes('cancel') && Array.isArray(order.dispatch?.offeredTo)) {
          // If order is cancelled BEFORE a rider accepts it, dismiss the popup for everyone it was offered to
          const claimedPayload = {
            orderId: order._id.toString(),
            orderMongoId: order._id?.toString?.(),
            claimedBy: 'cancelled',
          };
          for (const offer of order.dispatch.offeredTo) {
            io.to(rooms.delivery(offer.partnerId)).emit('order_claimed', claimedPayload);
          }
          void clearDeliveryOffersForOrder(order);
      }
    }

    const notifyList = [
      { ownerType: "USER", ownerId: order.userId },
      { ownerType: "RESTAURANT", ownerId: restaurantId },
    ];

    const assignedRiderId = order.dispatch?.deliveryPartnerId;
    if (assignedRiderId) {
      notifyList.push({ ownerType: "DELIVERY_PARTNER", ownerId: assignedRiderId });
    }

    let riderTitle = `Order #${order.order_id || order._id} updated`;
    let riderBody = `The order status is now ${String(orderStatus).replace(/_/g, " ")}.`;

    if (String(orderStatus).includes("cancel")) {
      riderTitle = "Order Cancelled ❌";
      riderBody = `Order #${order.order_id || order._id} has been cancelled. Please stop your current task.`;
      
      // Sync transaction status
      try {
        const isOnlinePaid = order.payment.method === "razorpay" && (order.payment.status === "paid" || order.payment.status === "refunded");
        await foodTransactionService.updateTransactionStatus(order._id, 'cancelled_by_restaurant', {
            status: isOnlinePaid ? 'refunded' : 'failed',
            note: `Order cancelled by restaurant/admin`,
            recordedByRole: 'RESTAURANT',
            recordedById: restaurantId
        });
      } catch (err) {
        logger.warn(`updateOrderStatusRestaurant transaction sync failed: ${err?.message || err}`);
      }
    }

    await notifyOwnersSafely(
      notifyList,
      {
        title: title,
        body: body,
        image: "https://i.ibb.co/3m2Yh7r/Tuggo-Brand-Image.png",
        data: {
          type: "order_status_update",
          orderId: order._id.toString(),
          orderMongoId: order._id?.toString?.() || "",
          orderStatus: String(orderStatus || ""),
          link: `/food/user/orders/${order._id?.toString?.() || ""}`,
        },
      },
    );
  } catch (err) {
    console.error("[DEBUG] Error emitting status update to restaurant:", err);
  }

  // Real-time: delivery request / ready notifications.
  try {
    const io = getIO();
    if (io) {
      // On accept (confirmed or preparing) -> request delivery partners via central logic
      if (
        (String(orderStatus) === "preparing" || String(orderStatus) === "confirmed") && 
        (String(from) !== "preparing" && String(from) !== "confirmed")
      ) {
        console.log(
          `[DEBUG] Order ${order._id.toString()} status changed to '${orderStatus}'. Triggering FRESH delivery dispatch.`,
        );
        
        try {
            // CRITICAL: Reset dispatch state so tryAutoAssign is NOT blocked by stale locks
            // from any previous dispatch attempt (e.g. from createOrder flow).
            // This ensures restaurant accept ALWAYS triggers an immediate, fresh dispatch.
            const currentDispatchStatus = order.dispatch?.status;
            const isAlreadyAccepted = currentDispatchStatus === 'accepted' && order.dispatch?.acceptedAt;
            
            if (!isAlreadyAccepted) {
              await dispatchService.resetDispatchForFreshHunt(order._id);
            }
            
            await dispatchService.tryAutoAssign(order._id, { attempt: 1 });
            // Refresh local order state after assignment search
            order = await FoodOrder.findById(order._id); 
        } catch (err) {
            console.error(`[DEBUG] Auto-assign in updateOrderStatusRestaurant failed:`, err);
        }
      }

            // When ready for pickup -> ping assigned delivery partner.
            if (String(orderStatus) === 'ready_for_pickup' && String(from) !== 'ready_for_pickup') {
                console.log(`[DEBUG] Order ${order._id.toString()} changed to 'ready_for_pickup'.`);
                const assignedId = order.dispatch?.deliveryPartnerId?.toString?.() || order.dispatch?.deliveryPartnerId;
                if (assignedId) {
                    console.log(`[DEBUG] Notifying assigned partner ${assignedId} that order is ready.`);
                    const restaurant = await FoodRestaurant.findById(order.restaurantId).select('restaurantName location addressLine1 area city state').lean();
                    const payload = buildDeliverySocketPayload(order, restaurant);
                    logger.info(
                      `[DeliveryDispatch] Emitting order_ready to ${rooms.delivery(assignedId)} for order ${order._id.toString()}`,
                    );
                    io.to(rooms.delivery(assignedId)).emit('order_ready', payload);
                } else {
                    console.log(`[DEBUG] Order ${order._id.toString()} is ready but no partner assigned.`);
                }
            }
        }
    } catch (err) {
        console.error('[DEBUG] Error in delivery notification logic:', err);
    }

    enqueueOrderEvent('restaurant_order_status_updated', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        restaurantId,
        from,
        to: orderStatus
    });

    // ✅ NEW: Automated Razorpay Refund on Restaurant Cancel
    // Triggers if the restaurant sets status to a cancelled state (e.g., cancelled_by_restaurant)
    if (
      String(orderStatus).includes("cancel") &&
      order.payment.status === "paid" &&
      order.payment.method === "razorpay" &&
      order.payment.razorpay?.paymentId &&
      (!order.payment.refund || order.payment.refund.status !== "processed")
    ) {
      try {
        const refundResult = await initiateRazorpayRefund(
          order.payment.razorpay.paymentId,
          order.pricing.total
        );

        if (refundResult.success) {
          order.payment.status = "refunded";
          order.payment.refund = {
            status: "processed",
            amount: order.pricing.total,
            refundId: refundResult.refundId,
            processedAt: new Date()
          };
        } else {
          // Record failure so admin knows a manual refund might be needed
          order.payment.refund = {
            status: "failed",
            amount: order.pricing.total
          };
        }
      } catch (err) {
        console.error(`Automated refund failed for Order ${order._id.toString()} (Restaurant Cancel):`, err);
        order.payment.refund = { status: "failed", amount: order.pricing.total };
      }
      // Re-save order with updated payment status
      await order.save();
    } else if (
      String(orderStatus).includes("cancel") &&
      order.payment.status === "paid" &&
      order.payment.method === "wallet" &&
      (!order.payment.refund || order.payment.refund.status !== "processed")
    ) {
      try {
        await userWalletService.refundWalletBalance(order.userId, order.pricing.total, `Refund for order #${order.order_id || order._id} cancelled by restaurant`, { orderId: order._id });
        order.payment.status = "refunded";
        order.payment.refund = {
          status: "processed",
          amount: order.pricing.total,
          processedAt: new Date()
        };
      } catch (err) {
        console.error(`Wallet refund processing error for Order ${order._id.toString()}:`, err);
        order.payment.refund = { status: "failed", amount: order.pricing.total };
      }
      // Re-save order with updated payment status
      await order.save();
    }

    return normalizeOrderForClient(order);
}

/**
 * Manually re-trigger delivery partner search for a restaurant order.
 * Only allowed if status is preparing/ready and no partner has accepted yet.
 */
export async function resendDeliveryNotificationRestaurant(orderId, restaurantId) {
  return dispatchService.resendDeliveryNotificationRestaurant(orderId, restaurantId);
}

export async function resendDeliveryNotificationAdmin(orderId) {
  return dispatchService.resendDeliveryNotificationAdmin(orderId);
}

export async function getCurrentTripDelivery(deliveryPartnerId) {
  return deliveryService.getCurrentTripDelivery(deliveryPartnerId);
}

export async function getActiveOrdersDelivery(deliveryPartnerId) {
  return deliveryService.getActiveOrdersDelivery(deliveryPartnerId);
}

// ----- Delivery: available, accept, reject, status -----
export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  return deliveryService.listOrdersAvailableDelivery(deliveryPartnerId, query);
}

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  return deliveryService.acceptOrderDelivery(orderId, deliveryPartnerId);
}

export async function rejectOrderDelivery(orderId, deliveryPartnerId) {
  return deliveryService.rejectOrderDelivery(orderId, deliveryPartnerId);
}

export async function passOrderOfferDelivery(orderId, deliveryPartnerId) {
  return deliveryService.passOrderOfferDelivery(orderId, deliveryPartnerId);
}

export async function confirmReachedPickupDelivery(orderId, deliveryPartnerId) {
  return deliveryService.confirmReachedPickupDelivery(orderId, deliveryPartnerId);
}

/**
 * Slide to confirm pickup (Bill uploaded)
 */
export async function confirmPickupDelivery(
  orderId,
  deliveryPartnerId,
  billImageUrl,
  otp
) {
  return deliveryService.confirmPickupDelivery(
    orderId,
    deliveryPartnerId,
    billImageUrl,
    otp
  );
}

export async function requestPickupOtp(orderId, deliveryPartnerId) {
  return deliveryService.requestPickupOtp(orderId, deliveryPartnerId);
}

export async function confirmReachedDropDelivery(orderId, deliveryPartnerId) {
  return deliveryService.confirmReachedDropDelivery(orderId, deliveryPartnerId);
}

export async function verifyDropOtpDelivery(orderId, deliveryPartnerId, otp) {
  return deliveryService.verifyDropOtpDelivery(orderId, deliveryPartnerId, otp);
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  return deliveryService.completeDelivery(orderId, deliveryPartnerId, body);
}



export async function updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus) {
  return deliveryService.updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus);
}

// ----- COD QR collection -----
export async function createCollectQr(orderId, deliveryPartnerId) {
  return paymentService.createCollectQr(orderId, deliveryPartnerId);
}

export async function getPaymentStatus(orderId, deliveryPartnerId) {
  return paymentService.getPaymentStatus(orderId, deliveryPartnerId);
}

// ----- Admin -----
export async function listOrdersAdmin(query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = {
    $or: [
      { "payment.method": { $in: ["cash", "wallet"] } },
      { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } },
    ],
  };

  const rawStatus =
    typeof query.status === "string" ? query.status.trim().toLowerCase() : "";
  const cancelledBy =
    typeof query.cancelledBy === "string"
      ? query.cancelledBy.trim().toLowerCase()
      : "";
  const restaurantIdRaw =
    typeof query.restaurantId === "string" ? query.restaurantId.trim() : "";
  const startDateRaw =
    typeof query.startDate === "string" ? query.startDate.trim() : "";
  const endDateRaw =
    typeof query.endDate === "string" ? query.endDate.trim() : "";

  if (rawStatus && rawStatus !== "all") {
    switch (rawStatus) {
      case "pending":
        filter.orderStatus = "created";
        break;
      case "accepted":
        filter.orderStatus = "confirmed";
        break;
      case "processing":
        filter.orderStatus = { $in: ["preparing", "ready_for_pickup"] };
        break;
      case "food-on-the-way":
        filter.orderStatus = "picked_up";
        break;
      case "delivered":
        filter.orderStatus = "delivered";
        break;
      case "canceled":
      case "cancelled":
        filter.orderStatus = {
          $in: [
            "cancelled_by_user",
            "cancelled_by_restaurant",
            "cancelled_by_admin",
            "dead"
          ],
        };
        break;
      case "restaurant-cancelled":
        filter.orderStatus = "cancelled_by_restaurant";
        break;
      case "payment-failed":
        filter["payment.status"] = "failed";
        break;
      case "refunded":
        filter["payment.status"] = "refunded";
        break;
      case "offline-payments":
        filter["payment.method"] = "cash";
        filter.orderStatus = { $in: ["created", "confirmed", "delivered"] };
        break;
      case "scheduled":
        filter.scheduledAt = { $ne: null };
        break;
      default:
        break;
    }
  }

  if (cancelledBy) {
    if (cancelledBy === "restaurant") {
      filter.orderStatus = "cancelled_by_restaurant";
    } else if (cancelledBy === "user" || cancelledBy === "customer") {
      filter.orderStatus = "cancelled_by_user";
    }
  }

  if (restaurantIdRaw && mongoose.Types.ObjectId.isValid(restaurantIdRaw)) {
    filter.restaurantId = new mongoose.Types.ObjectId(restaurantIdRaw);
  }

  if (startDateRaw || endDateRaw) {
    const createdAt = {};
    const start = startDateRaw ? new Date(startDateRaw) : null;
    const end = endDateRaw ? new Date(endDateRaw) : null;
    if (start && !Number.isNaN(start.getTime())) {
      createdAt.$gte = start;
    }
    if (end && !Number.isNaN(end.getTime())) {
      createdAt.$lte = end;
    }
    if (Object.keys(createdAt).length > 0) {
      filter.createdAt = createdAt;
    }
  }

  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .select("+deliveryOtp")
      .populate("userId", "name phone email")
      .populate("restaurantId", "restaurantName area city ownerPhone")
      .populate("dispatch.deliveryPartnerId", "name phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  const paginated = buildPaginatedResult({ docs: docs.map(d => normalizeOrderForClient(d)), total, page, limit });
  return { ...paginated, orders: paginated.data };
}

export async function assignDeliveryPartnerAdmin(
  orderId,
  deliveryPartnerId,
  adminId,
) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError("Order not found");
  
  if (order.dispatch?.deliveryPartnerId && order.dispatch?.status === "accepted") {
    throw new ValidationError("Order already assigned to another partner");
  }

  const cancellableStatuses = ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin', 'dead', 'delivered'];
  if (cancellableStatuses.includes(order.orderStatus)) {
    throw new ValidationError("Order is cancelled or delivered, cannot assign delivery partner");
  }

  const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
    .select("status availabilityStatus")
    .lean();
  if (!partner || partner.status !== "approved" || partner.availabilityStatus !== "online")
    throw new ValidationError("Delivery partner is not available or offline");

  const busyPartner = await FoodOrder.findOne({
    'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(deliveryPartnerId),
    'dispatch.status': 'accepted',
    orderStatus: { $in: ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up', 'reached_drop'] }
  });
  if (busyPartner) {
    throw new ValidationError("Delivery partner is currently busy with another order");
  }

  const paymentMethod = String(order.payment?.method || order.paymentMethod || 'cash').toLowerCase();
  if (paymentMethod === 'cash') {
      const { getPartnerCashCapacity } = await import('./order-delivery.service.js');
      const partnerCapacity = await getPartnerCashCapacity(deliveryPartnerId);
      const orderAmount = Math.max(0, Number(order.pricing?.total || 0));
      if (!partnerCapacity.hasCapacity || Number(partnerCapacity.availableCashLimit || 0) < orderAmount) {
          throw new ValidationError('Delivery partner cash limit exceeded for this COD order.');
      }
  }

  const now = new Date();
  order.dispatch.status = 'accepted';
  order.dispatch.deliveryPartnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  order.dispatch.assignedAt = now;
  order.dispatch.acceptedAt = now;
  
  pushStatusHistory(order, { byRole: 'ADMIN', byId: adminId, from: 'assigned', to: 'accepted', note: 'Manually assigned by admin' });
  await order.save();

  // Call the same post-acceptance logic
  try {
      // Firebase update
      const restLoc = order.restaurantId ? (await FoodRestaurant.findById(order.restaurantId).select('location').lean())?.location?.coordinates : null;
      const userLoc = order.deliveryAddress?.location?.coordinates;
      if (restLoc?.[0] && userLoc?.[0]) {
          const { fetchPolyline } = await import('../utils/googleMaps.js');
          const polyline = await fetchPolyline({ lat: restLoc[1], lng: restLoc[0] }, { lat: userLoc[1], lng: userLoc[0] });
          const { getFirebaseDB } = await import('../../../../config/firebase.js');
          const db = getFirebaseDB();
          if (db) {
             await db.ref(`active_orders/${order._id.toString()}`).set({
                polyline, lat: restLoc[1], lng: restLoc[0],
                boy_lat: restLoc[1], boy_lng: restLoc[0],
                restaurant_lat: restLoc[1], restaurant_lng: restLoc[0],
                customer_lat: userLoc[1], customer_lng: userLoc[0],
                status: 'accepted', last_updated: Date.now(),
             });
          }
      }

      const { getIO, rooms } = await import('../../../../config/socket.js');
      const io = getIO();
      if (io) {
          const payload = { orderMongoId: order._id.toString(), orderId: order._id.toString(), orderStatus: order.orderStatus, dispatchStatus: order.dispatch?.status };
          io.to(rooms.delivery(deliveryPartnerId)).emit('order_status_update', payload);
          io.to(rooms.restaurant(order.restaurantId)).emit('order_status_update', payload);
          io.to(rooms.user(order.userId)).emit('order_status_update', payload);
          io.to('all_delivery').emit('order_claimed', { orderId: order._id.toString(), claimedBy: deliveryPartnerId });
      }

      // FCM Notify Partner
      await notifyOwnerSafely(
          { ownerType: 'DELIVERY_PARTNER', ownerId: deliveryPartnerId },
          { title: 'New Order Assigned! 🚀', body: `Admin manually assigned order #${order._id.toString()} to you.`, data: { type: 'delivery_accepted', orderId: order._id.toString() } }
      );
  } catch(e) {
      console.error("Post manual assignment logic failed", e);
  }

  enqueueOrderEvent('delivery_accepted', {
      orderMongoId: order._id?.toString?.(),
      orderId: order._id.toString(),
      deliveryPartnerId,
      dispatchStatus: order.dispatch?.status,
      orderStatus: order.orderStatus,
  });

  return normalizeOrderForClient(order);
}

export async function updateOrderStatusAdmin(orderId, adminId, orderStatus, note = "") {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  let order = await FoodOrder.findOne(identity);
  if (!order) throw new NotFoundError("Order not found");

  const from = order.orderStatus;
  
  // Allow admin to move it backward or forward, but let's at least log it
  order.orderStatus = orderStatus;
  pushStatusHistory(order, {
    byRole: "ADMIN",
    byId: adminId,
    from,
    to: orderStatus,
    note: note || "Status updated by admin"
  });
  await order.save();

  try {
    const { getIO, rooms } = await import('../../../../config/socket.js');
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        title: `Order updated by Admin`,
        message: `Status changed to ${String(orderStatus).replace(/_/g, " ")}`,
        updatedBy: 'ADMIN'
      };
      io.to(rooms.restaurant(order.restaurantId)).emit("order_status_update", payload);
      io.to(rooms.user(order.userId)).emit("order_status_update", payload);
      if (order.dispatch?.deliveryPartnerId) {
          io.to(rooms.delivery(order.dispatch.deliveryPartnerId)).emit("order_status_update", payload);
      } else if (String(orderStatus).includes('cancel') && Array.isArray(order.dispatch?.offeredTo)) {
        const claimedPayload = {
          orderId: order._id.toString(),
          orderMongoId: order._id?.toString?.(),
          claimedBy: 'cancelled',
        };
        for (const offer of order.dispatch.offeredTo) {
          io.to(rooms.delivery(offer.partnerId)).emit('order_claimed', claimedPayload);
        }
      }
    }

    if (String(orderStatus).includes('cancel') || String(orderStatus) === 'delivered') {
      await dispatchService.cancelPendingDispatchJob(order._id);
      if (String(orderStatus).includes('cancel')) {
        void clearDeliveryOffersForOrder(order);
      }
    }

    // Real-time: delivery request / ready notifications.
    if (
      (String(orderStatus) === "preparing" || String(orderStatus) === "confirmed") && 
      (String(from) !== "preparing" && String(from) !== "confirmed")
    ) {
      console.log(
        `[DEBUG] Admin accepted order ${order._id.toString()}. Status changed to '${orderStatus}'. Triggering FRESH delivery dispatch.`
      );
      try {
        const currentDispatchStatus = order.dispatch?.status;
        const isAlreadyAccepted = currentDispatchStatus === 'accepted' && order.dispatch?.acceptedAt;
        
        if (!isAlreadyAccepted) {
          await dispatchService.resetDispatchForFreshHunt(order._id);
        }
        await dispatchService.tryAutoAssign(order._id, { attempt: 1 });
        order = await FoodOrder.findById(order._id); 
      } catch (err) {
        console.error(`[DEBUG] Auto-assign in updateOrderStatusAdmin failed:`, err);
      }
    }
  } catch (err) {
    logger.warn(`Admin update order socket emit failed: ${err?.message || err}`);
  }

  enqueueOrderEvent('order_status_updated_by_admin', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    adminId,
    from,
    to: orderStatus
  });

  return normalizeOrderForClient(order);
}

export async function deleteOrderAdmin(orderId, adminId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne(identity).lean();
  if (!order) throw new NotFoundError("Order not found");

  // Keep support tickets but detach deleted order reference.
  await Promise.all([
    FoodSupportTicket.updateMany(
      { orderId: order._id },
      { $set: { orderId: null } },
    ),
    FoodTransaction.deleteOne({
      $or: [{ orderId: order._id }, { orderReadableId: String(order._id.toString()) }],
    }),
    FoodOrder.deleteOne({ _id: order._id }),
  ]);

  // Remove realtime tracking node if present.
  try {
    const db = getFirebaseDB();
    if (db && order?.orderId) {
      await db.ref(`active_orders/${order._id.toString()}`).remove();
    }
  } catch (err) {
    logger.warn(`Delete order firebase cleanup failed: ${err?.message || err}`);
  }

  // Notify connected apps so stale UI entries can disappear without refresh.
  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: String(order._id),
        orderId: String(order._id.toString() || ""),
        deletedBy: "ADMIN",
        adminId: adminId ? String(adminId) : null,
      };

      if (order.userId) io.to(rooms.user(order.userId)).emit("order_deleted", payload);
      if (order.restaurantId) io.to(rooms.restaurant(order.restaurantId)).emit("order_deleted", payload);
      if (order.dispatch?.deliveryPartnerId) {
        io.to(rooms.delivery(order.dispatch.deliveryPartnerId)).emit("order_deleted", payload);
      }
    }
  } catch (err) {
    logger.warn(`Delete order socket emit failed: ${err?.message || err}`);
  }

  enqueueOrderEvent("order_deleted_by_admin", {
    orderMongoId: String(order._id),
    orderId: String(order._id.toString() || ""),
    adminId: adminId ? String(adminId) : null,
  });

  return {
    deleted: true,
    orderId: String(order._id.toString() || ""),
    orderMongoId: String(order._id),
  };
}

