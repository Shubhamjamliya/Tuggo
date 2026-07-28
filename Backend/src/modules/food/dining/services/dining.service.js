import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDiningCategory } from '../models/diningCategory.model.js';
import { FoodDiningRestaurant } from '../models/diningRestaurant.model.js';
import { FoodDiningRequest } from '../models/diningRequest.model.js';
import { FoodDiningBooking } from '../models/diningBooking.model.js';
import { notifyOwnerSafely } from '../../../../core/notifications/firebase.service.js';
import { createInboxNotifications } from '../../../../core/notifications/notification.service.js';
import { normalizeStoredUploadPath } from '../../../../services/upload.service.js';

const slugify = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

const toObjectIdArray = (values) =>
    Array.from(
        new Set(
            (Array.isArray(values) ? values : [values])
                .map((value) => String(value || '').trim())
                .filter((value) => mongoose.Types.ObjectId.isValid(value))
        )
    ).map((value) => new mongoose.Types.ObjectId(value));

async function syncRestaurantDiningSettings(restaurantId, diningDoc) {
    const primaryCategory = diningDoc?.primaryCategoryId
        ? await FoodDiningCategory.findById(diningDoc.primaryCategoryId).select('slug').lean()
        : null;

    await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: {
                diningSettings: {
                    isEnabled: Boolean(diningDoc?.isEnabled),
                    maxGuests: Math.max(1, Number(diningDoc?.maxGuests) || 6),
                    diningType: Array.isArray(diningDoc?.diningType) ? diningDoc.diningType : (primaryCategory?.slug ? [primaryCategory.slug] : ['family-dining'])
                }
            }
        },
        { new: false }
    );
}

async function syncCategoryRestaurantLinks(restaurantId, categoryIds) {
    await FoodDiningCategory.updateMany(
        { restaurantIds: restaurantId, _id: { $nin: categoryIds } },
        { $pull: { restaurantIds: restaurantId } }
    );

    if (categoryIds.length > 0) {
        await FoodDiningCategory.updateMany(
            { _id: { $in: categoryIds } },
            { $addToSet: { restaurantIds: restaurantId } }
        );
    }
}

function mapCategory(doc) {
    return {
        _id: doc._id,
        name: doc.name,
        slug: doc.slug,
        imageUrl: doc.imageUrl || '',
        isActive: doc.isActive !== false,
        sortOrder: doc.sortOrder || 0,
        restaurantCount: Array.isArray(doc.restaurantIds) ? doc.restaurantIds.length : 0,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
    };
}

function getRestaurantZone(restaurant) {
    return (
        restaurant?.location?.area ||
        restaurant?.location?.city ||
        restaurant?.area ||
        restaurant?.city ||
        'N/A'
    );
}

function getRestaurantImage(restaurant) {
    const coverImage = Array.isArray(restaurant?.coverImages)
        ? restaurant.coverImages
            .map((image) => (typeof image === 'string' ? image : image?.url || ''))
            .find(Boolean)
        : '';
    if (coverImage) return coverImage;

    const menuImage = Array.isArray(restaurant?.menuImages)
        ? restaurant.menuImages
            .map((image) => (typeof image === 'string' ? image : image?.url || ''))
            .find(Boolean)
        : '';
    if (menuImage) return menuImage;

    const value = restaurant?.profileImage;
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value?.url || '';
}

