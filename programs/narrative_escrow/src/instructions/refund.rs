use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use super::vault_transfer;
use crate::constants::*;
use crate::errors::EscrowError;
use crate::events::Refunded;
use crate::state::{Escrow, Phase, PoolQuote, Receipt};

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
    /// CHECK: must be empty: a token pool refunds tokens, never lamports (D-023).
    #[account(seeds = [SEED_POOL_QUOTE, escrow.key().as_ref()], bump)]
    pub pool_quote: UncheckedAccount<'info>,
}

/// Token-pool refund (D-023): the full deposit goes back to the depositor's associated token
/// account, recreated at the caller's expense if the depositor closed it, so a closed account
/// can't block the refund. The receipt's rent still goes to the depositor.
#[derive(Accounts)]
pub struct RefundToken<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut, seeds = [SEED_ESCROW, escrow.narrative_id.as_ref()], bump = escrow.bump)]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(seeds = [SEED_VAULT, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [SEED_RECEIPT, escrow.key().as_ref(), wallet.key().as_ref()],
        bump = receipt.bump,
        has_one = wallet,
        close = wallet
    )]
    pub receipt: Box<Account<'info, Receipt>>,
    /// CHECK: the depositor; bound to the receipt by its seeds and `has_one`.
    #[account(mut)]
    pub wallet: UncheckedAccount<'info>,
    #[account(seeds = [SEED_POOL_QUOTE, escrow.key().as_ref()], bump = pool_quote.bump, has_one = escrow)]
    pub pool_quote: Box<Account<'info, PoolQuote>>,
    #[account(address = pool_quote.mint @ EscrowError::InvalidQuoteMint, mint::token_program = token_program)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = quote_mint,
        associated_token::authority = wallet,
        associated_token::token_program = token_program
    )]
    pub wallet_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = pool_quote.token_program @ EscrowError::InvalidProgram)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn process_refund(ctx: Context<Refund>) -> Result<()> {
    PoolQuote::require_sol_pool(&ctx.accounts.pool_quote.to_account_info())?;
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

pub fn process_refund_token(ctx: Context<RefundToken>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let escrow_key = ctx.accounts.escrow.key();
    require!(ctx.accounts.escrow.phase(now) == Phase::Refundable, EscrowError::NotRefundable);

    let amount = ctx.accounts.receipt.amount;
    let vault_seeds: &[&[u8]] = &[SEED_VAULT, escrow_key.as_ref(), &[ctx.accounts.escrow.vault_bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault_quote_account.to_account_info(),
                mint: ctx.accounts.quote_mint.to_account_info(),
                to: ctx.accounts.wallet_quote_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[vault_seeds],
        ),
        amount,
        ctx.accounts.quote_mint.decimals,
    )?;

    let escrow = &mut ctx.accounts.escrow;
    escrow.total_refunded = escrow.total_refunded.checked_add(amount).ok_or(EscrowError::MathOverflow)?;

    emit!(Refunded { escrow: escrow_key, wallet: ctx.accounts.wallet.key(), amount });
    Ok(())
}
