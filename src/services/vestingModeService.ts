import { SupabaseService } from './supabaseService';
import { VestingMode } from '../types';

/**
 * Vesting Mode Service
 * Manages switching between snapshot and dynamic vesting modes
 */
export class VestingModeService {
  constructor(private dbService: SupabaseService) {}

  /**
   * Get current vesting mode
   */
  async getCurrentMode(): Promise<VestingMode> {
    const config = await this.dbService.getConfig();
    return (config?.vesting_mode as VestingMode) || VestingMode.SNAPSHOT;
  }

  /**
   * Set vesting mode
   */
  async setMode(mode: VestingMode, adminWallet: string): Promise<void> {
    const { error } = await this.dbService.supabase
      .from('config')
      .update({ vesting_mode: mode })
      .eq('id', 1);

    if (error) throw error;

    await this.dbService.logAdminAction({
      action: 'change_vesting_mode',
      admin_wallet: adminWallet,
      details: { new_mode: mode },
    });

    console.log(`✅ Vesting mode changed to: ${mode}`);
  }

  /**
   * Check if mode switching is allowed
   */
  async canSwitchMode(): Promise<boolean> {
    const config = await this.dbService.getConfig();
    return config?.allow_mode_switch ?? true;
  }

  /**
   * Get mode configuration details
   */
  async getModeConfig() {
    const config = await this.dbService.getConfig();
    return {
      currentMode: (config?.vesting_mode as VestingMode) || VestingMode.SNAPSHOT,
      snapshotDate: config?.snapshot_date,
      allowModeSwitch: config?.allow_mode_switch ?? true,
      gracePeriodDays: config?.grace_period_days ?? 30,
      requireNFTOnClaim: config?.require_nft_on_claim ?? true,
    };
  }

  /**
   * Update snapshot date
   */
  async updateSnapshotDate(date: Date): Promise<void> {
    const { error } = await this.dbService.supabase
      .from('config')
      .update({ snapshot_date: date.toISOString() })
      .eq('id', 1);

    if (error) throw error;
  }
}