function mapDiningRestaurant(restaurant, diningDoc, categoriesById) {
    const categoryIds = (diningDoc?.categoryIds || []).map((id) => String(id));
    const categories = categoryIds
        .map((id) => categoriesById.get(id))
        .filter(Boolean)
        .map((category) => ({
            _id: category._id,
            name: category.name,
            slug: category.slug,
            imageUrl: category.imageUrl || ''
        }));

    const primaryCategoryId = diningDoc?.primaryCategoryId ? String(diningDoc.primaryCategoryId) : '';
    const primaryCategory = categories.find((category) => String(category._id) === primaryCategoryId) || categories[0] || null;

    return {
        _id: restaurant._id,
        id: restaurant._id,
        name: restaurant.restaurantName || restaurant.name || 'N/A',
        restaurantName: restaurant.restaurantName || restaurant.name || 'N/A',
        ownerName: restaurant.ownerName || 'N/A',
        ownerPhone: restaurant.ownerPhone || restaurant.phone || 'N/A',
        pureVegRestaurant: diningDoc?.pureVegRestaurant === true || restaurant?.pureVegRestaurant === true,
        zone: getRestaurantZone(restaurant),
        city: restaurant?.location?.city || restaurant?.city || '',
        status: restaurant.status,
        isActive: restaurant.status === 'approved',
        rating: Number(restaurant.rating || 0),
        logo: getRestaurantImage(restaurant),
        categories,
        categoryIds,
        primaryCategoryId: primaryCategory?._id || null,
        diningSettings: {
            isEnabled: Boolean(diningDoc?.isEnabled),
            maxGuests: Math.max(1, Number(diningDoc?.maxGuests) || 6),
            pureVegRestaurant: diningDoc?.pureVegRestaurant === true || restaurant?.pureVegRestaurant === true,
            diningType: primaryCategory?.slug || restaurant?.diningSettings?.diningType || ''
        }
    };
}

export async function listDiningCategoriesAdmin() {
    const categories = await FoodDiningCategory.find({})
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
    return { categories: categories.map(mapCategory) };
}

export async function createDiningCategory(body = {}) {
    const name = String(body.name || '').trim();
    if (!name) {
        throw new ValidationError('Category name is required');
    }

    const slug = slugify(body.slug || name);
    if (!slug) {
        throw new ValidationError('Category slug is required');
    }

    const existing = await FoodDiningCategory.findOne({ slug }).lean();
    if (existing) {
        throw new ValidationError('Dining category already exists');
    }

    const created = await FoodDiningCategory.create({
        name,
        slug,
        imageUrl: normalizeStoredUploadPath(body.imageUrl),
        isActive: body.isActive !== false,
        sortOrder: Number(body.sortOrder) || 0
    });

    return mapCategory(created.toObject());
}

export async function updateDiningCategory(id, body = {}) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;

    const doc = await FoodDiningCategory.findById(id);
    if (!doc) return null;

    if (body.name !== undefined) {
        doc.name = String(body.name || '').trim();
    }
    if (body.slug !== undefined || body.name !== undefined) {
        const nextSlug = slugify(body.slug || doc.name);
        const conflict = await FoodDiningCategory.findOne({ slug: nextSlug, _id: { $ne: doc._id } }).lean();
        if (conflict) {
            throw new ValidationError('Dining category slug already exists');
        }
        doc.slug = nextSlug;
    }
    if (body.imageUrl !== undefined) {
        doc.imageUrl = normalizeStoredUploadPath(body.imageUrl);
    }
    if (body.isActive !== undefined) {
        doc.isActive = body.isActive !== false;
    }
    if (body.sortOrder !== undefined) {
        doc.sortOrder = Number(body.sortOrder) || 0;
    }

    await doc.save();

    const linkedDiningDocs = await FoodDiningRestaurant.find({ categoryIds: doc._id }).select('_id restaurantId').lean();
    await Promise.all(linkedDiningDocs.map(async (item) => {
        await syncRestaurantDiningSettings(item.restaurantId, await FoodDiningRestaurant.findById(item._id).lean());
    }));

    return mapCategory(doc.toObject());
}

export async function deleteDiningCategory(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;

    const category = await FoodDiningCategory.findByIdAndDelete(id).lean();
    if (!category) return null;

    const categoryId = new mongoose.Types.ObjectId(id);
    const diningDocs = await FoodDiningRestaurant.find({ categoryIds: categoryId });

    for (const doc of diningDocs) {
        doc.categoryIds = (doc.categoryIds || []).filter((value) => String(value) !== id);
        if (doc.primaryCategoryId && String(doc.primaryCategoryId) === id) {
            doc.primaryCategoryId = doc.categoryIds[0] || null;
        }
        if (typeof doc.pureVegRestaurant !== 'boolean') {
            const sourceRestaurant = await FoodRestaurant.findById(doc.restaurantId).select('pureVegRestaurant').lean();
            doc.pureVegRestaurant = sourceRestaurant?.pureVegRestaurant === true;
        }
        await doc.save();
        await syncRestaurantDiningSettings(doc.restaurantId, doc);
    }

    return { id };
}

