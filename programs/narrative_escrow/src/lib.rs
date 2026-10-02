//! Narrativepad escrow (Solana). See docs/ARCHITECTURE.md §3–4.
//!
//! Funds can leave a vault ONLY via:
//!   (a) `refund` / `claim`            → the depositing wallet itself
//!   (b) `launch`                       → pump.fun (pinned program id), bounded by post-checks
//!   (c) `launch`                       → treasury, exactly `fee_bps` of the pool (≤ 2%)
//!   (d) `distribute_creator_fees`      → creator-fee income only, split frozen at creation
//! There is no admin withdraw and no instruction that takes a destination from the caller.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod pump;
pub mod state;

use instructions::*;

declare_id!("42bwRMxcnpbfiH1K68dGuVkgEWdZoWY72fZ7VVVcbVrY");

#[program]
pub mod narrative_escrow {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, params: ConfigParams) -> Result<()> {
        instructions::config::process_init_config(ctx, params)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        params: ConfigParams,
        new_admin: Option<Pubkey>,
    ) -> Result<()> {
        instructions::config::process_update_config(ctx, params, new_admin)
    }

    pub fn create_escrow(ctx: Context<CreateEscrow>, params: CreateEscrowParams) -> Result<()> {
        instructions::create_escrow::process_create_escrow(ctx, params)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::process_deposit(ctx, amount)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund::process_refund(ctx)
    }

    pub fn launch<'info>(ctx: Context<'info, Launch<'info>>, mint_nonce: u64) -> Result<()> {
        instructions::launch::process_launch(ctx, mint_nonce)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::process_claim(ctx)
    }

    pub fn distribute_creator_fees(ctx: Context<DistributeCreatorFees>) -> Result<()> {
        instructions::distribute_creator_fees::process_distribute_creator_fees(ctx)
    }

    pub fn sweep_wsol(ctx: Context<SweepWsol>) -> Result<()> {
        instructions::sweep_wsol::process_sweep_wsol(ctx)
    }

    pub fn burn_dust(ctx: Context<BurnDust>) -> Result<()> {
        instructions::burn_dust::process_burn_dust(ctx)
    }
}
