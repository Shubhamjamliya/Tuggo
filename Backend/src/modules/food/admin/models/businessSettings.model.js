import mongoose from 'mongoose';

const businessSettingsSchema = new mongoose.Schema(
    {
        companyName: { type: String, required: true, default: 'Tuggo' },
        email: { type: String, required: true, default: 'admin@tuggo.com' },
        phone: {
            countryCode: { type: String, default: '+91' },
            number: { type: String, default: '' }
        },
        address: { type: String, default: '' },
        state: { type: String, default: '' },
        pincode: { type: String, default: '' },
        region: { type: String, default: 'India' },
        fssai: { type: String, default: '' },
        gstin: { type: String, default: '' },
        logo: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        userLogo: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        restaurantLogo: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        deliveryLogo: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        favicon: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        supportEmail: { type: String, default: 'support@tuggo.com' },
        supportPhone: { type: String, default: '+91 1234567890' },
        supportHours: { type: String, default: '24/7 Availability' },
        termsAndConditionsPdf: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        onlinePaymentOnly: { type: Boolean, default: false },
        maxCodAmount: { type: Number, default: 0 }, // 0 means no limit
        maintenanceMode: { type: Boolean, default: false },
        customerRegistration: { type: Boolean, default: true },
        restaurantRegistration: { type: Boolean, default: true },
        deliveryRegistration: { type: Boolean, default: true }
    },
    { timestamps: true }
);

export const FoodBusinessSettings = mongoose.model('FoodBusinessSettings', businessSettingsSchema);
