import AppIntroAd from '../models/appIntroAd.model.js';
import { uploadGenericImage, uploadVideoBuffer } from '../../../../services/upload.service.js';

const normalizeToUploadsPath = (value) => {
    if (typeof value !== 'string') return '';

    const trimmed = value.trim();
    if (!trimmed) return '';

    try {
        const parsed = new URL(trimmed);
        const matchedPath = parsed.pathname.match(/\/uploads\/([^?#]+)/i);
        if (matchedPath?.[1]) {
            const filename = matchedPath[1].split('/').filter(Boolean).pop();
            return filename ? `/uploads/${filename}` : '';
        }
        return '';
    } catch {
        const normalized = trimmed.replace(/\\/g, '/');
        const matchedPath = normalized.match(/(?:^|\/)uploads\/([^?#]+)/i);
        if (matchedPath?.[1]) {
            const filename = matchedPath[1].split('/').filter(Boolean).pop();
            return filename ? `/uploads/${filename}` : '';
        }
        return '';
    }
};

const serializeAd = (ad) => {
    const payload = ad?.toObject ? ad.toObject() : { ...ad };
    if (payload?.mediaUrl) {
        payload.mediaUrl = normalizeToUploadsPath(payload.mediaUrl) || payload.mediaUrl;
    }
    return payload;
};

const resolveUploadedMedia = async (req) => {
    if (req.files?.media?.[0]) {
        const file = req.files.media[0];
        const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
        const mediaUrl = mediaType === 'video'
            ? await uploadVideoBuffer(file.buffer, 'app_intro_ads')
            : await uploadGenericImage(file.buffer, 'app_intro_ads');

        return { mediaType, mediaUrl };
    }

    if (req.file) {
        const file = req.file;
        const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
        const mediaUrl = mediaType === 'video'
            ? await uploadVideoBuffer(file.buffer, 'app_intro_ads')
            : await uploadGenericImage(file.buffer, 'app_intro_ads');

        return { mediaType, mediaUrl };
    }

    return null;
};

export const getAppIntroAds = async (req, res) => {
    try {
        const ads = await AppIntroAd.find().sort({ order: 1, createdAt: -1 });
        res.status(200).json({ success: true, data: ads.map(serializeAd) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

export const createAppIntroAd = async (req, res) => {
    try {
        const { title, mediaType, duration, isActive, order, type, startDate, endDate } = req.body;

        const uploadedMedia = await resolveUploadedMedia(req);
        const normalizedBodyMediaUrl = normalizeToUploadsPath(req.body.mediaUrl);
        const resolvedMediaType = uploadedMedia?.mediaType || (mediaType === 'video' ? 'video' : 'image');
        const mediaUrl = uploadedMedia?.mediaUrl || normalizedBodyMediaUrl;

        if (!mediaUrl) {
            return res.status(400).json({ success: false, message: 'Media must be uploaded into /uploads before saving this screen' });
        }

        const newAd = new AppIntroAd({
            title,
            mediaUrl,
            mediaType: resolvedMediaType,
            duration: Number(duration) || 3,
            isActive: isActive === 'true' || isActive === true,
            order: Number(order) || 0,
            type: type || 'ad',
            startDate: startDate || null,
            endDate: endDate || null
        });

        await newAd.save();
        res.status(201).json({ success: true, data: serializeAd(newAd), message: 'Ad created successfully' });
    } catch (error) {
        console.error('Error creating app intro ad:', error);
        const errorMsg = error?.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
        res.status(500).json({ success: false, message: 'Server Error', error: errorMsg });
    }
};

export const updateAppIntroAd = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body };
        const uploadedMedia = await resolveUploadedMedia(req);

        if (uploadedMedia) {
            updates.mediaUrl = uploadedMedia.mediaUrl;
            updates.mediaType = uploadedMedia.mediaType;
        } else if (updates.mediaUrl !== undefined) {
            const normalizedMediaUrl = normalizeToUploadsPath(updates.mediaUrl);
            if (!normalizedMediaUrl) {
                return res.status(400).json({ success: false, message: 'Media URL must point to a file inside /uploads' });
            }
            updates.mediaUrl = normalizedMediaUrl;
        }

        if (updates.duration !== undefined) updates.duration = Number(updates.duration) || 1;
        if (updates.order !== undefined) updates.order = Number(updates.order) || 0;
        if (updates.isActive !== undefined) {
            updates.isActive = updates.isActive === 'true' || updates.isActive === true;
        }

        const ad = await AppIntroAd.findByIdAndUpdate(id, updates, { new: true });

        if (!ad) {
            return res.status(404).json({ success: false, message: 'Ad not found' });
        }

        res.status(200).json({ success: true, data: serializeAd(ad), message: 'Ad updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

export const deleteAppIntroAd = async (req, res) => {
    try {
        const { id } = req.params;
        const ad = await AppIntroAd.findByIdAndDelete(id);

        if (!ad) {
            return res.status(404).json({ success: false, message: 'Ad not found' });
        }

        res.status(200).json({ success: true, message: 'Ad deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

export const toggleAppIntroAdStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const ad = await AppIntroAd.findById(id);

        if (!ad) {
            return res.status(404).json({ success: false, message: 'Ad not found' });
        }

        ad.isActive = !ad.isActive;
        await ad.save();

        res.status(200).json({ success: true, data: serializeAd(ad), message: `Ad ${ad.isActive ? 'enabled' : 'disabled'} successfully` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

export const updateAppIntroAdsOrder = async (req, res) => {
    try {
        const { orders } = req.body;

        if (!orders || !Array.isArray(orders)) {
            return res.status(400).json({ success: false, message: 'Invalid orders array' });
        }

        for (const item of orders) {
            await AppIntroAd.findByIdAndUpdate(item.id, { order: item.order });
        }

        res.status(200).json({ success: true, message: 'Order updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};

export const getPublicActiveAds = async (req, res) => {
    try {
        const now = new Date();
        const query = {
            isActive: true,
            $or: [
                { startDate: null, endDate: null },
                { startDate: { $lte: now }, endDate: { $gte: now } },
                { startDate: { $lte: now }, endDate: null },
                { startDate: null, endDate: { $gte: now } }
            ]
        };

        const ads = await AppIntroAd.find(query).sort({ order: 1, createdAt: -1 });
        res.status(200).json({ success: true, data: ads.map(serializeAd) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error', error: error.message });
    }
};
