use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::EscrowError;
use crate::events::DustBurned;
use crate::state::Escrow;

/// Permissionless. Pro-rata rounding leaves fewer than `depositor_count` base units behind.
/// Once every depositor has claimed in full, that dust is burned. It never goes to anyone.
#[derive(Accounts)]
pub struct BurnDust<'info> {
    #[account(seeds = [SEED_ESCROW, escrow.narrative_id.as_ref()], bump = escrow.bump)]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(seeds = [SEED_VAULT, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut, address = escrow.mint @ EscrowError::NotLaunched, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = TOKEN_2022_PROGRAM_ID @ EscrowError::InvalidProgram)]
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn process_burn_dust(ctx: Context<BurnDust>) -> Result<()> {
    let e = &ctx.accounts.escrow;
    require!(e.launched, EscrowError::NotLaunched);
    require!(e.receipts_fully_claimed == e.depositor_count, EscrowError::ClaimsOutstanding);
    let amount = ctx.accounts.vault_token_account.amount;
    require!(amount > 0, EscrowError::NothingToClaim);
    require!(amount < e.depositor_count as u64, EscrowError::NotDust);

    let escrow_key = e.key();
    let seeds: &[&[u8]] = &[SEED_VAULT, escrow_key.as_ref(), &[e.vault_bump]];
    token_interface::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;
    emit!(DustBurned { escrow: escrow_key, amount });
    Ok(())
}
