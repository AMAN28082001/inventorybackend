import express, { Router } from 'express';
import {
  getAllAccountManagers,
  getAccountManagerById,
  createAccountManager,
  updateAccountManager,
  updateAccountManagerPassword,
  activateAccountManager,
  deactivateAccountManager,
  deleteAccountManager,
  getAccountManagerHistory
} from '../controllers/accountManagerController';
import { authenticate, authorizeAdmin } from '../middleware/authQuotation';
import { validate } from '../middleware/validate';
import { createAccountManagerSchema, updateAccountManagerSchema, updatePasswordSchema } from '../validations/accountManagerValidations';

const router: Router = express.Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(authorizeAdmin);

/**
 * @swagger
 * /api/admin/account-managers:
 *   get:
 *     summary: Get all account managers
 *     description: Retrieve all account management users with optional filtering and pagination
 *     tags: [Account Managers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term (searches firstName, lastName, email, mobile, username)
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           default: createdAt
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: List of account managers
 *       403:
 *         description: Insufficient permissions
 */
router.get('/', getAllAccountManagers);

/**
 * @swagger
 * /api/admin/account-managers/{accountManagerId}:
 *   get:
 *     summary: Get account manager by ID
 *     description: Retrieve detailed information about a specific account manager
 *     tags: [Account Managers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountManagerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Account manager details
 *       404:
 *         description: Account manager not found
 *       403:
 *         description: Insufficient permissions
 */
router.get('/:accountManagerId', getAccountManagerById);

/**
 * @swagger
 * /api/admin/account-managers:
 *   post:
 *     summary: Create account manager
 *     description: Create a new account management user
 *     tags: [Account Managers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *               - firstName
 *               - lastName
 *               - email
 *               - mobile
 *             properties:
 *               username:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 50
 *               password:
 *                 type: string
 *                 minLength: 8
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               mobile:
 *                 type: string
 *                 pattern: '^\d{10}$'
 *     responses:
 *       201:
 *         description: Account manager created successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Insufficient permissions
 */
router.post('/', validate(createAccountManagerSchema), createAccountManager);

/**
 * @swagger
 * /api/admin/account-managers/{accountManagerId}:
 *   put:
 *     summary: Update account manager
 *     description: Update account manager information (excluding password and username)
 *     tags: [Account Managers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountManagerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *               mobile:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *               emailVerified:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Account manager updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Account manager not found
 *       403:
 *         description: Insufficient permissions
 */
router.put('/:accountManagerId', validate(updateAccountManagerSchema), updateAccountManager);

/**
 * @swagger
 * /api/admin/account-managers/{accountManagerId}/password:
 *   put:
 *     summary: Update account manager password
 *     description: Update the password for an account manager
 *     tags: [Account Managers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountManagerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Account manager not found
 *       403:
 *         description: Insufficient permissions
 */
router.put('/:accountManagerId/password', validate(updatePasswordSchema), updateAccountManagerPassword);

/**
 * @swagger
 * /api/admin/account-managers/{accountManagerId}/activate:
 *   patch:
 *     summary: Activate account manager
 *     description: Activate a deactivated account manager
 *     tags: [Account Managers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountManagerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Account manager activated successfully
 *       404:
 *         description: Account manager not found
 *       403:
 *         description: Insufficient permissions
 */
router.patch('/:accountManagerId/activate', activateAccountManager);

/**
 * @swagger
 * /api/admin/account-managers/{accountManagerId}/deactivate:
 *   patch:
 *     summary: Deactivate account manager
 *     description: Deactivate an account manager (soft delete)
 *     tags: [Account Managers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountManagerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Account manager deactivated successfully
 *       404:
 *         description: Account manager not found
 *       403:
 *         description: Insufficient permissions
 */
router.patch('/:accountManagerId/deactivate', deactivateAccountManager);

/**
 * @swagger
 * /api/admin/account-managers/{accountManagerId}:
 *   delete:
 *     summary: Delete account manager
 *     description: Permanently delete an account manager (hard delete)
 *     tags: [Account Managers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountManagerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Account manager deleted successfully
 *       404:
 *         description: Account manager not found
 *       403:
 *         description: Insufficient permissions
 */
router.delete('/:accountManagerId', deleteAccountManager);

/**
 * @swagger
 * /api/admin/account-managers/{accountManagerId}/history:
 *   get:
 *     summary: Get account manager history
 *     description: Retrieve activity and login history for an account manager
 *     tags: [Account Managers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountManagerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter history from this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter history until this date
 *     responses:
 *       200:
 *         description: Account manager history
 *       404:
 *         description: Account manager not found
 *       403:
 *         description: Insufficient permissions
 */
router.get('/:accountManagerId/history', getAccountManagerHistory);

export default router;
