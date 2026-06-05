# Account Manager Frontend Integration - API Updates

## Overview
This document outlines the backend changes made to support account manager login and quotation viewing. The frontend team needs to be aware of these changes to ensure proper integration.

---

## ✅ Backend Changes Complete

### 1. Account Manager Login Support
- ✅ Account managers can now log in via `/api/auth/login`
- ✅ Login returns `role: "account-management"` in the response
- ✅ Login automatically updates `loginCount` and `lastLogin`
- ✅ Login history is automatically logged

### 2. Quotation Viewing for Account Managers
- ✅ Account managers can view quotations (read-only)
- ✅ Account managers only see **approved** quotations
- ✅ Account managers can view quotation details
- ✅ Dealer/admin information is now included in quotation responses

---

## 📋 API Response Changes

### 1. GET `/api/quotations` - List Quotations

**Response Structure (Updated):**
```json
{
  "success": true,
  "data": {
    "quotations": [
      {
        "id": "quotation-001",
        "dealerId": "dealer-001",
        "dealer": {
          "id": "dealer-001",
          "firstName": "John",
          "lastName": "Doe",
          "email": "john.doe@example.com",
          "mobile": "9876543210",
          "username": "johndoe",
          "role": "dealer"
        },
        "customer": {
          "firstName": "Customer",
          "lastName": "Name",
          "mobile": "1234567890"
        },
        "products": { ... },
        "pricing": { ... },
        "status": "approved",
        "discount": 5,
        "createdAt": "2025-01-08T10:00:00Z",
        "validUntil": "2025-01-15T10:00:00Z"
      }
    ],
    "pagination": { ... }
  }
}
```

**New Field Added:**
- `dealer` - Object containing dealer/admin information (NEW)
  - Available for all user types (dealers, admins, visitors, account managers)
  - Includes: `id`, `firstName`, `lastName`, `email`, `mobile`, `username`, `role`

**Account Manager Behavior:**
- Only sees quotations with `status: "approved"`
- Cannot filter by status (status filter is ignored for account managers)
- Sees all approved quotations from all dealers/admins

---

### 2. GET `/api/quotations/:id` - Get Quotation Details

**Response Structure (Updated):**
```json
{
  "success": true,
  "data": {
    "id": "quotation-001",
    "dealerId": "dealer-001",
    "dealer": {
      "id": "dealer-001",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com",
      "mobile": "9876543210",
      "username": "johndoe",
      "role": "dealer"
    },
    "customer": {
      "id": "customer-001",
      "firstName": "Customer",
      "lastName": "Name",
      "mobile": "1234567890",
      "email": "customer@example.com",
      "address": {
        "street": "123 Main St",
        "city": "City",
        "state": "State",
        "pincode": "123456"
      }
    },
    "products": { ... },
    "pricing": { ... },
    "status": "approved",
    "discount": 5,
    "createdAt": "2025-01-08T10:00:00Z",
    "validUntil": "2025-01-15T10:00:00Z"
  }
}
```

**New Field Added:**
- `dealer` - Object containing dealer/admin information (NEW)
  - Available for all user types
  - Includes: `id`, `firstName`, `lastName`, `email`, `mobile`, `username`, `role`

**Account Manager Behavior:**
- Can only view quotations with `status: "approved"`
- If quotation is not approved, returns 404 (not found)
- Sees full dealer/admin information in the response

---

## 🔐 Authentication & Authorization

### Account Manager Login
**Endpoint:** `POST /api/auth/login`

**Request:**
```json
{
  "username": "accountmgr",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "account-mgr-001",
      "username": "accountmgr",
      "firstName": "Arjun",
      "lastName": "Singh",
      "email": "arjun.singh@accountmanagement.com",
      "mobile": "9876543215",
      "role": "account-management",
      "isActive": true,
      "emailVerified": false,
      "loginCount": 1,
      "lastLogin": "2025-01-08T10:30:00Z",
      "createdAt": "2025-01-08T10:00:00Z"
    },
    "expiresIn": 3600
  }
}
```

**Key Points:**
- `role` will be `"account-management"` for account managers
- Frontend should check `user.role === "account-management"` to identify account managers
- All other fields are the same as other user types

---

## 🎯 Frontend Integration Checklist

### 1. Account Manager Login
- [ ] Verify login page works for account managers
- [ ] Check that `role: "account-management"` is handled correctly
- [ ] Ensure account manager dashboard loads after login
- [ ] Verify token is stored and used for subsequent requests

### 2. Quotation List View
- [ ] Update TypeScript interfaces to include `dealer` field
- [ ] Display dealer/admin information in quotation cards/list
- [ ] For account managers: Only show approved quotations (backend filters automatically)
- [ ] Handle empty state when no approved quotations exist

### 3. Quotation Detail Modal (Eye Button)
- [ ] Update modal to display dealer/admin information
- [ ] Show dealer name, email, mobile, role in the modal
- [ ] Ensure all quotation data displays correctly
- [ ] Handle 404 error if account manager tries to view non-approved quotation

### 4. TypeScript Interface Updates

**Quotation Interface:**
```typescript
interface Quotation {
  id: string;
  dealerId: string;
  dealer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    mobile: string;
    username: string;
    role: 'dealer' | 'admin';
  } | null;
  customer: {
    firstName: string;
    lastName: string;
    mobile: string;
    // ... other customer fields
  } | null;
  products: { ... } | null;
  pricing: { ... };
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  discount: number;
  createdAt: string;
  validUntil: string;
}
```

