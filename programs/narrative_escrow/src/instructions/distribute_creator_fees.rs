use anchor_lang::prelude::*;

use super::vault_transfer;
use crate::constants::*;
use crate::errors::EscrowError;
use crate::events::CreatorFeesDistributed;
use crate::math::bps_of;
use crate::state::{Escrow, HolderVote};

/// Permissionless. Pump pays creator fees to `creator` = our vault (anyone can trigger
/// `collect_creator_fee_v2`; AMM fees arrive as wSOL and are unwrapped by `sweep_wsol`).
/// Everything in the vault above what is owed to depositors is creator-fee income and is
/// split by the ratios frozen into the escrow (D-006): proposer, platform, and the rest to
/// depositors pro-rata (credited here, pulled via `claim`). If the coin launched with holder
/// rewards (D-022), all of it goes to depositors.
#[derive(Accounts)]
pub struct DistributeCreatorFees<'info> {
    #[account(mut, seeds = [SEED_ESCROW, escrow.narrative_id.as_ref()], bump = escrow.bump)]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(mut, seeds = [SEED_VAULT, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: fixed at escrow creation.
    #[account(mut, address = escrow.proposer @ EscrowError::InvalidAccount)]
    pub proposer: UncheckedAccount<'info>,
    /// CHECK: fixed at escrow creation.
    #[account(mut, address = escrow.treasury @ EscrowError::InvalidAccount)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: the holder-rewards tally at its PDA (D-022); may be empty for old escrows.
    #[account(seeds = [SEED_HOLDER_VOTE, escrow.key().as_ref()], bump)]
    pub holder_vote: UncheckedAccount<'info>,
}

pub fn process_distribute_creator_fees(ctx: Context<DistributeCreatorFees>) -> Result<()> {
    let escrow_key = ctx.accounts.escrow.key();
    let e = &ctx.accounts.escrow;
    require!(e.launched, EscrowError::NotLaunched);

    let overflow = || error!(EscrowError::MathOverflow);
    let rent_floor = Rent::get()?.minimum_balance(0);
    let obligations = e
        .vault_obligations()
        .and_then(|o| o.checked_add(rent_floor))
        .ok_or_else(overflow)?;
    let surplus = ctx.accounts.vault.lamports().saturating_sub(obligations);
    require!(surplus >= MIN_CREATOR_FEE_DISTRIBUTION, EscrowError::NothingToDistribute);

    // A share that would leave an empty recipient below rent exemption can't be sent; it
    // goes to depositors instead so distribution can never be blocked.
    let payable = |share: u64, to: &AccountInfo| to.lamports() > 0 || share >= rent_floor;
    let mut proposer_share = bps_of(surplus, e.creator_fee_proposer_bps as u64).ok_or_else(overflow)?;
    let mut platform_share = bps_of(surplus, e.creator_fee_platform_bps as u64).ok_or_else(overflow)?;
    // The pool voted fees to holders (D-022): pump pays holders itself, and whatever reaches the
    // vault (holder rewards on the tokens it holds for depositors) goes entirely to depositors.
    let to_holders = HolderVote::read(&ctx.accounts.holder_vote.to_account_info())?.map(|v| v.applied).unwrap_or(false);
    if to_holders {
        proposer_share = 0;
        platform_share = 0;
    }
    if !payable(proposer_share, &ctx.accounts.proposer.to_account_info()) {
        proposer_share = 0;
    }
    if !payable(platform_share, &ctx.accounts.treasury.to_account_info()) {
        platform_share = 0;
    }
    let depositors_share = surplus - proposer_share - platform_share;

    let vault = ctx.accounts.vault.to_account_info();
    let bump = e.vault_bump;
    vault_transfer(&ctx.accounts.system_program, &vault, &ctx.accounts.proposer.to_account_info(), &escrow_key, bump, proposer_share)?;
    vault_transfer(&ctx.accounts.system_program, &vault, &ctx.accounts.treasury.to_account_info(), &escrow_key, bump, platform_share)?;

    let escrow = &mut ctx.accounts.escrow;
    escrow.creator_fees_depositors_total =
        escrow.creator_fees_depositors_total.checked_add(depositors_share).ok_or_else(overflow)?;
    escrow.creator_fees_distributed_total =
        escrow.creator_fees_distributed_total.checked_add(surplus).ok_or_else(overflow)?;

    emit!(CreatorFeesDistributed {
        escrow: escrow_key,
        total: surplus,
        proposer_share,
        platform_share,
        depositors_share,
    });
    Ok(())
}
