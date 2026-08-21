import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodDeliveryCashDeposit } from '../../delivery/models/foodDeliveryCashDeposit.model.js';
import { FoodDeliveryCashLimit } from '../../admin/models/deliveryCashLimit.model.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../../../core/auth/errors.js';
import { buildPaginatedResult, buildPaginationOptions } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import { fetchPolyline } from '../utils/googleMaps.js';
import * as foodTransactionService from './foodTransaction.service.js';
import { syncRazorpayQrPayment } from './order-payment.service.js';
import * as dispatchService from './order-dispatch.service.js';
import { clearDeliveryOffersForOrder } from './order-dispatch.firebase.js';
import {
  buildOrderIdentityFilter,
  emitDeliveryDropOtpToUser,
  enqueueOrderEvent,
  generateFourDigitDeliveryOtp,
  notifyOwnerSafely,
  notifyOwnersSafely,
  pushStatusHistory,
  sanitizeOrderForExternal,
  isStatusAdvance,
} from './order.helpers.js';

function normalizeOtpValue(value) {
  return String(value ?? '').replace(/\D/g, '').trim();
}

function isOtpMatch(expectedOtp, enteredOtp) {
  const expected = normalizeOtpValue(expectedOtp);
  const entered = normalizeOtpValue(enteredOtp);
  if (!expected || !entered) return false;
  if (entered === expected) return true;

  // Accept last 4 digits if client sends prefixed/padded OTP.
  if (expected.length === 4 && entered.length > 4) {
    return entered.slice(-4) === expected;
  }

  return false;
}

export async function getPartnerCashCapacity(deliveryPartnerId) {
  const partnerObjectId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const limitDoc = await FoodDeliveryCashLimit.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();

  const totalCashLimit = Number(limitDoc?.deliveryCashLimit || 0);
  // If limit is not configured, don't block assignments globally.
  if (!Number.isFinite(totalCashLimit) || totalCashLimit <= 0) {
    return {
      totalCashLimit: 0,
      cashInHand: 0,
      availableCashLimit: Number.MAX_SAFE_INTEGER,
      hasCapacity: true,
    };
  }

  const [cashAgg, depositsAgg] = await Promise.all([
    FoodOrder.aggregate([
      {
        $match: {
          'dispatch.deliveryPartnerId': partnerObjectId,
          orderStatus: 'delivered',
        },
      },
      {
        $lookup: {
          from: 'food_transactions',
          localField: '_id',
          foreignField: 'orderId',
          as: 'tx',
        },
      },
      {
        $match: {
          $or: [
            { 'tx.paymentMethod': 'cash' },
            { 'tx': { $size: 0 }, 'payment.method': 'cash' }
          ]
        }
      },
      {
        $group: {
          _id: null,
          grossCashCollected: { $sum: { $ifNull: ['$pricing.total', 0] } },
        },
      },
    ]),
    FoodDeliveryCashDeposit.aggregate([
      {
        $match: {
          deliveryPartnerId: partnerObjectId,
          status: 'Completed',
        },
      },
      {
        $group: {
          _id: null,
          depositedCash: { $sum: { $ifNull: ['$amount', 0] } },
        },
      },
    ]),
  ]);

  const grossCashCollected = Number(cashAgg?.[0]?.grossCashCollected || 0);
  const depositedCash = Number(depositsAgg?.[0]?.depositedCash || 0);
  const cashInHand = Math.max(0, grossCashCollected - depositedCash);
  const availableCashLimit = Math.max(0, totalCashLimit - cashInHand);

  return {
    totalCashLimit,
    cashInHand,
    availableCashLimit,
    hasCapacity: availableCashLimit > 0,
  };
}

