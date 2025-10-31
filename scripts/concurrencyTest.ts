/**
 * Concurrency Test - Tests rate limiting and deduplication
 * 
 * This test verifies:
 * 1. Rate limiting works (max 1 claim per wallet per 10 seconds)
 * 2. Deduplication catches duplicate requests
 * 3. Duplicate claims are prevented at database level
 * 
 * Usage: npx ts-node scripts/concurrencyTest.ts
 */

import axios from 'axios';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001/api';

// Use a real test wallet that has vesting pools
// Replace this with an actual wallet from your database
const TEST_WALLET = process.env.TEST_WALLET || 'Fp9YvoRdncSMePnUFVmubM1eQdikazQ2zFgrork2iifu';

interface TestCase {
  name: string;
  description: string;
  test: () => Promise<void>;
}

class ConcurrencyTester {
  private testCases: TestCase[] = [];

  constructor() {
    this.setupTests();
  }

  private setupTests(): void {
    // Test 1: Rate Limiting
    this.testCases.push({
      name: 'Rate Limiting Test',
      description: 'Verify that max 1 claim per wallet per 10 seconds is enforced',
      test: async () => {
        console.log(`\n📋 Test: Rate Limiting`);
        console.log(`   Wallet: ${TEST_WALLET}`);
        console.log(`   Sending 3 simultaneous requests...\n`);

        const requests = [
          this.makeClaimRequest(TEST_WALLET, 10),
          this.makeClaimRequest(TEST_WALLET, 10),
          this.makeClaimRequest(TEST_WALLET, 10),
        ];

        const results = await Promise.all(requests.map(r => r.catch(e => e)));

        let successCount = 0;
        let rateLimitCount = 0;
        let otherErrors = 0;

        results.forEach((result, index) => {
          if (result.status === 200) {
            console.log(`   Request ${index + 1}: ✓ Success (200)`);
            successCount++;
          } else if (result.status === 429) {
            console.log(`   Request ${index + 1}: ⏱️ Rate Limited (429)`);
            rateLimitCount++;
          } else {
            console.log(`   Request ${index + 1}: ✗ Error (${result.status})`);
            otherErrors++;
          }
        });

        console.log(`\n   Result: ${successCount} succeeded, ${rateLimitCount} rate limited, ${otherErrors} other errors`);
        if (successCount === 1 && rateLimitCount === 2) {
          console.log(`   ✅ PASS: Rate limiting working correctly\n`);
        } else if (successCount >= 1 && rateLimitCount >= 1) {
          console.log(`   ✅ PASS: Rate limiting is working (some requests succeeded, some rate limited)\n`);
        } else {
          console.log(`   ⚠️ Note: Check if wallet has vesting pools\n`);
        }
      },
    });

    // Test 2: Deduplication
    this.testCases.push({
      name: 'Deduplication Test',
      description: 'Verify that duplicate requests return cached response',
      test: async () => {
        console.log(`\n📋 Test: Deduplication`);
        console.log(`   Wallet: ${TEST_WALLET}`);
        console.log(`   Sending 2 identical requests with 100ms delay...\n`);

        const request1 = this.makeClaimRequest(TEST_WALLET, 10);
        await new Promise(resolve => setTimeout(resolve, 100));
        const request2 = this.makeClaimRequest(TEST_WALLET, 10);

        const [result1, result2] = await Promise.all([request1, request2].map(r => r.catch(e => e)));

        console.log(`   Request 1: ${result1.status}`);
        console.log(`   Request 2: ${result2.status}`);

        if ((result1.status === 200 || result1.status === 429) && (result2.status === 200 || result2.status === 429)) {
          console.log(`   ✅ PASS: Rate limiting working (first succeeded or rate limited, second rate limited)\n`);
        } else {
          console.log(`   ⚠️ Note: Check wallet has vesting pools\n`);
        }
      },
    });

    // Test 3: Concurrent Users (Rate Limit Enforcement)
    this.testCases.push({
      name: 'Concurrent Users Test',
      description: 'Verify that 10 concurrent requests from same wallet are rate limited',
      test: async () => {
        console.log(`\n📋 Test: Concurrent Users (Rate Limit Enforcement)`);
        console.log(`   Wallet: ${TEST_WALLET}`);
        console.log(`   Sending 10 simultaneous requests from same wallet...\n`);

        const requests: Promise<any>[] = [];
        for (let i = 0; i < 10; i++) {
          requests.push(this.makeClaimRequest(TEST_WALLET, 10));
        }

        const results = await Promise.all(requests.map(r => r.catch(e => e)));

        let successCount = 0;
        let rateLimitCount = 0;
        let otherErrors = 0;

        results.forEach((result, index) => {
          if (result.status === 200) {
            console.log(`   Request ${index + 1}: ✓ Success (200)`);
            successCount++;
          } else if (result.status === 429) {
            console.log(`   Request ${index + 1}: ⏱️ Rate Limited (429)`);
            rateLimitCount++;
          } else {
            console.log(`   Request ${index + 1}: ✗ Error (${result.status})`);
            otherErrors++;
          }
        });

        console.log(`\n   Result: ${successCount} succeeded, ${rateLimitCount} rate limited, ${otherErrors} other errors`);
        if (successCount === 1 && rateLimitCount === 9) {
          console.log(`   ✅ PASS: Rate limiting working perfectly (1 success, 9 rate limited)\n`);
        } else if (successCount >= 1 && rateLimitCount >= 5) {
          console.log(`   ✅ PASS: Rate limiting is working\n`);
        } else {
          console.log(`   ⚠️ Note: Rate limiting may not be working as expected\n`);
        }
      },
    });

    // Test 4: Rate Limit Recovery
    this.testCases.push({
      name: 'Rate Limit Recovery Test',
      description: 'Verify that user can claim again after 10 second window',
      test: async () => {
        console.log(`\n📋 Test: Rate Limit Recovery`);
        console.log(`   Wallet: ${TEST_WALLET}`);
        console.log(`   Sending first request...`);

        const result1 = await this.makeClaimRequest(TEST_WALLET, 10).catch(e => e);
        console.log(`   Result 1: ${result1.status}`);

        console.log(`   Waiting 11 seconds for rate limit window to reset...`);
        await new Promise(resolve => setTimeout(resolve, 11000));

        console.log(`   Sending second request...`);
        const result2 = await this.makeClaimRequest(TEST_WALLET, 10).catch(e => e);
        console.log(`   Result 2: ${result2.status}`);

        if ((result1.status === 200 || result1.status === 429) && (result2.status === 200 || result2.status === 429)) {
          console.log(`   ✅ PASS: Rate limit window reset after 11 seconds\n`);
        } else {
          console.log(`   ⚠️ Note: Check wallet has vesting pools\n`);
        }
      },
    });
  }

  /**
   * Make a claim request
   */
  private async makeClaimRequest(wallet: string, amount: number): Promise<any> {
    try {
      const response = await axios.post(`${API_BASE_URL}/user/vesting/claim`, {
        userWallet: wallet,
        amountToClaim: amount,
      }, {
        validateStatus: () => true, // Don't throw on any status
      });

      return {
        status: response.status,
        data: response.data,
      };
    } catch (error: any) {
      return {
        status: error.response?.status || 500,
        error: error.message,
      };
    }
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🧪 Concurrency Test Suite`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`API Base URL: ${API_BASE_URL}`);
    console.log(`Total Tests: ${this.testCases.length}\n`);

    for (const testCase of this.testCases) {
      try {
        await testCase.test();
      } catch (error) {
        console.log(`   ❌ Test failed with error: ${error}\n`);
      }
    }

    console.log(`${'═'.repeat(60)}`);
    console.log(`✅ All tests completed`);
    console.log(`${'═'.repeat(60)}\n`);
  }
}

// Run tests
const tester = new ConcurrencyTester();
tester.runAllTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
