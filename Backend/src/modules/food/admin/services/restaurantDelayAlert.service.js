import mongoose from 'mongoose';
import { FoodOrder } from '../../orders/models/order.model.js';
import { sendPushNotification, removeFirebaseDeviceToken, upsertFirebaseDeviceToken } from '../../../../core/notifications/firebase.service.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodRestaurantDelayAlertSettings } from '../models/restaurantDelayAlertSettings.model.js';

const normalizeDevicePlatform = (value) => {
  const platform = String(value || '').toLowerCase();
  return ['ios', 'android', 'web'].includes(platform) ? platform : 'unknown';
};

const serializeSettings = (settings) => ({
  enabled: Boolean(settings?.enabled),
  delayMinutes: Number(settings?.delayMinutes || 5),
  devices: (settings?.devices || []).map((device) => ({
    id: String(device._id),
    name: device.name,
    platform: device.platform,
    devicePlatform: device.devicePlatform,
    deviceId: device.deviceId || '',
    adminId: String(device.adminId),
    selected: Boolean(device.selected),
    isActive: Boolean(device.isActive),
    lastSeenAt: device.lastSeenAt,
  })),
});

async function getSettingsDocument() {
  return FoodRestaurantDelayAlertSettings.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global', enabled: false, delayMinutes: 5, devices: [] } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

export async function getRestaurantDelayAlertSettings() {
  return serializeSettings(await getSettingsDocument());
}

export async function updateRestaurantDelayAlertSettings({ enabled, delayMinutes, selectedDeviceIds }) {
  const settings = await getSettingsDocument();
  const selectedIds = new Set((selectedDeviceIds || []).map(String));
  if (enabled && selectedIds.size === 0) throw new ValidationError('Select at least one notification device before enabling alerts.');
  settings.enabled = Boolean(enabled);
  settings.delayMinutes = Math.min(60, Math.max(1, Math.trunc(Number(delayMinutes) || 5)));
  settings.devices.forEach((device) => {
    device.selected = device.isActive && selectedIds.has(String(device._id));
  });
  await settings.save();
  return serializeSettings(settings);
}

export async function registerRestaurantDelayAlertDevice(adminId, payload = {}) {
  const token = String(payload.token || '').trim();
  const name = String(payload.name || '').trim().slice(0, 50);
  if (!token) throw new ValidationError('FCM token is required.');
  if (!name) throw new ValidationError('Device name is required.');
  const platform = payload.platform === 'mobile' ? 'mobile' : 'web';
  const deviceId = String(payload.deviceId || '').trim();
  const settings = await getSettingsDocument();
  let device = settings.devices.find((item) =>
    item.token === token ||
    (deviceId && item.deviceId === deviceId && String(item.adminId) === String(adminId)),
  );
  const previousToken = device && device.token !== token ? String(device.token || '') : '';
  const previousPlatform = device?.platform || platform;
  if (device) {
    device.name = name;
    device.platform = platform;
    device.devicePlatform = normalizeDevicePlatform(payload.devicePlatform);
    device.deviceId = deviceId || device.deviceId || '';
    device.adminId = adminId;
    device.isActive = true;
    device.lastSeenAt = new Date();
  } else {
    settings.devices.push({
      name,
      token,
      platform,
      devicePlatform: normalizeDevicePlatform(payload.devicePlatform),
      deviceId,
      adminId,
      selected: settings.devices.filter((item) => item.isActive).length === 0,
      isActive: true,
      lastSeenAt: new Date(),
    });
    device = settings.devices[settings.devices.length - 1];
  }
  await settings.save();
  if (previousToken) {
    await removeFirebaseDeviceToken({
      ownerType: 'ADMIN',
      ownerId: adminId,
      token: previousToken,
      platform: previousPlatform,
    });
  }
  await upsertFirebaseDeviceToken({ ownerType: 'ADMIN', ownerId: adminId, token, platform });
  return { settings: serializeSettings(settings), deviceId: String(device._id) };
}

export async function removeRestaurantDelayAlertDevice(deviceId) {
  if (!mongoose.Types.ObjectId.isValid(deviceId)) throw new ValidationError('Invalid device id.');
  const settings = await getSettingsDocument();
  const device = settings.devices.id(deviceId);
  if (!device) throw new ValidationError('Device not found.');
  const removal = { adminId: device.adminId, token: device.token, platform: device.platform };
  const hasSelectedRemaining = settings.devices.some(
    (item) => String(item._id) !== String(deviceId) && item.selected && item.isActive,
  );
  device.deleteOne();
  if (!hasSelectedRemaining) settings.enabled = false;
  await settings.save();
  await removeFirebaseDeviceToken({ ownerType: 'ADMIN', ownerId: removal.adminId, token: removal.token, platform: removal.platform });
  return serializeSettings(settings);
}

export async function testRestaurantDelayAlertDevice(deviceId, delaySeconds = 0) {
  if (!mongoose.Types.ObjectId.isValid(deviceId)) throw new ValidationError('Invalid device id.');
  const settings = await getSettingsDocument();
  const device = settings.devices.id(deviceId);
  if (!device || !device.isActive) throw new ValidationError('Active device not found.');
  const safeDelaySeconds = Math.min(10, Math.max(0, Math.trunc(Number(delaySeconds) || 0)));
  if (safeDelaySeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, safeDelaySeconds * 1000));
  }
  const response = await sendPushNotification([device.token], {
    title: 'Restaurant delay alert test',
    body: `Test notification sent to ${device.name}.`,
    dataOnly: false,
    data: { type: 'restaurant_delay_alert_test', link: '/admin/food/restaurant-delay-alerts' },
  });
  if (!response.successCount) throw new ValidationError(response.results?.[0]?.error || 'Test notification could not be delivered.');
  return response;
}

