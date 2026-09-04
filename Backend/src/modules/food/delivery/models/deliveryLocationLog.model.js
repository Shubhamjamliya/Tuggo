import mongoose from 'mongoose';

const deliveryLocationLogSchema = new mongoose.Schema(
    {
        deliveryPartnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodDeliveryPartner',
            required: true,
            index: true
        },
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodOrder',
            default: null,
            index: true
        },
        location: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                required: true
            }
        },
        speed: {
            type: Number,
            default: null
        },
        heading: {
            type: Number,
            default: null
        },
        accuracy: {
            type: Number,
            default: null
        },
        altitude: {
            type: Number,
            default: null
        },
        battery: {
            type: Number,
            default: null
        },
        capturedAt: {
            type: Date,
            required: true,
            index: true
        }
    },
    {
        collection: 'food_delivery_location_logs',
        timestamps: true
    }
);

// Compound indexes for deduplication & fast trajectory queries
deliveryLocationLogSchema.index({ deliveryPartnerId: 1, capturedAt: 1 }, { unique: true });
deliveryLocationLogSchema.index({ orderId: 1, capturedAt: 1 });
deliveryLocationLogSchema.index({ location: '2dsphere' });

export const DeliveryLocationLog = mongoose.model('DeliveryLocationLog', deliveryLocationLogSchema);
