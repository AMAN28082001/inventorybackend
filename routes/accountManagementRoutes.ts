import express, { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/authQuotation';
import { downloadQuotationsExcel } from '../controllers/quotationController';
import { canAccessSection, hasAdminPanelAccess } from '../utils/userAccess';

const router: Router = express.Router();

const authorizeAccountManagementPayments = (req: Request, res: Response, next: NextFunction): void => {
  const role = req.user?.role;
  const allowed =
    role === 'account-management' ||
    role === 'admin' ||
    role === 'super-admin' ||
    role === 'super-admin-manager' ||
    hasAdminPanelAccess(req) ||
    canAccessSection(
      {
        role: req.user?.role,
        access: (req.user as any)?.access,
        username: req.user?.username
      },
      'accounts'
    );
  if (!allowed) {
    res.status(403).json({
      success: false,
      error: { code: 'AUTH_004', message: 'Insufficient permissions' }
    });
    return;
  }
  next();
};

router.use(authenticate);
router.use(authorizeAccountManagementPayments);

router.get('/payments/export', downloadQuotationsExcel);

export default router;