export async function scheduleRestaurantResponseDelayAlert(order) {
  const settings = await FoodRestaurantDelayAlertSettings.findOne({ key: 'global' }).lean();
  const hasTarget = settings?.devices?.some((device) => device.selected && device.isActive && device.token);
  if (!settings?.enabled || !hasTarget || !order?._id) return null;
  const now = Date.now();
  const scheduledAt = order.scheduledAt ? new Date(order.scheduledAt).getTime() : 0;
  const responseWindowStartsAt = scheduledAt > now + 15 * 60 * 1000
    ? scheduledAt - 15 * 60 * 1000
    : now;
  const delay = Math.max(0, responseWindowStartsAt - now) + Math.max(1, Number(settings.delayMinutes || 5)) * 60 * 1000;
  return addOrderJob(
    { action: 'RESTAURANT_RESPONSE_DELAY_ALERT', orderMongoId: String(order._id), configuredDelayMinutes: Number(settings.delayMinutes || 5) },
    { jobId: `restaurant-response-delay-${String(order._id)}`, delay },
  );
}

export async function processRestaurantResponseDelayAlert(orderMongoId, configuredDelayMinutes = null) {
  if (!mongoose.Types.ObjectId.isValid(orderMongoId)) return { skipped: 'invalid_order_id' };
  const settings = await FoodRestaurantDelayAlertSettings.findOne({ key: 'global' });
  if (!settings?.enabled) return { skipped: 'disabled' };
  const order = await FoodOrder.findOne({ _id: orderMongoId, orderStatus: 'created' })
    .populate('restaurantId', 'restaurantName name')
    .lean();
  if (!order) return { skipped: 'restaurant_already_responded' };
  const devices = settings.devices.filter((device) => device.selected && device.isActive && device.token);
  if (!devices.length) return { skipped: 'no_selected_devices' };
  const restaurantName = order.restaurantId?.restaurantName || order.restaurantId?.name || 'Restaurant';
  const response = await sendPushNotification(devices.map((device) => device.token), {
    title: 'Restaurant is not responding',
    body: `${restaurantName} has not responded to order #${order.order_id || order._id} within ${Number(configuredDelayMinutes || settings.delayMinutes)} minutes.`,
    dataOnly: false,
    data: {
      type: 'restaurant_response_delay',
      orderId: String(order._id),
      restaurantId: String(order.restaurantId?._id || order.restaurantId || ''),
      link: '/admin/food/orders/all',
    },
  });
  const invalidTokens = new Set((response.results || []).filter((result) => !result.ok && result.remove).map((result) => result.token));
  if (invalidTokens.size) {
    settings.devices.forEach((device) => {
      if (invalidTokens.has(device.token)) {
        device.isActive = false;
        device.selected = false;
      }
    });
    await settings.save();
  }
  return response;
}
