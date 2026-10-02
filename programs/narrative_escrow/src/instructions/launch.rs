use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self, Create as CreateAta};

use super::vault_transfer;
use crate::constants::*;
use crate::errors::EscrowError;
use crate::events::Launched;
use crate::math::{bps_of, curve_tokens_out, net_of_fee};
use crate::pump::{self, ra};
use crate::state::{Escrow, Phase};

/// Permissionless. Creates the coin on pump.fun with the locked metadata and spends the pool
/// on the opening buy inside this ONE instruction, so nothing can be ordered between create
/// and buy (ARCHITECTURE.md §4.3). Must be a top-level instruction (CPI depth).
///
/// Pump's own accounts follow in `remaining_accounts` in the order of `pump::ra`.
#[derive(Accounts)]
#[instruction(mint_nonce: u64)]
pub struct Launch<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [SEED_ESCROW, escrow.narrative_id.as_ref()], bump = escrow.bump)]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(mut, seeds = [SEED_VAULT, escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: pays the rent of pump's `create_v2`: the vault (default) or the cranker
    /// (fallback if pump rejects a PDA payer for create, §4.3b). Nothing else is allowed.
    #[account(
        mut,
        constraint = create_payer.key() == vault.key() || create_payer.key() == cranker.key()
            @ EscrowError::InvalidLaunchPayer
    )]
    pub create_payer: UncheckedAccount<'info>,
    /// CHECK: the coin's mint, created by pump. A PDA of this escrow and a nonce chosen at
    /// launch time, so its address can't be pre-funded to grief the launch.
    #[account(mut, seeds = [SEED_MINT, escrow.key().as_ref(), &mint_nonce.to_le_bytes()], bump)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: the vault's Token-2022 ATA for `mint`; created here, address verified.
    #[account(
        mut,
        address = pump::ata_address(&vault.key(), &mint.key(), &TOKEN_2022_PROGRAM_ID)
            @ EscrowError::InvalidAccount
    )]
    pub vault_token_account: UncheckedAccount<'info>,
    /// CHECK: platform fee destination, frozen into the escrow at creation.
    #[account(mut, address = escrow.treasury @ EscrowError::InvalidAccount)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: pinned.
    #[account(address = PUMP_PROGRAM_ID @ EscrowError::InvalidProgram)]
    pub pump_program: UncheckedAccount<'info>,
    /// CHECK: pinned.
    #[account(address = TOKEN_2022_PROGRAM_ID @ EscrowError::InvalidProgram)]
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: pinned.
    #[account(address = ASSOCIATED_TOKEN_PROGRAM_ID @ EscrowError::InvalidProgram)]
    pub associated_token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn process_launch<'info>(ctx: Context<'info, Launch<'info>>, mint_nonce: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let r = ctx.remaining_accounts;
    require!(r.len() >= ra::COUNT, EscrowError::InvalidAccount);

    let a = &ctx.accounts;
    let escrow_key = a.escrow.key();
    let vault_key = a.vault.key();
    let mint_key = a.mint.key();
    require!(a.escrow.phase(now) == Phase::Launchable, EscrowError::NotLaunchable);
    // Refunds only happen in the (permanent) Refundable phase, so none can have happened.
    require!(a.escrow.total_refunded == 0, EscrowError::NotLaunchable);

    // Accounts we read or rely on ourselves. Pump validates the rest of its accounts.
    require_keys_eq!(r[ra::BONDING_CURVE].key(), pump::bonding_curve_address(&mint_key), EscrowError::InvalidAccount);
    require_keys_eq!(r[ra::MAYHEM_PROGRAM].key(), MAYHEM_PROGRAM_ID, EscrowError::InvalidProgram);
    require_keys_eq!(r[ra::QUOTE_MINT].key(), WSOL_MINT, EscrowError::InvalidAccount);
    require_keys_eq!(r[ra::QUOTE_TOKEN_PROGRAM].key(), SPL_TOKEN_PROGRAM_ID, EscrowError::InvalidProgram);
    require_keys_eq!(r[ra::FEE_PROGRAM].key(), PUMP_FEE_PROGRAM_ID, EscrowError::InvalidProgram);

    let total = a.escrow.total_deposited;
    let platform_fee = bps_of(total, a.escrow.fee_bps as u64).ok_or(EscrowError::MathOverflow)?;
    let pool_after_fee = total - platform_fee;
    let budget = pool_after_fee
        .checked_sub(LAUNCH_RENT_RESERVE)
        .filter(|b| *b > 0)
        .ok_or(EscrowError::PoolTooSmall)?;

    let name = a.escrow.name.clone();
    let symbol = a.escrow.symbol.clone();
    let uri = a.escrow.uri.clone();
    let vault_bump = a.escrow.vault_bump;
    let nonce_bytes = mint_nonce.to_le_bytes();
    let mint_bump = [ctx.bumps.mint];
    let vault_bump_bytes = [vault_bump];
    let vault_seeds: &[&[u8]] = &[SEED_VAULT, escrow_key.as_ref(), &vault_bump_bytes];
    let mint_seeds: &[&[u8]] = &[SEED_MINT, escrow_key.as_ref(), &nonce_bytes, &mint_bump];

    let vault = a.vault.to_account_info();
    let mint = a.mint.to_account_info();
    let vault_token_account = a.vault_token_account.to_account_info();
    let token_program = a.token_program.to_account_info();
    let ata_program = a.associated_token_program.to_account_info();
    let system_program = a.system_program.to_account_info();
    let pump_program = a.pump_program.to_account_info();

    // 1. Platform fee (only ever charged here, on a successful launch).
    vault_transfer(&a.system_program, &vault, &a.treasury.to_account_info(), &escrow_key, vault_bump, platform_fee)?;
    let lamports_before = vault.lamports();

    // 2. Create the coin. creator = vault, so on pump.fun the "dev" is the community escrow.
    pump::create_v2(
        &pump::CreateV2Accounts {
            mint: &mint,
            user: &a.create_payer.to_account_info(),
            system_program: &system_program,
            token_program: &token_program,
            associated_token_program: &ata_program,
            pump_program: &pump_program,
            ra: r,
        },
        &name,
        &symbol,
        &uri,
        &vault_key,
        &[vault_seeds, mint_seeds],
    )?;

    // 3. The vault's token account for the new coin (pump expects it to exist).
    associated_token::create_idempotent(CpiContext::new_with_signer(
        ata_program.key(),
        CreateAta {
            payer: vault.clone(),
            associated_token: vault_token_account.clone(),
            authority: vault.clone(),
            mint: mint.clone(),
            system_program: system_program.clone(),
            token_program: token_program.clone(),
        },
        &[vault_seeds],
    ))?;

    // 4. Bound the opening buy using the fresh curve.
    let curve = pump::read_curve(&r[ra::BONDING_CURVE])?;
    require!(!curve.complete && curve.creator == vault_key, EscrowError::InvalidBondingCurve);
    let max_out = curve_tokens_out(budget, curve.virtual_token_reserves, curve.virtual_quote_reserves)
        .ok_or(EscrowError::MathOverflow)?;
    let fill_limit = bps_of(curve.real_token_reserves, MAX_CURVE_FILL_BPS).ok_or(EscrowError::MathOverflow)?;
    require!(max_out <= fill_limit, EscrowError::CurveOverfill);
    let min_out = curve_tokens_out(
        net_of_fee(budget, MAX_ASSUMED_PUMP_FEE_BPS).ok_or(EscrowError::MathOverflow)?,
        curve.virtual_token_reserves,
        curve.virtual_quote_reserves,
    )
    .ok_or(EscrowError::MathOverflow)?;
    require!(min_out > 0, EscrowError::PoolTooSmall);

    // 5. Opening buy, paid by the vault.
    pump::buy_exact_quote_in_v2(
        &pump::BuyAccounts {
            base_mint: &mint,
            base_token_program: &token_program,
            associated_token_program: &ata_program,
            user: &vault,
            associated_base_user: &vault_token_account,
            system_program: &system_program,
            pump_program: &pump_program,
            ra: r,
        },
        budget,
        min_out,
        &[vault_seeds],
    )?;

    // 6. Post-conditions: don't trust the CPI, check what actually happened.
    let (token_mint, token_owner, tokens) = pump::read_token_account(&vault_token_account)?;
    require!(token_mint == mint_key && token_owner == vault_key, EscrowError::InvalidAccount);
    require!(tokens >= min_out, EscrowError::LaunchUnderfilled);
    let spent = lamports_before.saturating_sub(vault.lamports());
    require!(spent <= pool_after_fee, EscrowError::LaunchOverspent);
    let base_leftover = pool_after_fee - spent;

    let escrow = &mut ctx.accounts.escrow;
    escrow.launched = true;
    escrow.launched_at = now;
    escrow.mint = mint_key;
    escrow.tokens_bought = tokens;
    escrow.base_leftover = base_leftover;

    emit!(Launched {
        escrow: escrow_key,
        mint: mint_key,
        pool_total: total,
        platform_fee,
        buy_budget: budget,
        tokens_bought: tokens,
        base_leftover,
        launched_at: now,
    });
    Ok(())
}
