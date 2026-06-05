import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import logger from '../config/logger';

/** e.g. ['phases', 1, 'paymentMode'] -> phases[1].paymentMode */
const formatZodPath = (path: readonly PropertyKey[]): string => {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else if (typeof segment === 'string') {
      out += out === '' ? segment : `.${segment}`;
    } else {
      out += out === '' ? String(segment) : `.${String(segment)}`;
    }
  }
  return out;
};

export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Log incoming request for debugging
      logger.debug('Validation request', {
        path: req.path,
        method: req.method,
        body: req.body
      });

      // Parse and transform the body, then update req.body with transformed values
      const parsed = schema.parse(req.body);
      req.body = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((err) => {
          const path = formatZodPath(err.path);
          return {
            path,
            field: path,
            message: err.message
          };
        });

        const primaryMessage =
          details[0]?.message || 'Request validation failed';

        // Log validation errors for debugging
        logger.warn('Validation failed', {
          path: req.path,
          method: req.method,
          errors: details,
          body: req.body
        });

        res.status(400).json({
          success: false,
          error: {
            code: 'VAL_001',
            message: primaryMessage,
            details
          }
        });
        return;
      }
      
      logger.error('Validation error (non-Zod)', {
        path: req.path,
        method: req.method,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(400).json({
        success: false,
        error: {
          code: 'VAL_001',
          message: 'Invalid request data'
        }
      });
    }
  };
};