export async function listDiningRestaurantsAdmin() {
    const [restaurants, diningDocs, categories] = await Promise.all([
        FoodRestaurant.find({})
            .sort({ createdAt: -1 })
            .select('restaurantName ownerName ownerPhone profileImage coverImages menuImages location area city status rating pureVegRestaurant diningSettings')
            .lean(),
        FoodDiningRestaurant.find({})
            .select('restaurantId categoryIds primaryCategoryId isEnabled maxGuests pureVegRestaurant')
            .lean(),
        FoodDiningCategory.find({}).select('name slug imageUrl').lean()
    ]);

    const categoriesById = new Map(categories.map((category) => [String(category._id), category]));
    const diningByRestaurantId = new Map(diningDocs.map((doc) => [String(doc.restaurantId), doc]));

    const items = restaurants.map((restaurant) =>
        mapDiningRestaurant(restaurant, diningByRestaurantId.get(String(restaurant._id)), categoriesById)
    );

    return { restaurants: items };
}

export async function updateDiningRestaurant(restaurantId, body = {}) {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return null;

    const restaurant = await FoodRestaurant.findById(restaurantId).lean();
    if (!restaurant) return null;

    let diningDoc = await FoodDiningRestaurant.findOne({ restaurantId });
    if (!diningDoc) {
        diningDoc = new FoodDiningRestaurant({
            restaurantId,
            pureVegRestaurant: restaurant.pureVegRestaurant === true
        });
    }

    const categoryIds = body.categoryIds !== undefined
        ? toObjectIdArray(body.categoryIds)
        : (diningDoc.categoryIds || []);

    const validCategories = categoryIds.length > 0
        ? await FoodDiningCategory.find({ _id: { $in: categoryIds } }).select('_id').lean()
        : [];
    const validCategoryIds = validCategories.map((category) => category._id);

    if (body.categoryIds !== undefined) {
        diningDoc.categoryIds = validCategoryIds;
    }
    if (body.isEnabled !== undefined) {
        diningDoc.isEnabled = body.isEnabled === true;
    }
    if (body.maxGuests !== undefined) {
        diningDoc.maxGuests = Math.max(1, parseInt(body.maxGuests, 10) || 6);
    }
    if (body.pureVegRestaurant !== undefined) {
        if (typeof body.pureVegRestaurant === 'boolean') {
            diningDoc.pureVegRestaurant = body.pureVegRestaurant;
        } else if (typeof body.pureVegRestaurant === 'string') {
            const normalized = body.pureVegRestaurant.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
                diningDoc.pureVegRestaurant = true;
            } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
                diningDoc.pureVegRestaurant = false;
            }
        }
    }

    if (body.primaryCategoryId !== undefined) {
        diningDoc.primaryCategoryId = mongoose.Types.ObjectId.isValid(body.primaryCategoryId)
            ? new mongoose.Types.ObjectId(body.primaryCategoryId)
            : null;
    }

    const primaryCategoryIsAllowed = diningDoc.primaryCategoryId
        && validCategoryIds.some((categoryId) => String(categoryId) === String(diningDoc.primaryCategoryId));

    if (!primaryCategoryIsAllowed) {
        diningDoc.primaryCategoryId = validCategoryIds[0] || null;
    }
    if (typeof diningDoc.pureVegRestaurant !== 'boolean') {
        diningDoc.pureVegRestaurant = restaurant.pureVegRestaurant === true;
    }

    await diningDoc.save();
    await syncCategoryRestaurantLinks(restaurant._id, validCategoryIds);
    await syncRestaurantDiningSettings(restaurant._id, diningDoc);

    const categories = await FoodDiningCategory.find({}).select('name slug imageUrl').lean();
    const categoriesById = new Map(categories.map((category) => [String(category._id), category]));

    return mapDiningRestaurant(restaurant, diningDoc.toObject(), categoriesById);
}

