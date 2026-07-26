import express from 'express';
import { upload } from '../../../middleware/upload.js';
import { uploadFileBuffer, uploadGenericImage, uploadVideoBuffer } from '../../../services/upload.service.js';

const router = express.Router();

// POST /v1/uploads/image
router.post('/image', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: 'No file provided'
            });
        }

        const folderLabel = typeof req.body?.folder === 'string' && req.body.folder.trim()
            ? req.body.folder.trim()
            : 'upload';

        const url = await uploadGenericImage(req.file.buffer, folderLabel);

        return res.status(200).json({
            success: true,
            message: 'Image uploaded successfully',
            data: {
                url,
                publicId: null
            }
        });
    } catch (error) {
        next(error);
    }
});

// POST /v1/uploads/file
router.post('/file', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: 'No file provided'
            });
        }

        const mimeType = String(req.file.mimetype || '').toLowerCase();
        const originalName = String(req.file.originalname || '').toLowerCase();
        const isPdf = mimeType === 'application/pdf' || originalName.endsWith('.pdf');
        if (!isPdf) {
            return res.status(400).json({
                success: false,
                message: 'Only PDF files are allowed'
            });
        }

        const folderLabel = typeof req.body?.folder === 'string' && req.body.folder.trim()
            ? req.body.folder.trim()
            : 'upload';

        const url = await uploadFileBuffer(req.file.buffer, folderLabel, {
            fileName: req.file.originalname || 'menu.pdf',
            format: 'pdf'
        });

        return res.status(200).json({
            success: true,
            message: 'File uploaded successfully',
            data: {
                url,
                publicId: null
            }
        });
    } catch (error) {
        next(error);
    }
});

// POST /v1/uploads/video
router.post('/video', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: 'No file provided'
            });
        }

        const mimeType = String(req.file.mimetype || '').toLowerCase();
        if (!mimeType.startsWith('video/')) {
            return res.status(400).json({
                success: false,
                message: 'Only video files are allowed'
            });
        }

        const folderLabel = typeof req.body?.folder === 'string' && req.body.folder.trim()
            ? req.body.folder.trim()
            : 'upload';

        const url = await uploadVideoBuffer(req.file.buffer, folderLabel);

        return res.status(200).json({
            success: true,
            message: 'Video uploaded successfully',
            data: {
                url,
                publicId: null
            }
        });
    } catch (error) {
        next(error);
    }
});

export default router;
