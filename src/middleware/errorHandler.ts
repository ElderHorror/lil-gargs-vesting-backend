/**
 * Comprehensive error handling middleware for Express
 */

import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  statusCode?: number;
  retryable?: boolean;
  context?: Record<string, any>;
}

export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  statusCode: number;
  retryable: boolean;
  timestamp: string;
  requestId?: string;
  details?: Record<string, any>;
}

/**
 * Custom error class
 */
export class AppError extends Error implements ApiError {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
    public retryable: boolean = false,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Specific error classes
 */
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 400, 'VALIDATION_ERROR', false, context);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 404, 'NOT_FOUND', false, context);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', context?: Record<string, any>) {
    super(message, 401, 'UNAUTHORIZED', false, context);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', context?: Record<string, any>) {
    super(message, 403, 'FORBIDDEN', false, context);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 409, 'CONFLICT', false, context);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests', context?: Record<string, any>) {
    super(message, 429, 'RATE_LIMIT', true, context);
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends AppError {
  constructor(message: string = 'Request timeout', context?: Record<string, any>) {
    super(message, 504, 'TIMEOUT', true, context);
    this.name = 'TimeoutError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service unavailable', context?: Record<string, any>) {
    super(message, 503, 'SERVICE_UNAVAILABLE', true, context);
    this.name = 'ServiceUnavailableError';
  }
}

/**
 * Error handler middleware
 */
export function errorHandler(
  err: Error | ApiError,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = (req as any).id || 'unknown';

  // Log error
  console.error('[ERROR]', {
    requestId,
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
    context: (err as ApiError).context,
  });

  // Determine response
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let retryable = false;
  let details: Record<string, any> | undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    retryable = err.retryable;
    details = err.context;
  } else if (err instanceof SyntaxError) {
    statusCode = 400;
    code = 'INVALID_JSON';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    code = 'INVALID_ID';
  }

  const response: ErrorResponse = {
    success: false,
    error: err.message,
    code,
    statusCode,
    retryable,
    timestamp: new Date().toISOString(),
    requestId,
    ...(details && { details }),
  };

  res.status(statusCode).json(response);
}

/**
 * Async error wrapper for route handlers
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Request validation wrapper
 */
export function validateRequest(schema: any) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const { error, value } = schema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        const details = error.details.reduce((acc: any, err: any) => {
          acc[err.path.join('.')] = err.message;
          return acc;
        }, {});

        throw new ValidationError('Validation failed', details);
      }

      req.body = value;
      next();
    } catch (err) {
      next(err);
    }
  };
}
