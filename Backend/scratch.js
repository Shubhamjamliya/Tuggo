import 'dotenv/config';
import { connectDB } from './src/config/db.js';
import mongoose from 'mongoose';

await connectDB();
console.log('Connected to DB');
const orderModel = mongoose.connection.collection('food_orders');
const counts = await orderModel.aggregate([{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }]).toArray();
console.log('Order status counts in DB:', JSON.stringify(counts, null, 2));

const pendingOrders = await orderModel.find({ 
  orderStatus: { $in: ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up'] } 
}).toArray();
console.log('Pending orders count:', pendingOrders.length);
console.log('Pending orders details:', JSON.stringify(pendingOrders.map(o => ({
  _id: o._id,
  order_id: o.order_id,
  orderId: o.orderId,
  orderStatus: o.orderStatus,
  createdAt: o.createdAt,
  payment: o.payment?.status,
  method: o.payment?.method
})), null, 2));

process.exit(0);
