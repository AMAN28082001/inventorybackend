================================================================================

                    API AND DATABASE DOCUMENTATION

                Chairbord Solar Inventory Management System

================================================================================

This document provides a comprehensive overview of:

1. All APIs being used in the frontend application

2. Database tables/models and their structures

3. Mapping between APIs and database tables

Base URL: http://localhost:3000/api (configurable via NEXT_PUBLIC_API_URL)

================================================================================

PART 1: APIS USED IN FRONTEND

================================================================================

1. AUTHENTICATION APIs

================================================================================

1.1 POST /api/auth/login

   - Purpose: User authentication/login

   - Used in: components/auth/login-page.tsx

   - Request Body:

     {

       "username": string,

       "password": string

     }

   - Response:

     {

       "message": string,

       "token": string (JWT),

       "user": {

         "id": string,

         "username": string,

         "name": string,

         "role": "super-admin" | "admin" | "agent" | "account",

         "is_active": boolean

       }

     }

   - Notes: Returns 401 with "Account is inactive" for users awaiting approval

   - Database Table: users

1.2 GET /api/auth/me

   - Purpose: Get current authenticated user details

   - Used in: app/page.tsx (session verification)

   - Headers: Authorization: Bearer <token>

   - Response: User object with id, username, name, role, is_active, created_at

   - Database Table: users

1.3 POST /api/auth/forgot-password

   - Purpose: Request password reset token

   - Used in: components/auth/forgot-password-page.tsx (if implemented)

   - Request Body:

     {

       "username": string

     }

   - Response:

     {

       "message": string,

       "resetToken": string (JWT token, expires in 1 hour),

       "expiresIn": "1 hour"

     }

   - Notes: 

     - Returns success message even if username doesn't exist (security best practice)

     - Returns 401 if account is inactive

     - In production, resetToken should be sent via email, not returned in response

     - Token expires in 1 hour

   - Database Table: users

1.4 POST /api/auth/reset-password

   - Purpose: Reset password using reset token

   - Used in: components/auth/reset-password-page.tsx (if implemented)

   - Request Body:

     {

       "resetToken": string (JWT token from forgot-password),

       "newPassword": string (minimum 6 characters)

     }

   - Response:

     {

       "message": "Password reset successfully. Please login with your new password"

     }

   - Notes:

     - Returns 400 if token is invalid or expired

     - Returns 400 if password is less than 6 characters

     - Returns 401 if account is inactive

   - Database Table: users

1.5 POST /api/auth/change-password

   - Purpose: Change password for authenticated users

   - Used in: components/settings/change-password-modal.tsx (if implemented)

   - Headers: Authorization: Bearer <token>

   - Request Body:

     {

       "currentPassword": string,

       "newPassword": string (minimum 6 characters)

     }

   - Response:

     {

       "message": "Password changed successfully"

     }

   - Notes:

     - Requires authentication

     - Returns 401 if current password is incorrect

     - Returns 400 if new password is same as current password

     - Returns 400 if password is less than 6 characters

   - Database Table: users

================================================================================

2. USERS APIs

================================================================================

2.1 GET /api/users

   - Purpose: Get all users (with optional role filter)

   - Used in: 

     - components/dashboards/super-admin-dashboard.tsx (get admins)

     - components/dashboards/admin-dashboard.tsx (get agents)

     - components/dashboards/account-dashboard.tsx (get agents)

   - Query Parameters: role (optional) - "super-admin" | "admin" | "agent" | "account"

   - Headers: Authorization: Bearer <token>

   - Response: Array of User objects

   - Required Role: super-admin, admin

   - Database Table: users

2.2 GET /api/users/agents (Alternative endpoint)

   - Purpose: Get all agent users

   - Used in: components/dashboards/account-dashboard.tsx (fallback)

   - Headers: Authorization: Bearer <token>

   - Response: Array of User objects with role="agent"

   - Database Table: users

2.3 GET /api/account/agents (Alternative endpoint for account role)

   - Purpose: Get all agents (for account role)

   - Used in: components/dashboards/account-dashboard.tsx (fallback)

   - Headers: Authorization: Bearer <token>

   - Response: Array of User objects with role="agent"

   - Database Table: users

2.4 GET /api/users/:id

   - Purpose: Get user by ID

   - Used in: Various components for fetching user details

   - Headers: Authorization: Bearer <token>

   - Response: Single User object

   - Required Role: super-admin, admin

   - Database Table: users

2.5 POST /api/users

   - Purpose: Create new user (admin or agent)

   - Used in: 

     - components/modals/create-user-modal.tsx (create admin/agent)

   - Headers: Authorization: Bearer <token>

   - Request Body:

     {

       "username": string,

       "password": string,

       "name": string,

       "role": string,

       "is_active": boolean (optional, defaults based on creator)

     }

   - Required Role: super-admin (can create any role), admin (can create agents only)

   - Notes: Agents created by admins have is_active=false until super-admin approval

   - Database Table: users

2.6 PUT /api/users/:id

   - Purpose: Update user (activate/deactivate, update details)

   - Used in:

     - components/dashboards/super-admin-dashboard.tsx (approve agents)

     - components/dashboards/account-dashboard.tsx (approve/reject agents)

   - Headers: Authorization: Bearer <token>

   - Request Body (partial updates):

     {

       "name": string (optional),

       "is_active": boolean (optional)

     }

   - Required Role: super-admin (for all updates), account (for agent approval)

   - Database Table: users

2.7 DELETE /api/users/:id

   - Purpose: Delete user

   - Used in: Various admin components

   - Headers: Authorization: Bearer <token>

   - Required Role: super-admin

   - Database Table: users

