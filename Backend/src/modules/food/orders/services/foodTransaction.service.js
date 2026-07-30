import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodRestaurantCommission } from '../../admin/models/restaurantCommission.model.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import mongoose from 'mongoose';

const RESTAURANT_COMMISSION_CACHE_MS = 60 * 1000;
let restaurantCommissionRulesCache = null;
let restaurantCommissionRulesLoadedAt = 0;

async function getActiveRestaurantCommissionRules() {
    const now = Date.now();
    if (
        restaurantCommissionRulesCache &&
        now - restaurantCommissionRulesLoadedAt < RESTAURANT_COMMISSION_CACHE_MS
    ) {
        return restaurantCommissionRulesCache;
    }

    const list = await FoodRestaurantCommission.find({
        status: { $ne: false },
    }).lean();
    restaurantCommissionRulesCache = list || [];
    restaurantCommissionRulesLoadedAt = now;
    return restaurantCommissionRulesCache;
}

export function computeRestaurantCommissionAmount(baseAmount, rule) {
    const safeBase = Math.max(0, Number(baseAmount) || 0);
    if (!Number.isFinite(safeBase) || safeBase < 0) return 0;

    const commissionType = rule?.defaultCommission?.type || 'percentage';
    const commissionValue = Math.max(
        0,
        Number(rule?.defaultCommission?.value ?? 0) || 0
    );

    let commissionAmount = 0;
    if (commissionType === 'percentage') {
        commissionAmount = safeBase * (commissionValue / 100);
    } else if (commissionType === 'amount') {
        commissionAmount = commissionValue;
    }

    // Round to 2 decimals and clamp to [0, base]
    commissionAmount = Math.round((commissionAmount || 0) * 100) / 100;
    commissionAmount = Math.max(0, Math.min(commissionAmount, safeBase));

    return { commissionAmount, commissionType, commissionValue, baseAmount: safeBase };
}

export async function getRestaurantCommissionSnapshot(orderDoc) {
    const baseAmount = Number(orderDoc?.pricing?.subtotal ?? 0) || 0;
    const restaurantIdRaw =
        orderDoc?.restaurantId?._id ?? orderDoc?.restaurantId ?? null;

    if (!restaurantIdRaw) {
        return {
            commissionAmount: 0,
            commissionType: 'percentage',
            commissionValue: 0,
            baseAmount,
            gstOnItem: 0,
            gstOnCommission: 0,
            paymentGatewayFee: 0,
            tcs: 0,
        };
    }

    const rules = await getActiveRestaurantCommissionRules();
    let rule =
        rules.find((r) => String(r.restaurantId) === String(restaurantIdRaw)) ||
        // Fallback: accept legacy docs where restaurantId may be stored under `restaurant` / `restaurant_id`
        rules.find((r) => String(r.restaurant || r.restaurant_id || '') === String(restaurantIdRaw)) ||
        null;

    if (!rule) {
        // If no specific rule, try to use global default
        const globalSettings = await FoodFeeSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean() || {};
        if (globalSettings.globalRestaurantCommission > 0) {
            rule = {
                defaultCommission: {
                    type: 'percentage',
                    value: globalSettings.globalRestaurantCommission
                }
            };
        }
    }

    const result = rule ? computeRestaurantCommissionAmount(baseAmount, rule) : {
        commissionAmount: 0,
        commissionType: 'percentage',
        commissionValue: 0,
        baseAmount,
    };

    const globalSettings = await FoodFeeSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean() || {};

    const applyTaxes = globalSettings.applyGlobalTaxes !== false;

    const gstOnItemRate = applyTaxes ? (Number(globalSettings.globalGstOnItem) || 0) : 0;
    const gstOnCommission = applyTaxes ? (Number(globalSettings.globalGstOnCommission) || 0) : 0;
    const pgFee = applyTaxes ? (Number(globalSettings.globalPaymentGatewayFee) || 0) : 0;
    const tcs = applyTaxes ? (Number(globalSettings.globalTcs) || 0) : 0;

    const totalPaid = Number(orderDoc?.pricing?.total) || 0;

    result.gstOnItem = Math.round(baseAmount * (gstOnItemRate / 100) * 100) / 100;
    result.gstOnCommission = Math.round(result.commissionAmount * (gstOnCommission / 100) * 100) / 100;
    result.paymentGatewayFee = Math.round(totalPaid * (pgFee / 100) * 100) / 100;
    result.tcs = Math.round(baseAmount * (tcs / 100) * 100) / 100;

    return result;
}

/**
 * Creates an initial 'pending' transaction when an order is created.
 */
