import mongoose from 'mongoose';

const alertDeviceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 50 },
  token: { type: String, required: true, trim: true },
  platform: { type: String, enum: ['web', 'mobile'], default: 'web' },
  devicePlatform: { type: String, enum: ['ios', 'android', 'web', 'unknown'], default: 'unknown' },
  deviceId: { type: String, trim: true, default: '' },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAdmin', required: true },
  selected: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  lastSeenAt: { type: Date, default: Date.now },
}, { _id: true });

const restaurantDelayAlertSettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'global', immutable: true },
  enabled: { type: Boolean, default: false },
  delayMinutes: { type: Number, min: 1, max: 60, default: 5 },
  devices: { type: [alertDeviceSchema], default: [] },
}, { collection: 'food_restaurant_delay_alert_settings', timestamps: true });

export const FoodRestaurantDelayAlertSettings = mongoose.model(
  'FoodRestaurantDelayAlertSettings',
  restaurantDelayAlertSettingsSchema,
);