function emitOrderUpdate(order, deliveryPartnerId, options = {}) {
  const shouldSendMilestonePush = options?.sendMilestonePush !== false;
  try {
    const io = getIO();
    if (io) {
      const dv =
        order.deliveryVerification?.toObject?.() || order.deliveryVerification;
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        deliveryState: order.deliveryState,
        deliveryVerification: dv,
      };
      io.to(rooms.delivery(deliveryPartnerId)).emit(
        'order_status_update',
        payload,
      );
      io.to(rooms.restaurant(order.restaurantId)).emit(
        'order_status_update',
        payload,
      );
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);
    }

    // Only send push notifications for key delivery milestones when explicitly allowed.
    if (!shouldSendMilestonePush) return;

    // Only send push notifications for key delivery milestones
    const status = order.orderStatus;
    if (!['picked_up', 'reached_drop', 'delivered'].includes(status)) return;

    let userTitle = '';
    let userBody = '';
    let riderTitle = '';
    let riderBody = '';

    const orderId = order.order_id || order.orderId || order._id.toString();

    if (status === 'picked_up') {
      userTitle = 'Order on the way!';
      userBody = `Partner has picked up your order #${orderId} and is heading your way.`;
      riderTitle = 'Order picked up!';
      riderBody = `You have picked up order #${orderId}. Proceed to the customer location.`;
    } else if (status === 'reached_drop') {
      userTitle = 'Partner nearby!';
      userBody = `Your delivery partner has reached your location for order #${orderId}.`;
      riderTitle = 'Arrived at drop!';
      riderBody = `You have reached the customer location for order #${orderId}.`;
    } else if (status === 'delivered') {
      userTitle = `Order #${orderId} delivered!`;
      userBody = 'Hope you enjoyed your meal! Don\'t forget to rate your experience.';
      riderTitle = 'Delivery successful!';
      riderBody = `Order #${orderId} has been successfully delivered.`;

      if (order.payment?.method === 'cash' || order.paymentMethod === 'cash') {
        riderTitle = 'Payment collected!';
        const amt = order.pricing?.total || order.amounts?.totalCustomerPaid || 0;
        riderBody = `You have collected Rs ${amt} cash for Order #${orderId}.`;
      }
    }

    if (userTitle) {
      void notifyOwnerSafely(
        { ownerType: 'USER', ownerId: order.userId },
        {
          title: userTitle,
          body: userBody,
          dataOnly: true,
          data: {
            type: 'order_status_update',
            orderId,
            orderMongoId: order._id?.toString?.() || '',
            orderStatus: status,
          },
        },
      );
    }

    if (riderTitle) {
      void notifyOwnerSafely(
        { ownerType: 'DELIVERY_PARTNER', ownerId: deliveryPartnerId },
        {
          title: riderTitle,
          body: riderBody,
          dataOnly: true,
          data: {
            type: status === 'delivered' ? 'order_completed' : 'order_status_update',
            orderId,
            orderMongoId: order._id?.toString?.() || '',
            paymentMethod: order.payment?.method || order.paymentMethod,
            amountCollected: String(order.pricing?.total || order.amounts?.totalCustomerPaid || 0),
          },
        },
      );
    }
  } catch (error) {
    logger.error(`Error emitting delivery order update: ${error?.message || error}`);
  }
}

export async function getCurrentTripDelivery(deliveryPartnerId) {
  if (!deliveryPartnerId) {
    throw new ValidationError('Delivery partner ID required');
  }

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const order = await FoodOrder.findOne({
    'dispatch.deliveryPartnerId': partnerId,
    'dispatch.status': 'accepted',
    orderStatus: {
      $in: ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up'],
    },
  })
    .populate({
      path: 'restaurantId',
      select: 'restaurantName name phone location addressLine1 area city state profileImage',
    })
    .populate({ path: 'userId', select: 'name phone' })
    .sort({ updatedAt: -1 })
    .lean();

  if (!order) return null;
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const out = sanitizeOrderForExternal(order);
  if (tx) {
    out.paymentMethod = tx.payment?.method || tx.paymentMethod || out.paymentMethod;
    out.payment = tx.payment || out.payment;
    out.pricing = tx.pricing || out.pricing;
    out.amounts = tx.amounts || out.amounts;
    out.transactionStatus = tx.status || out.transactionStatus;
  }
  return out;
}

