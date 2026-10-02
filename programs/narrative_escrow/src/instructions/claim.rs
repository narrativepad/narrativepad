use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use super::vault_transfer;
use crate::constants::*;
use crate::errors::EscrowError;
use crate::events::Claimed;
use crate::math::{pro_rata, unlocked_tranches, vested};
use crate::state::{Escrow, Receipt};

/// Permissionless (a crank may push), but everything goes to the depositing wallet: tokens
/// to its associated token account, lamports to the wallet. No destination parameter exists.
///
/// Pays out, in one go, whatever is due: vested tokens (uniform vesting, D-001), the wallet's
/// share of unspent pool lamports, and its share of creator fees credited so far (D-006).
#[derive(Accounts)]
pub struct Claim<'info> {
    /// Pays for the wallet's token account if it doesn't exist yet.
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut, seeds = [SEED_ESCROW, escrow.narrative_id.as_ref()], bump = escrow.bump)]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(mut, seeds = [SEED_VAULT, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [SEED_RECEIPT, escrow.key().as_ref(), wallet.key().as_ref()],
        bump = receipt.bump,
        has_one = wallet
    )]
    pub receipt: Box<Account<'info, Receipt>>,
    /// CHECK: the depositing wallet; bound to the receipt by seeds and `has_one`.
    #[account(mut)]
    pub wallet: UncheckedAccount<'info>,
    #[account(address = escrow.mint @ EscrowError::NotLaunched, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = wallet,
        associated_token::token_program = token_program
    )]
    pub wallet_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = TOKEN_2022_PROGRAM_ID @ EscrowError::InvalidProgram)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn process_claim(ctx: Context<Claim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let escrow_key = ctx.accounts.escrow.key();
    let e = &ctx.accounts.escrow;
    let rc = &ctx.accounts.receipt;
    require!(e.launched, EscrowError::NotLaunched);

    let overflow = || error!(EscrowError::MathOverflow);
    let unlocked = unlocked_tranches(now, e.launched_at, e.tranche_interval, e.tranche_count);
    let entitlement = pro_rata(e.tokens_bought, rc.amount, e.total_deposited).ok_or_else(overflow)?;
    let vested_now = vested(entitlement, unlocked, e.tranche_count).ok_or_else(overflow)?;
    let tokens_due = vested_now.saturating_sub(rc.tokens_claimed);

    let leftover_share = if rc.leftover_paid {
        0
    } else {
        pro_rata(e.base_leftover, rc.amount, e.total_deposited).ok_or_else(overflow)?
    };
    let fees_owed = pro_rata(e.creator_fees_depositors_total, rc.amount, e.total_deposited)
        .ok_or_else(overflow)?;
    let fees_due = fees_owed.saturating_sub(rc.creator_fees_claimed);

    // A system transfer that would leave an empty account below the rent-exempt minimum
    // fails. Never let that block token claims: defer tiny lamport payouts to a wallet that
    // currently holds 0 lamports until they add up.
    let lamports_due = leftover_share.checked_add(fees_due).ok_or_else(overflow)?;
    let pay_lamports = lamports_due > 0
        && (ctx.accounts.wallet.lamports() > 0
            || lamports_due >= Rent::get()?.minimum_balance(0));
    require!(tokens_due > 0 || pay_lamports, EscrowError::NothingToClaim);

    let vault_bump = e.vault_bump;
    let vault_seeds: &[&[u8]] = &[SEED_VAULT, escrow_key.as_ref(), &[vault_bump]];

    if tokens_due > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.wallet_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[vault_seeds],
            ),
            tokens_due,
            ctx.accounts.mint.decimals,
        )?;
    }
    if pay_lamports {
        vault_transfer(
            &ctx.accounts.system_program,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.wallet.to_account_info(),
            &escrow_key,
            vault_bump,
            lamports_due,
        )?;
    }

    let receipt = &mut ctx.accounts.receipt;
    receipt.tokens_claimed = receipt.tokens_claimed.max(vested_now);
    let (paid_leftover, paid_fees) = if pay_lamports { (leftover_share, fees_due) } else { (0, 0) };
    if pay_lamports {
        receipt.leftover_paid = true;
        receipt.creator_fees_claimed = fees_owed;
    }
    let newly_complete = !receipt.fully_claimed && receipt.tokens_claimed == entitlement;
    if newly_complete {
        receipt.fully_claimed = true;
    }

    let escrow = &mut ctx.accounts.escrow;
    escrow.tokens_claimed = escrow.tokens_claimed.checked_add(tokens_due).ok_or_else(overflow)?;
    escrow.base_leftover_claimed =
        escrow.base_leftover_claimed.checked_add(paid_leftover).ok_or_else(overflow)?;
    escrow.creator_fees_depositors_claimed =
        escrow.creator_fees_depositors_claimed.checked_add(paid_fees).ok_or_else(overflow)?;
    if newly_complete {
        escrow.receipts_fully_claimed =
            escrow.receipts_fully_claimed.checked_add(1).ok_or_else(overflow)?;
    }

    emit!(Claimed {
        escrow: escrow_key,
        wallet: ctx.accounts.wallet.key(),
        tokens: tokens_due,
        leftover_lamports: paid_leftover,
        creator_fee_lamports: paid_fees,
        unlocked_tranches: unlocked,
    });
    Ok(())
}