export async function createInitialTransaction(order) {
    const commissionSnapshot = await getRestaurantCommissionSnapshot(order);

    // Split logic
    const totalCustomerPaid = order.pricing?.total || 0;
    const riderShare = order.riderEarning || 0;

    const restaurantCommissionFromOrder = Number(order.pricing?.restaurantCommission);
    const restaurantCommission =
        Number.isFinite(restaurantCommissionFromOrder) && restaurantCommissionFromOrder > 0
            ? restaurantCommissionFromOrder
            : (commissionSnapshot.commissionAmount || 0);

    const gstOnItemFromOrder = Number(order.pricing?.gstOnItem);
    const gstOnItem = Number.isFinite(gstOnItemFromOrder)
        ? gstOnItemFromOrder
        : (commissionSnapshot.gstOnItem || 0);

    const gstOnCommission = commissionSnapshot.gstOnCommission || 0;
    const paymentGatewayFee = commissionSnapshot.paymentGatewayFee || 0;
    const tcs = commissionSnapshot.tcs || 0;

    const restaurantNet = (order.pricing?.subtotal || 0) + (order.pricing?.packagingFee || 0) - restaurantCommission - gstOnItem - gstOnCommission - paymentGatewayFee - tcs;

    const calculatedPlatformNetProfit = (order.pricing?.platformFee || 0) + (order.pricing?.deliveryFee || 0) + restaurantCommission + gstOnItem + paymentGatewayFee + tcs - riderShare;
    const platformNetProfit = order.platformProfit !== undefined
        ? order.platformProfit
        : Math.max(0, calculatedPlatformNetProfit);

    const transaction = new FoodTransaction({
        orderId: order._id,

        userId: order.userId,
        restaurantId: order.restaurantId,
        deliveryPartnerId: order.dispatch?.deliveryPartnerId,
        paymentMethod: order.payment?.method || 'cash',
        status: order.payment?.status === 'paid' ? 'captured' : 'pending',
        payment: {
            method: String(order.payment?.method || 'cash'),
            status: String(order.payment?.status || 'cod_pending'),
            amountDue: Number(order.payment?.amountDue ?? order.pricing?.total ?? 0) || 0,
            razorpay: {
                orderId: String(order.payment?.razorpay?.orderId || ''),
                paymentId: String(order.payment?.razorpay?.paymentId || ''),
                signature: String(order.payment?.razorpay?.signature || ''),
            },
            qr: {
                qrId: String(order.payment?.qr?.qrId || ''),
                imageUrl: String(order.payment?.qr?.imageUrl || ''),
                paymentLinkId: String(order.payment?.qr?.paymentLinkId || ''),
                shortUrl: String(order.payment?.qr?.shortUrl || ''),
                status: String(order.payment?.qr?.status || ''),
                expiresAt: order.payment?.qr?.expiresAt || null,
            }
        },
        pricing: {
            subtotal: Number(order.pricing?.subtotal || 0) || 0,
            tax: Number(order.pricing?.tax || 0) || 0,
            packagingFee: Number(order.pricing?.packagingFee || 0) || 0,
            deliveryFee: Number(order.pricing?.deliveryFee || 0) || 0,
            platformFee: Number(order.pricing?.platformFee || 0) || 0,
            restaurantCommission,
            discount: Number(order.pricing?.discount || 0) || 0,
            total: Number(order.pricing?.total || 0) || 0,
            currency: String(order.pricing?.currency || order.currency || 'INR'),
        },
        amounts: {
            totalCustomerPaid,
            restaurantShare: Math.max(0, restaurantNet),
            restaurantCommission,
            gstOnItem,
            gstOnCommission,
            paymentGatewayFee,
            tcs,
            riderShare,
            platformNetProfit,
            taxAmount: order.pricing?.tax || 0
        },
        gateway: {
            razorpayOrderId: order.payment?.razorpay?.orderId,
            qrUrl: order.payment?.qr?.imageUrl
        },
        history: [{
            kind: 'created',
            amount: totalCustomerPaid,
            note: 'Initial transaction created with order'
        }]
    });

    await transaction.save();

    // Link back to the order
    try {
        await mongoose.model('FoodOrder').updateOne(
            { _id: order._id },
            { $set: { transactionId: transaction._id } }
        );
    } catch (err) {
        // Log but don't fail transaction if the backlink fails
    }

    return transaction;
}

/**
 * Updates transaction status (captured, settled, etc) and appends to history.
 */
export async function updateTransactionStatus(orderId, kind, details = {}) {
    const query = { orderId };
    const transaction = await FoodTransaction.findOne(query);
    if (!transaction) return null;

    if (details.status) transaction.status = details.status;
    if (details.razorpayPaymentId) transaction.gateway.razorpayPaymentId = details.razorpayPaymentId;
    if (details.razorpaySignature) transaction.gateway.razorpaySignature = details.razorpaySignature;

    // Sync payment method if provided (e.g. switching from cash to QR)
    if (details.paymentMethod) {
        transaction.paymentMethod = details.paymentMethod;
        transaction.payment.method = details.paymentMethod;
    }

    transaction.history.push({
        kind,
        amount: transaction.amounts.totalCustomerPaid,
        at: new Date(),
        note: details.note || `Transaction updated: ${kind}`,
        recordedBy: { role: details.recordedByRole || 'SYSTEM', id: details.recordedById }
    });

    await transaction.save();

    // Sync back to order as well
    if (details.paymentMethod || details.status) {
        try {
            const updateFields = {};
            if (details.paymentMethod) updateFields['payment.method'] = details.paymentMethod;
            if (details.status === 'captured') updateFields['payment.status'] = 'paid';

            await mongoose.model('FoodOrder').updateOne(
                { _id: orderId },
                { $set: updateFields }
            );
        } catch (err) {
            console.error('Failed to sync transaction status to order:', err.message);
        }
    }

    return transaction;
}

/**
 * Updates the rider in the transaction when an order is accepted.
 */
export async function updateTransactionRider(orderId, riderId) {
    const query = { orderId };
    return await FoodTransaction.findOneAndUpdate(
        query,
        { $set: { deliveryPartnerId: riderId } },
        { new: true }
    );
}

/**
 * Marks restaurant as settled in the finance record.
 */
export async function settleRestaurant(orderId, adminId) {
    return await updateTransactionStatus(orderId, 'settled', {
        status: 'captured', // Ensure it's marked as captured if it was pending cash
        note: 'Restaurant payout settled by admin',
        recordedByRole: 'ADMIN',
        recordedById: adminId
    });
}
