/**
 * Public environment variables for frontend runtime.
 * Runtime env fetching has been deprecated and disabled for security.
 * Frontend now uses build-time Vite environment variables directly.
 */
export const getPublicEnvController = async (_req, res, next) => {
    try {
        return res.status(200).json({
            success: true,
            message: 'Public environment variables fetched',
            data: {}
        });
    } catch (error) {
        next(error);
    }
};
