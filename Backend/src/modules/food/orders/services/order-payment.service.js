import { FoodOrder } from '../models/order.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import {
  createRazorpayQrCode,
  fetchAllRazorpayQrPayments,
  fetchRazorpayQrCode,
  isRazorpayConfigured,
} from '../helpers/razorpay.helper.js';
import * as foodTransactionService from './foodTransaction.service.js';
import {
  buildOrderIdentityFilter,
  enqueueOrderEvent,
} from './order.helpers.js';

const QR_LIFETIME_SECONDS = 30 * 60;
const ACTIVE_QR_STATUSES = new Set(['active', 'created', 'pending']);
const TERMINAL_QR_STATUSES = new Set([
  'closed', 'expired', 'failed', 'cancelled', 'canceled',
]);

function getExpectedAmount(transaction, order) {
  return Number(
    transaction?.payment?.amountDue ?? transaction?.pricing?.total ??
    order?.payment?.amountDue ?? order?.pricing?.total ?? 0,
  );
}

function isActiveQr(qr, now = new Date()) {
  if (!qr?.qrId || !qr?.imageUrl || !qr?.expiresAt) return false;
  return ACTIVE_QR_STATUSES.has(String(qr.status || '').toLowerCase()) &&
    new Date(qr.expiresAt).getTime() > now.getTime();
}

function qrResponse(qr, reused = false) {
  return {
    qrId: qr.qrId,
    image_url: qr.imageUrl,
    imageUrl: qr.imageUrl,
    status: qr.status,
    amount: Number(qr.amount || 0),
    expiresAt: qr.expiresAt,
    reused,
  };
}

function paymentItems(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.items) ? result.items : [];
}

/** Shared by polling and webhooks. Never records an authorized or underpaid payment. */
export async function markCapturedQrPayment(transaction, paymentEntity, source = 'status_poll') {
  if (!transaction || !paymentEntity) return false;
  if (String(paymentEntity.status || '').toLowerCase() !== 'captured') return false;

  const qrId = String(transaction.payment?.qr?.qrId || '');
  const paymentQrId = String(paymentEntity.qr_code_id || '');
  const notedOrderId = String(paymentEntity.notes?.order_id || '');
  const notesMatchOrder = notedOrderId === String(transaction.orderId || '');
  // A late capture from a recently replaced QR is still valid when its signed
  // webhook carries the immutable order note that this server attached.
  if (qrId && paymentQrId && qrId !== paymentQrId && !notesMatchOrder) return false;

  const expectedPaise = Math.round(getExpectedAmount(transaction) * 100);
  const capturedPaise = Number(paymentEntity.amount || 0);
  if (expectedPaise < 1 || !Number.isFinite(capturedPaise) || capturedPaise < expectedPaise) {
    logger.warn(
      `Rejected underpaid Razorpay QR payment ${paymentEntity.id || ''}: ` +
      `${capturedPaise} < ${expectedPaise} paise`,
    );
    return false;
  }

  const paidAt = new Date(
    Number(paymentEntity.created_at) > 0
      ? Number(paymentEntity.created_at) * 1000
      : Date.now(),
  );
  const update = await FoodTransaction.updateOne(
    { _id: transaction._id, 'payment.status': { $ne: 'paid' } },
    {
      $set: {
        status: 'captured',
        paymentMethod: 'razorpay_qr',
        'payment.method': 'razorpay_qr',
        'payment.status': 'paid',
        'payment.qr.status': 'paid',
        'gateway.razorpayPaymentId': String(paymentEntity.id || ''),
      },
      $push: {
        history: {
          kind: 'captured',
          amount: capturedPaise / 100,
          at: paidAt,
          note: `Razorpay QR payment verified via ${source}`,
          recordedBy: { role: 'SYSTEM' },
        },
      },
    },
  );

  await FoodOrder.updateOne(
    { _id: transaction.orderId },
    {
      $set: {
        'payment.method': 'razorpay_qr',
        'payment.status': 'paid',
        'payment.qr.status': 'paid',
        'payment.razorpay.paymentId': String(paymentEntity.id || ''),
      },
    },
  );
  return update.modifiedCount > 0 || transaction.payment?.status === 'paid';
}

