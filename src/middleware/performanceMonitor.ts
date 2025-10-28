/**
 * Performance monitoring middleware
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export interface RequestMetrics {
  id: string;
  method: string;
  path: string;
  startTime: number;
  duration: number;
  statusCode: number;
  responseSize: number;
  slow: boolean;
  timestamp: string;
}

const SLOW_REQUEST_THRESHOLD = 5000; // 5 seconds
const metrics: RequestMetrics[] = [];
const MAX_METRICS = 500;

/**
 * Request ID middleware
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  (req as any).id = uuidv4();
  res.setHeader('X-Request-ID', (req as any).id);
  next();
}

/**
 * Performance monitoring middleware
 */
export function performanceMonitor(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const requestId = (req as any).id;

  // Capture original send
  const originalSend = res.send;

  res.send = function (data: any) {
    const duration = Date.now() - startTime;
    const responseSize = typeof data === 'string' ? data.length : JSON.stringify(data).length;
    const slow = duration > SLOW_REQUEST_THRESHOLD;

    const metric: RequestMetrics = {
      id: requestId,
      method: req.method,
      path: req.path,
      startTime,
      duration,
      statusCode: res.statusCode,
      responseSize,
      slow,
      timestamp: new Date().toISOString(),
    };

    recordMetric(metric);

    if (slow) {
      console.warn('[SLOW REQUEST]', {
        requestId,
        method: req.method,
        path: req.path,
        duration: `${duration}ms`,
        statusCode: res.statusCode,
      });
    } else {
      console.log('[REQUEST]', {
        requestId,
        method: req.method,
        path: req.path,
        duration: `${duration}ms`,
        statusCode: res.statusCode,
      });
    }

    return originalSend.call(this, data);
  };

  next();
}

/**
 * Record metric
 */
function recordMetric(metric: RequestMetrics) {
  metrics.push(metric);
  if (metrics.length > MAX_METRICS) {
    metrics.shift();
  }
}

/**
 * Get performance metrics
 */
export function getPerformanceMetrics() {
  const slowRequests = metrics.filter((m) => m.slow);
  const avgDuration = metrics.length > 0
    ? metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length
    : 0;

  return {
    total: metrics.length,
    avgDuration: Math.round(avgDuration),
    slowRequests: slowRequests.length,
    slowThreshold: SLOW_REQUEST_THRESHOLD,
    recent: metrics.slice(-20),
    byPath: groupByPath(metrics),
  };
}

/**
 * Group metrics by path
 */
function groupByPath(metrics: RequestMetrics[]) {
  return metrics.reduce((acc: any, m) => {
    if (!acc[m.path]) {
      acc[m.path] = {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        maxDuration: 0,
        minDuration: Infinity,
        errors: 0,
      };
    }

    acc[m.path].count++;
    acc[m.path].totalDuration += m.duration;
    acc[m.path].avgDuration = Math.round(acc[m.path].totalDuration / acc[m.path].count);
    acc[m.path].maxDuration = Math.max(acc[m.path].maxDuration, m.duration);
    acc[m.path].minDuration = Math.min(acc[m.path].minDuration, m.duration);

    if (m.statusCode >= 400) {
      acc[m.path].errors++;
    }

    return acc;
  }, {});
}

/**
 * Clear metrics
 */
export function clearMetrics() {
  metrics.length = 0;
}

/**
 * Get metrics endpoint handler
 */
export function metricsHandler(req: Request, res: Response) {
  res.json({
    success: true,
    data: getPerformanceMetrics(),
  });
}
