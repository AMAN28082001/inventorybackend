/// <reference types="express" />

// Inventory System User Attributes
interface UserAttributes {
  id: string;
  username: string;
  password: string;
  name: string;
  role: 'super-admin' | 'super-admin-manager' | 'admin' | 'agent' | 'account' | 'installer' | 'baldev' | 'confirmation' | 'hr';
  is_active: boolean;
  created_by_id?: string | null;
  created_by_name?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

// Quotation System User Attributes
interface QuotationUserAttributes {
  id: string;
  username: string;
  role: 'dealer' | 'admin' | 'visitor' | 'account-management' | 'installer' | 'baldev' | 'confirmation' | 'hr';
}

declare global {
  namespace Express {
    interface Request {
      // Inventory system user
      user?: UserAttributes | QuotationUserAttributes;
      // Quotation system specific
      dealer?: {
        id: string;
        username: string;
        role: 'dealer' | 'admin';
      };
      visitor?: {
        id: string;
        username: string;
      };
      // Account manager (can be part of QuotationUserAttributes but keeping for clarity)
      accountManager?: {
        id: string;
        username: string;
        role: 'account-management' | 'hr';
      };
    }
  }
}

export {};