export async function syncRazorpayQrPayment(orderDoc) {
  const transaction = await FoodTransaction.findOne({ orderId: orderDoc?._id }).lean();
  const payment = transaction?.payment || orderDoc?.payment || null;
  if (!payment || payment.method !== 'razorpay_qr' || payment.status === 'paid') {
    return payment;
  }

  const qr = payment.qr || {};
  if (!qr.qrId || !isRazorpayConfigured()) return payment;

  const [result, remoteQr] = await Promise.all([
    fetchAllRazorpayQrPayments(qr.qrId),
    fetchRazorpayQrCode(qr.qrId),
  ]);
  const capturedPayments = paymentItems(result).filter(
    (item) => String(item?.status || '').toLowerCase() === 'captured',
  );
  let markedPaid = false;
  for (const captured of capturedPayments) {
    if (await markCapturedQrPayment(transaction, captured, 'status_poll')) {
      markedPaid = true;
      break;
    }
  }

  const remoteStatus = String(remoteQr?.status || '').toLowerCase();
  const locallyExpired = qr.expiresAt && new Date(qr.expiresAt).getTime() <= Date.now();
  if (!markedPaid && (TERMINAL_QR_STATUSES.has(remoteStatus) || locallyExpired)) {
    const terminalStatus = locallyExpired && !TERMINAL_QR_STATUSES.has(remoteStatus)
      ? 'expired'
      : remoteStatus;
    await Promise.all([
      FoodTransaction.updateOne(
        { _id: transaction._id, 'payment.status': { $ne: 'paid' } },
        { $set: { 'payment.qr.status': terminalStatus, 'payment.status': 'failed' } },
      ),
      FoodOrder.updateOne(
        { _id: orderDoc._id, 'payment.status': { $ne: 'paid' } },
        { $set: { 'payment.qr.status': terminalStatus, 'payment.status': 'failed' } },
      ),
    ]);
  }
  return (await FoodTransaction.findById(transaction._id).lean())?.payment || payment;
}

