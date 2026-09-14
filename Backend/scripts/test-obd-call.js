import { triggerObdVoiceCall } from '../src/services/obd.service.js';
import { getCallAlertConfig } from '../src/modules/food/orders/services/order-call-alert.service.js';
import { connectDB, disconnectDB } from '../src/config/db.js';

async function testObd() {
    console.log('Testing OBD Configuration and API Connectivity...');
    await connectDB();

    const config = await getCallAlertConfig();
    console.log('Active Call Alert Config from DB/env:', config);

    // Use CLI argument or default to test phone number
    const testNumber = process.argv[2] || '7974161582';
    console.log(`Triggering test OBD call to ${testNumber}...`);

    const result = await triggerObdVoiceCall({
        phoneNumber: testNumber,
        voiceFile: config.voiceFile,
        meta: { test: true, triggeredAt: new Date().toISOString() }
    });

    console.log('OBD Call Result:');
    console.log(JSON.stringify(result, null, 2));

    await disconnectDB();
    process.exit(0);
}

testObd().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
