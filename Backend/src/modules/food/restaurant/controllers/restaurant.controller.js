import { listPublicApprovedFoods } from '../services/restaurantFood.service.js';
import {
    registerRestaurant,
    listApprovedRestaurants,
    getApprovedRestaurantByIdOrSlug,
    getCurrentRestaurantProfile,
    updateRestaurantProfile,
    updateRestaurantAcceptingOrders,
    updateCurrentRestaurantDiningSettings,
    uploadRestaurantProfileImage,
    uploadRestaurantMenuImage,
    uploadRestaurantCoverImages,
    uploadRestaurantMenuImages,
    listPublicOffers,
    getRestaurantComplaints
} from '../services/restaurant.service.js';
import {
    createDiningRequest,
    getPendingDiningRequest
} from '../../dining/services/dining.service.js';
import { validateRestaurantRegisterDto } from '../validators/restaurant.validator.js';
import { sendResponse } from '../../../../utils/response.js';
import { FoodBusinessSettings } from '../../admin/models/businessSettings.model.js';
import { sendRestaurantOnboardingEmail } from '../../../../utils/email.js';

export const registerRestaurantController = async (req, res, next) => {
    try {
        const validated = validateRestaurantRegisterDto(req.body);
        const restaurant = await registerRestaurant(validated, req.files);

        // Send onboarding email with T&C asynchronously
        (async () => {
            try {
                const settings = await FoodBusinessSettings.findOne().lean();
                const pdfUrl = settings?.termsAndConditionsPdf?.url || null;
                const email = validated.ownerEmail || restaurant.ownerEmail;
                const restaurantName = validated.restaurantName || restaurant.restaurantName;
                
                if (email) {
                    await sendRestaurantOnboardingEmail(email, restaurantName, pdfUrl);
                }
            } catch (err) {
                console.error("Error sending onboarding email:", err);
            }
        })();

        return sendResponse(res, 201, 'Restaurant registered successfully', restaurant);
    } catch (error) {
        next(error);
    }
};

export const listApprovedRestaurantsController = async (req, res, next) => {
    try {
        const mergedQuery = {
            ...req.query,
            lat: req.query?.lat ?? req.headers['x-user-lat'],
            lng: req.query?.lng ?? req.headers['x-user-lng']
        };
        const data = await listApprovedRestaurants(mergedQuery);
        return sendResponse(res, 200, 'Restaurants fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const listPublicApprovedFoodsController = async (req, res, next) => {
    try {
        const data = await listPublicApprovedFoods(req.query || {});
        return sendResponse(res, 200, 'Foods fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getApprovedRestaurantController = async (req, res, next) => {
    try {
        const restaurant = await getApprovedRestaurantByIdOrSlug(req.params.id, req.query);
        if (!restaurant) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const getCurrentRestaurantController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await getCurrentRestaurantProfile(restaurantId);
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantProfileController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateRestaurantProfile(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Restaurant updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantAcceptingOrdersController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateRestaurantAcceptingOrders(restaurantId, req.body?.isAcceptingOrders);
        return sendResponse(res, 200, 'Restaurant availability updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateCurrentRestaurantDiningSettingsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateCurrentRestaurantDiningSettings(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Dining settings updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantProfileImageController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantProfileImage(restaurantId, req.file);
        return sendResponse(res, 200, 'Profile image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImageController = async (req, res, next) => {
    try {
        const result = await uploadRestaurantMenuImage(req.file);
        return sendResponse(res, 200, 'Menu image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantCoverImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantCoverImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Restaurant photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantMenuImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Menu photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const listPublicOffersController = async (req, res, next) => {
    try {
        const data = await listPublicOffers(req.query || {});
        return sendResponse(res, 200, 'Offers fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getRestaurantComplaintsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const data = await getRestaurantComplaints(restaurantId, req.query || {});
        return sendResponse(res, 200, 'Complaints fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const createDiningRequestController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const request = await createDiningRequest(restaurantId, req.body || {});
        return sendResponse(res, 201, 'Dining update request submitted successfully', request);
    } catch (error) {
        next(error);
    }
};

export const getPendingDiningRequestController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const request = await getPendingDiningRequest(restaurantId);
        return sendResponse(res, 200, 'Pending request fetched successfully', request);
    } catch (error) {
        next(error);
    }
};

