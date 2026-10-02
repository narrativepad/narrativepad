use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::EscrowError;
use crate::events::Deposited;
use crate::state::{Escrow, Phase, Receipt};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(mut, seeds = [SEED_ESCROW, escrow.narrative_id.as_ref()], bump = escrow.bump)]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(mut, seeds = [SEED_VAULT, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = depositor,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [SEED_RECEIPT, escrow.key().as_ref(), depositor.key().as_ref()],
        bump
    )]
    pub receipt: Box<Account<'info, Receipt>>,
    pub system_program: Program<'info, System>,
}

pub fn process_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let escrow_key = ctx.accounts.escrow.key();
    let depositor_key = ctx.accounts.depositor.key();
    let escrow = &mut ctx.accounts.escrow;
    let receipt = &mut ctx.accounts.receipt;

    require!(escrow.phase(clock.unix_timestamp) == Phase::Pooling, EscrowError::NotPooling);
    require!(amount >= escrow.min_deposit, EscrowError::DepositTooSmall);
    let wallet_total = receipt.amount.checked_add(amount).ok_or(EscrowError::MathOverflow)?;
    require!(wallet_total <= escrow.per_wallet_max, EscrowError::WalletCapExceeded);
    let pool_total = escrow.total_deposited.checked_add(amount).ok_or(EscrowError::MathOverflow)?;
    require!(pool_total <= escrow.pool_cap, EscrowError::PoolCapExceeded);

    if receipt.wallet == Pubkey::default() {
        receipt.escrow = escrow_key;
        receipt.wallet = depositor_key;
        receipt.first_order_index = escrow.next_order_index;
        receipt.first_slot = clock.slot;
        receipt.bump = ctx.bumps.receipt;
        escrow.depositor_count = escrow.depositor_count.checked_add(1).ok_or(EscrowError::MathOverflow)?;
    }
    let order_index = escrow.next_order_index;
    escrow.next_order_index = order_index.checked_add(1).ok_or(EscrowError::MathOverflow)?;
    receipt.amount = wallet_total;
    receipt.deposit_count = receipt.deposit_count.checked_add(1).ok_or(EscrowError::MathOverflow)?;
    escrow.total_deposited = pool_total;

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        amount,
    )?;

    emit!(Deposited {
        escrow: escrow_key,
        wallet: depositor_key,
        amount,
        order_index,
        slot: clock.slot,
        timestamp: clock.unix_timestamp,
        wallet_total,
        pool_total,
    });
    Ok(())
}
