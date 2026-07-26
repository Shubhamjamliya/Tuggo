import { ValidationError } from '../core/auth/errors.js';
import { sendSuccess } from '../utils/response.js';

export const uploadSingle = async (req, res, next) => {
    try {
        if (!req.file) {
            throw new ValidationError('No file provided or invalid file format.');
        }

        const fileUrl = `/uploads/${req.file.filename}`;

        const fileData = {
            filename: req.file.filename,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            path: fileUrl,
            url: fileUrl
        };

        return sendSuccess(res, {
            success: true,
            file: fileData
        });
    } catch (error) {
        next(error);
    }
};

export const uploadMultiple = async (req, res, next) => {
    try {
        if (!req.files || req.files.length === 0) {
            throw new ValidationError('No files provided or invalid formats.');
        }

        const filesData = req.files.map(file => {
            const fileUrl = `/uploads/${file.filename}`;
            return {
                filename: file.filename,
                originalName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                path: fileUrl,
                url: fileUrl
            };
        });

        return sendSuccess(res, {
            success: true,
            files: filesData
        });
    } catch (error) {
        next(error);
    }
};