export async function listDiningCategoriesPublic() {
    const categories = await FoodDiningCategory.find({ isActive: true })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
    return categories.map(mapCategory);
}

export async function listDiningRestaurantsPublic(query = {}) {
    const filter = { isEnabled: true };
    const categoryValue = String(query.category || '').trim();
    const cityValue = String(query.city || '').trim();
    const zoneIdValue = String(query.zoneId || '').trim();

    if (categoryValue) {
        const category = await FoodDiningCategory.findOne({
            $or: [
                mongoose.Types.ObjectId.isValid(categoryValue) ? { _id: categoryValue } : null,
                { slug: categoryValue.toLowerCase() }
            ].filter(Boolean)
        }).lean();
        if (!category) {
            return [];
        }
        filter.categoryIds = category._id;
    }

    const restaurantMatch = {};
    const restaurantAndConditions = [];

    if (cityValue) {
        restaurantAndConditions.push({
            $or: [
                { city: { $regex: cityValue, $options: 'i' } },
                { 'location.city': { $regex: cityValue, $options: 'i' } }
            ]
        });
    }

    if (zoneIdValue && mongoose.Types.ObjectId.isValid(zoneIdValue)) {
        restaurantAndConditions.push({ zoneId: new mongoose.Types.ObjectId(zoneIdValue) });
    }

    if (restaurantAndConditions.length > 0) {
        restaurantMatch.$and = restaurantAndConditions;
    }

    const diningDocs = await FoodDiningRestaurant.find(filter)
        .populate({
            path: 'restaurantId',
            select: 'restaurantName restaurantNameNormalized ownerName ownerPhone profileImage coverImages menuImages cuisines location area city zoneId status rating diningSettings estimatedDeliveryTime estimatedDeliveryTimeMinutes featuredDish featuredPrice offer openingTime closingTime openDays isAcceptingOrders costForTwo',
            match: restaurantMatch
        })
        .populate('categoryIds', 'name slug imageUrl')
        .lean();

    return diningDocs
        .filter((doc) => doc.restaurantId)
        .map((doc) => ({
            ...doc.restaurantId,
            restaurant: doc.restaurantId,
            categories: doc.categoryIds || [],
            diningSettings: {
                isEnabled: true,
                maxGuests: Math.max(1, Number(doc.maxGuests) || 6),
                pureVegRestaurant: doc.pureVegRestaurant === true || doc.restaurantId?.pureVegRestaurant === true,
                diningType: doc.categoryIds?.[0]?.slug || doc.restaurantId?.diningSettings?.diningType || ''
            }
        }));
}

// ==================== DINING SETTINGS REQUESTS ====================

export async function createDiningRequest(restaurantId, settings = {}) {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw new ValidationError('Invalid restaurant ID');
    }

    // Check if there is already a pending request
    const existing = await FoodDiningRequest.findOne({
        restaurantId,
        status: 'pending'
    }).lean();

    if (existing) {
        throw new ValidationError('You already have a pending request awaiting approval');
    }

    // Deduplicate and sanitize categories
    let diningType = settings.diningType
    if (Array.isArray(diningType)) {
        diningType = [...new Set(diningType.map(t => String(t).trim()))].filter(Boolean)
    } else {
        diningType = String(diningType || '').split(',').map(t => t.trim()).filter(Boolean)
        diningType = [...new Set(diningType)]
    }

    if (diningType.length === 0) diningType = ['family-dining']

    const created = await FoodDiningRequest.create({
        restaurantId,
        requestedSettings: {
            isEnabled: Boolean(settings.isEnabled),
            maxGuests: parseInt(settings.maxGuests, 10) >= 0 ? parseInt(settings.maxGuests, 10) : 6,
            diningType: diningType
        }
    });

    return created.toObject();
}

export async function getPendingDiningRequest(restaurantId) {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return null;
    return await FoodDiningRequest.findOne({
        restaurantId,
        status: 'pending'
    }).lean();
}

