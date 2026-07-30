import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodCategory } from '../../admin/models/category.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { resolveStoredUploadPath, uploadFoodImage } from '../../../../services/upload.service.js';
import {
    extractRawFoodVariants,
    getFoodDisplayPrice,
    hasFoodVariants,
    normalizeFoodVariantsInput
} from '../../admin/services/foodVariant.service.js';
import {
    backfillLegacyCategoryWorkflow,
    categoryAllowsFoodType,
    GLOBAL_CATEGORY_FILTER
} from '../../shared/categoryWorkflow.js';
import { parseQueryLimit, parseQueryPage } from '../../../../utils/helpers.js';

const toStr = (v) => (v != null ? String(v).trim() : '');
const APPROVED_CATEGORY_FILTER = [
    { approvalStatus: 'approved' },
    { approvalStatus: { $exists: false }, isApproved: { $ne: false } }
];

const normalizeFoodType = (v) => {
    const t = String(v || '').trim();
    if (!t) return 'Non-Veg';
    if (t === 'Veg') return 'Veg';
    if (t === 'Non-Veg') return 'Non-Veg';
    if (t === 'Egg') return 'Non-Veg';
    return 'Non-Veg';
};

const CLOUDINARY_HOST_RE = /res\.cloudinary\.com/i;
const isCloudinaryUrl = (value) => CLOUDINARY_HOST_RE.test(String(value || ''));
const isLocalUploadUrl = (value) => /^\/uploads\//i.test(String(value || ''));

const shouldUploadImageUrl = (value) => {
    const url = toStr(value);
    if (!url) return false;
    if (isCloudinaryUrl(url)) return false;
    if (isLocalUploadUrl(url)) return false;
    if (/^data:/i.test(url) || /^blob:/i.test(url)) return false;
    return /^https?:\/\//i.test(url);
};

