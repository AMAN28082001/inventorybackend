import express, { Router } from 'express';
import { login, getCurrentUser, forgotPassword, resetPassword, changePassword, getAgentDealerMapping } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { loginSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema } from '../validations/authValidations';

const router: Router = express.Router();

/**
 * @swagger
 * /api/inventory-auth/login:
 *   post:
 *     summary: Inventory System login (Super Admin, Admin, Agent, Account)
 *     description: Login endpoint for Inventory System users (super admin, admin, agent, account roles)
 *     tags: [Auth - Inventory]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', validate(loginSchema), login);

/**
 * @swagger
 * /api/inventory-auth/me:
 *   get:
 *     summary: Get current authenticated user (Inventory System)
 *     description: Get current authenticated Inventory System user information
 *     tags: [Auth - Inventory]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 */
router.get('/me', authenticate, getCurrentUser);

/**
 * @swagger
 * /api/inventory-auth/agent-dealer:
 *   get:
 *     summary: Resolve quotation dealer mapping for inventory agent
 *     tags: [Auth - Inventory]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Mapped dealer for quotation access
 *       404:
 *         description: No dealer mapping found
 */
router.get('/agent-dealer', authenticate, getAgentDealerMapping);

/**
 * @swagger
 * /api/inventory-auth/forgot-password:
 *   post:
 *     summary: Request password reset token (Inventory System)
 *     description: Request password reset token for Inventory System users
 *     tags: [Auth - Inventory]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *             properties:
 *               username:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reset token generated
 *       400:
 *         description: Validation error
 */
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);

/**
 * @swagger
 * /api/inventory-auth/reset-password:
 *   post:
 *     summary: Reset password using token (Inventory System)
 *     description: Reset password for Inventory System users using reset token
 *     tags: [Auth - Inventory]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - resetToken
 *               - newPassword
 *             properties:
 *               resetToken:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Validation error or invalid token
 */
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);

/**
 * @swagger
 * /api/inventory-auth/change-password:
 *   post:
 *     summary: Change password for authenticated user (Inventory System)
 *     description: Change password for authenticated Inventory System users
 *     tags: [Auth - Inventory]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized or incorrect current password
 */
router.post('/change-password', authenticate, validate(changePasswordSchema), changePassword);

export default router;

