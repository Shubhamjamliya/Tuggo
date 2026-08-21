import crypto from 'crypto';
import mongoose from 'mongoose';
import { FoodOrder } from '../../../modules/food/orders/models/order.model.js';
import { FoodTransaction } from '../../../modules/food/orders/models/foodTransaction.model.js';
import * as foodTransactionService from '../../../modules/food/orders/services/foodTransaction.service.js';
import { markCapturedQrPayment } from '../../../modules/food/orders/services/order-payment.service.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

function hasValidWebhookSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const actualBuffer = Buffer.from(String(signature), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function findQrTransaction(payment) {
  const qrId = String(payment?.qr_code_id || '');
  if (qrId) {
    const byQr = await FoodTransaction.findOne({ 'payment.qr.qrId': qrId }).lean();
    if (byQr) return byQr;
  }

  const notes = payment?.notes || {};
  const orderReference = String(notes.order_id || notes.order_reference || '');
  if (!orderReference) return null;
  const orderFilter = mongoose.Types.ObjectId.isValid(orderReference)
    ? { $or: [{ _id: orderReference }, { orderId: orderReference }, { order_id: orderReference }] }
    : { $or: [{ orderId: orderReference }, { order_id: orderReference }] };
  const order = await FoodOrder.findOne(orderFilter).select('_id').lean();
  if (!order) return null;
  return FoodTransaction.findOne({ orderId: order._id }).lean();
}

async function handleCapturedPayment(payment) {
  if (String(payment?.status || '').toLowerCase() !== 'captured') return;

  const qrTransaction = await findQrTransaction(payment);
  if (qrTransaction?.payment?.method === 'razorpay_qr') {
    const markedPaid = await markCapturedQrPayment(qrTransaction, payment, 'webhook');
    if (markedPaid) {
      logger.info(
        `Webhook [payment.captured]: verified QR payment ${payment.id} for order ${qrTransaction.orderId}`,
      );
    }
    return;
  }

  // Preserve the regular checkout flow, with captured-status and full-amount checks.
  const razorpayOrderId = String(payment?.order_id || '');
  if (!razorpayOrderId) return;
  const order = await FoodOrder.findOne({
    'payment.razorpay.orderId': razorpayOrderId,
  });
  if (!order || order.payment?.status === 'paid') return;

  const expectedPaise = Math.round(Number(order.payment?.amountDue ?? order.pricing?.total ?? 0) * 100);
  if (expectedPaise < 1 || Number(payment.amount || 0) < expectedPaise) {
    logger.warn(`Webhook rejected underpaid payment ${payment.id} for order ${order._id}`);
    return;
  }

  order.payment.status = 'paid';
  order.payment.razorpay.paymentId = String(payment.id || '');
  await order.save();
  await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
    status: 'captured',
    razorpayPaymentId: String(payment.id || ''),
    note: 'Captured payment verified through Razorpay webhook',
  });
}

async function handleProcessedRefund(refund) {
  const paymentId = String(refund?.payment_id || '');
  if (!paymentId) return;
  const order = await FoodOrder.findOneAndUpdate(
    {
      'payment.razorpay.paymentId': paymentId,
      'payment.refund.status': { $ne: 'processed' },
    },
    {
      $set: {
        'payment.status': 'refunded',
        'payment.refund': {
          status: 'processed',
          amount: Number(refund.amount || 0) / 100,
          refundId: String(refund.id || ''),
          processedAt: new Date(),
        },
      },
    },
    { new: true },
  );
  if (order) logger.info(`Webhook [refund.processed]: synced order ${order.orderId}`);
}

export const handleRazorpayWebhook = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (!hasValidWebhookSignature(req.rawBody, signature, config.razorpayWebhookSecret)) {
    logger.warn('Razorpay webhook signature verification failed.');
    return res.status(400).send('Invalid signature');
  }

  try {
    const { event, payload } = req.body || {};
    if (event === 'payment.captured') {
      await handleCapturedPayment(payload?.payment?.entity);
    } else if (event === 'refund.processed') {
      await handleProcessedRefund(payload?.refund?.entity);
    }
    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    logger.error(`Razorpay webhook processing failed: ${error?.message || error}`);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};
