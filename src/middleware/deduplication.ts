/**
 * Request Deduplication Middleware
 * Prevents duplicate requests from being processed multiple times
 * Useful for preventing accidental double-claims from frontend retries
 */

interface InFlightRequest {
  response: any;
  timestamp: number;
  status: 'pending' | 'completed';
}

class RequestDeduplicator {
  private inFlightRequests: Map<string, InFlightRequest> = new Map();
  private readonly TTL_MS = 60000; // 60 seconds

  /**
   * Generate a unique key for a request
   * Based on wallet + endpoint + request body
   */
  private generateKey(wallet: string, endpoint: string, body: any): string {
    const bodyStr = JSON.stringify(body || {});
    return `${wallet}:${endpoint}:${bodyStr}`;
  }

  /**
   * Check if request is already in flight
   */
  isInFlight(wallet: string, endpoint: string, body: any): boolean {
    const key = this.generateKey(wallet, endpoint, body);
    const request = this.inFlightRequests.get(key);

    if (!request) {
      return false;
    }

    // Check if expired
    if (Date.now() - request.timestamp > this.TTL_MS) {
      this.inFlightRequests.delete(key);
      return false;
    }

    return request.status === 'pending';
  }

  /**
   * Get cached response for duplicate request
   */
  getCachedResponse(wallet: string, endpoint: string, body: any): any {
    const key = this.generateKey(wallet, endpoint, body);
    const request = this.inFlightRequests.get(key);

    if (request && request.status === 'completed') {
      return request.response;
    }

    return null;
  }

  /**
   * Mark request as in-flight
   */
  markInFlight(wallet: string, endpoint: string, body: any): void {
    const key = this.generateKey(wallet, endpoint, body);
    this.inFlightRequests.set(key, {
      response: null,
      timestamp: Date.now(),
      status: 'pending',
    });
  }

  /**
   * Mark request as completed and cache response
   */
  markCompleted(wallet: string, endpoint: string, body: any, response: any): void {
    const key = this.generateKey(wallet, endpoint, body);
    this.inFlightRequests.set(key, {
      response,
      timestamp: Date.now(),
      status: 'completed',
    });
  }

  /**
   * Clear expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, request] of this.inFlightRequests.entries()) {
      if (now - request.timestamp > this.TTL_MS) {
        this.inFlightRequests.delete(key);
      }
    }
  }

  /**
   * Get cache size (for monitoring)
   */
  size(): number {
    return this.inFlightRequests.size;
  }
}

// Export singleton instance
export const deduplicator = new RequestDeduplicator();

/**
 * Express middleware for request deduplication
 * Simplified version - just logs and passes through
 * Full caching can be added later if needed
 */
export function deduplicationMiddleware(req: any, res: any, next: any) {
  const wallet = req.body?.userWallet;
  const endpoint = req.path;

  if (!wallet) {
    return next();
  }

  // Log for monitoring
  console.log(`[DEDUP] Request from ${wallet} on ${endpoint}`);

  // Always continue to next middleware/handler
  next();
}
