import { connectDB, disconnectDB } from '../src/config/db.js';
import { FoodDeliveryPartner } from '../src/modules/food/delivery/models/deliveryPartner.model.js';
import { FoodDeliveryWallet } from '../src/modules/food/delivery/models/deliveryWallet.model.js';

async function registerRider() {
    await connectDB();

    const phone = '9815450007';
    console.log(`Checking if delivery partner exists with phone: ${phone}...`);

    let partner = await FoodDeliveryPartner.findOne({ phone });

    if (partner) {
        console.log(`Rider already exists with ID: ${partner._id}`);
        console.log(`Name: ${partner.name}, Status: ${partner.status}`);
        
        // Ensure approved and wallet exists
        if (partner.status !== 'approved') {
            partner.status = 'approved';
            partner.approvedAt = new Date();
            await partner.save();
            console.log('Updated partner status to "approved"');
        }
    } else {
        partner = await FoodDeliveryPartner.create({
            name: 'Rider Demo',
            phone: '9815450007',
            countryCode: '+91',
            email: 'rider9815450007@tuggo.in',
            address: 'Main Market, City Center',
            city: 'Patiala',
            state: 'Punjab',
            vehicleType: 'Bike',
            vehicleName: 'Hero Splendor',
            vehicleNumber: 'PB11AB' + Math.floor(1000 + Math.random() * 9000),
            drivingLicenseNumber: 'PB11' + Math.floor(10000000000 + Math.random() * 90000000000),
            panNumber: 'ABCDE' + Math.floor(1000 + Math.random() * 9000) + 'F',
            aadharNumber: '9815' + Math.floor(10000000 + Math.random() * 90000000),
            status: 'approved',
            approvedAt: new Date(),
            availabilityStatus: 'offline',
            profilePhoto: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
            aadharPhoto: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&q=80',
            aadharFrontPhoto: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&q=80',
            aadharBackPhoto: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&q=80',
            panPhoto: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&q=80',
            drivingLicenseFrontPhoto: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&q=80',
            drivingLicenseBackPhoto: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&q=80',
            rcPhoto: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&q=80',
            bankAccountHolderName: 'Rider Demo',
            bankAccountNumber: '123456789012',
            bankIfscCode: 'HDFC0001234',
            bankName: 'HDFC Bank',
            upiId: '9815450007@upi',
            referralCode: 'RIDER' + phone.slice(-4),
        });
        console.log(`Created new delivery partner profile! ID: ${partner._id}`);
    }

    // Ensure wallet exists
    let wallet = await FoodDeliveryWallet.findOne({ deliveryPartnerId: partner._id });
    if (!wallet) {
        wallet = await FoodDeliveryWallet.create({
            deliveryPartnerId: partner._id,
            balance: 0,
            cashInHand: 0,
            totalEarnings: 0
        });
        console.log(`Created delivery wallet for partner: ${wallet._id}`);
    } else {
        console.log(`Delivery wallet already exists: ${wallet._id}`);
    }

    console.log('\n--- RIDER PROFILE SUMMARY ---');
    console.log({
        id: partner._id,
        name: partner.name,
        phone: partner.phone,
        email: partner.email,
        vehicleNumber: partner.vehicleNumber,
        status: partner.status,
        availabilityStatus: partner.availabilityStatus
    });

    await disconnectDB();
    process.exit(0);
}

registerRider().catch(err => {
    console.error('Error registering rider:', err);
    process.exit(1);
});
