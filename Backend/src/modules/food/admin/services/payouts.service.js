import mongoose from 'mongoose';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodRestaurantWithdrawal } from '../../restaurant/models/foodRestaurantWithdrawal.model.js';
import { FoodRestaurantAdjustment } from '../../restaurant/models/foodRestaurantAdjustment.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';

/**
 * Summary card totals for restaurant payouts based on filters.
 * STRICT RULES:
 * 1. Filter by deliveryState.deliveredAt for date filtering
 * 2. Only include orderStatus = 'delivered' for payout math
 * 3. totalPaid = sum of ALL approved withdrawals for that restaurant (unfiltered by date)
 * 4. totalRemaining = totalPayout - totalPaid + totalAdjustments
 * 5. Includes all restaurants (active, approved, banned, inactive).
 */
export async function getPayoutSummary(query = {}) {
    const filter = {
        orderStatus: 'delivered'
    };

    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        filter.restaurantId = new mongoose.Types.ObjectId(query.restaurantId);
    }

    if (query.fromDate || query.toDate) {
        filter['deliveryState.deliveredAt'] = {};
        if (query.fromDate) {
            const start = new Date(query.fromDate);
            start.setHours(0, 0, 0, 0);
            filter['deliveryState.deliveredAt'].$gte = start;
        }
        if (query.toDate) {
            const end = new Date(query.toDate);
            end.setHours(23, 59, 59, 999);
            filter['deliveryState.deliveredAt'].$lte = end;
        }
    }

    // Aggregate delivered orders for revenue & payout calculations
    const summaryAgg = await FoodOrder.aggregate([
        { $match: filter },
        {
            $group: {
                _id: null,
                totalRevenue: { $sum: { $ifNull: ['$pricing.total', 0] } },
                totalCommission: { $sum: { $ifNull: ['$pricing.restaurantCommission', 0] } },
                totalGst: {
                    $sum: {
                        $add: [
                            { $ifNull: ['$pricing.tax', { $ifNull: ['$pricing.gstAmount', 0] }] },
                            { $ifNull: ['$pricing.additionalChargesGst', 0] }
                        ]
                    }
                },
                totalDeliveryFee: { $sum: { $ifNull: ['$pricing.deliveryFee', 0] } },
                totalPlatformFee: { $sum: { $ifNull: ['$pricing.platformFee', 0] } },
                totalSubtotal: { $sum: { $ifNull: ['$pricing.subtotal', 0] } },
                totalPackagingFee: { $sum: { $ifNull: ['$pricing.packagingFee', 0] } }
            }
        }
    ]);

    const stats = summaryAgg[0] || {};
    const totalRevenue = Math.round((stats.totalRevenue || 0) * 100) / 100;
    const totalCommission = Math.round((stats.totalCommission || 0) * 100) / 100;
    const totalGst = Math.round((stats.totalGst || 0) * 100) / 100;
    const totalDeliveryFee = Math.round((stats.totalDeliveryFee || 0) * 100) / 100;
    const totalPlatformFee = Math.round((stats.totalPlatformFee || 0) * 100) / 100;
    const totalSubtotal = stats.totalSubtotal || 0;
    const totalPackagingFee = stats.totalPackagingFee || 0;

    // Earning Formula: totalPayout = (subtotal + packagingFee) - restaurantCommission
    const totalPayout = Math.max(0, Math.round(((totalSubtotal + totalPackagingFee) - totalCommission) * 100) / 100);

    // Rule 3: Do NOT filter totalPaid by date!
    // totalPaid = sum of ALL approved withdrawals for that restaurant
    const withdrawalFilter = { status: 'approved' };
    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        withdrawalFilter.restaurantId = new mongoose.Types.ObjectId(query.restaurantId);
    }

    const paidAgg = await FoodRestaurantWithdrawal.aggregate([
        { $match: withdrawalFilter },
        {
            $group: {
                _id: null,
                totalPaid: { $sum: { $ifNull: ['$amount', 0] } }
            }
        }
    ]);

    const totalPaid = Math.round((paidAgg[0]?.totalPaid || 0) * 100) / 100;

    const adjFilter = {};
    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        adjFilter.restaurantId = new mongoose.Types.ObjectId(query.restaurantId);
    }
    const adjAgg = await FoodRestaurantAdjustment.aggregate([
        { $match: adjFilter },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } } } }
    ]);
    const totalAdjustments = Math.round((adjAgg[0]?.total || 0) * 100) / 100;

    const totalRemaining = Math.max(0, Math.round((totalPayout - totalPaid + totalAdjustments) * 100) / 100);

    return {
        totalRevenue,
        totalPayout,
        totalCommission,
        totalGst,
        totalDeliveryFee,
        totalPlatformFee,
        totalPaid,
        totalAdjustments,
        totalRemaining
    };
}

