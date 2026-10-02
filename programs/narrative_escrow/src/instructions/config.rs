use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::EscrowError;
use crate::program::NarrativeEscrow;
use crate::state::Config;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ConfigParams {
    pub operator: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub creator_fee_proposer_bps: u16,
    pub creator_fee_platform_bps: u16,
    pub max_pool_cap: u64,
}

impl ConfigParams {
    fn validate(&self) -> Result<()> {
        require!(self.fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
        require!(
            self.creator_fee_proposer_bps as u64 + self.creator_fee_platform_bps as u64
                <= BPS_DENOMINATOR,
            EscrowError::InvalidCreatorFeeSplit
        );
        require!(self.max_pool_cap >= MIN_POOL_MIN, EscrowError::InvalidLimits);
        Ok(())
    }

    fn apply(&self, config: &mut Config) {
        config.operator = self.operator;
        config.treasury = self.treasury;
        config.fee_bps = self.fee_bps;
        config.creator_fee_proposer_bps = self.creator_fee_proposer_bps;
        config.creator_fee_platform_bps = self.creator_fee_platform_bps;
        config.max_pool_cap = self.max_pool_cap;
    }
}

/// One-time setup. Only the program's upgrade authority may call it, so nobody can front-run
/// the deploy and install themselves as admin.
#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [SEED_CONFIG], bump)]
    pub config: Account<'info, Config>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ EscrowError::NotUpgradeAuthority
    )]
    pub program: Program<'info, NarrativeEscrow>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(admin.key())
            @ EscrowError::NotUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn process_init_config(ctx: Context<InitConfig>, params: ConfigParams) -> Result<()> {
    params.validate()?;
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.bump = ctx.bumps.config;
    params.apply(config);
    Ok(())
}

/// Changes apply only to escrows created afterwards; existing escrows copied their values.
#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

pub fn process_update_config(
    ctx: Context<UpdateConfig>,
    params: ConfigParams,
    new_admin: Option<Pubkey>,
) -> Result<()> {
    params.validate()?;
    let config = &mut ctx.accounts.config;
    params.apply(config);
    if let Some(admin) = new_admin {
        config.admin = admin;
    }
    Ok(())
}
