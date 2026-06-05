# Serial Number Status Lifecycle

## Status Flow

available -> dispatched -> acknowledged -> sold

## Notes

- Agent selects serial numbers from the admin’s dispatched/acknowledged list.
- On sale creation, backend sets status to `sold` and links `sale_id` and `sale_item_id`.
