import React from 'react';
import { CheckCircle2, Clock3, MapPin, Package, Store, X } from 'lucide-react';
import { getOrderAcceptId, getOrderMongoId } from '@food/utils/orderDispatchId';

const money = (value) => `₹${Number(value || 0).toFixed(0)}`;

const restaurantName = (order) =>
  order?.restaurantId?.restaurantName || order?.restaurantId?.name || order?.restaurantName || 'Restaurant';

const displayOrderId = (order) => order?.order_id || order?.displayOrderId || getOrderAcceptId(order) || 'Order';

function OrderInfo({ order }) {
  const amount = order?.deliveryEarning || order?.deliveryFee || order?.pricing?.deliveryFee || order?.pricing?.total;
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{displayOrderId(order)}</p>
          <h3 className="mt-1 text-base font-black text-gray-950">{restaurantName(order)}</h3>
        </div>
        <span className="rounded-lg bg-green-50 px-2.5 py-1 text-xs font-black text-green-700">{money(amount)}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-semibold text-gray-600">
        <span className="flex items-center gap-1.5"><Store className="h-4 w-4 text-orange-500" />Pickup</span>
        <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-blue-500" />Customer drop</span>
      </div>
    </>
  );
}

export default function OrdersV2({ incomingOrders = [], acceptedOrders = [], capacity = {}, onAccept, onPass, onOpen }) {
  const limit = Number(capacity.effectiveLimit || 1);
  const activeCount = Number(capacity.activeOrderCount ?? acceptedOrders.length);
  const canAccept = capacity.canAcceptMore !== false && activeCount < limit;

  return (
    <div className="min-h-full bg-gray-50 px-4 pb-28 pt-5">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-950">Orders</h1>
          <p className="mt-1 text-sm font-medium text-gray-500">Manage offers and active deliveries</p>
        </div>
        <span className="rounded-full bg-gray-950 px-3 py-1.5 text-xs font-bold text-white">{activeCount} / {limit} active</span>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-2"><Clock3 className="h-5 w-5 text-orange-500" /><h2 className="font-black text-gray-900">New offers</h2></div>
        <div className="space-y-3">
          {incomingOrders.length === 0 && <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">No new offers right now.</div>}
          {incomingOrders.map((order) => {
            const id = getOrderMongoId(order) || getOrderAcceptId(order);
            return (
              <article key={id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <OrderInfo order={order} />
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button type="button" onClick={(event) => { event.stopPropagation(); onPass?.(order); }} className="flex items-center justify-center gap-2 rounded-xl border border-gray-300 py-3 text-sm font-bold text-gray-700"><X className="h-4 w-4" />Pass</button>
                  <button type="button" disabled={!canAccept} onClick={(event) => { event.stopPropagation(); onAccept?.(order); }} className="flex items-center justify-center gap-2 rounded-xl bg-gray-950 py-3 text-sm font-bold text-white disabled:bg-gray-300"><CheckCircle2 className="h-4 w-4" />{canAccept ? 'Accept' : 'Limit reached'}</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mt-7">
        <div className="mb-3 flex items-center gap-2"><Package className="h-5 w-5 text-green-600" /><h2 className="font-black text-gray-900">Accepted orders</h2></div>
        <div className="space-y-3">
          {acceptedOrders.length === 0 && <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">No active deliveries.</div>}
          {acceptedOrders.map((order) => {
            const id = getOrderMongoId(order) || getOrderAcceptId(order);
            return (
              <button key={id} type="button" onClick={() => onOpen?.(order)} className="w-full rounded-2xl border border-green-200 bg-white p-4 text-left shadow-sm transition active:scale-[0.99]">
                <OrderInfo order={order} />
                <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
                  <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-black uppercase text-green-700">{String(order?.orderStatus || 'accepted').replaceAll('_', ' ')}</span>
                  <span className="text-sm font-black text-gray-950">Open order →</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
