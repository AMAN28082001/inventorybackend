# Frontend WebSocket Integration (Backend-wide)

This backend now supports Socket.IO for realtime updates across the full API.

## 1) Install dependency

```bash
npm install socket.io-client
```

## 2) Create socket client

Create `src/lib/realtime.ts` (or equivalent):

```ts
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const connectRealtime = (token: string) => {
  if (socket?.connected) return socket;

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL || window.location.origin;

  socket = io(baseUrl, {
    transports: ['websocket', 'polling'],
    withCredentials: true,
    auth: { token } // backend reads handshake auth token
  });

  socket.on('connect_error', (err) => {
    console.error('[realtime] connect_error:', err.message);
  });

  return socket;
};

export const getRealtime = () => socket;

export const disconnectRealtime = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
```

## 3) Subscribe to backend streams

After login (when JWT token is available):

```ts
import { connectRealtime } from '@/lib/realtime';

export const initRealtime = (token: string) => {
  const socket = connectRealtime(token);

  socket.on('connect', () => {
    // global stream
    socket.emit('realtime:subscribe', 'stream:backend');

    // module streams (choose what your page needs)
    socket.emit('realtime:subscribe', ['stream:hr', 'stream:admin', 'stream:dealers']);
  });
};
```

## 4) Events exposed by backend

### Generic (whole backend)

- `backend:mutation`
  - fired on successful `POST|PUT|PATCH|DELETE` under `/api/*`
  - payload:
    - `method`
    - `path`
    - `domain` (first segment after `/api/`, eg `hr`, `admin`, `dealers`)
    - `statusCode`
    - `timestamp`
    - `actor` (if available)

### Domain-specific

- `dealer:directory-updated`
  - fired when dealer approval/activation changes
- `calling:actions-updated`
  - fired when calling actions/upload alter calling reports
- `calling:uploads-updated`
  - fired when HR uploads lead CSV

## 5) Recommended frontend listeners

For HR Assign Leads page:

```ts
socket.on('dealer:directory-updated', () => {
  refetchHrDealers();
});
```

For Admin/HR Calling Reports page:

```ts
socket.on('calling:actions-updated', () => {
  refetchCallingActions();
});
```

For HR Uploaded Data tab:

```ts
socket.on('calling:uploads-updated', () => {
  refetchUploadBatches();
});
```

Fallback (catch all writes):

```ts
socket.on('backend:mutation', (evt) => {
  // optional safety net based on evt.domain/evt.path
  // example:
  if (evt.domain === 'hr') {
    refetchHrData();
  }
});
```

## 6) Cleanup in React components

```ts
useEffect(() => {
  const socket = getRealtime();
  if (!socket) return;

  const onDealerUpdate = () => refetchHrDealers();
  socket.on('dealer:directory-updated', onDealerUpdate);

  return () => {
    socket.off('dealer:directory-updated', onDealerUpdate);
  };
}, [refetchHrDealers]);
```

## 7) API calls to refetch

- Dealer selector: `GET /api/hr/dealers`
- Calling reports:
  - `GET /api/admin/calling-actions`
  - `GET /api/hr/calling-actions`
- Upload tab:
  - `GET /api/hr/leads/uploads`
  - `GET /api/hr/leads/uploads/:batchId`

## 8) Notes

- Backend socket endpoint is standard: `/socket.io`
- Auth token is read from `auth.token` (recommended) or `Authorization` header.
- If token changes (refresh/login), reconnect socket with the new token.
