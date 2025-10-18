import express from 'express';
import { SnapshotController } from './snapshotController';
import { PoolController } from './poolController';
import { ConfigController } from './configController';
import { ClaimsController } from './claimsController';
import { MetricsController } from './metricsController';
import { StreamController } from './streamController';
import { UserVestingController } from './userVestingController';
import { TreasuryController } from './treasuryController';
import { AdminLogsController } from './adminLogsController';
import { CronController } from './cronController';

const router = express.Router();
const snapshotController = new SnapshotController();
const poolController = new PoolController();
const configController = new ConfigController();
const claimsController = new ClaimsController();
const metricsController = new MetricsController();
const streamController = new StreamController();
const userVestingController = new UserVestingController();
const treasuryController = new TreasuryController();
const adminLogsController = new AdminLogsController();
const cronController = new CronController();

// ============================================================================
// ADMIN ROUTES - Protected by frontend page-level auth
// ============================================================================

// Snapshot endpoints
router.post('/snapshot/holders', (req, res) => snapshotController.getHolders(req, res));
router.post('/snapshot/collection-stats', (req, res) => snapshotController.getCollectionStats(req, res));
router.post('/snapshot/preview-rule', (req, res) => snapshotController.previewRule(req, res));
router.post('/snapshot/calculate-summary', (req, res) => snapshotController.calculateSummary(req, res));
router.post('/snapshot/process', (req, res) => snapshotController.processSnapshot(req, res));
router.post('/snapshot/commit', (req, res) => snapshotController.commitSnapshot(req, res));

// Pool endpoints
router.post('/pools', (req, res) => poolController.createPool(req, res));
router.get('/pools', (req, res) => poolController.listPools(req, res));
router.get('/pools/:id', (req, res) => poolController.getPoolDetails(req, res));
router.delete('/pools/:id', (req, res) => poolController.cancelPool(req, res));
router.put('/pools/:id/rules', (req, res) => poolController.updatePoolRule(req, res));
router.post('/pools/:id/rules', (req, res) => poolController.addRule(req, res));
router.post('/pools/:id/sync', (req, res) => poolController.syncPool(req, res));
router.get('/pools/:id/streamflow-status', (req, res) => poolController.getStreamflowStatus(req, res));
router.post('/pools/:id/deploy-streamflow', (req, res) => poolController.deployToStreamflow(req, res));
router.post('/pools/:id/topup', (req, res) => poolController.topupPool(req, res));
router.get('/pools/:id/activity', (req, res) => poolController.getPoolActivity(req, res));
router.get('/pools/:id/users/:wallet', (req, res) => poolController.getUserStatus(req, res));

// Config endpoints
router.get('/config', (req, res) => configController.getConfig(req, res));
router.put('/config', (req, res) => configController.updateConfig(req, res));
router.get('/config/mode', (req, res) => configController.getMode(req, res));

// Price endpoints
router.get('/price/sol', async (req, res) => {
  try {
    const { PriceService } = await import('../services/priceService');
    const { getConnection } = await import('../config');
    const connection = getConnection();
    const priceService = new PriceService(connection, 'devnet');
    const solPrice = await priceService.getSolPrice();
    
    res.json({
      success: true,
      data: {
        price: solPrice,
        currency: 'USD',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch price',
    });
  }
});
router.put('/config/mode', (req, res) => configController.switchMode(req, res));
router.get('/config/claim-policy', (req, res) => configController.getClaimPolicy(req, res));
router.put('/config/claim-policy', (req, res) => configController.updateClaimPolicy(req, res));
router.get('/integrations/status', (req, res) => configController.getIntegrationStatus(req, res));

// Claims endpoints
router.get('/claims', (req, res) => claimsController.listClaims(req, res));
router.get('/claims/stats', (req, res) => claimsController.getClaimStats(req, res));
router.get('/claims/:id', (req, res) => claimsController.getClaimDetails(req, res));
router.post('/claims/:id/flag', (req, res) => claimsController.flagClaim(req, res));
router.get('/claims/wallet/:wallet', (req, res) => claimsController.getWalletClaims(req, res));

// Metrics endpoints
router.get('/metrics/dashboard', (req, res) => metricsController.getDashboardMetrics(req, res));
router.get('/metrics/pool-balance', (req, res) => metricsController.getPoolBalanceEndpoint(req, res));
router.get('/metrics/eligible-wallets', (req, res) => metricsController.getEligibleWalletsEndpoint(req, res));
router.get('/metrics/activity-log', (req, res) => metricsController.getActivityLog(req, res));

// Stream management endpoints
router.post('/streams/pause-all', (req, res) => streamController.pauseAllStreams(req, res));
router.post('/streams/emergency-stop', (req, res) => streamController.emergencyStopAllStreams(req, res));
router.post('/streams/resume-all', (req, res) => streamController.resumeAllStreams(req, res));

// Treasury endpoints
router.get('/treasury/status', (req, res) => treasuryController.getTreasuryStatus(req, res));
router.get('/treasury/pools', (req, res) => treasuryController.getPoolBreakdown(req, res));

// Admin logs endpoints
router.get('/admin-logs', (req, res) => adminLogsController.getAdminLogs(req, res));
router.post('/admin-logs', (req, res) => adminLogsController.createAdminLog(req, res));

// ============================================================================
// PUBLIC ROUTES - No authentication required
// ============================================================================

// Admin check endpoint (public, just checks if wallet is admin)
router.get('/config/check-admin', (req, res) => configController.checkAdmin(req, res));

// User vesting endpoints
router.get('/user/vesting/list', (req, res) => userVestingController.listUserVestings(req, res));
router.get('/user/vesting/summary', (req, res) => userVestingController.getVestingSummary(req, res));
router.post('/user/vesting/claim', (req, res) => userVestingController.claimVesting(req, res));
router.post('/user/vesting/complete-claim', (req, res) => userVestingController.completeClaimWithFee(req, res));
router.get('/user/vesting/claim-history', (req, res) => userVestingController.getClaimHistory(req, res));

// ============================================================================
// CRON ROUTES - For external cron services (secured with CRON_SECRET)
// ============================================================================
router.get('/cron/health', (req, res) => cronController.healthCheck(req, res));
router.post('/cron/snapshot', (req, res) => cronController.triggerSnapshotCheck(req, res));
router.post('/cron/sync-dynamic', (req, res) => cronController.triggerDynamicSync(req, res));

export default router;