**Account Manager User Interface:**
```typescript
interface AccountManager {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  role: 'account-management';
  isActive: boolean;
  emailVerified: boolean;
  loginCount: number;
  lastLogin: string | null;
  createdAt: string;
}
```

---

## 🔍 Account Manager Specific Behavior

### Quotation Filtering
- **Backend automatically filters** to only show approved quotations
- Frontend does NOT need to filter on the client side
- Status filter query parameter is ignored for account managers
- Account managers see all approved quotations from all dealers/admins

### Quotation Details
- Account managers can view full quotation details (same as dealers/admins)
- If quotation is not approved, API returns 404
- Frontend should handle 404 gracefully (show "Quotation not found" or similar)

### Permissions
- ✅ Account managers CAN:
  - View approved quotations
  - View quotation details
  - View product catalog
  - Download quotation PDFs (for approved quotations)
  
- ❌ Account managers CANNOT:
  - Create quotations
  - Edit quotations
  - Update pricing/products
  - View pending/rejected/completed quotations
  - Change quotation status

---

## 📊 Display Recommendations

### Quotation List Card
When displaying quotations for account managers, show:
- **Dealer/Admin Information:**
  - Dealer name: `{dealer.firstName} {dealer.lastName}`
  - Dealer role badge: "Dealer" or "Admin"
  - Dealer contact: Email or mobile (optional)
- **Customer Information:**
  - Customer name
  - Customer mobile
- **Quotation Details:**
  - Status badge: "Approved" (always for account managers)
  - Final amount
  - Created date

### Quotation Detail Modal
When displaying quotation details, show:
- **Dealer/Admin Section:**
  - Full name
  - Email
  - Mobile
  - Username
  - Role (Dealer/Admin)
- **Customer Section:**
  - Full customer details
- **Products Section:**
  - All product details
- **Pricing Section:**
  - Complete pricing breakdown

---

## 🐛 Error Handling

### Authentication Errors
- **401 Unauthorized**: Token expired or invalid
  - Redirect to login page
  - Clear stored tokens

### Permission Errors
- **403 Forbidden**: Account manager trying to access restricted endpoint
  - Show error message
  - Hide/disable restricted actions

### Not Found Errors
- **404 Not Found**: Account manager trying to view non-approved quotation
  - Show "Quotation not found" message
  - Optionally redirect to quotation list

---

## 🔄 Migration Notes

### Breaking Changes
- **None** - All changes are additive
- Existing dealer/admin/visitor functionality remains unchanged
- New `dealer` field is optional (can be `null`)

### Backward Compatibility
- ✅ Existing code will continue to work
- ✅ `dealer` field can be safely ignored if not needed
- ✅ Account managers use same endpoints as other users

---

## 📝 Example Frontend Code

### Check if User is Account Manager
```typescript
const isAccountManager = user?.role === 'account-management';
```

### Display Dealer Information
```typescript
{quotation.dealer && (
  <div className="dealer-info">
    <h4>Dealer/Admin Information</h4>
    <p>Name: {quotation.dealer.firstName} {quotation.dealer.lastName}</p>
    <p>Email: {quotation.dealer.email}</p>
    <p>Mobile: {quotation.dealer.mobile}</p>
    <p>Role: {quotation.dealer.role === 'admin' ? 'Admin' : 'Dealer'}</p>
  </div>
)}
```

### Handle Account Manager Quotation List
```typescript
// Backend automatically filters to approved only
// Frontend just displays the results
const quotations = response.data.quotations;

// All quotations shown are approved (for account managers)
quotations.forEach(quotation => {
  // quotation.status will always be 'approved' for account managers
  console.log(quotation.status); // 'approved'
});
```

---

## ✅ Testing Checklist

### Account Manager Login
- [ ] Test login with account manager credentials
- [ ] Verify `role: "account-management"` in response
- [ ] Verify token is received and stored
- [ ] Verify redirect to account manager dashboard

### Quotation List
- [ ] Verify only approved quotations are shown
- [ ] Verify dealer information is displayed
- [ ] Verify customer information is displayed
- [ ] Test pagination
- [ ] Test search functionality

### Quotation Details Modal
- [ ] Verify modal opens when clicking eye button
- [ ] Verify dealer/admin information is displayed
- [ ] Verify all quotation data is shown
- [ ] Test with approved quotation (should work)
- [ ] Test with non-approved quotation (should show 404)

### Error Handling
- [ ] Test with expired token (should redirect to login)
- [ ] Test with invalid token (should redirect to login)
- [ ] Test viewing non-approved quotation (should show error)

---

## 📞 Support

For questions about these changes:
- **Backend Login**: `controllers/quotationAuthController.ts` - `login()` function
- **Quotation List**: `controllers/quotationController.ts` - `getQuotations()` function
- **Quotation Details**: `controllers/quotationController.ts` - `getQuotationById()` function
- **Authentication Middleware**: `middleware/authQuotation.ts` - `authorizeDealerAdminOrVisitor()` function

---

## Summary

### What Frontend Needs to Do:
1. ✅ Update TypeScript interfaces to include `dealer` field
2. ✅ Display dealer/admin information in quotation views
3. ✅ Handle account manager role correctly
4. ✅ Account managers will automatically only see approved quotations (backend handles this)

### What Backend Handles:
- ✅ Account manager authentication
- ✅ Filtering to approved quotations only
- ✅ Including dealer information in responses
- ✅ Permission checks

### No Breaking Changes:
- ✅ All existing functionality remains the same
- ✅ New fields are optional/additive
- ✅ Backward compatible

---

**Status**: ✅ **Backend Ready - Frontend Integration Required**