export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const partnerCapacity = await getPartnerCashCapacity(deliveryPartnerId);
  const cashLimit = {
    blocked: false,
    message: '',
    totalCashLimit: Number(partnerCapacity.totalCashLimit || 0),
    cashInHand: Number(partnerCapacity.cashInHand || 0),
    availableCashLimit: Number(partnerCapacity.availableCashLimit || 0),
  };

  const activeOwnOrderFilter = {
    'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(deliveryPartnerId),
    orderStatus: {
      $nin: [
        'delivered',
        'cancelled_by_user',
        'cancelled_by_restaurant',
        'cancelled_by_admin',
        'dead',
      ],
    },
  };

  const filter = {
    $or: [
      {
        'dispatch.status': 'unassigned',
        orderStatus: { $in: ['confirmed', 'preparing', 'ready_for_pickup'] },
      },
      activeOwnOrderFilter,
    ],
  };

  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name phone email')
      .populate(
        'restaurantId',
        'restaurantName name address phone ownerPhone location profileImage',
      )
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);

  const orderIds = (docs || []).map((d) => d?._id).filter(Boolean);
  const txRows = orderIds.length
    ? await FoodTransaction.find({ orderId: { $in: orderIds } }).lean()
    : [];
  const txByOrderId = new Map(txRows.map((t) => [String(t.orderId), t]));

  const enriched = (docs || []).map((doc) => {
    const tx = txByOrderId.get(String(doc?._id)) || null;
    if (!tx) return doc;
    return {
      ...doc,
      paymentMethod: tx.payment?.method || tx.paymentMethod || doc.paymentMethod,
      payment: tx.payment || doc.payment,
      pricing: tx.pricing || doc.pricing,
      amounts: tx.amounts || doc.amounts,
      transactionStatus: tx.status || doc.transactionStatus,
    };
  });

  const popupTtlMs = 60 * 1000;
  for (const doc of enriched || []) {
    const offers = Array.isArray(doc?.dispatch?.offeredTo) ? doc.dispatch.offeredTo : [];
    const partnerOffers = offers.filter(
      (entry) => String(entry?.partnerId || '') === String(deliveryPartnerId),
    );
    const latest = partnerOffers.length ? partnerOffers[partnerOffers.length - 1] : null;
    const offeredAtMs = latest?.at ? new Date(latest.at).getTime() : 0;
    const offerAgeMs = offeredAtMs && !Number.isNaN(offeredAtMs) ? Date.now() - offeredAtMs : null;
    const popupEligible = Boolean(
      doc?.dispatch?.status === 'unassigned' &&
      latest &&
      String(latest?.action || '') === 'offered' &&
      offerAgeMs != null &&
      offerAgeMs <= popupTtlMs
    );

    logger.info(
      `[DeliveryPopupServer] available-order rider=${deliveryPartnerId} order=${doc?.order_id || doc?._id} dispatchStatus=${doc?.dispatch?.status || 'none'} orderStatus=${doc?.orderStatus || 'none'} offeredToRider=${partnerOffers.length > 0} latestAction=${latest?.action || 'none'} offerAgeMs=${offerAgeMs ?? 'na'} popupEligible=${popupEligible}`,
    );
  }

  logger.info(
    `[DeliveryPopupServer] available-orders summary rider=${deliveryPartnerId} returned=${enriched.length} total=${total} page=${page} limit=${limit}`,
  );

  return {
    ...buildPaginatedResult({ docs: enriched, total, page, limit }),
    cashLimit,
  };
}

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);

  const existingOrder = await FoodOrder.findOne(identity)
    .select('pricing payment dispatch orderStatus')
    .lean();
  if (!existingOrder) throw new NotFoundError('Order not found');

  const paymentMethod = String(existingOrder?.payment?.method || 'cash').toLowerCase();
  const isCashOrder = paymentMethod === 'cash';
  const orderAmount = Math.max(0, Number(existingOrder?.pricing?.total || 0));
  const offeredEntry = (existingOrder?.dispatch?.offeredTo || []).find(
    (entry) => String(entry?.partnerId || '') === String(deliveryPartnerId),
  );
  const canBypassCashLimit = Boolean(offeredEntry?.allowOverLimit);

  const partnerCapacity = await getPartnerCashCapacity(deliveryPartnerId);
  const hasAmountCapacity = Number(partnerCapacity.availableCashLimit || 0) >= orderAmount;

  // Cash limit restriction removed. All riders can accept orders.

  const now = new Date();
  const acceptedStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];
  const cancellableStatuses = [
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
    'dead',
  ];

  const statusHistoryEntry = {
    byRole: 'DELIVERY_PARTNER',
    byId: partnerId,
    from: 'dispatchable',
    to: 'accepted',
    note: 'Delivery partner accepted order',
    at: now,
  };

  const order = await FoodOrder.findOneAndUpdate(
    {
      ...identity,
      orderStatus: { $in: acceptedStatuses },
      $or: [
        {
          'dispatch.status': 'unassigned',
          'dispatch.offeredTo': {
            $elemMatch: {
              partnerId: partnerId,
              $or: [
                { action: 'offered' },
                { action: { $exists: false } },
                { action: null },
              ],
            },
          },
        },
        {
          'dispatch.status': 'assigned',
          'dispatch.deliveryPartnerId': partnerId,
        },
      ],
    },
    {
      $set: {
        'dispatch.deliveryPartnerId': partnerId,
        'dispatch.status': 'accepted',
        'dispatch.assignedAt': now,
        'dispatch.acceptedAt': now,
      },
      $push: {
        statusHistory: statusHistoryEntry,
      },
    },
    { new: true },
  ).populate('restaurantId userId');

  if (!order) {
    const existing = await FoodOrder.findOne(identity)
      .select('orderStatus dispatch')
      .lean();

    if (!existing) throw new NotFoundError('Order not found');
    if (cancellableStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order was cancelled');
    }
    if (existing.orderStatus === 'delivered') {
      throw new ValidationError('Order already delivered');
    }
    if (!acceptedStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order not ready for delivery assignment');
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId)
    ) {
      const acceptedOrder = await FoodOrder.findOne(identity)
        .populate('restaurantId userId');
      return acceptedOrder
        ? sanitizeOrderForExternal(acceptedOrder)
        : null;
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') !== String(deliveryPartnerId)
    ) {
      throw new ForbiddenError('Order already accepted by another partner');
    }

    throw new ValidationError('Order is no longer available to accept');
  }

  const responseOrder = sanitizeOrderForExternal(order);

  void (async () => {
    try {
      const rest = order.restaurantId;
      const userLoc = order.deliveryAddress?.location?.coordinates;
      const restLoc = rest?.location?.coordinates;

      if (restLoc?.[0] && userLoc?.[0]) {
        const polyline = await fetchPolyline(
          { lat: restLoc[1], lng: restLoc[0] },
          { lat: userLoc[1], lng: userLoc[0] },
        );

        const db = getFirebaseDB();
        if (db) {
          const orderRef = db.ref(`active_orders/${order._id.toString()}`);
          await orderRef
            .set({
              polyline,
              lat: restLoc[1],
              lng: restLoc[0],
              boy_lat: restLoc[1],
              boy_lng: restLoc[0],
              restaurant_lat: restLoc[1],
              restaurant_lng: restLoc[0],
              customer_lat: userLoc[1],
              customer_lng: userLoc[0],
              status: 'accepted',
              last_updated: Date.now(),
            })
            .catch((error) =>
              logger.error(`Firebase orderRef set error: ${error.message}`),
            );
        }
      }
    } catch (error) {
      logger.error(
        `Error initializing Firebase order tracking: ${error?.message || error}`,
      );
    }

    try {
      await foodTransactionService.updateTransactionRider(order._id, deliveryPartnerId);
    } catch (error) {
      logger.error(
        `Error updating delivery rider transaction for ${order._id}: ${
          error?.message || error
        }`,
      );
    }

    try {
      const io = getIO();
      if (io) {
        const payload = {
          orderMongoId: order._id?.toString?.(),
          orderId: order._id.toString(),
          orderStatus: order.orderStatus,
          dispatchStatus: order.dispatch?.status,
        };
        io.to(rooms.delivery(deliveryPartnerId)).emit('order_status_update', payload);
        io.to(rooms.restaurant(order.restaurantId)).emit('order_status_update', payload);
        io.to(rooms.user(order.userId)).emit('order_status_update', payload);

        // Broadcast order_claimed to ALL online delivery partners so every popup is dismissed
        const claimedPayload = {
          orderId: order.order_id || order.orderId || order._id.toString(),
          orderMongoId: order._id?.toString?.(),
          claimedBy: deliveryPartnerId.toString(),
        };
        
        // Broadcast order_claimed to every partner who was offered this order
        if (Array.isArray(order.dispatch?.offeredTo)) {
          const otherPartnerOwners = [];
          for (const offer of order.dispatch.offeredTo) {
            io.to(rooms.delivery(offer.partnerId)).emit('order_claimed', claimedPayload);
            if (String(offer.partnerId) !== String(deliveryPartnerId)) {
              otherPartnerOwners.push({ ownerType: 'DELIVERY_PARTNER', ownerId: offer.partnerId });
            }
          }
          
          if (otherPartnerOwners.length > 0) {
            void notifyOwnersSafely(
              otherPartnerOwners,
              {
                title: 'Order Accepted',
                body: `Order #${order.order_id || order.orderId || order._id.toString()} has been accepted by another delivery partner.`,
                data: {
                  type: 'order_claimed',
                  orderId: order._id.toString(),
                  orderMongoId: order._id?.toString?.() || '',
                },
              }
            );
          }
        }
        io.to('all_delivery').emit('order_claimed', claimedPayload);
        logger.info(`[DeliveryDispatch] Broadcasted order_claimed specifically and globally for order ${order._id.toString()}`);

        void clearDeliveryOffersForOrder(order, { includeAssignedPartner: true });
      }

      await notifyOwnerSafely(
        { ownerType: 'USER', ownerId: order.userId },
        {
          title: `Delivery partner assigned`,
          body: `A delivery partner has accepted Order #${order.order_id || order.orderId || order._id.toString()}.`,
          data: {
            type: 'delivery_accepted',
            orderId: order._id.toString(),
            orderMongoId: order._id?.toString?.() || '',
            dispatchStatus: order.dispatch?.status,
            link: '/food/user/orders',
          },
        },
      );

      await notifyOwnerSafely(
        { ownerType: 'RESTAURANT', ownerId: order.restaurantId },
        {
          title: `Rider assigned`,
          body: `Order #${order.order_id || order.orderId || order._id.toString()} is now assigned to a delivery partner.`,
          data: {
            type: 'delivery_accepted',
            orderId: order._id.toString(),
            orderMongoId: order._id?.toString?.() || '',
            dispatchStatus: order.dispatch?.status,
            link: '/food/restaurant/orders',
          },
        },
      );
    } catch (error) {
      logger.error(
        `Error notifying delivery acceptance for ${order._id}: ${
          error?.message || error
        }`,
      );
    }
  })();

  enqueueOrderEvent('delivery_accepted', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dispatchStatus: order.dispatch?.status,
    orderStatus: order.orderStatus,
  });

  return responseOrder;
}

