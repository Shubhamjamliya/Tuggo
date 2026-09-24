import mongoose from 'mongoose';

const foodRestaurantAdjustmentSchema = new mongoose.Schema(
    {
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodRestaurant',
            required: true,
            index: true
        },
        type: {
            type: String,
            enum: ['credit', 'debit', 'offline_payout', 'adjustment'],
            default: 'adjustment'
        },
        amount: {
            type: Number,
            required: true
        },
        previousBalance: {
            type: Number,
            default: 0
        },
        newBalance: {
            type: Number,
            default: 0
        },
        reason: {
            type: String,
            trim: true,
            default: 'Admin manual adjustment'
        },
        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodUser',
            default: null
        },
        adminNote: {
            type: String,
            trim: true,
            default: ''
        }
    },
    { collection: 'food_restaurant_adjustments', timestamps: true }
);

foodRestaurantAdjustmentSchema.index({ restaurantId: 1, createdAt: -1 });

export const FoodRestaurantAdjustment = mongoose.model(
    'FoodRestaurantAdjustment',
    foodRestaurantAdjustmentSchema,
    'food_restaurant_adjustments'
);