/**
 * Returns paginated list of delivered orders for payouts table.
 */
export async function getPayoutOrders(query = {}) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 500);
    const skip = (page - 1) * limit;

    const filter = {
        orderStatus: 'delivered'
    };

    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        filter.restaurantId = new mongoose.Types.ObjectId(query.restaurantId);
    }

    if (query.fromDate || query.toDate) {
        filter['deliveryState.deliveredAt'] = {};
        if (query.fromDate) {
            const start = new Date(query.fromDate);
            start.setHours(0, 0, 0, 0);
            filter['deliveryState.deliveredAt'].$gte = start;
        }
        if (query.toDate) {
            const end = new Date(query.toDate);
            end.setHours(23, 59, 59, 999);
            filter['deliveryState.deliveredAt'].$lte = end;
        }
    }

    const [orders, total] = await Promise.all([
        FoodOrder.find(filter)
            .populate('restaurantId', 'restaurantName isBanned status')
            .sort({ 'deliveryState.deliveredAt': -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodOrder.countDocuments(filter)
    ]);

    const data = orders.map((o, idx) => {
        const items = Array.isArray(o.items) ? o.items : [];
        const itemName = items.map(it => it.name).filter(Boolean).join(', ') || 'N/A';
        const subtotal = Number(o.pricing?.subtotal || 0);
        const packagingFee = Number(o.pricing?.packagingFee || 0);
        const commission = Number(o.pricing?.restaurantCommission || 0);
        const gst = Number(o.pricing?.tax || o.pricing?.gstAmount || 0) + Number(o.pricing?.additionalChargesGst || 0);
        const deliveryFee = Number(o.pricing?.deliveryFee || 0);
        const platformFee = Number(o.pricing?.platformFee || 0);
        const payoutAmount = Math.max(0, (subtotal + packagingFee) - commission);

        const deliveredAt = o.deliveryState?.deliveredAt || o.updatedAt || o.createdAt;

        const isBanned = Boolean(o.restaurantId?.isBanned || o.restaurantId?.status === 'banned');
        const restaurantName = o.restaurantId?.restaurantName
            ? `${o.restaurantId.restaurantName}${isBanned ? ' (Banned)' : ''}`
            : 'N/A';

        return {
            srNo: skip + idx + 1,
            orderId: o.order_id || o.orderId || String(o._id),
            restaurantName,
            isBanned,
            itemName,
            itemAmount: subtotal,
            commission,
            gst,
            deliveryFee,
            platformFee,
            payoutAmount,
            dateTime: deliveredAt
        };
    });

    return {
        data,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1
        }
    };
}

/**
 * Formats JSON payload for PDF generation.
 */