export async function rejectOrderDelivery(orderId, deliveryPartnerId, reason = '') {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  const offer = order.dispatch.offeredTo.find(
    (item) =>
      String(item.partnerId) === String(deliveryPartnerId) &&
      item.action === 'offered',
  );
  if (offer) offer.action = 'rejected';

  // If the order is dead, we don't need to put it back in the unassigned pool. 
  // We just want to record the rider's reason.
  if (order.orderStatus === 'dead') {
    pushStatusHistory(order, {
      byRole: 'DELIVERY_PARTNER',
      byId: deliveryPartnerId,
      from: 'assigned',
      to: 'dead_reason',
      note: `Delivery Failure Reason: ${reason || 'Not provided'}`,
    });
    order.cancellationReason = reason || order.cancellationReason;
    await order.save();
    return order.toObject();
  }

  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = undefined;
  order.dispatch.assignedAt = undefined;
  order.dispatch.acceptedAt = undefined;
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from: 'assigned',
    to: 'unassigned',
    note: `Rejected. Reason: ${reason || 'Not provided'}`,
  });
  await order.save();

  enqueueOrderEvent('delivery_rejected', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
  });

  void dispatchService
    .tryAutoAssign(order._id, {
      attempt: Math.max(1, Number(order.dispatch?.dispatchAttempt || 1)),
    })
    .catch((error) =>
      logger.error(`SmartDispatch: Auto-assign after reject failed: ${error.message}`),
    );

  return order.toObject();
}

