import React, { useEffect, useMemo, useState } from 'react';
import { BellRing, Check, Loader2, Send, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminAPI } from '@food/api';
import { Switch } from '@food/components/ui/switch';
import { registerWebPushForCurrentModule } from '@food/utils/firebaseMessaging';

const inferDevicePlatform = () => {
  const agent = String(navigator.userAgent || '').toLowerCase();
  if (/iphone|ipad|ipod/.test(agent)) return 'ios';
  if (agent.includes('android')) return 'android';
  return 'web';
};

const getDeviceId = () => {
  const key = 'admin_restaurant_delay_alert_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `admin-device-${Date.now()}`;
    localStorage.setItem(key, id);
  }
  return id;
};

export default function RestaurantDelayAlerts() {
  const [settings, setSettings] = useState({ enabled: false, delayMinutes: 5, devices: [] });
  const [deviceName, setDeviceName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [testingId, setTestingId] = useState('');

  const selectedCount = useMemo(() => settings.devices.filter((device) => device.selected && device.isActive).length, [settings.devices]);

  const load = async () => {
    try {
      const response = await adminAPI.getRestaurantDelayAlertSettings();
      setSettings(response?.data?.data || { enabled: false, delayMinutes: 5, devices: [] });
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Unable to load alert settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const registerThisDevice = async () => {
    const name = deviceName.trim();
    if (!name) return toast.error('Enter a name for this device');
    setRegistering(true);
    try {
      const token = await registerWebPushForCurrentModule(window.location.pathname, { allowAdmin: true });
      if (!token) throw new Error('Notification permission was not granted or Firebase is not configured.');
      const isNativeApp = Boolean(window.flutter_inappwebview?.callHandler);
      const response = await adminAPI.registerRestaurantDelayAlertDevice({
        name,
        token,
        platform: isNativeApp ? 'mobile' : 'web',
        devicePlatform: inferDevicePlatform(),
        deviceId: getDeviceId(),
      });
      setSettings(response?.data?.data?.settings || settings);
      setDeviceName('');
      toast.success('This device is registered');
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Unable to register this device');
    } finally {
      setRegistering(false);
    }
  };

  const toggleDevice = (id, checked) => {
    setSettings((current) => ({
      ...current,
      devices: current.devices.map((device) => device.id === id ? { ...device, selected: checked } : device),
    }));
  };

  const save = async () => {
    if (settings.enabled && selectedCount === 0) return toast.error('Select at least one active device');
    const delayMinutes = Number(settings.delayMinutes);
    if (!Number.isInteger(delayMinutes) || delayMinutes < 1 || delayMinutes > 60) return toast.error('Delay must be between 1 and 60 minutes');
    setSaving(true);
    try {
      const response = await adminAPI.updateRestaurantDelayAlertSettings({
        enabled: settings.enabled,
        delayMinutes,
        selectedDeviceIds: settings.devices.filter((device) => device.selected && device.isActive).map((device) => device.id),
      });
      setSettings(response?.data?.data || settings);
      toast.success('Restaurant delay alerts saved');
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Unable to save settings');
    } finally {
      setSaving(false);
    }
  };

  const testDevice = async (id) => {
    setTestingId(id);
    try {
      await adminAPI.testRestaurantDelayAlertDevice(id);
      toast.success('Test notification sent');
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Test notification failed');
    } finally {
      setTestingId('');
    }
  };

  const removeDevice = async (id) => {
    if (!window.confirm('Remove this notification device?')) return;
    try {
      const response = await adminAPI.removeRestaurantDelayAlertDevice(id);
      setSettings(response?.data?.data || settings);
      toast.success('Device removed');
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Unable to remove device');
    }
  };

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading settings...</div>;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <div className="mb-6 flex items-start gap-3">
        <div className="rounded-xl bg-amber-100 p-3 text-amber-700"><BellRing className="h-6 w-6" /></div>
        <div><h1 className="text-2xl font-bold text-slate-900">Restaurant Delay Alerts</h1><p className="mt-1 text-sm text-slate-500">Notify selected admin devices when a restaurant does not respond to an order.</p></div>
      </div>

      <div className="space-y-5">
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <h2 className="font-bold text-blue-950">How to set it up</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-blue-900">
            <li>Open this page on the phone that should receive alerts.</li>
            <li>Enter a device name, register it, and allow notifications.</li>
            <li>Select the device, set the wait time, turn alerts on, and save.</li>
          </ol>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">Register this device</h2>
          <p className="mt-1 text-sm text-slate-500">Do this from each phone that should appear in the device list.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={50} placeholder="Example: Owner Phone" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-600" />
            <button type="button" onClick={registerThisDevice} disabled={registering} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
              {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}{registering ? 'Registering...' : 'Register this device'}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4"><div><h2 className="font-bold text-slate-900">Enable delay alerts</h2><p className="mt-1 text-sm text-slate-500">Only orders still waiting for a restaurant response will trigger an alert.</p></div><div className="flex items-center gap-3"><span className={`text-xs font-bold ${settings.enabled ? 'text-green-700' : 'text-slate-500'}`}>{settings.enabled ? 'ON' : 'OFF'}</span><Switch checked={settings.enabled} onCheckedChange={(enabled) => setSettings((current) => ({ ...current, enabled }))} className="data-[state=checked]:bg-green-600" /></div></div>
          <div className="mt-5"><label className="text-sm font-semibold text-slate-800" htmlFor="delayMinutes">Wait time before alert</label><div className="mt-2 flex max-w-xs items-center gap-2"><input id="delayMinutes" type="number" min="1" max="60" value={settings.delayMinutes} onChange={(event) => setSettings((current) => ({ ...current, delayMinutes: event.target.value }))} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-600" /><span className="text-sm font-semibold text-slate-500">minutes</span></div></div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4"><h2 className="font-bold text-slate-900">Notification devices</h2><p className="mt-1 text-sm text-slate-500">Choose one or more devices. Tokens are stored securely and are not displayed.</p></div>
          <div className="space-y-3">
            {settings.devices.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No devices registered yet.</div>}
            {settings.devices.map((device) => (
              <div key={device.id} className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center ${device.selected ? 'border-green-200 bg-green-50/40' : 'border-slate-200'}`}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"><input type="checkbox" checked={device.selected} disabled={!device.isActive} onChange={(event) => toggleDevice(device.id, event.target.checked)} className="h-5 w-5 rounded border-slate-300 accent-green-600" /><Smartphone className="h-5 w-5 shrink-0 text-slate-500" /><span className="min-w-0"><span className="block truncate font-bold text-slate-900">{device.name}</span><span className="text-xs capitalize text-slate-500">{device.devicePlatform} · {device.isActive ? 'Active' : 'Inactive'}</span></span>{device.selected && <Check className="h-4 w-4 text-green-600" />}</label>
                <div className="flex gap-2"><button type="button" onClick={() => testDevice(device.id)} disabled={!device.isActive || testingId === device.id} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">{testingId === device.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Test</button><button type="button" onClick={() => removeDevice(device.id)} className="rounded-lg border border-red-200 p-2 text-red-600" aria-label={`Remove ${device.name}`}><Trash2 className="h-4 w-4" /></button></div>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end"><button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-6 py-3 text-sm font-bold text-white disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? 'Saving...' : 'Save settings'}</button></div>
      </div>
    </div>
  );
}
