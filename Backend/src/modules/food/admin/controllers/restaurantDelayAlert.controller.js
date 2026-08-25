import { sendResponse } from '../../../../utils/response.js';
import * as service from '../services/restaurantDelayAlert.service.js';

export async function getSettings(req, res, next) {
  try { return sendResponse(res, 200, 'Restaurant delay alert settings fetched', await service.getRestaurantDelayAlertSettings()); }
  catch (error) { next(error); }
}

export async function updateSettings(req, res, next) {
  try {
    const delayMinutes = Number(req.body?.delayMinutes);
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ success: false, message: 'enabled must be a boolean' });
    if (!Number.isInteger(delayMinutes) || delayMinutes < 1 || delayMinutes > 60) return res.status(400).json({ success: false, message: 'Delay must be between 1 and 60 minutes' });
    const data = await service.updateRestaurantDelayAlertSettings({ ...req.body, delayMinutes });
    return sendResponse(res, 200, 'Restaurant delay alert settings updated', data);
  } catch (error) { next(error); }
}

export async function registerDevice(req, res, next) {
  try { return sendResponse(res, 200, 'Device registered', await service.registerRestaurantDelayAlertDevice(req.user?.userId, req.body)); }
  catch (error) { next(error); }
}

export async function removeDevice(req, res, next) {
  try { return sendResponse(res, 200, 'Device removed', await service.removeRestaurantDelayAlertDevice(req.params.deviceId)); }
  catch (error) { next(error); }
}

export async function testDevice(req, res, next) {
  try { return sendResponse(res, 200, 'Test notification sent', await service.testRestaurantDelayAlertDevice(req.params.deviceId)); }
  catch (error) { next(error); }
}