================================================================================

3. PRODUCTS APIs

================================================================================

3.1 GET /api/products

   - Purpose: Get all products

   - Used in:

     - hooks/use-inventory-state.ts

     - components/modals/product-modal.tsx

     - components/modals/sales-modal.tsx

     - components/modals/agent-stock-request-modal.tsx

     - components/modals/admin-stock-request-modal.tsx

   - Query Parameters:

     - category (optional): Filter by category

     - search (optional): Search by name or model

   - Public endpoint (no authentication required)

   - Response: Array of Product objects

   - Database Table: products

3.2 GET /api/products/:id

   - Purpose: Get product by ID

   - Used in: Various components for product details

   - Public endpoint (no authentication required)

   - Response: Single Product object

   - Database Table: products

3.3 GET /api/products/inventory/levels

   - Purpose: Get inventory levels for all products

   - Used in: components/dashboards/super-admin-dashboard.tsx

   - Headers: Authorization: Bearer <token>

   - Response: Array of ProductInventoryLevel objects with central_stock, distributed_stock, total_stock

   - Required: Authentication

   - Database Table: products (calculated from central_stock and distributed_stock)

3.4 POST /api/products

   - Purpose: Create new product

   - Used in: components/modals/product-modal.tsx

   - Headers: Authorization: Bearer <token>

   - Content-Type: multipart/form-data (if image) or application/json

   - Request Body:

     {

       "name": string,

       "model": string,

       "category": string,

       "wattage": string (optional),

       "quantity": number (maps to products.quantity - central stock),

       "unit_price": number,

       "image": File (optional, max 5MB)

     }

   - Required Role: super-admin

   - Database Table: products

3.5 PUT /api/products/:id

   - Purpose: Update product

   - Used in: components/modals/product-modal.tsx

   - Headers: Authorization: Bearer <token>

   - Content-Type: multipart/form-data (if image) or application/json

   - Request Body: Partial Product object

   - Required Role: super-admin

   - Database Table: products

3.6 DELETE /api/products/:id

   - Purpose: Delete product

   - Used in: hooks/use-inventory-state.ts

   - Headers: Authorization: Bearer <token>

   - Required Role: super-admin

   - Database Table: products

================================================================================

4. CATEGORIES APIs

================================================================================

4.1 GET /api/categories

   - Purpose: Get all categories (distinct category labels from products)

   - Used in: components/modals/product-modal.tsx (populate category dropdown)

   - Public endpoint (no authentication required)

   - Response: Array of Category objects { label: string }

   - Database Table: products (categories are derived from product.category field)

4.2 GET /api/categories/:label

   - Purpose: Check if category exists (verify if products use this category)

   - Used in: Category validation

   - Public endpoint (no authentication required)

   - Response: Category object or 404 if not found

   - Database Table: products

================================================================================

5. STOCK REQUESTS APIs

================================================================================

5.1 GET /api/stock-requests

   - Purpose: Get all stock requests with optional filters

   - Used in:

     - hooks/use-stock-requests-state.ts

     - components/dashboards/super-admin-dashboard.tsx

     - components/dashboards/admin-dashboard.tsx

     - components/dashboards/agent-dashboard.tsx

   - Query Parameters:

     - status (optional): "pending" | "dispatched" | "confirmed" | "rejected"

     - requested_by_id (optional): Filter by requester ID

     - requested_from (optional): Filter by source ("super-admin" or admin ID)

   - Headers: Authorization: Bearer <token>

   - Response: Array of StockRequest objects

   - Required: Authentication

   - Database Tables: stock_requests, stock_request_items

5.2 GET /api/stock-requests/:id

   - Purpose: Get stock request by ID with full details

   - Used in:

     - components/modals/enhanced-request-approval-modal.tsx

     - components/modals/stock-confirmation-modal.tsx

   - Headers: Authorization: Bearer <token>

   - Response: Single StockRequest object with items, addresses, etc.

   - Required: Authentication

   - Database Tables: stock_requests, stock_request_items

5.3 POST /api/stock-requests

   - Purpose: Create new stock request

   - Used in:

     - components/modals/agent-stock-request-modal.tsx

     - components/modals/admin-stock-request-modal.tsx

   - Headers: Authorization: Bearer <token>

   - Request Body:

     {

       "requested_from": "super-admin" | string (admin ID) | "admin" (placeholder for agents),

       "items": [

         {

           "product_id": string (optional, can be null for products not yet in system),

           "product_name": string (required if product_id is null),

           "model": string (required if product_id is null),

           "quantity": number (required, min: 1)

         }

       ],

       "notes": string (optional)

     }

   - Notes: 

     - For agents, requested_from can be "admin" (placeholder) which gets resolved to actual admin ID during dispatch

     - B2B/B2C fields (billing_address, delivery_address, customer_name, etc.) are not currently supported in stock requests

     - Items can reference products not yet in system by omitting product_id and providing product_name and model

   - Required Role: admin, agent

   - Database Tables: stock_requests, stock_request_items

5.4 POST /api/stock-requests/:id/dispatch

   - Purpose: Approve and dispatch stock request (or reject)

   - Used in: components/modals/enhanced-request-approval-modal.tsx

   - Headers: Authorization: Bearer <token>

   - Content-Type: multipart/form-data

   - Request Body:

     {

       "rejection_reason": string (optional, if rejecting),

       "dispatch_image": File (optional)

     }

   - Required Role: super-admin, admin

   - Database Tables: stock_requests, inventory_transactions