const downloadImageBuffer = async (url) => {
    if (typeof fetch !== 'function') {
        throw new Error('Image download is not supported in this runtime');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Failed to download image (${response.status})`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } finally {
        clearTimeout(timeoutId);
    }
};

const MAX_BULK_ITEMS = 500;
const BULK_CONCURRENCY = 5;

const ensureLocalImageUrl = async (value) => {
    const url = toStr(value);
    if (!url) return '';
    if (!shouldUploadImageUrl(url)) return url;
    const buffer = await downloadImageBuffer(url);
    return await uploadFoodImage(buffer);
};

const asyncPool = async (limit, items, iterator) => {
    const results = [];
    const executing = new Set();

    for (let i = 0; i < items.length; i++) {
        const p = Promise.resolve().then(() => iterator(items[i], i));
        results.push(p);
        executing.add(p);

        const cleanup = () => executing.delete(p);
        p.then(cleanup).catch(cleanup);

        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }

    return Promise.all(results);
};

const getCreateFoodPricing = (body = {}) => {
    const variants = normalizeFoodVariantsInput(extractRawFoodVariants(body));
    if (variants.length > 0) {
        return {
            price: getFoodDisplayPrice({ variants }),
            variants
        };
    }

    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw new ValidationError('Price is invalid');
    return {
        price,
        variants: []
    };
};

const getUpdatedFoodPricing = (existing = {}, body = {}) => {
    const variantsTouched = body.variants !== undefined || body.variations !== undefined;
    const existingHasVariants = hasFoodVariants(existing);
    const update = {};

    if (variantsTouched) {
        const variants = normalizeFoodVariantsInput(extractRawFoodVariants(body));
        update.variants = variants;

        if (variants.length > 0) {
            update.price = getFoodDisplayPrice({ variants });
            return update;
        }

        const nextBasePrice = body.price !== undefined ? Number(body.price) : Number(existingHasVariants ? NaN : existing.price);
        if (!Number.isFinite(nextBasePrice) || nextBasePrice < 0) {
            throw new ValidationError('Base price is required when variants are removed');
        }
        update.price = nextBasePrice;
        return update;
    }

    if (body.price !== undefined) {
        if (existingHasVariants) {
            throw new ValidationError('Update variants instead of base price for foods with variants');
        }
        const price = Number(body.price);
        if (!Number.isFinite(price) || price < 0) throw new ValidationError('Price is invalid');
        update.price = price;
    }

    return update;
};

const getRestaurantContext = async (restaurantId) => {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }

    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('pureVegRestaurant')
        .lean();
    if (!restaurant?._id) {
        throw new ValidationError('Restaurant not found');
    }

    return {
        restaurantId: new mongoose.Types.ObjectId(String(restaurantId)),
        pureVegRestaurant: restaurant.pureVegRestaurant === true
    };
};

const getAccessibleCategoryFilter = (context) => ({
    $or: [
        { restaurantId: context.restaurantId, $or: APPROVED_CATEGORY_FILTER },
        {
            $and: [
                { $or: GLOBAL_CATEGORY_FILTER },
                { $or: APPROVED_CATEGORY_FILTER }
            ]
        }
    ]
});

const resolveCategoryForRestaurant = async (context, body = {}) => {
    const categoryIdRaw = toStr(body.categoryId);
    const categoryNameRaw = toStr(body.categoryName);
    const foodType = normalizeFoodType(body.foodType);

    if (!categoryIdRaw && !categoryNameRaw) {
        return { categoryObjectId: undefined, categoryName: '' };
    }

    const baseFilter = {
        ...getAccessibleCategoryFilter(context),
        isActive: { $ne: false }
    };
    if (context.pureVegRestaurant) {
        baseFilter.foodTypeScope = { $in: ['Veg', 'Both'] };
    }

    let category = null;
    if (categoryIdRaw) {
        if (!mongoose.Types.ObjectId.isValid(categoryIdRaw)) {
            throw new ValidationError('Invalid category id');
        }

        category = await FoodCategory.findOne({
            _id: new mongoose.Types.ObjectId(categoryIdRaw),
            ...baseFilter
        }).lean();
    } else {
        const exact = `^${String(categoryNameRaw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
        const matches = await FoodCategory.find({
            ...baseFilter,
            name: { $regex: exact, $options: 'i' }
        })
            .sort({ createdAt: -1 })
            .limit(2)
            .lean();
        if (matches.length > 1) {
            throw new ValidationError('Multiple categories share this name. Please choose a specific category.');
        }
        category = matches[0] || null;

        // Automatically create category if not found by name
        if (!category) {
            category = await FoodCategory.create({
                name: categoryNameRaw,
                restaurantId: context.restaurantId,
                createdByRestaurantId: context.restaurantId,
                foodTypeScope: context.pureVegRestaurant ? 'Veg' : 'Both',
                approvalStatus: 'approved',
                isApproved: true,
                isActive: true
            });
        }
    }

    if (!category?._id) {
        throw new ValidationError('Category lookup failed');
    }

    await backfillLegacyCategoryWorkflow([category]);

    if (String(category.approvalStatus || '') !== 'approved') {
        throw new ValidationError('This category is awaiting admin approval');
    }
    if (context.pureVegRestaurant && String(category.foodTypeScope || '') === 'Non-Veg') {
        throw new ValidationError('Pure veg restaurants can only use veg categories');
    }
    if (!categoryAllowsFoodType(category.foodTypeScope, foodType)) {
        throw new ValidationError(`This ${category.foodTypeScope} category cannot accept ${foodType} food`);
    }

    return {
        categoryObjectId: category._id,
        categoryName: category.name || '',
        category
    };
};

export async function createRestaurantFood(restaurantId, body = {}) {
    const context = await getRestaurantContext(restaurantId);

    const name = toStr(body.name);
    if (!name) throw new ValidationError('Item name is required');
    if (name.length > 200) throw new ValidationError('Item name is too long');

    const { price, variants } = getCreateFoodPricing(body);

    const description = toStr(body.description);
    const image = await ensureLocalImageUrl(body.image || body.imageUrl || body.photoUrl || body.photo);
    const isAvailable = body.isAvailable !== false;
    const foodType = normalizeFoodType(body.foodType);
    const preparationTime = toStr(body.preparationTime);
    const { categoryObjectId, categoryName } = await resolveCategoryForRestaurant(context, { ...body, foodType });

    const doc = await FoodItem.create({
        restaurantId,
        categoryId: categoryObjectId,
        categoryName: categoryName || '',
        name,
        description,
        price,
        priceOnOtherPlatforms: body.priceOnOtherPlatforms ? Number(body.priceOnOtherPlatforms) : null,
        otherPlatformGst: body.otherPlatformGst !== undefined && body.otherPlatformGst !== null
            ? Number(body.otherPlatformGst)
            : null,
        variants,
        image,
        foodType,
        isAvailable,
        preparationTime,
        approvalStatus: 'pending',
        requestedAt: new Date()
    });

    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'New Product Approval Request ðŸ”',
            body: `Restaurant has submitted a new item "${doc.name}" for approval.`,
            data: {
                type: 'approval_request',
                subType: 'food',
                id: String(doc._id)
            }
        });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to notify admins of new food approval request:', e);
    }

    return doc.toObject();
}

