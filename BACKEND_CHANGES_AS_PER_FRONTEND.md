# Backend Changes As Per Frontend

## Serial Numbers Flow (Agent + Admin)

| Step | Actor | Status | Notes |
| --- | --- | --- | --- |
| Dispatch | Super Admin | dispatched | Serial numbers are dispatched to admin and linked to the stock request. |
| Confirm | Admin | acknowledged | Admin confirms receipt; serials move to acknowledged. |
| Sell | Agent | sold | Agent selects serials from dispatched/acknowledged list; backend sets status to sold and links to sale. |

## Key Behaviors

- Agent selects serial numbers only from the admin’s dispatched/acknowledged stock.
- On sale creation, backend updates those serials to `sold` and links `sale_id` and `sale_item_id`.
- Admin-scoped endpoint returns only serials mapped to that admin with status `dispatched` or `acknowledged`.
