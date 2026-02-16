# Backend Changes: Cost Price, Selling Price & Serials

## Overview

| Field | When set | Who sets | Where stored |
| --- | --- | --- | --- |
| Cost price | When entering/adding product | User adding stock | `product_serial_numbers.cost_price` (per serial) |
| Selling price | In Super Admin panel | Super Admin | `products.selling_price` (per product name) |

Notes:
- Cost price = set when adding product/stock, stored per serial, internal only.
- Selling price = set by Super Admin in their panel, per product name, can vary and change independently.

## 1. Cost Price (Per Serial)

- Saved when `serial_numbers` are provided on product create/update.
- Stored as `product_serial_numbers.cost_price` for each serial.
- Not used for agent quotation amounts.

## 2. Selling Price (Per Product)

- Separate from cost price and can be changed anytime.
- Set by Super Admin per product name.
- Used for agent quotation amounts and display.

Example:
- Cost price (per serial): ₹8,500 (internal)
- Selling price (per product): ₹10,000 (used for quotations)