export async function updateRestaurantFood(restaurantId, foodId, body = {}) {
    const context = await getRestaurantContext(restaurantId);
    if (!foodId || !mongoose.Types.ObjectId.isValid(String(foodId))) {
        throw new ValidationError('Invalid food id');
    }

    const existing = await FoodItem.findOne({ _id: foodId, restaurantId }).lean();
    if (!existing) return null;

    const update = {};

    if (body.name !== undefined) {
        const name = toStr(body.name);
        if (!name) throw new ValidationError('Item name is required');
        if (name.length > 200) throw new ValidationError('Item name is too long');
        update.name = name;
    }
    if (body.description !== undefined) update.description = toStr(body.description);
    if (body.image !== undefined) update.image = toStr(body.image);
    if (body.priceOnOtherPlatforms !== undefined) update.priceOnOtherPlatforms = body.priceOnOtherPlatforms ? Number(body.priceOnOtherPlatforms) : null;
    if (body.otherPlatformGst !== undefined) {
        update.otherPlatformGst = body.otherPlatformGst !== null && body.otherPlatformGst !== ''
            ? Number(body.otherPlatformGst)
            : null;
    }
    Object.assign(update, getUpdatedFoodPricing(existing, body));
    if (body.isAvailable !== undefined) update.isAvailable = body.isAvailable !== false;
    if (body.preparationTime !== undefined) update.preparationTime = toStr(body.preparationTime);

    const targetFoodType = body.foodType !== undefined ? normalizeFoodType(body.foodType) : normalizeFoodType(existing.foodType);
    if (body.foodType !== undefined) update.foodType = targetFoodType;

    if (
        body.categoryId !== undefined ||
        body.categoryName !== undefined ||
        body.foodType !== undefined
    ) {
        const { categoryObjectId, categoryName } = await resolveCategoryForRestaurant(context, {
            categoryId: body.categoryId !== undefined ? body.categoryId : existing.categoryId,
            categoryName: body.categoryName !== undefined ? body.categoryName : existing.categoryName,
            foodType: targetFoodType
        });
        update.categoryId = categoryObjectId;
        update.categoryName = categoryName || '';
    }

    const shouldResubmitForApproval = Object.keys(update).length > 0;

    if (shouldResubmitForApproval) {
        update.approvalStatus = 'pending';
        update.requestedAt = new Date();
        update.rejectionReason = '';
        update.approvedAt = null;
        update.rejectedAt = null;
    }

    const updated = await FoodItem.findOneAndUpdate(
        { _id: foodId, restaurantId },
        { $set: update },
        { new: true }
    ).lean();

    if (updated && shouldResubmitForApproval) {
        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            void notifyAdminsSafely({
                title: 'Updated Product Approval Request',
                body: `Restaurant has updated and resubmitted "${updated.name}" for approval.`,
                data: {
                    type: 'approval_request',
                    subType: 'food',
                    id: String(updated._id)
                }
            });
        } catch (e) {
            console.error('Failed to notify admins of resubmitted food approval request:', e);
        }
    }

    return updated;
}

