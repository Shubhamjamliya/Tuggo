import React from 'react';
import { CheckCircle2, Clock3, MapPin, Package, Store, X, ExternalLink, Banknote, CreditCard } from 'lucide-react';
import { getOrderAcceptId, getOrderMongoId } from '@food/utils/orderDispatchId';
import { getRestaurantDisplayInfo, getCustomerDisplayInfo, getOrderPaymentInfo } from '@/modules/DeliveryV2/utils/orderLocation';

const money = (value) => `₹${Number(value || 0).toFixed(0)}`;

const displayOrderId = (order) => order?.order_id || order?.displayOrderId || getOrderAcceptId(order) || 'Order';

function OrderInfo({ order }) {
  const amount =
    order?.earnings ||
    order?.riderEarning ||
    order?.deliveryEarning ||
    order?.deliveryFee ||
    order?.pricing?.deliveryFee ||
    order?.pricing?.total;
  const restaurantInfo = getRestaurantDisplayInfo(order);
  const customerInfo = getCustomerDisplayInfo(order);
  const paymentInfo = getOrderPaymentInfo(order);
  const distanceKm =
    order?.pickupDistanceKm ??
    order?.distanceKm ??
    order?.dropDistanceKm ??
    order?.deliveryDistanceKm;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{displayOrderId(order)}</p>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
              paymentInfo.isCod
                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
            }`}>
              {paymentInfo.paymentLabel}
            </span>
            {distanceKm != null && Number.isFinite(Number(distanceKm)) && (
              <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
                {Number(distanceKm).toFixed(1)} km
              </span>
            )}
          </div>
          <h3 className="mt-0.5 text-base font-black text-gray-950">{restaurantInfo.name}</h3>
        </div>
        <div className="text-right shrink-0">
          <span className="inline-block rounded-xl bg-green-50 border border-green-100 px-3 py-1.5 text-sm font-black text-green-700">
            {money(amount)}
          </span>
          <span className="block text-[10px] font-semibold text-gray-400 mt-0.5">Rider Pay</span>
        </div>
      </div>

      <div className="mt-3.5 space-y-2.5 rounded-xl bg-gray-50/80 p-3 text-xs border border-gray-100">
        {/* Restaurant Pickup */}
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600">
            <Store className="h-3 w-3" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">Pickup Location</span>
              {restaurantInfo.mapsUrl && (
                <a
                  href={restaurantInfo.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-600 hover:text-blue-700 active:scale-95 transition-transform"
                >
                  <span>Map</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
            <p className="mt-0.5 text-xs font-semibold text-gray-800 truncate">{restaurantInfo.name}</p>
            <p className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">{restaurantInfo.address}</p>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-dashed border-gray-200 ml-7" />

        {/* Customer Drop */}
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
            <MapPin className="h-3 w-3" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Customer Drop</span>
              {customerInfo.mapsUrl && (
                <a
                  href={customerInfo.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-600 hover:text-blue-700 active:scale-95 transition-transform"
                >
                  <span>Map</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
            <p className="mt-0.5 text-xs font-semibold text-gray-800 truncate">{customerInfo.name}</p>
            <p className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed">{customerInfo.address}</p>
          </div>
        </div>
      </div>

      {/* Order Bill & Payment Status Strip */}
      <div className={`mt-2.5 flex items-center justify-between rounded-xl px-3 py-2 text-xs border ${
        paymentInfo.isCod
          ? 'bg-amber-50/70 border-amber-200/80 text-amber-900'
          : 'bg-emerald-50/70 border-emerald-200/80 text-emerald-900'
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          {paymentInfo.isCod ? <Banknote className="h-4 w-4 shrink-0 text-amber-600" /> : <CreditCard className="h-4 w-4 shrink-0 text-emerald-600" />}
          <div className="min-w-0">
            <span className="font-bold block truncate">
              {paymentInfo.isCod ? `Cash to Collect: ₹${paymentInfo.totalAmount.toFixed(2)}` : 'Pre-paid Online (Collect ₹0)'}
            </span>
            <span className="text-[10px] opacity-80 block truncate">
              {paymentInfo.collectionNotice}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0 ml-2">
          <span className="text-[10px] uppercase font-bold text-gray-400 block">Total Bill</span>
          <span className="font-black text-gray-950 text-sm">
            ₹{paymentInfo.totalAmount.toFixed(2)}
          </span>
        </div>
      </div>
    </>
  );
}

export default function OrdersV2({ incomingOrders = [], acceptedOrders = [], capacity = {}, onAccept, onPass, onOpen, onMarkDelivered }) {
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
              <article key={id} onClick={() => onOpen?.(order)} className="w-full rounded-2xl border border-green-200 bg-white p-4 text-left shadow-sm transition active:scale-[0.99] cursor-pointer">
                <OrderInfo order={order} />
                <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 gap-2">
                  <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-black uppercase text-green-700 truncate">{String(order?.orderStatus || 'accepted').replaceAll('_', ' ')}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkDelivered?.(order);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-black uppercase tracking-wider shadow-sm transition-all"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Mark Delivered</span>
                    </button>
                    <span className="text-xs font-black text-gray-900 flex items-center">Open →</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