5.5 POST /api/stock-requests/:id/confirm

   - Purpose: Confirm receipt of dispatched stock

   - Used in: components/modals/stock-confirmation-modal.tsx

   - Headers: Authorization: Bearer <token>

   - Content-Type: multipart/form-data

   - Request Body:

     {

       "confirmation_image": File (optional)

     }

   - Required: Must be the requester

   - Database Tables: stock_requests, inventory_transactions

5.6 PUT /api/stock-requests/:id

   - Purpose: Update stock request (items or notes)

   - Used in: Stock request editing (if implemented)

   - Headers: Authorization: Bearer <token>

   - Request Body (partial updates):

     {

       "items": Array<StockRequestItem> (optional),

       "notes": string (optional)

     }

   - Required: Must be the requester, status must be pending

   - Database Tables: stock_requests, stock_request_items

5.7 DELETE /api/stock-requests/:id

   - Purpose: Delete stock request

   - Used in: Stock request deletion (if implemented)

   - Headers: Authorization: Bearer <token>

   - Required: Must be the requester or super-admin, status must be pending

   - Database Tables: stock_requests, stock_request_items

================================================================================

6. SALES APIs

================================================================================

6.1 GET /api/sales

   - Purpose: Get all sales with optional filters

   - Used in:

     - hooks/use-sales-state.ts

     - components/dashboards/agent-dashboard.tsx

     - components/dashboards/account-dashboard.tsx

   - Query Parameters:

     - type (optional): "B2B" | "B2C"

     - payment_status (optional): "pending" | "completed"

     - customer_name (optional): Search by customer name

     - start_date (optional): Filter by start date

     - end_date (optional): Filter by end date

   - Headers: Authorization: Bearer <token>

   - Response: Array of Sale objects

   - Required: Authentication

   - Database Tables: sales, sale_items, addresses

6.2 GET /api/sales/summary

   - Purpose: Get sales summary statistics

   - Used in: components/dashboards/agent-dashboard.tsx (metrics)

   - Headers: Authorization: Bearer <token>

   - Response: Array of SaleSummary objects

   - Required: Authentication

   - Database Tables: sales, sale_items (aggregated)

6.3 GET /api/sales/:id

   - Purpose: Get sale by ID with full details

   - Used in:

     - lib/quotation-generator.ts (for PDF generation)

     - components/dashboards/account-dashboard.tsx

   - Headers: Authorization: Bearer <token>

   - Response: Single Sale object with items, addresses, etc.

   - Required: Authentication

   - Database Tables: sales, sale_items, addresses

6.4 POST /api/sales

   - Purpose: Create new sale (B2B or B2C)

   - Used in: components/modals/sales-modal.tsx

   - Headers: Authorization: Bearer <token>

   - Content-Type: multipart/form-data (if image) or application/json

   - Request Body:

     {

       "type": "B2B" | "B2C",

       "customer_name": string,

       "items": [

         {

           "product_id": string,

           "quantity": number,

           "unit_price": number,

           "gst_rate": number (optional)

         }

       ],

       "tax_amount": number,

       "discount_amount": number (optional),

       "billing_address": Address object,

       "delivery_address": Address object (optional),

       "delivery_matches_billing": boolean,

       "company_name": string (optional, for B2B),

       "gst_number": string (optional, for B2B),

       "contact_person": string (optional, for B2B),

       "customer_email": string (optional),

       "customer_phone": string (optional),

       "notes": string (optional),

       "image": File (optional)

     }

   - Required Role: agent, admin

   - Database Tables: sales, sale_items, addresses, inventory_transactions

6.5 POST /api/sales/:id/confirm-bill

   - Purpose: Confirm B2B bill (upload bill image)

   - Used in: Account dashboard (if implemented)

   - Headers: Authorization: Bearer <token>

   - Content-Type: multipart/form-data

   - Request Body:

     {

       "bill_image": File

     }

   - Required Role: account

   - Database Tables: sales

6.6 PUT /api/sales/:id

   - Purpose: Update sale

   - Used in: Sale editing (if implemented)

   - Headers: Authorization: Bearer <token>

   - Request Body: Partial Sale object

   - Required: Creator, admin, or super-admin

   - Database Tables: sales, sale_items

6.7 DELETE /api/sales/:id

   - Purpose: Delete sale

   - Used in: Sale deletion (if implemented)

   - Headers: Authorization: Bearer <token>

   - Required: Creator or super-admin

   - Database Tables: sales, sale_items

================================================================================

7. INVENTORY TRANSACTIONS APIs

================================================================================

7.1 GET /api/inventory-transactions

   - Purpose: Get all inventory transactions with optional filters

   - Used in: hooks/use-inventory-state.ts (fetch transaction history)

   - Query Parameters:

     - product_id (optional): Filter by product

     - transaction_type (optional): "purchase" | "sale" | "adjustment" | "return" | "transfer"

     - start_date (optional): Filter by start date

     - end_date (optional): Filter by end date

   - Headers: Authorization: Bearer <token>

   - Response: Array of InventoryTransaction objects

   - Required: Authentication

   - Database Tables: inventory_transactions

7.2 GET /api/inventory-transactions/:id

   - Purpose: Get transaction by ID

   - Used in: Transaction details (if implemented)

   - Headers: Authorization: Bearer <token>

   - Response: Single InventoryTransaction object

   - Required: Authentication

   - Database Tables: inventory_transactions