export async function createCollectQr(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).lean();
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }
  if ([
    'delivered', 'cancelled_by_user', 'cancelled_by_restaurant',
    'cancelled_by_admin', 'dead',
  ].includes(String(order.orderStatus || '').toLowerCase())) {
    throw new ValidationError('A payment QR cannot be created for this order');
  }

  let transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
  if (!transaction) throw new ValidationError('Order payment record not found');
  let payment = transaction.payment || order.payment || {};
  if (payment.status === 'paid' || transaction.status === 'captured') {
    throw new ValidationError('Order is already paid');
  }
  if (!['cash', 'razorpay_qr'].includes(String(payment.method || '').toLowerCase())) {
    throw new ValidationError('This order is not eligible for COD QR collection');
  }

  const now = new Date();
  if (isActiveQr(payment.qr, now)) return qrResponse(payment.qr, true);

  // Before replacing a terminal QR, check Razorpay for a late captured payment.
  if (payment.qr?.qrId) {
    await syncRazorpayQrPayment(order);
    transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
    payment = transaction?.payment || payment;
    if (payment.status === 'paid' || transaction?.status === 'captured') {
      throw new ValidationError('Order is already paid');
    }
    if (isActiveQr(payment.qr, now)) return qrResponse(payment.qr, true);
  }
  if (!isRazorpayConfigured()) {
    throw new ValidationError('Razorpay QR payment is not configured');
  }

  const amountDue = getExpectedAmount(transaction, order);
  if (!Number.isFinite(amountDue) || amountDue < 1) {
    throw new ValidationError('No valid amount is due for this order');
  }

  const closeBy = Math.floor(Date.now() / 1000) + QR_LIFETIME_SECONDS;
  const expiresAt = new Date(closeBy * 1000);
  const creationLockUntil = new Date(Date.now() + 60 * 1000);
  const previousMethod = String(payment.method || transaction.paymentMethod || 'cash');

  // Claim creation atomically so concurrent button taps cannot create duplicate QRs.
  const lock = await FoodTransaction.updateOne(
    {
      _id: transaction._id,
      'payment.status': { $ne: 'paid' },
      $or: [
        { 'payment.qr.status': { $nin: ['active', 'created', 'pending', 'creating'] } },
        { 'payment.qr.expiresAt': { $lte: now } },
      ],
    },
    {
      $set: {
        'payment.qr.status': 'creating',
        'payment.qr.expiresAt': creationLockUntil,
      },
    },
  );
  if (lock.modifiedCount === 0) {
    const latest = await FoodTransaction.findById(transaction._id).lean();
    if (isActiveQr(latest?.payment?.qr, now)) return qrResponse(latest.payment.qr, true);
    throw new ValidationError('A payment QR is already being created. Please try again.');
  }

  let razorpayQr;
  try {
    const orderIdentity = String(order.orderId || order.order_id || order._id);
    razorpayQr = await createRazorpayQrCode({
      amountPaise: Math.round(amountDue * 100),
      closeBy,
      description: `Payment collection for order ${orderIdentity}`,
      notes: {
        order_id: String(order._id),
        order_reference: orderIdentity,
        user_id: String(order.userId || ''),
        customer_id: String(order.userId || ''),
        delivery_partner_id: String(deliveryPartnerId || ''),
        amount: amountDue.toFixed(2),
        purpose: 'cod_order_collection',
      },
    });
  } catch (error) {
    await FoodTransaction.updateOne(
      { _id: transaction._id, 'payment.qr.status': 'creating' },
      {
        $set: {
          paymentMethod: previousMethod,
          'payment.method': previousMethod,
          'payment.qr.status': 'failed',
          'payment.qr.expiresAt': now,
        },
      },
    );
    throw error;
  }

  const qr = {
    qrId: String(razorpayQr.id || ''),
    imageUrl: String(razorpayQr.image_url || ''),
    amount: amountDue,
    paymentLinkId: '',
    shortUrl: '',
    status: String(razorpayQr.status || 'active').toLowerCase(),
    expiresAt,
  };
  if (!qr.qrId || !qr.imageUrl) {
    await FoodTransaction.updateOne(
      { _id: transaction._id },
      { $set: { 'payment.qr.status': 'failed', 'payment.qr.expiresAt': now } },
    );
    throw new Error('Razorpay returned an invalid QR response');
  }

  const transactionWrite = await FoodTransaction.updateOne(
    { _id: transaction._id, 'payment.status': { $ne: 'paid' } },
    {
      $set: {
        paymentMethod: 'razorpay_qr',
        'payment.method': 'razorpay_qr',
        'payment.status': 'pending_qr',
        'payment.qr': qr,
        'gateway.qrUrl': qr.imageUrl,
        'gateway.qrExpiresAt': expiresAt,
      },
    },
  );

  if (transactionWrite.modifiedCount === 0) {
    const latest = await FoodTransaction.findById(transaction._id).lean();
    if (latest?.payment?.status === 'paid' || latest?.status === 'captured') {
      throw new ValidationError('Order is already paid');
    }
    throw new Error('Could not save the Razorpay QR against this order');
  }

  await FoodOrder.updateOne(
    { _id: order._id, 'payment.status': { $ne: 'paid' } },
    {
      $set: {
        'payment.method': 'razorpay_qr',
        'payment.status': 'pending_qr',
        'payment.qr': qr,
      },
    },
  );

  await foodTransactionService.updateTransactionStatus(order._id, 'cod_collect_qr_created', {
    recordedByRole: 'DELIVERY_PARTNER',
    recordedById: deliveryPartnerId,
    note: 'Single-use Razorpay UPI QR created for COD collection',
  });
  enqueueOrderEvent('collect_qr_created', {
    orderMongoId: String(order._id),
    orderId: order.orderId || order.order_id || null,
    deliveryPartnerId,
    qrId: qr.qrId,
    amountDue,
  });
  return qrResponse(qr);
}

export async function getPaymentStatus(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');
  const order = await FoodOrder.findOne(identity).select(
    'dispatch payment riderEarning platformProfit',
  );
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  let transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
  if (transaction?.payment?.method === 'razorpay_qr') {
    await syncRazorpayQrPayment(order);
    transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
  }
  const latestHistory = [...(transaction?.history || [])]
    .sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
  const payment = transaction?.payment || order.payment || {};
  const qrStatus = String(payment?.qr?.status || '').toLowerCase();
  const status = payment.status === 'paid'
    ? 'paid'
    : TERMINAL_QR_STATUSES.has(qrStatus)
      ? (qrStatus === 'expired' || qrStatus === 'closed' ? 'expired' : 'failed')
      : 'pending';

  return {
    status,
    paid: status === 'paid',
    payment,
    qr: payment.qr || null,
    latestPaymentSnapshot: latestHistory,
    riderEarning: order.riderEarning ?? 0,
    platformProfit: order.platformProfit ?? 0,
    pricingTotal: transaction?.pricing?.total ?? 0,
    transactionStatus: transaction?.status ?? null,
  };
}