export async function listAllPendingDiningRequests() {
    return await FoodDiningRequest.find({ status: 'pending' })
        .populate({
            path: 'restaurantId',
            select: 'restaurantName profileImage location'
        })
        .sort({ createdAt: -1 })
        .lean()
        .then(docs => docs.map(doc => ({
            ...doc,
            restaurant: doc.restaurantId ? {
                _id: doc.restaurantId._id,
                name: doc.restaurantId.restaurantName,
                profileImage: doc.restaurantId.profileImage ? { url: doc.restaurantId.profileImage } : null,
                address: doc.restaurantId.location?.formattedAddress || ''
            } : null,
            restaurantId: doc.restaurantId?._id
        })));
}

export async function approveDiningRequest(requestId) {
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
        throw new ValidationError('Invalid request ID');
    }

    const request = await FoodDiningRequest.findById(requestId);
    if (!request || request.status !== 'pending') {
        throw new ValidationError('Pending request not found');
    }

    const { restaurantId, requestedSettings } = request;

    // Sanitize diningType from request (handle array or messy string)
    let finalDiningType = request.requestedSettings.diningType;
    if (!Array.isArray(finalDiningType)) {
        finalDiningType = String(finalDiningType || '').split(',').map(s => s.trim()).filter(Boolean);
    }
    finalDiningType = [...new Set(finalDiningType)];

    // Find the Category IDs based on slugs
    const selectedCategories = await FoodDiningCategory.find({
        slug: { $in: finalDiningType }
    }).select('_id').lean();
    const categoryIds = selectedCategories.map(c => c._id);

    // Apply changes to FoodDiningRestaurant
    await FoodDiningRestaurant.findOneAndUpdate(
        { restaurantId },
        {
            $set: {
                isEnabled: request.requestedSettings.isEnabled,
                maxGuests: request.requestedSettings.maxGuests,
                categoryIds: categoryIds,
                primaryCategoryId: categoryIds[0] || null
            }
        },
        { upsert: true }
    );

    // Apply changes to FoodRestaurant
    await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: {
                diningSettings: {
                    isEnabled: request.requestedSettings.isEnabled,
                    maxGuests: request.requestedSettings.maxGuests,
                    diningType: finalDiningType
                }
            }
        }
    );

    request.status = 'approved';
    await request.save();

    return request.toObject();
}

export async function rejectDiningRequest(requestId, reason = '') {
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
        throw new ValidationError('Invalid request ID');
    }

    const request = await FoodDiningRequest.findById(requestId);
    if (!request || request.status !== 'pending') {
        throw new ValidationError('Pending request not found');
    }

    request.status = 'rejected';
    request.rejectionReason = String(reason || '').trim() || null;
    await request.save();

    return request.toObject();
}

// ==================== DINING BOOKINGS ====================

export async function createDiningBooking(userId, payload = {}) {
    const restaurantId = payload.restaurantId || (payload.restaurant?._id || payload.restaurant);
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw new ValidationError('Invalid restaurant ID');
    }

    // Check if restaurant exists and has dining enabled
    const restaurant = await FoodRestaurant.findById(restaurantId).select('restaurantName diningSettings').lean();
    if (!restaurant) {
        throw new ValidationError('Restaurant not found');
    }

    const bookingId = `TB${Date.now().toString().slice(-8)}`;
    
    const userPayload = payload.user || payload.userRef || {};
    const name = (userPayload.name || userPayload.fullName || 'Guest').trim();
    const phone = (userPayload.phone || userPayload.mobile || userPayload.phoneNumber || '').trim();
    const email = (userPayload.email || '').trim();

    const booking = await FoodDiningBooking.create({
        bookingId,
        restaurantId,
        userId,
        user: {
            name,
            phone,
            email
        },
        guests: Math.max(1, Number(payload.guests) || 1),
        date: new Date(payload.date || Date.now()),
        timeSlot: String(payload.timeSlot || '').trim(),
        specialRequest: String(payload.specialRequest || '').trim(),
        status: 'pending'
    });

    return booking.toObject();
}

