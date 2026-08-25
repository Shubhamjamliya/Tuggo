import { randomUUID } from 'node:crypto';
import {
  FoodDeliveryAcceptanceLock,
  FoodDeliveryMultiOrderSettings,
} from '../../admin/models/deliveryMultiOrderSettings.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';

export const ACTIVE_DELIVERY_ORDER_STATUSES = [
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'picked_up',
  'reached_drop',
];

export async function getDeliveryMultiOrderSettings() {
  const settings = await FoodDeliveryMultiOrderSettings.findOne().lean();
  return {
    enabled: Boolean(settings?.enabled),
    maxConcurrentOrders: Math.min(5, Math.max(1, Number(settings?.maxConcurrentOrders || 1))),
  };
}

export async function updateDeliveryMultiOrderSettings({ enabled, maxConcurrentOrders }) {
  const normalizedEnabled = Boolean(enabled);
  const normalizedLimit = Math.min(5, Math.max(1, Math.trunc(Number(maxConcurrentOrders) || 1)));
  const settings = await FoodDeliveryMultiOrderSettings.findOneAndUpdate(
    {},
    { $set: { enabled: normalizedEnabled, maxConcurrentOrders: normalizedLimit } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return {
    enabled: Boolean(settings.enabled),
    maxConcurrentOrders: Number(settings.maxConcurrentOrders),
  };
}

export async function getDeliveryPartnerOrderCapacity(deliveryPartnerId) {
  const settings = await getDeliveryMultiOrderSettings();
  const effectiveLimit = settings.enabled ? settings.maxConcurrentOrders : 1;
  const activeOrderCount = await FoodOrder.countDocuments({
    'dispatch.deliveryPartnerId': deliveryPartnerId,
    'dispatch.status': 'accepted',
    orderStatus: { $in: ACTIVE_DELIVERY_ORDER_STATUSES },
  });
  return {
    ...settings,
    effectiveLimit,
    activeOrderCount,
    remainingSlots: Math.max(0, effectiveLimit - activeOrderCount),
    canAcceptMore: activeOrderCount < effectiveLimit,
  };
}

export async function acquireDeliveryAcceptanceLock(deliveryPartnerId) {
  const now = new Date();
  const token = randomUUID();
  try {
    const lock = await FoodDeliveryAcceptanceLock.findOneAndUpdate(
      {
        _id: deliveryPartnerId,
        $or: [{ expiresAt: { $lte: now } }, { expiresAt: { $exists: false } }],
      },
      { $set: { token, expiresAt: new Date(now.getTime() + 15000) } },
      { new: true, upsert: true },
    ).lean();
    return lock?.token === token ? token : null;
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

export async function releaseDeliveryAcceptanceLock(deliveryPartnerId, token) {
  if (!token) return;
  await FoodDeliveryAcceptanceLock.deleteOne({ _id: deliveryPartnerId, token });
}
