import mongoose from 'mongoose';
import { FoodUser } from '../../../../core/users/user.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';

const toGeoPoint = ({ latitude, longitude }) => {
    if (latitude === undefined || longitude === undefined) return undefined;
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    return { type: 'Point', coordinates: [lng, lat] };
};

const resolveAddressLocation = async (address, dto) => {
    let loc = toGeoPoint(dto);

    // Safeguard: if location is missing, OR if location is set to default Indore (22.7196, 75.8577) while city is not Indore
    const isIndoreDefault = loc?.coordinates &&
        Math.abs(loc.coordinates[1] - 22.7196) < 0.05 &&
        Math.abs(loc.coordinates[0] - 75.8577) < 0.05 &&
        address.city &&
        !String(address.city).toLowerCase().includes('indore');

    if (!loc || isIndoreDefault) {
        try {
            const query = [address.street, address.additionalDetails, address.city, address.state, address.zipCode].filter(Boolean).join(', ');
            if (query) {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`, {
                    headers: { 'User-Agent': 'Tuggo-Backend/1.0', 'Accept-Language': 'en' }
                });
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    const lat = Number(data[0].lat);
                    const lng = Number(data[0].lon);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        loc = { type: 'Point', coordinates: [lng, lat] };
                    }
                }
            }
        } catch (_) {}
    }
    return loc;
};

const normalizeLabel = (label) => {
    const v = String(label || '').trim();
    if (v === 'Work') return 'Office';
    if (v === 'home' || v === 'Home') return 'Home';
    if (v === 'office' || v === 'Office') return 'Office';
    if (v === 'other' || v === 'Other') return 'Other';
    return 'Other';
};

export const listAddresses = async (userId) => {
    const user = await FoodUser.findById(userId).select('addresses').lean();
    return { addresses: user?.addresses || [] };
};

export const addAddress = async (userId, dto) => {
    const user = await FoodUser.findById(userId).select('addresses');
    if (!user) throw new ValidationError('User not found');

    const address = {
        label: normalizeLabel(dto.label),
        street: dto.street,
        additionalDetails: dto.additionalDetails || '',
        city: dto.city,
        state: dto.state,
        zipCode: dto.zipCode || '',
        phone: dto.phone || '',
        location: await resolveAddressLocation(dto, dto),
        isDefault: false
    };

    // If same label exists, update-in-place (keeps "Home/Office/Other" single entry best UX)
    const existingIdx = user.addresses.findIndex((a) => String(a?.label) === String(address.label));
    if (existingIdx >= 0) {
        const existing = user.addresses[existingIdx];
        existing.label = address.label;
        existing.street = address.street;
        existing.additionalDetails = address.additionalDetails;
        existing.city = address.city;
        existing.state = address.state;
        existing.zipCode = address.zipCode;
        existing.phone = address.phone;
        if (address.location) existing.location = address.location;
        await user.save();
        return { address: existing.toObject() };
    }

    // First address becomes default automatically
    if (!user.addresses.some((a) => a.isDefault)) {
        address.isDefault = true;
    }

    user.addresses.push(address);
    await user.save();
    const saved = user.addresses[user.addresses.length - 1];
    return { address: saved.toObject() };
};

export const updateAddress = async (userId, addressId, dto) => {
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
        throw new ValidationError('Invalid address id');
    }
    const user = await FoodUser.findById(userId).select('addresses');
    if (!user) throw new ValidationError('User not found');

    const address = user.addresses.id(addressId);
    if (!address) throw new ValidationError('Address not found');

    if (dto.label !== undefined) address.label = normalizeLabel(dto.label);
    if (dto.street !== undefined) address.street = dto.street;
    if (dto.additionalDetails !== undefined) address.additionalDetails = dto.additionalDetails || '';
    if (dto.city !== undefined) address.city = dto.city;
    if (dto.state !== undefined) address.state = dto.state;
    if (dto.zipCode !== undefined) address.zipCode = dto.zipCode || '';
    if (dto.phone !== undefined) address.phone = dto.phone || '';
    const location = await resolveAddressLocation(address, dto);
    if (location) address.location = location;

    await user.save();
    return { address: address.toObject() };
};

export const deleteAddress = async (userId, addressId) => {
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
        throw new ValidationError('Invalid address id');
    }
    const user = await FoodUser.findById(userId).select('addresses');
    if (!user) throw new ValidationError('User not found');

    const address = user.addresses.id(addressId);
    if (!address) throw new ValidationError('Address not found');

    const wasDefault = !!address.isDefault;
    address.deleteOne();

    // If deleting default, promote the newest remaining address to default
    if (wasDefault) {
        const remaining = user.addresses.filter(Boolean);
        if (remaining.length) {
            remaining.forEach((a) => {
                a.isDefault = false;
            });
            remaining[remaining.length - 1].isDefault = true;
        }
    }

    await user.save();
    return { success: true };
};

export const setDefaultAddress = async (userId, addressId) => {
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
        throw new ValidationError('Invalid address id');
    }
    const user = await FoodUser.findById(userId).select('addresses');
    if (!user) throw new ValidationError('User not found');

    const address = user.addresses.id(addressId);
    if (!address) throw new ValidationError('Address not found');

    user.addresses.forEach((a) => {
        a.isDefault = String(a._id) === String(addressId);
    });
    await user.save();

    const updated = user.addresses.id(addressId);
    return { address: updated?.toObject() };
};

