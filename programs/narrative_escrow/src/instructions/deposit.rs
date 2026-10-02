use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::EscrowError;
use crate::events::Deposited;
use crate::state::{Escrow, HolderVote, Phase, PoolQuote, Receipt};

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
    /// The pool's holder-rewards tally. Created with the escrow; `init_if_needed` only covers
    /// escrows from before D-022, whose first new depositor pays its small rent.
    #[account(
        init_if_needed,
        payer = depositor,
        space = 8 + HolderVote::INIT_SPACE,
        seeds = [SEED_HOLDER_VOTE, escrow.key().as_ref()],
        bump
    )]
    pub holder_vote: Box<Account<'info, HolderVote>>,
    /// CHECK: must be empty: SOL can't go into a token pool (D-023).
    #[account(seeds = [SEED_POOL_QUOTE, escrow.key().as_ref()], bump)]
    pub pool_quote: UncheckedAccount<'info>,
}

/// A deposit into a token pool (D-023): the pool's token moves from the depositor's token
/// account to the vault's. Same caps, receipt, ordering and vote as a SOL deposit.
#[derive(Accounts)]
pub struct DepositToken<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(mut, seeds = [SEED_ESCROW, escrow.narrative_id.as_ref()], bump = escrow.bump)]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(seeds = [SEED_VAULT, escrow.key().as_ref()], bump = escrow.vault_bump)]
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
    #[account(mut, seeds = [SEED_HOLDER_VOTE, escrow.key().as_ref()], bump = holder_vote.bump)]
    pub holder_vote: Box<Account<'info, HolderVote>>,
    #[account(seeds = [SEED_POOL_QUOTE, escrow.key().as_ref()], bump = pool_quote.bump, has_one = escrow)]
    pub pool_quote: Box<Account<'info, PoolQuote>>,
    #[account(address = pool_quote.mint @ EscrowError::InvalidQuoteMint, mint::token_program = token_program)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = quote_mint, token::authority = depositor, token::token_program = token_program)]
    pub depositor_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = quote_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = pool_quote.token_program @ EscrowError::InvalidProgram)]
    pub token_program: Interface<'info, TokenInterface>,
}

struct Recorded {
    order_index: u32,
    wallet_total: u64,
    pool_total: u64,
}

/// The bookkeeping both deposit kinds share: window, minimum, per-wallet and pool caps, the
/// receipt, the order index and the holder-rewards tally. Funds move after this returns.
#[allow(clippy::too_many_arguments)]
fn record_deposit(
    escrow: &mut Escrow,
    receipt: &mut Receipt,
    vote: &mut HolderVote,
    escrow_key: Pubkey,
    depositor_key: Pubkey,
    (receipt_bump, vote_bump): (u8, u8),
    amount: u64,
    holder_rewards: bool,
    clock: &Clock,
) -> Result<Recorded> {
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
        receipt.bump = receipt_bump;
        escrow.depositor_count = escrow.depositor_count.checked_add(1).ok_or(EscrowError::MathOverflow)?;
    }
    let order_index = escrow.next_order_index;
    escrow.next_order_index = order_index.checked_add(1).ok_or(EscrowError::MathOverflow)?;
    receipt.amount = wallet_total;
    receipt.deposit_count = receipt.deposit_count.checked_add(1).ok_or(EscrowError::MathOverflow)?;
    escrow.total_deposited = pool_total;

    if vote.escrow == Pubkey::default() {
        vote.escrow = escrow_key;
        vote.bump = vote_bump;
    }
    if holder_rewards {
        vote.on = vote.on.checked_add(amount).ok_or(EscrowError::MathOverflow)?;
    } else {
        vote.off = vote.off.checked_add(amount).ok_or(EscrowError::MathOverflow)?;
    }
    Ok(Recorded { order_index, wallet_total, pool_total })
}

/// `holder_rewards` is this deposit's vote; it counts with `amount` lamports (D-022).
pub fn process_deposit(ctx: Context<Deposit>, amount: u64, holder_rewards: bool) -> Result<()> {
    PoolQuote::require_sol_pool(&ctx.accounts.pool_quote.to_account_info())?;
    let clock = Clock::get()?;
    let escrow_key = ctx.accounts.escrow.key();
    let depositor_key = ctx.accounts.depositor.key();
    let a = &mut *ctx.accounts;
    let rec = record_deposit(
        &mut a.escrow,
        &mut a.receipt,
        &mut a.holder_vote,
        escrow_key,
        depositor_key,
        (ctx.bumps.receipt, ctx.bumps.holder_vote),
        amount,
        holder_rewards,
        &clock,
    )?;

    system_program::transfer(
        CpiContext::new(
            a.system_program.key(),
            system_program::Transfer { from: a.depositor.to_account_info(), to: a.vault.to_account_info() },
        ),
        amount,
    )?;

    emit!(Deposited {
        escrow: escrow_key,
        wallet: depositor_key,
        amount,
        order_index: rec.order_index,
        slot: clock.slot,
        timestamp: clock.unix_timestamp,
        wallet_total: rec.wallet_total,
        pool_total: rec.pool_total,
        holder_rewards,
    });
    Ok(())
}

/// `amount` is in the pool token's base units (D-023).
pub fn process_deposit_token(ctx: Context<DepositToken>, amount: u64, holder_rewards: bool) -> Result<()> {
    let clock = Clock::get()?;
    let escrow_key = ctx.accounts.escrow.key();
    let depositor_key = ctx.accounts.depositor.key();
    let vote_bump = ctx.accounts.holder_vote.bump;
    let a = &mut *ctx.accounts;
    let rec = record_deposit(
        &mut a.escrow,
        &mut a.receipt,
        &mut a.holder_vote,
        escrow_key,
        depositor_key,
        (ctx.bumps.receipt, vote_bump),
        amount,
        holder_rewards,
        &clock,
    )?;

    let before = a.vault_quote_account.amount;
    token_interface::transfer_checked(
        CpiContext::new(
            a.token_program.key(),
            TransferChecked {
                from: a.depositor_quote_account.to_account_info(),
                mint: a.quote_mint.to_account_info(),
                to: a.vault_quote_account.to_account_info(),
                authority: a.depositor.to_account_info(),
            },
        ),
        amount,
        a.quote_mint.decimals,
    )?;
    // The pool's accounting assumes exactly `amount` arrived (no transfer fees or hooks that
    // change it); refunds and the launch rely on that.
    a.vault_quote_account.reload()?;
    let received = a.vault_quote_account.amount.checked_sub(before).ok_or(EscrowError::MathOverflow)?;
    require!(received == amount, EscrowError::TransferAmountMismatch);

    emit!(Deposited {
        escrow: escrow_key,
        wallet: depositor_key,
        amount,
        order_index: rec.order_index,
        slot: clock.slot,
        timestamp: clock.unix_timestamp,
        wallet_total: rec.wallet_total,
        pool_total: rec.pool_total,
        holder_rewards,
    });
    Ok(())
}
