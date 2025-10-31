/**
 * Load Testing Script for Claiming System
 * Simulates multiple concurrent users claiming simultaneously
 * 
 * Usage: npx ts-node scripts/loadTest.ts
 */

import axios from 'axios';

// Configuration
const API_BASE_URL = process.env.API_URL || 'http://localhost:3001/api';
const NUM_CONCURRENT_USERS = 10;
const CLAIMS_PER_USER = 1; // Changed to 1 - rate limiter prevents 2 claims per 10s

// Test data - Use the same wallet that has vesting pools
// In production, you'd have multiple wallets with vesting pools
const TEST_WALLETS = [
  'Fp9YvoRdncSMePnUFVmubM1eQdikazQ2zFgrork2iifu', // Has vesting pools
  'Fp9YvoRdncSMePnUFVmubM1eQdikazQ2zFgrork2iifu', // Same wallet (demonstrates rate limiting)
  'Fp9YvoRdncSMePnUFVmubM1eQdikazQ2zFgrork2iifu',
  'Fp9YvoRdncSMePnUFVmubM1eQdikazQ2zFgrork2iifu',
  'Fp9YvoRdncSMePnUFVmubM1eQdikazQ2zFgrork2iifu',
  'Fp9YvoRdncSMePnUFVmubM1eQdikazQ2zFgrork2iifu',
  'Fp9YvoRdncSMePnUFVmubM1eQdikazQ2zFgrork2iifu',
  'Fp9YvoRdncSMePnUFVmubM1eQdikazQ2zFgrork2iifu',
  'Fp9YvoRdncSMePnUFVmubM1eQdikazQ2zFgrork2iifu',
  'Fp9YvoRdncSMePnUFVmubM1eQdikazQ2zFgrork2iifu',
];

interface TestResult {
  userId: string;
  claimId: number;
  endpoint: string;
  status: number;
  latency: number;
  success: boolean;
  error?: string;
}

interface TestStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p95Latency: number;
  p99Latency: number;
  rateLimitErrors: number;
  duplicateErrors: number;
  otherErrors: number;
}

class LoadTester {
  private results: TestResult[] = [];
  private startTime: number = 0;

  /**
   * Simulate a single claim request
   */
  async simulateClaim(userId: string, claimId: number): Promise<TestResult> {
    const wallet = TEST_WALLETS[Math.floor(Math.random() * TEST_WALLETS.length)];
    const amount = Math.random() * 50 + 10; // Random amount between 10-60

    try {
      // Step 1: Prepare claim
      const startTime = Date.now();
      const prepareResponse = await axios.post(`${API_BASE_URL}/user/vesting/claim`, {
        userWallet: wallet,
        amountToClaim: amount,
      });
      const prepareLatency = Date.now() - startTime;

      if (prepareResponse.status !== 200) {
        return {
          userId,
          claimId,
          endpoint: '/user/vesting/claim',
          status: prepareResponse.status,
          latency: prepareLatency,
          success: false,
          error: `Unexpected status: ${prepareResponse.status}`,
        };
      }

      console.log(`✓ User ${userId} Claim ${claimId}: Prepare successful (${prepareLatency}ms)`);

      return {
        userId,
        claimId,
        endpoint: '/user/vesting/claim',
        status: prepareResponse.status,
        latency: prepareLatency,
        success: true,
      };
    } catch (error: any) {
      const latency = Date.now() - this.startTime;
      const status = error.response?.status || 0;
      const errorMsg = error.response?.data?.error || error.message;

      console.log(`✗ User ${userId} Claim ${claimId}: ${errorMsg} (Status: ${status})`);

      return {
        userId,
        claimId,
        endpoint: '/user/vesting/claim',
        status,
        latency,
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Run concurrent claims for a single user
   */
  async runUserClaims(userId: string): Promise<void> {
    const claims: Promise<TestResult>[] = [];
    for (let i = 1; i <= CLAIMS_PER_USER; i++) {
      claims.push(this.simulateClaim(userId, i));
    }
    const results = await Promise.all(claims);
    this.results.push(...results);
  }

  /**
   * Run load test with multiple concurrent users
   */
  async runLoadTest(): Promise<void> {
    console.log(`\n🚀 Starting Load Test`);
    console.log(`📊 Configuration:`);
    console.log(`   - Concurrent Users: ${NUM_CONCURRENT_USERS}`);
    console.log(`   - Claims per User: ${CLAIMS_PER_USER}`);
    console.log(`   - Total Requests: ${NUM_CONCURRENT_USERS * CLAIMS_PER_USER}`);
    console.log(`   - API Base URL: ${API_BASE_URL}\n`);

    this.startTime = Date.now();

    // Create user tasks
    const userTasks: Promise<void>[] = [];
    for (let i = 1; i <= NUM_CONCURRENT_USERS; i++) {
      userTasks.push(this.runUserClaims(`User-${i}`));
    }

    // Run all users concurrently
    await Promise.all(userTasks);

    const totalTime = Date.now() - this.startTime;
    console.log(`\n✅ Load test completed in ${totalTime}ms\n`);

    this.printResults();
  }

  /**
   * Calculate statistics from results
   */
  private calculateStats(): TestStats {
    const latencies = this.results.map(r => r.latency).sort((a, b) => a - b);
    const successful = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success).length;

    const rateLimitErrors = this.results.filter(r => r.status === 429).length;
    const duplicateErrors = this.results.filter(r => r.error?.includes('duplicate')).length;
    const otherErrors = failed - rateLimitErrors - duplicateErrors;

    return {
      totalRequests: this.results.length,
      successfulRequests: successful,
      failedRequests: failed,
      avgLatency: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      minLatency: Math.min(...latencies),
      maxLatency: Math.max(...latencies),
      p95Latency: latencies[Math.floor(latencies.length * 0.95)],
      p99Latency: latencies[Math.floor(latencies.length * 0.99)],
      rateLimitErrors,
      duplicateErrors,
      otherErrors,
    };
  }

  /**
   * Print test results
   */
  private printResults(): void {
    const stats = this.calculateStats();

    console.log(`📈 Test Results:`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Total Requests:        ${stats.totalRequests}`);
    console.log(`Successful:            ${stats.successfulRequests} (${((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1)}%)`);
    console.log(`Failed:                ${stats.failedRequests} (${((stats.failedRequests / stats.totalRequests) * 100).toFixed(1)}%)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Latency (ms):`);
    console.log(`  Min:                 ${stats.minLatency}ms`);
    console.log(`  Avg:                 ${stats.avgLatency}ms`);
    console.log(`  P95:                 ${stats.p95Latency}ms`);
    console.log(`  P99:                 ${stats.p99Latency}ms`);
    console.log(`  Max:                 ${stats.maxLatency}ms`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Error Breakdown:`);
    console.log(`  Rate Limit (429):    ${stats.rateLimitErrors}`);
    console.log(`  Duplicate Errors:    ${stats.duplicateErrors}`);
    console.log(`  Other Errors:        ${stats.otherErrors}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Print detailed results
    console.log(`📋 Detailed Results:`);
    this.results.forEach(result => {
      const status = result.success ? '✓' : '✗';
      const error = result.error ? ` - ${result.error}` : '';
      console.log(`${status} ${result.userId} Claim ${result.claimId}: ${result.latency}ms (${result.status})${error}`);
    });
  }
}

// Run the load test
const tester = new LoadTester();
tester.runLoadTest().catch(err => {
  console.error('Load test failed:', err);
  process.exit(1);
});