export async function bulkCreateFood(restaurantId, items = []) {
    const context = await getRestaurantContext(restaurantId);
    const results = {
        successCount: 0,
        errorCount: 0,
        errors: [],
        items: []
    };

    if (!Array.isArray(items) || items.length === 0) {
        throw new ValidationError('No items provided for bulk upload');
    }

    // Limit bulk size to prevent timeout
    if (items.length > MAX_BULK_ITEMS) {
        throw new ValidationError(`Bulk upload limit is ${MAX_BULK_ITEMS} items per request`);
    }

    const processedItems = [];

    await asyncPool(BULK_CONCURRENCY, items, async (item, index) => {
        try {
            const name = toStr(item.name);
            if (!name) throw new Error('Item name is required');

            const foodType = normalizeFoodType(item.foodType);
            const { categoryObjectId, categoryName } = await resolveCategoryForRestaurant(context, {
                categoryId: item.categoryId,
                categoryName: item.categoryName,
                foodType
            });

            const { price: finalPrice, variants: finalVariants } = getCreateFoodPricing(item);
            const imageUrl = await ensureLocalImageUrl(item.image || item.imageUrl || item.photoUrl || item.photo);

            processedItems.push({
                restaurantId,
                categoryId: categoryObjectId,
                categoryName: categoryName || '',
                name,
                description: toStr(item.description),
                price: finalPrice,
                variants: finalVariants,
                image: imageUrl,
                foodType,
                isAvailable: item.isAvailable !== false,
                preparationTime: toStr(item.preparationTime),
                approvalStatus: 'pending',
                requestedAt: new Date()
            });

            results.successCount++;
        } catch (err) {
            results.errorCount++;
            results.errors.push({
                index,
                name: item?.name || 'Unknown',
                message: err.message
            });
        }
    });

    if (processedItems.length > 0) {
        const docs = await FoodItem.insertMany(processedItems);
        results.items = docs;

        // Notify admins about the bulk request
        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            void notifyAdminsSafely({
                title: 'Bulk Product Approval Request 🚀',
                body: `Restaurant has uploaded ${processedItems.length} new items for approval.`,
                data: {
                    type: 'approval_request',
                    subType: 'food_bulk',
                    restaurantId: String(restaurantId)
                }
            });
        } catch (e) {
            console.error('Failed to notify admins of bulk food upload:', e);
        }
    }

    return results;
}

export async function deleteFood(userId, foodId) {
    const context = await getRestaurantContext(userId);
    if (!mongoose.Types.ObjectId.isValid(foodId)) {
        throw new ValidationError("Invalid food ID");
    }
    const foodItem = await FoodItem.findOne({
        _id: foodId,
        restaurantId: context.restaurantId
    });
    if (!foodItem) {
        throw new ValidationError("Food item not found or unauthorized");
    }
    await FoodItem.findByIdAndDelete(foodId);
    return { success: true, message: "Food item deleted successfully" };
}

/** Public: approved food items for user app (zone-scoped, paginated). */
export async function listPublicApprovedFoods(query = {}) {
    const limit = parseQueryLimit(query.limit, 100, 1000);
    const page = parseQueryPage(query.page, 1);
    const skip = (page - 1) * limit;

    const filter = {
        approvalStatus: 'approved',
        isAvailable: { $ne: false }
    };

    const zoneIdRaw = String(query.zoneId || '').trim();
    if (zoneIdRaw && mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        const zoneRestaurants = await FoodRestaurant.distinct('_id', {
            zoneId: new mongoose.Types.ObjectId(zoneIdRaw),
            status: 'approved'
        });
        filter.restaurantId = { $in: zoneRestaurants };
    }

    const [list, total] = await Promise.all([
        FoodItem.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodItem.countDocuments(filter)
    ]);

    const restaurantIds = Array.from(
        new Set(list.map((f) => String(f.restaurantId)).filter(Boolean))
    );
    const restaurants = restaurantIds.length
        ? await FoodRestaurant.find({ _id: { $in: restaurantIds } })
            .select('restaurantName')
            .lean()
        : [];
    const restaurantMap = new Map(
        restaurants.map((r) => [String(r._id), r.restaurantName])
    );

    const foods = list.map((f) => ({
        id: f._id,
        _id: f._id,
        restaurantId: f.restaurantId,
        restaurantName: restaurantMap.get(String(f.restaurantId)) || '',
        categoryId: f.categoryId || null,
        categoryName: f.categoryName || '',
        name: f.name,
        description: f.description || '',
        price: getFoodDisplayPrice(f),
        image: resolveStoredUploadPath(f.image || ''),
        foodType: f.foodType || 'Non-Veg',
        isAvailable: f.isAvailable !== false,
        approvalStatus: f.approvalStatus || 'approved'
    }));

    return { foods, total, page, limit };
}