7.3 POST /api/inventory-transactions

   - Purpose: Create inventory transaction (manual adjustment)

   - Used in: Inventory management (if implemented)

   - Headers: Authorization: Bearer <token>

   - Request Body:

     {

       "product_id": string,

       "transaction_type": "purchase" | "sale" | "adjustment" | "return" | "transfer",

       "quantity": number,

       "reference": string,

       "notes": string (optional),

       "related_stock_request_id": string (optional),

       "related_sale_id": string (optional)

     }

   - Required Role: super-admin, admin

   - Database Tables: inventory_transactions

================================================================================

8. ADMIN INVENTORY APIs

================================================================================

8.1 GET /api/admin-inventory

   - Purpose: Get all admin inventory records

   - Used in: Admin inventory management (if implemented)

   - Query Parameters:

     - admin_id (optional): Filter by admin

   - Headers: Authorization: Bearer <token>

   - Response: Array of AdminInventory objects

   - Required: Authentication

   - Database Tables: admin_inventory

8.2 GET /api/admin-inventory/admin/:adminId

   - Purpose: Get inventory for specific admin

   - Used in: Admin-specific inventory views

   - Headers: Authorization: Bearer <token>

   - Response: Array of AdminInventory objects for that admin

   - Required: Authentication

   - Database Tables: admin_inventory

8.3 POST /api/admin-inventory

   - Purpose: Create or update admin inventory

   - Used in: Inventory distribution (if implemented)

   - Headers: Authorization: Bearer <token>

   - Request Body:

     {

       "admin_id": string,

       "product_id": string,

       "quantity": number

     }

   - Required Role: super-admin

   - Database Tables: admin_inventory

8.4 PUT /api/admin-inventory/:id

   - Purpose: Update admin inventory quantity

   - Used in: Inventory updates

   - Headers: Authorization: Bearer <token>

   - Request Body:

     {

       "quantity": number

     }

   - Required Role: super-admin

   - Database Tables: admin_inventory

8.5 DELETE /api/admin-inventory/:id

   - Purpose: Delete admin inventory record

   - Used in: Inventory cleanup

   - Headers: Authorization: Bearer <token>

   - Required Role: super-admin

   - Database Tables: admin_inventory

================================================================================

9. STOCK RETURNS APIs

================================================================================

9.1 GET /api/stock-returns

   - Purpose: Get all stock returns with optional filters

   - Used in:

     - components/dashboards/super-admin-dashboard.tsx (return approvals)

     - components/dashboards/admin-dashboard.tsx (agent returns)

   - Query Parameters:

     - admin_id (optional): Filter by admin

     - status (optional): "pending" | "processed"

     - start_date (optional): Filter by start date

     - end_date (optional): Filter by end date

   - Headers: Authorization: Bearer <token>

   - Response: Array of StockReturn objects

   - Required: Authentication

   - Database Tables: stock_returns

9.2 GET /api/stock-returns/:id

   - Purpose: Get stock return by ID

   - Used in: Return details (if implemented)

   - Headers: Authorization: Bearer <token>

   - Response: Single StockReturn object

   - Required: Authentication

   - Database Tables: stock_returns

9.3 POST /api/stock-returns

   - Purpose: Create stock return request

   - Used in: components/modals/stock-return-modal.tsx

   - Headers: Authorization: Bearer <token>

   - Request Body:

     {

       "product_id": string,

       "quantity": number,

       "reason": string

     }

   - Required Role: admin (returns to super-admin), agent (returns to admin)

   - Database Tables: stock_returns

9.4 POST /api/stock-returns/:id/process

   - Purpose: Process (approve) stock return

   - Used in:

     - components/dashboards/super-admin-dashboard.tsx (approve admin returns)

     - components/dashboards/admin-dashboard.tsx (approve agent returns)

   - Headers: Authorization: Bearer <token>

   - Request Body: {} (empty)

   - Required Role: super-admin (for admin returns), admin (for agent returns)

   - Database Tables: stock_returns, inventory_transactions

9.5 PUT /api/stock-returns/:id

   - Purpose: Update stock return

   - Used in: Return editing (if implemented)

   - Headers: Authorization: Bearer <token>

   - Request Body (partial updates):

     {

       "quantity": number (optional),

       "reason": string (optional)

     }

   - Required: Admin or super-admin, status must be pending

   - Database Tables: stock_returns

9.6 DELETE /api/stock-returns/:id

   - Purpose: Delete stock return

   - Used in: Return deletion (if implemented)

   - Headers: Authorization: Bearer <token>

   - Required: Admin or super-admin, status must be pending

   - Database Tables: stock_returns

================================================================================

PART 2: DATABASE TABLES AND MODELS

================================================================================

================================================================================

1. USERS TABLE

================================================================================

Table Name: users

Primary Key: id (STRING)

Fields:

- id: STRING(50) - Primary Key, UUID

- username: STRING(255) - Unique, Required

- password: STRING(255) - Hashed password, Required

- name: STRING(255) - User's full name, Required

- role: ENUM('super-admin', 'admin', 'agent', 'account') - Required

- is_active: BOOLEAN - Default: true for super-admin, false for agents created by admin

- created_by_id: STRING(50) - Foreign Key to users.id, Nullable

  * Tracks which admin created this user (for agents)

- admin_id: STRING(50) - Foreign Key to users.id, Nullable

  * Alternative field for admin-agent relationship

- created_at: DATE - Auto-generated timestamp

- updated_at: DATE - Auto-generated timestamp

Relationships:

- created_by_id -> users.id (Many agents belong to one admin)

- admin_id -> users.id (Many agents belong to one admin)

Indexes:

- username (unique)

- role

- created_by_id

- admin_id

- is_active

Usage:

- Stores all system users (super-admin, admins, agents, account)

- Tracks creation hierarchy (admin creates agent)

- Controls user access based on is_active flag

================================================================================

2. PRODUCTS TABLE

================================================================================

Table Name: products

Primary Key: id (STRING)

Fields:

- id: STRING(50) - Primary Key, UUID

- name: STRING(255) - Product name, Required

- model: STRING(255) - Product model, Required

- category: STRING(120) - Product category (e.g., "Panels", "Inverter"), Required

- wattage: STRING(50) - Power rating (e.g., "400W"), Optional

- unit_price: DECIMAL(12,2) - Price per unit, Optional

- quantity: INTEGER - Stock at central warehouse (central_stock), Default: 0, min: 0

- image: STRING(500) - Image filename/URL, Optional

Note: distributed_stock and total_stock are calculated fields returned by /api/products/inventory/levels endpoint, not actual database columns.

- created_at: DATE - Auto-generated timestamp

- updated_at: DATE - Auto-generated timestamp

Relationships:

- One product has many stock_request_items

- One product has many sale_items

- One product has many admin_inventory records

- One product has many inventory_transactions

Indexes:

- category

- name

- model

Usage:

- Stores product catalog (solar panels, inverters, batteries, etc.)

- Tracks central stock (super-admin warehouse) in quantity field

- Distributed stock is calculated from admin_inventory table (via /api/products/inventory/levels)

- Total stock = quantity (central) + distributed_stock (calculated)

================================================================================

3. ADDRESSES TABLE

================================================================================

Table Name: addresses

Primary Key: id (STRING)

Fields:

- id: STRING(50) - Primary Key, UUID

- line1: STRING(255) - Street address, P.O. box, Required

- line2: STRING(255) - Apartment, suite, unit, building, floor, Optional

- city: STRING(120) - City name, Required

- state: STRING(120) - State/Province, Required

- postal_code: STRING(30) - Postal/ZIP code, Required

- country: STRING(120) - Country name, Required

- created_at: DATE - Auto-generated timestamp

Relationships:

- One address can be used in many sales (billing_address_id)

- One address can be used in many sales (delivery_address_id)

Usage:

- Stores billing and delivery addresses for sales

- Reusable address records to avoid duplication

Note: Addresses are currently only used in sales, not in stock requests

================================================================================

4. STOCK_REQUESTS TABLE

================================================================================

Table Name: stock_requests

Primary Key: id (STRING)

Fields:

- id: STRING(50) - Primary Key, UUID (numeric IDs for new requests)

- primary_product_id: STRING(50) - Foreign Key to products.id, Nullable

  * Legacy field for first product in request

- primary_product_name: STRING(255) - Name of primary product, Nullable

- primary_model: STRING(255) - Model of primary product, Nullable

- total_quantity: INTEGER - Total quantity across all items, Required, min: 1

- requested_by_id: STRING(50) - Foreign Key to users.id, Nullable

  * ID of user making the request (admin or agent)

- requested_by_name: STRING(255) - Name of requester, Required

- requested_by_role: ENUM('admin', 'agent') - Role of requester, Required

- requested_from: STRING(50) - "super-admin" or admin user ID, Required

  * Indicates source of stock (super-admin for admin requests, admin ID for agent requests)

  * For agents, can be "admin" placeholder which gets resolved during dispatch

- requested_from_role: ENUM('super-admin', 'admin') - Role of source, Required

- status: ENUM('pending', 'dispatched', 'confirmed', 'rejected') - Default: 'pending'

- notes: TEXT - Optional notes

- rejection_reason: TEXT - Reason for rejection (if rejected)

- dispatch_image: STRING(500) - Dispatch photo filename/URL, Optional

- confirmation_image: STRING(500) - Confirmation photo filename/URL, Optional

- dispatched_by_id: STRING(50) - Foreign Key to users.id, Nullable

- dispatched_by_name: STRING(255) - Name of dispatcher, Nullable

- confirmed_by_id: STRING(50) - Foreign Key to users.id, Nullable

- confirmed_by_name: STRING(255) - Name of confirmer, Nullable

- requested_date: DATE - Timestamp when requested, Default: NOW

- dispatched_date: DATE - Timestamp when dispatched, Nullable

- confirmed_date: DATE - Timestamp when confirmed, Nullable

Relationships:

- requested_by_id -> users.id (Many requests belong to one user)

- dispatched_by_id -> users.id (Many requests dispatched by one user)

- confirmed_by_id -> users.id (Many requests confirmed by one user)

- primary_product_id -> products.id (Optional)

- One stock_request has many stock_request_items

Indexes:

- requested_by_id

- requested_from

- status

- requested_date

- dispatched_date

- confirmed_date

Usage:

- Stores stock requests from admins to super-admin

- Stores stock requests from agents to admins

- Stores admin-to-admin stock transfers

- Tracks request status through approval workflow

================================================================================

5. STOCK_REQUEST_ITEMS TABLE

================================================================================

Table Name: stock_request_items

Primary Key: id (STRING)

Fields:

- id: STRING(50) - Primary Key, UUID

- stock_request_id: STRING(50) - Foreign Key to stock_requests.id, Required

- product_id: STRING(50) - Foreign Key to products.id, Nullable

  * Optional - allows requests for products not yet in system

- product_name: STRING(255) - Product name, Required

- model: STRING(255) - Product model, Required

- quantity: INTEGER - Requested quantity, Required, min: 1

Relationships:

- stock_request_id -> stock_requests.id (Many items belong to one request, CASCADE delete)