export async function getPayoutPdfData(query = {}) {
    let restaurant = null;
    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        restaurant = await FoodRestaurant.findById(query.restaurantId)
            .select('restaurantName ownerName ownerPhone ownerEmail accountNumber ifscCode bankName accountHolderName addressLine1 area city state pincode isBanned status')
            .lean();
    }

    const filter = {
        orderStatus: 'delivered'
    };

    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        filter.restaurantId = new mongoose.Types.ObjectId(query.restaurantId);
    }

    if (query.fromDate || query.toDate) {
        filter['deliveryState.deliveredAt'] = {};
        if (query.fromDate) {
            const start = new Date(query.fromDate);
            start.setHours(0, 0, 0, 0);
            filter['deliveryState.deliveredAt'].$gte = start;
        }
        if (query.toDate) {
            const end = new Date(query.toDate);
            end.setHours(23, 59, 59, 999);
            filter['deliveryState.deliveredAt'].$lte = end;
        }
    }

    const orders = await FoodOrder.find(filter)
        .populate('restaurantId', 'restaurantName isBanned status')
        .sort({ 'deliveryState.deliveredAt': -1 })
        .lean();

    let totalPayout = 0;
    let totalRevenue = 0;
    let totalCommission = 0;

    const formattedOrders = orders.map((o, idx) => {
        const items = Array.isArray(o.items) ? o.items : [];
        const itemName = items.map(it => it.name).filter(Boolean).join(', ') || 'N/A';
        const subtotal = Number(o.pricing?.subtotal || 0);
        const packagingFee = Number(o.pricing?.packagingFee || 0);
        const commission = Number(o.pricing?.restaurantCommission || 0);
        const total = Number(o.pricing?.total || 0);
        const payoutAmount = Math.max(0, (subtotal + packagingFee) - commission);

        totalPayout += payoutAmount;
        totalRevenue += total;
        totalCommission += commission;

        const deliveredAt = o.deliveryState?.deliveredAt || o.updatedAt || o.createdAt;

        const isBanned = Boolean(o.restaurantId?.isBanned || o.restaurantId?.status === 'banned');
        const restaurantName = o.restaurantId?.restaurantName
            ? `${o.restaurantId.restaurantName}${isBanned ? ' (Banned)' : ''}`
            : 'N/A';

        return {
            srNo: idx + 1,
            orderId: o.order_id || o.orderId || String(o._id),
            restaurantName,
            isBanned,
            itemName,
            itemAmount: subtotal,
            payoutAmount,
            commission,
            dateTime: deliveredAt
        };
    });

    const isBanned = Boolean(restaurant?.isBanned || restaurant?.status === 'banned');

    return {
        restaurant: restaurant ? {
            name: `${restaurant.restaurantName}${isBanned ? ' (Banned)' : ''}`,
            ownerName: restaurant.ownerName,
            ownerPhone: restaurant.ownerPhone,
            isBanned,
            bankDetails: {
                accountHolderName: restaurant.accountHolderName || '',
                accountNumber: restaurant.accountNumber || '',
                ifscCode: restaurant.ifscCode || ''
            }
        } : null,
        dateRange: {
            fromDate: query.fromDate || null,
            toDate: query.toDate || null
        },
        orders: formattedOrders,
        summary: {
            totalOrders: formattedOrders.length,
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            totalCommission: Math.round(totalCommission * 100) / 100,
            totalPayout: Math.round(totalPayout * 100) / 100
        }
    };
}

/**
 * Creates an approved FoodRestaurantWithdrawal entry without directly mutating wallet balance.
 */
export async function markPayoutAsPaid({ restaurantId, amount, transactionId, adminNote }) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw new ValidationError('Valid restaurant ID is required');
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new ValidationError('Amount must be a positive number');
    }

    const restaurant = await FoodRestaurant.findById(restaurantId).lean();
    if (!restaurant) throw new ValidationError('Restaurant not found');

    const withdrawal = new FoodRestaurantWithdrawal({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        amount: numericAmount,
        status: 'approved',
        paymentMethod: 'bank_transfer',
        bankDetails: {
            accountNumber: restaurant.accountNumber || '',
            ifscCode: restaurant.ifscCode || '',
            bankName: restaurant.bankName || '',
            accountHolderName: restaurant.accountHolderName || ''
        },
        transactionId: transactionId || `MANUAL-${Date.now()}`,
        adminNote: adminNote || 'Manual payout recorded by admin',
        processedAt: new Date()
    });

    await withdrawal.save();
    return withdrawal;
}
