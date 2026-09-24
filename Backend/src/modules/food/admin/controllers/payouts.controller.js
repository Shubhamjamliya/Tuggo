import * as payoutsService from '../services/payouts.service.js';
import { sendResponse } from '../../../../utils/response.js';

export async function getPayoutSummaryController(req, res, next) {
    try {
        const summary = await payoutsService.getPayoutSummary(req.query);
        return sendResponse(res, 200, 'Payout summary retrieved successfully', summary);
    } catch (err) {
        next(err);
    }
}

export async function getPayoutOrdersController(req, res, next) {
    try {
        const result = await payoutsService.getPayoutOrders(req.query);
        return sendResponse(res, 200, 'Payout orders retrieved successfully', result);
    } catch (err) {
        next(err);
    }
}

export async function getPayoutPdfDataController(req, res, next) {
    try {
        const data = await payoutsService.getPayoutPdfData(req.query);
        return sendResponse(res, 200, 'Payout PDF data retrieved successfully', data);
    } catch (err) {
        next(err);
    }
}

export async function markPayoutAsPaidController(req, res, next) {
    try {
        const withdrawal = await payoutsService.markPayoutAsPaid(req.body || {});
        return sendResponse(res, 201, 'Payout marked as paid successfully', { withdrawal });
    } catch (err) {
        next(err);
    }
}
