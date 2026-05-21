import express, { Router } from 'express';
import { getReviews, importReviewsFromCsv, markReviewAsUsed } from '../controllers/reviewController';
// import { authenticate, authorize } from '../middleware/auth';
import uploadCsv from '../middleware/uploadCsv';
import { validate } from '../middleware/validate';
import { markReviewAsUsedSchema } from '../validations/reviewValidations';

const router: Router = express.Router();

// router.use(authenticate);
// router.use(authorize('super-admin', 'admin'));

/**
 * @swagger
 * /api/reviews:
 *   get:
 *     summary: List reviews (paginated)
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: isUsed
 *         schema: { type: string, enum: [true, false] }
 */
router.get('/', getReviews);

/**
 * @swagger
 * /api/reviews/{id}/mark-used:
 *   patch:
 *     summary: Mark a review as used
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               usedBy:
 *                 type: string
 *                 description: Optional user/dealer id; defaults to authenticated user id when auth is enabled
 */
router.patch('/:id/mark-used', validate(markReviewAsUsedSchema), markReviewAsUsed);

/**
 * @swagger
 * /api/reviews/import:
 *   post:
 *     summary: Import reviews from CSV (super-admin, admin). Header row optional; if `type` is omitted or empty, it defaults to "Solar Customer". Single-column CSV = content only.
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 */
router.post(
  '/import',
  (req, res, next) => {
    uploadCsv.single('file')(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : 'File upload failed';
        res.status(400).json({ error: message });
        return;
      }
      next();
    });
  },
  importReviewsFromCsv
);

export default router;
