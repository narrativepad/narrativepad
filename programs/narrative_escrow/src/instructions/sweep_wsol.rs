use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::EscrowError;
use crate::state::Escrow;

/// Permissionless. After graduation, PumpSwap pays creator fees as wSOL into the vault's
/// wSOL token account. Closing it unwraps everything back into the vault as lamports, where
/// `distribute_creator_fees` picks it up. Anyone can re-create the account for the next round.
#[derive(Accounts)]
pub struct SweepWsol<'info> {
    #[account(seeds = [SEED_ESCROW, escrow.narrative_id.as_ref()], bump = escrow.bump)]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(mut, seeds = [SEED_VAULT, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        associated_token::mint = WSOL_MINT,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_wsol_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = SPL_TOKEN_PROGRAM_ID @ EscrowError::InvalidProgram)]
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn process_sweep_wsol(ctx: Context<SweepWsol>) -> Result<()> {
    require!(ctx.accounts.escrow.launched, EscrowError::NotLaunched);
    let escrow_key = ctx.accounts.escrow.key();
    let seeds: &[&[u8]] = &[SEED_VAULT, escrow_key.as_ref(), &[ctx.accounts.escrow.vault_bump]];
    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault_wsol_account.to_account_info(),
            destination: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
        &[seeds],
    ))
}
