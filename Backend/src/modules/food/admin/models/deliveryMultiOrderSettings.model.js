import mongoose from 'mongoose';

const deliveryMultiOrderSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    maxConcurrentOrders: { type: Number, min: 1, max: 5, default: 1 },
  },
  { collection: 'food_delivery_multi_order_settings', timestamps: true },
);

export const FoodDeliveryMultiOrderSettings = mongoose.model(
  'FoodDeliveryMultiOrderSettings',
  deliveryMultiOrderSettingsSchema,
);

const deliveryAcceptanceLockSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'food_delivery_acceptance_locks', versionKey: false },
);

deliveryAcceptanceLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const FoodDeliveryAcceptanceLock = mongoose.model(
  'FoodDeliveryAcceptanceLock',
  deliveryAcceptanceLockSchema,
);