export async function getUserDiningBookings(userId) {
    if (!mongoose.Types.ObjectId.isValid(userId)) return [];
    
    const docs = await FoodDiningBooking.find({ userId })
        .populate({
            path: 'restaurantId',
            select: 'restaurantName profileImage location slug coverImages'
        })
        .sort({ createdAt: -1 })
        .lean();

    return docs.map(doc => ({
        ...doc,
        restaurant: doc.restaurantId ? {
            ...doc.restaurantId,
            name: doc.restaurantId.restaurantName,
            image: Array.isArray(doc.restaurantId.coverImages) ? doc.restaurantId.coverImages[0] : (doc.restaurantId.profileImage || '')
        } : null
    }));
}

export async function getRestaurantDiningBookings(restaurantId) {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return [];

    return await FoodDiningBooking.find({ restaurantId })
        .populate({
            path: 'userId',
            select: 'name phone email'
        })
        .sort({ createdAt: -1 })
        .lean();
}

export async function updateDiningBookingStatus(bookingId, status) {
    const filter = mongoose.Types.ObjectId.isValid(bookingId) 
        ? { _id: bookingId } 
        : { bookingId: bookingId };

    const booking = await FoodDiningBooking.findOne(filter).populate('restaurantId', 'restaurantName');
    if (!booking) throw new ValidationError('Booking not found');

    const oldStatus = booking.status;
    booking.status = status;
    await booking.save();

    // Send notifications to user on status change
    if (oldStatus !== status) {
        try {
            const restaurantName = booking.restaurantId?.restaurantName || 'Restaurant';
            let notificationPayload = null;

            if (status === 'accepted' || status === 'confirmed') {
                notificationPayload = {
                    title: 'Dining Booking Confirmed! 🎉',
                    body: `Your table booking at ${restaurantName} for ${booking.guests} guests has been confirmed. See you soon!`,
                    data: {
                        type: 'dining_booking',
                        bookingId: String(booking._id),
                        status: 'confirmed'
                    }
                };
            } else if (status === 'cancelled') {
                notificationPayload = {
                    title: 'Dining Booking Cancelled',
                    body: `We're sorry, your table booking at ${restaurantName} has been cancelled by the restaurant.`,
                    data: {
                        type: 'dining_booking',
                        bookingId: String(booking._id),
                        status: 'cancelled'
                    }
                };
            }

            if (notificationPayload) {
                // 1. Push Notification (Firebase)
                notifyOwnerSafely({
                    ownerType: 'USER',
                    ownerId: booking.userId
                }, notificationPayload);

                // 2. In-App Inbox Notification
                createInboxNotifications({
                    notifications: [{
                        ownerType: 'USER',
                        ownerId: booking.userId,
                        title: notificationPayload.title,
                        message: notificationPayload.body,
                        category: 'orders',
                        source: 'SYSTEM',
                        metadata: notificationPayload.data
                    }]
                });
            }
        } catch (error) {
            console.error('[DiningNotification] Error sending notification:', error);
        }
    }

    return booking.toObject();
}

export async function createDiningBookingReview(bookingId, payload = {}) {
    const filter = mongoose.Types.ObjectId.isValid(bookingId) 
        ? { _id: bookingId } 
        : { bookingId: bookingId };

    const booking = await FoodDiningBooking.findOne(filter);
    if (!booking) throw new ValidationError('Booking not found');

    booking.review = {
        rating: Number(payload.rating || 0),
        comment: String(payload.comment || '').trim(),
        createdAt: new Date()
    };

    await booking.save();
    return booking.toObject();
}

export async function getRestaurantOccupiedSeats(restaurantId) {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return 0;

    const now = new Date();
    const THIRTY_MINUTES = 30 * 60 * 1000;
    const expiryLimit = new Date(now.getTime() - THIRTY_MINUTES);

    // Only count approved/confirmed bookings or recent pending ones
    const bookings = await FoodDiningBooking.find({
        restaurantId,
        $or: [
            { status: 'approved' },
            { status: 'confirmed' },
            { status: 'pending', createdAt: { $gte: expiryLimit } }
        ]
    }).select('guests').lean();

    return bookings.reduce((sum, b) => sum + (Number(b.guests) || 0), 0);
}