export async function confirmReachedPickupDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp +pickupOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }
  if (order.orderStatus === 'delivered') {
    throw new ValidationError('Order already delivered');
  }

  const currentPhase = order.deliveryState?.currentPhase || '';
  const currentStatus = order.deliveryState?.status || '';
  
  // If already at pickup but somehow missing OTP, generate it
  if (currentPhase === 'at_pickup' || currentStatus === 'reached_pickup') {
    if (!order.pickupOtp) {
      order.pickupOtp = generateFourDigitDeliveryOtp();
      
      if (!order.deliveryVerification?.pickupOtp) {
        order.deliveryVerification = {
          ...(order.deliveryVerification?.toObject?.() || order.deliveryVerification || {}),
          pickupOtp: { required: true, verified: false },
        };
      }
      await order.save();
    }
    return order.toObject();
  }

  const from = currentStatus || currentPhase || order.orderStatus;
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_pickup',
    status: 'reached_pickup',
    reachedPickupAt: order.deliveryState?.reachedPickupAt || new Date(),
  };

  const existingPickupOtp = String(order.pickupOtp || '').trim();
  if (!existingPickupOtp) {
    order.pickupOtp = generateFourDigitDeliveryOtp();
  }
  
  if (!order.deliveryVerification?.pickupOtp) {
    order.deliveryVerification = {
      ...(order.deliveryVerification?.toObject?.() || order.deliveryVerification || {}),
      pickupOtp: { required: true, verified: false },
    };
  }
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'reached_pickup',
    note: 'Reached pickup location',
  });
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);

  try {
    const restaurant = await FoodRestaurant.findById(order.restaurantId)
      .select('restaurantName')
      .lean();
    const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
      .select('name')
      .lean();

    await notifyOwnersSafely(
      [{ ownerType: 'RESTAURANT', ownerId: order.restaurantId }],
      {
        title: 'Rider arrived!',
        body: `${partner?.name || 'The delivery partner'} has arrived at ${
          restaurant?.restaurantName || 'your restaurant'
        } to pick up Order #${order.order_id || order.orderId || order._id.toString()}.`,
        data: {
          type: 'rider_arrived',
          orderId: String(order._id.toString()),
          orderMongoId: String(order._id),
          partnerName: partner?.name || '',
        },
      },
    );
  } catch (error) {
    logger.error(
      `Error notifying restaurant about rider arrival for ${order._id}: ${
        error?.message || error
      }`,
    );
  }

  enqueueOrderEvent('reached_pickup', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    orderStatus: order.orderStatus,
    deliveryPhase: order.deliveryState?.currentPhase,
    deliveryStatus: order.deliveryState?.status,
  });
  return order.toObject();
}

