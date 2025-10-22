// Import controllers
import { Router } from 'express';
import { PoolController } from './poolController';
import { AdminController } from './adminController';
import { UserVestingController } from './userVestingController';
import { ConfigController } from './configController';
import { AdminLogsController } from './adminLogsController';
import { ClaimsController } from './claimsController';
import { CronController } from './cronController';
import { MetricsController } from './metricsController';
import { SnapshotController } from './snapshotController';
import { StreamController } from './streamController';
import { TreasuryController } from './treasuryController';
import { requireAdmin } from '../middleware/adminAuth';

const router = Router();
const poolController = new PoolController();
const adminController = new AdminController();
const userVestingController = new UserVestingController();
const configController = new ConfigController();
const adminLogsController = new AdminLogsController();
const claimsController = new ClaimsController();
const cronController = new CronController();
const metricsController = new MetricsController();
const snapshotController = new SnapshotController();
const streamController = new StreamController();
const treasuryController = new TreasuryController();

// Pool routes
router.get('/pools', poolController.listPools.bind(poolController));
router.get('/pools/:id', poolController.getPoolDetails.bind(poolController));
router.get('/pools/:id/activity', poolController.getPoolActivity.bind(poolController));
router.get('/pools/:id/users/:wallet', poolController.getUserStatus.bind(poolController));
router.get('/pools/:id/streamflow-status', poolController.getStreamflowStatus.bind(poolController));

// Config routes
router.get('/config/check-admin', configController.checkAdmin.bind(configController));
router.get('/config/claim-policy', configController.getClaimPolicy.bind(configController));
router.put('/config/claim-policy', configController.updateClaimPolicy.bind(configController));

// User vesting routes
router.get('/user/vesting/list', userVestingController.listUserVestings.bind(userVestingController));
router.get('/user/vesting/summary', userVestingController.getVestingSummary.bind(userVestingController));
router.get('/user/vesting/history', userVestingController.getClaimHistory.bind(userVestingController));
router.post('/user/vesting/claim', userVestingController.claimVesting.bind(userVestingController));
router.post('/user/vesting/complete-claim', userVestingController.completeClaimWithFee.bind(userVestingController));

// Admin logs routes
router.get('/admin-logs', adminLogsController.getAdminLogs.bind(adminLogsController));
router.post('/admin-logs', adminLogsController.createAdminLog.bind(adminLogsController));

// Claims routes
router.get('/claims', claimsController.listClaims.bind(claimsController));
router.get('/claims/stats', claimsController.getClaimStats.bind(claimsController));
router.get('/claims/:id', claimsController.getClaimDetails.bind(claimsController));
router.post('/claims/:id/flag', claimsController.flagClaim.bind(claimsController));
router.get('/claims/wallet/:wallet', claimsController.getWalletClaims.bind(claimsController));

// Cron routes
router.post('/cron/snapshot', cronController.triggerSnapshotCheck.bind(cronController));
router.post('/cron/sync-dynamic', cronController.triggerDynamicSync.bind(cronController));
router.get('/cron/health', cronController.healthCheck.bind(cronController));

// Metrics routes
router.get('/metrics/dashboard', metricsController.getDashboardMetrics.bind(metricsController));
router.get('/metrics/pool-balance', metricsController.getPoolBalanceEndpoint.bind(metricsController));
router.get('/metrics/eligible-wallets', metricsController.getEligibleWalletsEndpoint.bind(metricsController));
router.get('/metrics/activity-log', metricsController.getActivityLog.bind(metricsController));

// Snapshot routes
router.get('/snapshot/holders', snapshotController.getHolders.bind(snapshotController));
router.post('/snapshot/collection-stats', snapshotController.getCollectionStats.bind(snapshotController));
router.post('/snapshot/preview-rule', snapshotController.previewRule.bind(snapshotController));
router.post('/snapshot/calculate-summary', snapshotController.calculateSummary.bind(snapshotController));
router.post('/snapshot/process', snapshotController.processSnapshot.bind(snapshotController));
router.post('/snapshot/commit', snapshotController.commitSnapshot.bind(snapshotController));

// Stream routes
router.post('/stream/pause-all', streamController.pauseAllStreams.bind(streamController));
router.post('/stream/emergency-stop', streamController.emergencyStopAllStreams.bind(streamController));
router.post('/stream/resume-all', streamController.resumeAllStreams.bind(streamController));

// Treasury routes
router.get('/treasury/status', treasuryController.getTreasuryStatus.bind(treasuryController));
router.get('/treasury/pools', treasuryController.getPoolBreakdown.bind(treasuryController));

// Admin routes (admin dashboard handles authentication)
router.get('/admin/pool/:poolId/members', adminController.getPoolMembers.bind(adminController));
router.patch('/admin/pool/:poolId/member/:wallet', adminController.updatePoolMember.bind(adminController));
router.patch('/admin/pool/:poolId/state', adminController.updatePoolState.bind(adminController));

export default router;