- product_id -> products.id (Many items reference one product, SET NULL on delete)

Indexes:

- stock_request_id

- product_id

Usage:

- Stores individual items within a stock request

- Each request can have multiple products with quantities

- Supports products not yet in system (product_id can be null)

================================================================================

6. SALES TABLE

================================================================================

Table Name: sales

Primary Key: id (STRING)

Fields:

- id: STRING(50) - Primary Key, UUID

- type: ENUM('B2B', 'B2C') - Sale type, Required

- customer_name: STRING(255) - Customer name, Required

- product_summary: STRING(500) - Summary of products in sale, Required

- total_quantity: INTEGER - Total quantity across all items, Required, min: 1

- subtotal: DECIMAL(15,2) - Subtotal before tax, Required, min: 0

- tax_amount: DECIMAL(15,2) - Total tax amount (GST), Required, Default: 0, min: 0

- discount_amount: DECIMAL(15,2) - Discount amount, Required, Default: 0, min: 0

- total_amount: DECIMAL(15,2) - Final total amount, Required, min: 0

- payment_status: ENUM('pending', 'completed') - Default: 'pending'

- sale_date: DATE - Sale date, Default: NOW

- billing_address_id: STRING(50) - Foreign Key to addresses.id, Nullable

- delivery_address_id: STRING(50) - Foreign Key to addresses.id, Nullable

- delivery_matches_billing: BOOLEAN - Default: false

- company_name: STRING(255) - Company name for B2B, Nullable

- gst_number: STRING(50) - GST number for B2B, Nullable

- contact_person: STRING(255) - Contact person for B2B, Nullable

- customer_email: STRING(255) - Customer email, Nullable, Valid email format

- customer_phone: STRING(50) - Customer phone, Nullable

- delivery_instructions: TEXT - Delivery instructions, Nullable

- notes: TEXT - Optional notes

- image: STRING(500) - Sale image filename/URL, Optional

- bill_image: STRING(500) - Bill image filename/URL (for B2B confirmation), Optional

- bill_confirmed_date: DATE - Timestamp when bill confirmed, Nullable

- bill_confirmed_by_id: STRING(50) - Foreign Key to users.id, Nullable

- bill_confirmed_by_name: STRING(255) - Name of bill confirmer, Nullable

- created_by: STRING(50) - Foreign Key to users.id, Nullable

  * ID of agent/admin who created the sale

- created_at: DATE - Auto-generated timestamp

- updated_at: DATE - Auto-generated timestamp

Relationships:

- billing_address_id -> addresses.id (Optional, SET NULL on delete)

- delivery_address_id -> addresses.id (Optional, SET NULL on delete)

- created_by -> users.id (Many sales belong to one user, SET NULL on delete)

- bill_confirmed_by_id -> users.id (Many sales confirmed by one user, SET NULL on delete)

- One sale has many sale_items (CASCADE delete)

Indexes:

- type

- payment_status

- created_by

- customer_name

- sale_date

- bill_confirmed_date

Usage:

- Stores B2B and B2C sales

- Tracks customer information

- Stores billing and delivery addresses

- Tracks payment status

- Stores sale images and bill images

================================================================================

7. SALE_ITEMS TABLE

================================================================================

Table Name: sale_items

Primary Key: id (STRING)

Fields:

- id: STRING(50) - Primary Key, UUID

- sale_id: STRING(50) - Foreign Key to sales.id, Required

- product_id: STRING(50) - Foreign Key to products.id, Nullable

  * Optional - allows sales for products not yet in system

- product_name: STRING(255) - Product name, Required

- model: STRING(255) - Product model, Required

- quantity: INTEGER - Quantity sold, Required, min: 1

- unit_price: DECIMAL(12,2) - Price per unit at time of sale, Required, min: 0

- line_total: DECIMAL(15,2) - Line item total (quantity * unit_price), Required, min: 0

- gst_rate: DECIMAL(5,2) - GST rate percentage, Required, Default: 0, min: 0

Relationships:

- sale_id -> sales.id (Many items belong to one sale, CASCADE delete)

- product_id -> products.id (Many items reference one product, SET NULL on delete)

Indexes:

- sale_id

- product_id

Usage:

- Stores individual items within a sale

- Each sale can have multiple products

- Stores price at time of sale (for historical accuracy)

- Stores GST rate per item

================================================================================

8. INVENTORY_TRANSACTIONS TABLE

================================================================================

Table Name: inventory_transactions

Primary Key: id (STRING)

Fields:

- id: STRING(50) - Primary Key, UUID

- product_id: STRING(50) - Foreign Key to products.id, Required

- transaction_type: ENUM('purchase', 'sale', 'adjustment', 'return', 'transfer') - Required

- quantity: INTEGER - Transaction quantity (positive or negative), Required

- reference: STRING(255) - Reference identifier, Nullable

- related_stock_request_id: STRING(50) - Foreign Key to stock_requests.id, Nullable

  * Links transaction to stock request (for transfers)

- related_sale_id: STRING(50) - Foreign Key to sales.id, Nullable

  * Links transaction to sale (for sales)

- notes: TEXT - Optional transaction notes

- created_by: STRING(50) - Foreign Key to users.id, Nullable

- timestamp: DATE - Transaction timestamp, Default: NOW

Relationships:

- product_id -> products.id (Many transactions belong to one product, CASCADE delete)

- related_stock_request_id -> stock_requests.id (Optional, SET NULL on delete)

- related_sale_id -> sales.id (Optional, SET NULL on delete)

- created_by -> users.id (Many transactions created by one user, SET NULL on delete)

Indexes:

- product_id

- transaction_type

- related_stock_request_id

- related_sale_id

- timestamp

- reference

Usage:

- Audit trail of all inventory movements

- Tracks stock transfers (super-admin to admin, admin to agent)

- Tracks sales (reduces inventory)

- Tracks purchases and adjustments

- Tracks returns (increases inventory)

================================================================================

9. ADMIN_INVENTORY TABLE

================================================================================

Table Name: admin_inventory

Primary Key: id (STRING)

Fields:

- id: STRING(50) - Primary Key, UUID

- admin_id: STRING(50) - Foreign Key to users.id, Required

  * ID of admin user

- product_id: STRING(50) - Foreign Key to products.id, Required

- quantity: INTEGER - Stock quantity for this admin, Required, Default: 0, min: 0

- created_at: DATE - Auto-generated timestamp

- updated_at: DATE - Auto-generated timestamp

Relationships:

- admin_id -> users.id (Many inventory records belong to one admin, CASCADE delete)

- product_id -> products.id (Many inventory records reference one product, CASCADE delete)

Indexes:

- admin_id

- product_id

- Unique constraint: (admin_id, product_id) - One record per admin-product combination

Usage:

- Stores distributed stock allocated to each admin

- Used to calculate distributed_stock in products table

- Updated when stock is transferred to admin

- Used to track admin inventory levels

================================================================================

10. STOCK_RETURNS TABLE

================================================================================

Table Name: stock_returns

Primary Key: id (STRING)

Fields:

- id: STRING(50) - Primary Key, UUID

- admin_id: STRING(50) - Foreign Key to users.id, Required

  * ID of admin returning stock (for agent returns) or admin returning to super-admin

- product_id: STRING(50) - Foreign Key to products.id, Required

- quantity: INTEGER - Quantity to return, Required, min: 1

- return_date: DATE - Return request date, Default: NOW

- reason: TEXT - Reason for return, Nullable

- status: ENUM('pending', 'completed') - Default: 'pending'

- processed_by: STRING(50) - Foreign Key to users.id, Nullable

- processed_date: DATE - Timestamp when processed, Nullable

- notes: TEXT - Optional notes

Relationships:

- admin_id -> users.id (Many returns belong to one admin, CASCADE delete)

- product_id -> products.id (Many returns reference one product, CASCADE delete)

- processed_by -> users.id (Many returns processed by one user, SET NULL on delete)

Indexes:

- admin_id

- product_id

- status

- return_date

Usage:

- Stores stock return requests from agents to admins

- Stores stock return requests from admins to super-admin

- Tracks return status (pending/completed)

- When processed, creates inventory_transaction to increase stock

================================================================================

PART 3: API TO TABLE MAPPING

================================================================================

Authentication APIs:

- /api/auth/login -> users table

- /api/auth/me -> users table

Users APIs:

- /api/users -> users table

- /api/users/:id -> users table

- POST /api/users -> users table

- PUT /api/users/:id -> users table

- DELETE /api/users/:id -> users table

Products APIs:

- /api/products -> products table

- /api/products/:id -> products table

- POST /api/products -> products table

- PUT /api/products/:id -> products table

- DELETE /api/products/:id -> products table

- /api/products/inventory/levels -> products table (calculated fields)

Categories APIs:

- /api/categories -> products table (derived from category field)

- /api/categories/:label -> products table (derived from category field)

Stock Requests APIs:

- /api/stock-requests -> stock_requests, stock_request_items tables

- /api/stock-requests/:id -> stock_requests, stock_request_items tables

- POST /api/stock-requests -> stock_requests, stock_request_items tables

- POST /api/stock-requests/:id/dispatch -> stock_requests, inventory_transactions tables

- POST /api/stock-requests/:id/confirm -> stock_requests, inventory_transactions tables

- PUT /api/stock-requests/:id -> stock_requests, stock_request_items tables

- DELETE /api/stock-requests/:id -> stock_requests, stock_request_items tables

Sales APIs:

- /api/sales -> sales, sale_items, addresses tables

- /api/sales/summary -> sales, sale_items tables (aggregated)

- /api/sales/:id -> sales, sale_items, addresses tables

- POST /api/sales -> sales, sale_items, addresses, inventory_transactions tables

- POST /api/sales/:id/confirm-bill -> sales table

- PUT /api/sales/:id -> sales, sale_items tables

- DELETE /api/sales/:id -> sales, sale_items tables

Inventory Transactions APIs:

- /api/inventory-transactions -> inventory_transactions table

- /api/inventory-transactions/:id -> inventory_transactions table

- POST /api/inventory-transactions -> inventory_transactions table

Admin Inventory APIs:

- /api/admin-inventory -> admin_inventory table

- /api/admin-inventory/admin/:adminId -> admin_inventory table

- POST /api/admin-inventory -> admin_inventory table

- PUT /api/admin-inventory/:id -> admin_inventory table

- DELETE /api/admin-inventory/:id -> admin_inventory table

Stock Returns APIs:

- /api/stock-returns -> stock_returns table

- /api/stock-returns/:id -> stock_returns table

- POST /api/stock-returns -> stock_returns table

- POST /api/stock-returns/:id/process -> stock_returns, inventory_transactions tables

- PUT /api/stock-returns/:id -> stock_returns table

- DELETE /api/stock-returns/:id -> stock_returns table

================================================================================

PART 4: KEY RELATIONSHIPS

================================================================================

User Hierarchy:

users.created_by_id -> users.id (Admin creates Agent)

users.admin_id -> users.id (Alternative admin-agent link)

Stock Flow:

stock_requests.requested_by_id -> users.id (Who requested)

stock_requests.requested_from -> users.id or "super-admin" (Source)

stock_requests.dispatched_by_id -> users.id (Who dispatched)

stock_requests.confirmed_by_id -> users.id (Who confirmed)

stock_request_items.stock_request_id -> stock_requests.id (Request items)

stock_request_items.product_id -> products.id (Product in request)

Sales Flow:

sales.created_by -> users.id (Who created sale)

sales.billing_address_id -> addresses.id (Billing address)

sales.delivery_address_id -> addresses.id (Delivery address)

sales.bill_confirmed_by_id -> users.id (Who confirmed bill)

sale_items.sale_id -> sales.id (Sale items)

sale_items.product_id -> products.id (Product in sale)

Inventory Management:

admin_inventory.admin_id -> users.id (Admin inventory)

admin_inventory.product_id -> products.id (Product)

inventory_transactions.product_id -> products.id (Transaction)

inventory_transactions.related_stock_request_id -> stock_requests.id (Transfer)

inventory_transactions.related_sale_id -> sales.id (Sale)

inventory_transactions.created_by -> users.id (Who created transaction)

Returns:

stock_returns.admin_id -> users.id (Who is returning)

stock_returns.product_id -> products.id (Product being returned)

stock_returns.processed_by -> users.id (Who processed return)

================================================================================

PART 5: COMMON PATTERNS AND VALIDATION

================================================================================

Authentication:

- Most endpoints require JWT authentication

- Include token in header: Authorization: Bearer <token>

- Token obtained from: POST /api/auth/login

- On 401 errors, token is cleared and user redirected to login

Address Validation:

- All address fields (except line2) are required

- Line2 is optional

- Address objects are created automatically when sent in requests

- Addresses referenced by ID in database (billing_address_id, delivery_address_id)

File Upload Rules:

- Maximum file size: 5MB (configurable via MAX_FILE_SIZE in .env)

- Allowed types: JPEG, JPG, PNG, GIF, PDF

- Use multipart/form-data content type

- Files accessible at: http://localhost:3000/uploads/<filename>

Price Fields:

- Only visible to agents in modals

- Required for agents when creating products/sales

- Hidden from super-admin and admin dashboards and product modals

- Stored as unit_price in database

Role-Based Access:

- Super-Admin: Full access except price visibility

- Admin: Can manage stock requests, sales, cannot see prices

- Agent: Can create sales, stock requests, set prices

- Account: Can view and approve/reject agents (via users API)

Status Flows:

Stock Requests:

pending -> dispatched -> confirmed

pending -> rejected

Sales:

payment_status: pending -> completed

B2B bills: Can be confirmed by account role (bill_confirmed_date)

Stock Returns:

status: pending -> completed (processed by super-admin)

Error Handling:

- All modals handle API errors gracefully

- Error messages displayed to user

- Loading states during API calls

- Form validation before API submission

- Error responses: { error: "Error message here" }

Common Status Codes:

- 200 - Success

- 201 - Created

- 400 - Bad Request

- 401 - Unauthorized (token invalid/expired)

- 403 - Forbidden (insufficient permissions)

- 404 - Not Found

- 500 - Internal Server Error

================================================================================

PART 6: DATA FLOW EXAMPLES

================================================================================

1. Agent Creates Sale:

   a. Fill Sales Modal (B2B/B2C fields + items)

   b. POST /api/sales with address objects

   c. Backend creates Address records

   d. Backend creates Sale and SaleItem records

   e. Backend creates InventoryTransaction (type: 'sale')

   f. Backend reduces inventory (admin_inventory or products.quantity)

2. Agent Creates Stock Request:

   a. Fill Agent Stock Request Modal (items)

   b. POST /api/stock-requests with requested_from: "admin"

   c. Backend creates StockRequest and StockRequestItem records

   d. Status: 'pending'

3. Admin/Super-Admin Approves Request:

   a. View request in dashboard

   b. POST /api/stock-requests/:id/dispatch with dispatch_image

   c. Backend updates status to 'dispatched'

   d. Backend updates requested_from to actual admin ID (if was "admin")

   e. Backend creates InventoryTransaction (type: 'transfer')

   f. Backend updates AdminInventory or products.quantity

4. Agent Confirms Receipt:

   a. View dispatched request

   b. POST /api/stock-requests/:id/confirm with confirmation_image

   c. Backend updates status to 'confirmed'

5. Account Approves Agent:

   a. View agents in Account Dashboard

   b. PUT /api/users/:id { is_active: true }

   c. Backend updates user.is_active = true

6. Admin Creates Stock Request from Super-Admin:

   a. Fill Admin Stock Request Modal

   b. POST /api/stock-requests with requested_from: "super-admin"

   c. Backend creates StockRequest and StockRequestItem records

   d. Status: 'pending'

7. Super-Admin Dispatches to Admin:

   a. View request in dashboard

   b. POST /api/stock-requests/:id/dispatch

   c. Backend reduces products.quantity (central stock)

   d. Backend increases admin_inventory.quantity

   e. Backend creates InventoryTransaction (type: 'transfer')

8. Admin Transfers to Another Admin:

   a. Fill Admin Stock Request Modal (admin-transfer type)

   b. POST /api/stock-requests with requested_from: <admin_id>

   c. Backend creates StockRequest and StockRequestItem records

   d. Status: 'pending'

   e. Source admin dispatches: reduces their admin_inventory

   f. Destination admin receives: increases their admin_inventory

================================================================================

END OF DOCUMENTATION

================================================================================