/**
 * Rider presses "Request OTP" button after uploading bill.
 * Emits pickup OTP to restaurant via socket so they can relay it verbally.
 */
export async function requestPickupOtp(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+pickupOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  const otp = order.pickupOtp;
  if (!otp) {
    throw new ValidationError('Pickup OTP not generated yet. Please confirm arrival at restaurant first.');
  }

  // Update DB to register the request so fallback polling can catch it
  if (!order.deliveryVerification) order.deliveryVerification = {};
  if (!order.deliveryVerification.pickupOtp) order.deliveryVerification.pickupOtp = {};
  order.deliveryVerification.pickupOtp.requestedAt = new Date();
  order.markModified('deliveryVerification');
  await order.save();

  const io = getIO();
  if (io) {
    io.to(rooms.restaurant(order.restaurantId)).emit('pickup_otp_reveal', {
      orderMongoId: order._id.toString(),
      orderId: order.order_id || order._id.toString(),
      otp,
      message: 'Delivery partner is requesting the Pickup OTP. Please share this code with them.',
    });
  }

  try {
    const restaurant = await mongoose.model('FoodRestaurant').findById(order.restaurantId).select('restaurantName').lean();
    await notifyOwnersSafely(
      [{ ownerType: 'RESTAURANT', ownerId: order.restaurantId }],
      {
        title: 'OTP Requested! 🔐',
        body: `Delivery partner is requesting the Pickup OTP for Order #${order.order_id || order._id.toString()}. The OTP is: ${otp}`,
        data: {
          type: 'pickup_otp_request',
          orderId: String(order.order_id || order._id.toString()),
          orderMongoId: String(order._id),
          otp: String(otp)
        },
      },
    );
  } catch (error) {
    logger.error(`Error notifying restaurant about OTP request for ${order._id}: ${error?.message || error}`);
  }

  return { otp };
}

export async function confirmPickupDelivery(orderId, deliveryPartnerId, billImageUrl, otp) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp +pickupOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const from = order.orderStatus;
  const nextStatus = 'picked_up';
  if (!isStatusAdvance(from, nextStatus)) {
      throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
  }

  const pickupRequired = order.deliveryVerification?.pickupOtp?.required !== false;
  const pickupVerified = order.deliveryVerification?.pickupOtp?.verified === true;

  if (pickupRequired && !pickupVerified) {
    const isSkipped = typeof otp === 'string' && ['SKIP', 'BYPASS', 'NONE', 'skip', 'bypass'].includes(otp.trim().toUpperCase());
    if (!isSkipped) {
      if (!otp) {
        throw new ValidationError("Pickup OTP is required to mark this order as picked up.");
      }
      if (!isOtpMatch(order.pickupOtp, otp)) {
        throw new ValidationError("Invalid Pickup OTP. Please ask the restaurant for the correct OTP.");
      }
    }
    if (!order.deliveryVerification) order.deliveryVerification = {};
    if (!order.deliveryVerification.pickupOtp) order.deliveryVerification.pickupOtp = {};
    order.deliveryVerification.pickupOtp.verified = true;
    if (isSkipped) {
      order.deliveryVerification.pickupOtp.bypassed = true;
    }
    order.markModified('deliveryVerification');
  }

  order.orderStatus = nextStatus;
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'en_route_to_delivery',
    status: 'picked_up',
    pickedUpAt: new Date(),
    billImageUrl,
  };

  // OTP should be generated/sent only when rider explicitly requests it at drop.

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'picked_up',
    note: 'Order picked up',
  });
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('picked_up', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    billImageUrl: billImageUrl || null,
  });
  return order.toObject();
}

