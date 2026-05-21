import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import logger from './config/logger';

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
import reviewRoutes from './routes/reviewRoutes';

// Import routes (Quotation System)
import quotationAuthRoutes from './routes/quotationAuthRoutes';
import dealerRoutes from './routes/dealerRoutes';
import customerRoutes from './routes/customerRoutes';
import quotationRoutes from './routes/quotationRoutes';
import visitRoutes from './routes/visitRoutes';
import visitorRoutes from './routes/visitorRoutes';
import adminRoutes from './routes/adminRoutes';
import configRoutes from './routes/configRoutes';

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3050', 'http://localhost:3001', 'http://43.204.133.228:3051', 'http://43.204.133.228:3050', 'http://localhost:3002', 'http://localhost:3003','http://quotation.chairbordsolar.com'];
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
// Increase body parser limits to handle larger payloads (e.g., large quotation data, images)
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
app.use('/api/config', configRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/admin-inventory', adminInventoryRoutes);
app.use('/api/stock-requests', stockRequestRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/inventory-transactions', inventoryTransactionRoutes);
app.use('/api/stock-returns', stockReturnRoutes);
app.use('/api/reviews', reviewRoutes);

// 404 handler res
app.use((_: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });

  next();
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

// Start server
app.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    apiBaseUrl: `http://localhost:${PORT}/api`,
    swaggerUrl: `http://localhost:${PORT}/api-docs`
  });

  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
  console.log(`📚 Swagger UI: http://localhost:${PORT}/api-docs`);
});

export default app;

