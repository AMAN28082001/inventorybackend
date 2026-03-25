import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import logger from './config/logger';
import { attachRealtimeServer, emitRealtime, realtimeEvents } from './utils/realtime';

dotenv.config();

// Import route (Inventory System)
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import categoryRoutes from './routes/categoryRoutes';
import productRoutes from './routes/productRoutes';
import adminInventoryRoutes from './routes/adminInventoryRoutes';
import stockRequestRoutes from './routes/stockRequestRoutes';
import salesRoutes from './routes/salesRoutes';
import inventoryTransactionRoutes from './routes/inventoryTransactionRoutes';
import stockReturnRoutes from './routes/stockReturnRoutes';
import serialNumberRoutes from './routes/serialNumberRoutes';

// Import routes (Quotation System)
import quotationAuthRoutes from './routes/quotationAuthRoutes';
import dealerRoutes from './routes/dealerRoutes';
import customerRoutes from './routes/customerRoutes';
import quotationRoutes from './routes/quotationRoutes';
import visitRoutes from './routes/visitRoutes';
import visitorRoutes from './routes/visitorRoutes';
import adminRoutes from './routes/adminRoutes';
import configRoutes from './routes/configRoutes';
import accountManagerRoutes from './routes/accountManagerRoutes';
import accountManagementRoutes from './routes/accountManagementRoutes';
import dealerRequestRoutes from './routes/dealerRequestRoutes';
import installerRoutes from './routes/installerRoutes';
import baldevRoutes from './routes/baldevRoutes';
import hrLeadRoutes from './routes/hrLeadRoutes';

const app: Application = express();
const PORT = process.env.PORT || 3000;
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const getApiDomain = (requestPath: string): string => {
  const cleanPath = requestPath.split('?')[0];
  if (!cleanPath.startsWith('/api/')) return 'system';
  const segments = cleanPath.replace(/^\/api\//, '').split('/').filter(Boolean);
  return segments[0] || 'system';
};

const getActor = (req: Request): { id?: string; role?: string; username?: string } => {
  const actor = (req as any).user || (req as any).dealer || (req as any).visitor;
  if (!actor) return {};
  return {
    id: actor.id,
    role: actor.role,
    username: actor.username
  };
};

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3050', 'http://localhost:3001', 'http://43.204.133.228:3051', 'http://43.204.133.228:3050', 'http://localhost:3002', 'http://localhost:3003','http://quotation.chairbordsolar.com', 'http://api.inventory.chairbordsolar.com', 'https://api.inventory.chairbordsolar.com', 'https://inventory.chairbordsolar.com', 'http://43.204.133.228:3052','https://quotation.chairbordsolar.com','http://192.168.1.25:3000','http://192.0.0.2:3000', 'http://192.168.1.47:3000'];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
// Increase body parser limits to handle larger payloads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Chairbord Solar Inventory API Documentation'
}));

// Swagger JSON endpoint (for API collection tools like Postman, Insomnia)
app.get('/api-docs.json', (_: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Health check route
app.get('/health', (_: Request, res: Response) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Global request instrumentation + backend-wide websocket mutation stream
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestPath = req.originalUrl || req.url;
  const domain = getApiDomain(requestPath);

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: requestPath,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    if (!MUTATION_METHODS.has(req.method)) return;
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    if (!requestPath.startsWith('/api/')) return;

    const payload = {
      method: req.method,
      path: requestPath,
      domain,
      statusCode: res.statusCode,
      timestamp: new Date().toISOString(),
      actor: getActor(req)
    };

    emitRealtime(realtimeEvents.backendMutation, payload, 'stream:backend');
    emitRealtime(realtimeEvents.backendMutation, payload, `stream:${domain}`);
  });

  next();
});

// API Routes (Inventory System) - Separate login endpoint
app.use('/api/inventory-auth', authRoutes); // /api/inventory-auth/login for Inventory System (legacy, also works via /api/auth/login)

// API Routes (Quotation System) - Universal login endpoint
app.use('/api/auth', quotationAuthRoutes); // /api/auth/login works for BOTH systems (checks dealers/visitors first, then users)
app.use('/api/dealers', dealerRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/visitors', visitorRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/account-managers', accountManagerRoutes);
app.use('/api/account-management', accountManagementRoutes);
app.use('/api/config', configRoutes);
app.use('/api/dealer-requests', dealerRequestRoutes);
app.use('/api/installer', installerRoutes);
app.use('/api/baldev', baldevRoutes);
app.use('/api/hr', hrLeadRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/admin-inventory', adminInventoryRoutes);
app.use('/api/stock-requests', stockRequestRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/inventory-transactions', inventoryTransactionRoutes);
app.use('/api/stock-returns', stockReturnRoutes);
app.use('/api/serial-numbers', serialNumberRoutes);

// 404 handler
app.use((_: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  const status = (err as any).status || 500;
  const errorMessage = err.message || 'Internal server error';
  
  // Handle payload too large error specifically
  if (status === 413 || errorMessage.includes('request entity too large') || errorMessage.includes('PayloadTooLargeError')) {
    logger.error('Request payload too large', {
      error: errorMessage,
      status: 413
    });
    
    res.status(413).json({
      success: false,
      error: {
        code: 'VAL_003',
        message: 'Request payload too large. Maximum size is 50MB.'
      }
    });
    return;
  }

  logger.error('Unhandled error', {
    error: errorMessage,
    stack: err.stack,
    status
  });

  res.status(status).json({
    success: false,
    error: {
      code: status === 500 ? 'SYS_001' : 'ERR_001',
      message: errorMessage
    }
  });
});

// Start HTTP + WebSocket server
const httpServer = attachRealtimeServer(app, allowedOrigins);
httpServer.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    apiBaseUrl: `http://localhost:${PORT}/api`,
    swaggerUrl: `http://localhost:${PORT}/api-docs`,
    websocketPath: `http://localhost:${PORT}/socket.io`
  });

  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
  console.log(`📚 Swagger UI: http://localhost:${PORT}/api-docs`);
});

export default app;