export async function confirmReachedDropDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  if (order.deliveryVerification?.dropOtp?.verified) {
    emitOrderUpdate(order, deliveryPartnerId);
    return sanitizeOrderForExternal(order);
  }

  const alreadyAtDrop =
    order.deliveryState?.currentPhase === 'at_drop' ||
    order.deliveryState?.status === 'reached_drop';
  const fromPhase =
    order.deliveryState?.status ||
    order.deliveryState?.currentPhase ||
    order.orderStatus ||
    '';

  const existingOtp = String(order.deliveryOtp || '').trim();

  // Idempotency: if already reached drop and OTP exists, avoid duplicate push notifications.
  if (alreadyAtDrop && existingOtp) {
    const hasDropOtpMeta = Boolean(order.deliveryVerification?.dropOtp);
    if (!hasDropOtpMeta) {
      order.deliveryVerification = {
        ...(order.deliveryVerification?.toObject?.() ||
          order.deliveryVerification ||
          {}),
        dropOtp: { required: true, verified: false },
      };
      await order.save();
    }
    // Rider explicitly requested OTP again at drop, re-emit same OTP without regenerating.
    emitDeliveryDropOtpToUser(order, existingOtp);
    return sanitizeOrderForExternal(order);
  }

  if (!existingOtp) {
    order.deliveryOtp = generateFourDigitDeliveryOtp();
  }

  if (!order.deliveryVerification?.dropOtp) {
    order.deliveryVerification = {
      ...(order.deliveryVerification?.toObject?.() ||
        order.deliveryVerification ||
        {}),
      dropOtp: { required: true, verified: false },
    };
  }

  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_drop',
    status: 'reached_drop',
    reachedDropAt: order.deliveryState?.reachedDropAt || new Date(),
  };

  if (!alreadyAtDrop) {
    pushStatusHistory(order, {
      byRole: 'DELIVERY_PARTNER',
      byId: deliveryPartnerId,
      from: fromPhase,
      to: 'reached_drop',
      note: 'Reached drop location',
    });
  }

  await order.save();

  emitDeliveryDropOtpToUser(order, String(order.deliveryOtp || '').trim());
  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('reached_drop', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dropOtpRequired: order.deliveryVerification?.dropOtp?.required ?? true,
    dropOtpVerified: order.deliveryVerification?.dropOtp?.verified ?? false,
  });
  return sanitizeOrderForExternal(order);
}

