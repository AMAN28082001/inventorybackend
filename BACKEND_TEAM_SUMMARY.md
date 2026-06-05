# Backend Team Summary

## Sales With Serial Numbers

- Agent selects serials from admin-mapped stock (status `dispatched` or `acknowledged`).
- Backend validates the serials belong to the agent’s admin and are in allowed status.
- Backend sets serials to `sold` and links `sale_id` and `sale_item_id`.
