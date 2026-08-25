import React, { useEffect, useState } from 'react';
import { adminAPI } from '@food/api';
import { toast } from 'sonner';
import { Switch } from '@food/components/ui/switch';

export default function DeliveryMultiOrders() {
  const [enabled, setEnabled] = useState(false);
  const [maxConcurrentOrders, setMaxConcurrentOrders] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminAPI.getDeliveryMultiOrderSettings()
      .then((response) => {
        const settings = response?.data?.data || {};
        setEnabled(Boolean(settings.enabled));
        setMaxConcurrentOrders(Number(settings.maxConcurrentOrders || 1));
      })
      .catch(() => toast.error('Unable to load multiple order settings'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    const limit = Number(maxConcurrentOrders);
    if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
      toast.error('Maximum simultaneous orders must be between 1 and 5');
      return;
    }
    setSaving(true);
    try {
      const response = await adminAPI.updateDeliveryMultiOrderSettings({
        enabled,
        maxConcurrentOrders: limit,
      });
      const settings = response?.data?.data || {};
      setEnabled(Boolean(settings.enabled));
      setMaxConcurrentOrders(Number(settings.maxConcurrentOrders || limit));
      toast.success('Multiple order settings saved');
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Unable to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading settings...</div>;

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Multiple Orders</h1>
        <p className="mt-1 text-sm text-gray-500">
          Control how many active deliveries a delivery partner can accept simultaneously.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm space-y-6">
        <div className={`flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors ${enabled ? 'border-green-200 bg-green-50/60' : 'border-gray-200 bg-gray-50'}`}>
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Allow multiple orders</h2>
            <p className="text-sm text-gray-500 mt-1">
              When off, every delivery partner can have only one active order.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className={`min-w-8 text-right text-xs font-bold ${enabled ? 'text-green-700' : 'text-gray-500'}`}>
              {enabled ? 'ON' : 'OFF'}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Allow multiple orders"
              className="h-7 w-12 border-0 bg-gray-300 shadow-inner data-[state=checked]:bg-green-600 [&_[data-slot=switch-thumb]]:h-5 [&_[data-slot=switch-thumb]]:w-5 [&_[data-slot=switch-thumb]]:bg-white data-[state=checked]:[&_[data-slot=switch-thumb]]:translate-x-6 data-[state=unchecked]:[&_[data-slot=switch-thumb]]:translate-x-1"
            />
          </div>
        </div>

        <div>
          <label htmlFor="maxConcurrentOrders" className="block text-sm font-semibold text-gray-900">
            Maximum simultaneous orders
          </label>
          <input
            id="maxConcurrentOrders"
            type="number"
            min="1"
            max="5"
            step="1"
            value={maxConcurrentOrders}
            disabled={!enabled}
            onChange={(event) => setMaxConcurrentOrders(event.target.value)}
            className="mt-2 w-full max-w-xs rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-green-600 disabled:bg-gray-100 disabled:text-gray-400"
          />
          <p className="mt-2 text-xs text-gray-500">
            Accepted orders are never removed if this setting is disabled or the limit is reduced.
          </p>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-gray-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}
