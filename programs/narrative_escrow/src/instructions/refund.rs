use anchor_lang::prelude::*;

use super::vault_transfer;
use crate::constants::*;
use crate::errors::EscrowError;
use crate::events::Refunded;
use crate::state::{Escrow, Phase, Receipt};

/// Permissionless: anyone may trigger a refund, but the SOL (and the receipt's rent) always
/// goes to the wallet that deposited. Eligibility depends only on time and pool state, so no
/// admin action can block it (ARCHITECTURE.md §3.2).
#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut, seeds = [SEED_ESCROW, escrow.narrative_id.as_ref()], bump = escrow.bump)]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(mut, seeds = [SEED_VAULT, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [SEED_RECEIPT, escrow.key().as_ref(), wallet.key().as_ref()],
        bump = receipt.bump,
        has_one = wallet,
        close = wallet
    )]
    pub receipt: Box<Account<'info, Receipt>>,
    /// CHECK: refund destination; bound to the receipt by its seeds and `has_one`.
    #[account(mut)]
    pub wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn process_refund(ctx: Context<Refund>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let escrow_key = ctx.accounts.escrow.key();
    require!(
        ctx.accounts.escrow.phase(now) == Phase::Refundable,
        EscrowError::NotRefundable
    );

    let amount = ctx.accounts.receipt.amount;
    vault_transfer(
        &ctx.accounts.system_program,
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.wallet.to_account_info(),
        &escrow_key,
        ctx.accounts.escrow.vault_bump,
        amount,
    )?;

    let escrow = &mut ctx.accounts.escrow;
    escrow.total_refunded = escrow.total_refunded.checked_add(amount).ok_or(EscrowError::MathOverflow)?;

    emit!(Refunded { escrow: escrow_key, wallet: ctx.accounts.wallet.key(), amount });
    Ok(())
}
