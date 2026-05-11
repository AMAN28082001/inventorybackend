import logger from '../config/logger';

/**
 * Helper function to log errors consistently across controllers
 */
export const logError = (message: string, error: unknown, context?: Record<string, any>): void => {
  const errorDetails: Record<string, any> = {
    ...context,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  };
  
  logger.error(message, errorDetails);
};

/**
 * Helper function to log info messages logs
 */
export const logInfo = (message: string, context?: Record<string, any>): void => {
  logger.info(message, context || {});
};

/**
 * Helper function to log warnings
 */
export const logWarn = (message: string, context?: Record<string, any>): void => {
  logger.warn(message, context || {});
};