export async function verifyDropOtpDelivery(orderId, deliveryPartnerId, otp) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const otpStr = normalizeOtpValue(otp);
  if (!otpStr) throw new ValidationError('OTP is required');

  if (!order.deliveryVerification?.dropOtp?.required) {
    const hasSecretOtp = Boolean(normalizeOtpValue(order.deliveryOtp));
    if (!hasSecretOtp) {
      throw new ValidationError(
        'OTP verification is not active for this order. Confirm reached drop first.',
      );
    }

    if (!order.deliveryVerification) order.deliveryVerification = {};
    order.deliveryVerification.dropOtp = {
      required: true,
      verified: false,
      ...(order.deliveryVerification?.dropOtp || {}),
    };
    order.markModified('deliveryVerification.dropOtp');
    await order.save();
  }
  if (order.deliveryVerification?.dropOtp?.verified) {
    return { order: sanitizeOrderForExternal(order) };
  }

  if (!isOtpMatch(order.deliveryOtp, otpStr)) {
    throw new ValidationError(
      'Invalid OTP. Ask the customer for the code shown in their app.',
    );
  }

  if (!order.deliveryVerification) order.deliveryVerification = { dropOtp: {} };
  order.deliveryVerification.dropOtp.verified = true;
  order.markModified('deliveryVerification.dropOtp.verified');
  await order.save();

  // OTP verification does not advance order status; suppress milestone push to avoid duplicates.
  emitOrderUpdate(order, deliveryPartnerId, { sendMilestonePush: false });
  enqueueOrderEvent('drop_otp_verified', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
  });
  return { order: sanitizeOrderForExternal(order) };
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const { otp, ratings } = body;

  // 1. Handover OTP Verification
  if (
    otp &&
    order.deliveryVerification?.dropOtp?.required &&
    !order.deliveryVerification?.dropOtp?.verified
  ) {
    const orderWithSecret = await FoodOrder.findById(order._id).select('+deliveryOtp');
    if (isOtpMatch(orderWithSecret?.deliveryOtp, otp)) {
      order.deliveryVerification.dropOtp.verified = true;
      order.markModified('deliveryVerification.dropOtp.verified');
    } else {
      throw new ValidationError('Invalid handover OTP provided.');
    }
  }

  if (
    order.deliveryVerification?.dropOtp?.required &&
    !order.deliveryVerification?.dropOtp?.verified &&
    !otp
  ) {
    throw new ValidationError(
      'Customer handover OTP is required. Verify the OTP from the customer before completing delivery.',
    );
  }

  const from = order.orderStatus;
  const nextStatus = 'delivered';
  if (!isStatusAdvance(from, nextStatus)) {
      throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
  }
  
  // 2. Financial Context Resolution
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const prevPayStatus = String(tx?.payment?.status || order?.payment?.status || 'cod_pending');
  const payMethod = String(tx?.payment?.method || order?.payment?.method || order?.paymentMethod || 'cash');

  const finalPayMethod = payMethod;

  // 3. Server-side Payment Verification (Blocking)
  // The request body cannot select a payment method or claim that payment happened.
  let verifiedPaymentStatus = prevPayStatus.toLowerCase();
  if (finalPayMethod === 'razorpay_qr') {
    const syncedPayment = await syncRazorpayQrPayment(order);
    verifiedPaymentStatus = String(syncedPayment?.status || '').toLowerCase();
  }
  if (verifiedPaymentStatus !== 'paid') {
    throw new ValidationError(
      'Payment has not been verified by the server. Complete payment before finishing delivery.',
    );
  }

  // 4. Update Order State
  order.orderStatus = 'delivered';
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'delivered',
    status: 'delivered',
    deliveredAt: new Date(),
  };

  if (ratings) {
    order.ratings = {
      ...(order.ratings?.toObject?.() || order.ratings || {}),
      ...ratings,
    };
  }

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'delivered',
    note: `Delivery completed using ${finalPayMethod}.`,
  });

  await order.save();

  // 5. Update Financial Ledger (FoodTransaction)
  // This triggers the sync back to FoodOrder.payment.method which updates the Rider's Cash Limit (if cash) or Pocket (always).
  const ledgerKind =
    finalPayMethod === 'cash' 
      ? 'cod_marked_paid_on_delivery' 
      : (finalPayMethod === 'razorpay_qr' ? 'cod_collect_qr_settled' : 'payment_snapshot_sync');

  await foodTransactionService.updateTransactionStatus(order._id, ledgerKind, {
    status: 'captured', // This marks payment as 'paid'
    paymentMethod: finalPayMethod,
    recordedByRole: 'DELIVERY_PARTNER',
    recordedById: deliveryPartnerId,
    note: `Rider finalized payment as ${finalPayMethod}. Order is now delivered.`,
  });

  emitOrderUpdate(order, deliveryPartnerId);
  
  enqueueOrderEvent('delivery_completed', {
    orderMongoId: order._id?.toString?.(),
    orderId: order.orderId || order._id.toString(),
    deliveryPartnerId,
    payMethod: finalPayMethod,
    prevPayStatus,
    paymentStatus: 'paid'
  });

  return sanitizeOrderForExternal(order);
}


export async function updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }
  if (orderStatus === 'delivered') {
    throw new ValidationError(
      'Use the delivery completion endpoint so OTP and server-side payment checks are enforced.',
    );
  }

  const from = order.orderStatus;
  if (!isStatusAdvance(from, orderStatus)) {
      throw new ValidationError(`Current order status '${from}' is further ahead than '${orderStatus}'. Order cannot be moved backwards.`);
  }
  order.orderStatus = orderStatus;
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: orderStatus,
  });
  await order.save();

  enqueueOrderEvent('delivery_status_updated', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    from,
    to: orderStatus,
  });
  return order.toObject();
}
