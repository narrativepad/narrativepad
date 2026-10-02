use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::{self, Create as CreateAta};
use anchor_spl::token_interface::{self, TransferChecked};

use super::vault_transfer;
use crate::constants::*;
use crate::errors::EscrowError;
use crate::events::Launched;
use crate::math::{bps_of, curve_tokens_out, net_of_fee};
use crate::pump::{self, ra};
use crate::state::{Escrow, HolderVote, Phase, PoolQuote};

/// Permissionless. Creates the coin on pump.fun with the locked metadata and spends the pool
/// on the opening buy inside this ONE instruction, so nothing can be ordered between create
/// and buy (ARCHITECTURE.md §4.3). Must be a top-level instruction (CPI depth).
///
/// Pump's own accounts follow in `remaining_accounts` in the order of `pump::ra`. A token pool
/// (D-023) adds, after them, the treasury's account for the pool token and, when pump admits
/// that token through quote-control, the quote-control PDA.
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
    /// CHECK: the holder-rewards tally at its PDA (D-022). Pinned by seeds so a cranker can't
    /// skip the vote; empty for escrows from before D-022 that got no deposit since.
    #[account(mut, seeds = [SEED_HOLDER_VOTE, escrow.key().as_ref()], bump)]
    pub holder_vote: UncheckedAccount<'info>,
    /// CHECK: the pool's token at its PDA (D-023); empty for SOL pools. Pinned by seeds so a
    /// cranker can't launch a token pool as a SOL pool or the reverse.
    #[account(mut, seeds = [SEED_POOL_QUOTE, escrow.key().as_ref()], bump)]
    pub pool_quote: UncheckedAccount<'info>,
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
    require_keys_eq!(r[ra::FEE_PROGRAM].key(), PUMP_FEE_PROGRAM_ID, EscrowError::InvalidProgram);

    // The pool's currency (D-023): SOL, or the coin's pump quote token held by the vault.
    let quote = PoolQuote::read(&a.pool_quote.to_account_info())?;
    if let Some(q) = &quote {
        require_keys_eq!(r[ra::QUOTE_MINT].key(), q.mint, EscrowError::InvalidAccount);
        require_keys_eq!(r[ra::QUOTE_TOKEN_PROGRAM].key(), q.token_program, EscrowError::InvalidProgram);
        require_keys_eq!(
            r[ra::ASSOCIATED_QUOTE_USER].key(),
            pump::ata_address(&vault_key, &q.mint, &q.token_program),
            EscrowError::InvalidAccount
        );
        require!(r.len() >= ra::COUNT + 1 + q.via_quote_control as usize, EscrowError::InvalidAccount);
        require_keys_eq!(
            r[ra::COUNT].key(),
            pump::ata_address(&a.escrow.treasury, &q.mint, &q.token_program),
            EscrowError::InvalidAccount
        );
        if q.via_quote_control {
            require_keys_eq!(r[ra::COUNT + 1].key(), pump::quote_control_address(), EscrowError::InvalidAccount);
        }
    } else {
        require_keys_eq!(r[ra::QUOTE_MINT].key(), WSOL_MINT, EscrowError::InvalidAccount);
        require_keys_eq!(r[ra::QUOTE_TOKEN_PROGRAM].key(), SPL_TOKEN_PROGRAM_ID, EscrowError::InvalidProgram);
    }

    // Holder rewards (D-022): on only if more SOL voted for them and pump has them enabled;
    // otherwise pump would reject the create and the pool could never launch.
    let vote = HolderVote::read(&a.holder_vote.to_account_info())?;
    let (votes_on, votes_off) = vote.as_ref().map(|v| (v.on, v.off)).unwrap_or((0, 0));
    let holder_rewards = HolderVote::wants_on(vote.as_ref()) && pump::holder_rewards_enabled(&r[ra::GLOBAL])?;
    let expected_creator = if holder_rewards { pump::holder_rewards_address(&mint_key) } else { vault_key };

    let total = a.escrow.total_deposited;
    let platform_fee = bps_of(total, a.escrow.fee_bps as u64).ok_or(EscrowError::MathOverflow)?;
    let pool_after_fee = total - platform_fee;
    // A SOL pool keeps a rent reserve back from the buy; a token pool's rents are lent by the
    // cranker (below), so the whole pool after the fee buys.
    let budget = if quote.is_some() { Some(pool_after_fee) } else { pool_after_fee.checked_sub(LAUNCH_RENT_RESERVE) }
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

    let cranker = a.cranker.to_account_info();
    let vault = a.vault.to_account_info();
    let mint = a.mint.to_account_info();
    let vault_token_account = a.vault_token_account.to_account_info();
    let token_program = a.token_program.to_account_info();
    let ata_program = a.associated_token_program.to_account_info();
    let system_program = a.system_program.to_account_info();
    let pump_program = a.pump_program.to_account_info();

    // 1. Platform fee (only ever charged here, on a successful launch).
    let quote_before = if let Some(q) = &quote {
        // The cranker lends the vault SOL for the launch's rents; the rest comes back in step 7.
        system_program::transfer(
            CpiContext::new(system_program.key(), system_program::Transfer { from: cranker.clone(), to: vault.clone() }),
            TOKEN_LAUNCH_RENT,
        )?;
        associated_token::create_idempotent(CpiContext::new(
            ata_program.key(),
            CreateAta {
                payer: cranker.clone(),
                associated_token: r[ra::COUNT].clone(),
                authority: a.treasury.to_account_info(),
                mint: r[ra::QUOTE_MINT].clone(),
                system_program: system_program.clone(),
                token_program: r[ra::QUOTE_TOKEN_PROGRAM].clone(),
            },
        ))?;
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                r[ra::QUOTE_TOKEN_PROGRAM].key(),
                TransferChecked {
                    from: r[ra::ASSOCIATED_QUOTE_USER].clone(),
                    mint: r[ra::QUOTE_MINT].clone(),
                    to: r[ra::COUNT].clone(),
                    authority: vault.clone(),
                },
                &[vault_seeds],
            ),
            platform_fee,
            q.decimals,
        )?;
        pump::read_quote_balance(&r[ra::ASSOCIATED_QUOTE_USER], &q.token_program, &q.mint, &vault_key)?
    } else {
        vault_transfer(&a.system_program, &vault, &a.treasury.to_account_info(), &escrow_key, vault_bump, platform_fee)?;
        0
    };
    let lamports_before = vault.lamports();

    // 2. Create the coin. creator = vault, so on pump.fun the "dev" is the community escrow.
    let quote_accounts = quote.as_ref().map(|q| pump::QuoteAccounts {
        mint: &r[ra::QUOTE_MINT],
        associated_bonding_curve: &r[ra::ASSOCIATED_QUOTE_BONDING_CURVE],
        token_program: &r[ra::QUOTE_TOKEN_PROGRAM],
        quote_control: if q.via_quote_control { Some(&r[ra::COUNT + 1]) } else { None },
    });
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
        holder_rewards,
        quote_accounts.as_ref(),
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

    // 4. Bound the opening buy using the fresh curve (its reserves are in the pool's currency).
    let curve = pump::read_curve(&r[ra::BONDING_CURVE])?;
    require!(!curve.complete && curve.creator == expected_creator, EscrowError::InvalidBondingCurve);
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

    // 5. Opening buy, paid by the vault (lamports, or the pool token from its account).
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
    let leftover = if let Some(q) = &quote {
        let quote_after = pump::read_quote_balance(&r[ra::ASSOCIATED_QUOTE_USER], &q.token_program, &q.mint, &vault_key)?;
        let spent = quote_before.saturating_sub(quote_after);
        require!(spent <= pool_after_fee, EscrowError::LaunchOverspent);
        pool_after_fee - spent
    } else {
        let spent = lamports_before.saturating_sub(vault.lamports());
        require!(spent <= pool_after_fee, EscrowError::LaunchOverspent);
        pool_after_fee - spent
    };

    // 7. Token pool: return the cranker's unspent SOL. The vault keeps exactly its rent floor,
    //    so pump can't have used more than was lent without failing the rent check.
    if quote.is_some() {
        let floor = Rent::get()?.minimum_balance(0);
        let back = vault.lamports().saturating_sub(floor);
        vault_transfer(&ctx.accounts.system_program, &vault, &cranker, &escrow_key, vault_bump, back)?;
    }

    let escrow = &mut ctx.accounts.escrow;
    escrow.launched = true;
    escrow.launched_at = now;
    escrow.mint = mint_key;
    escrow.tokens_bought = tokens;
    // SOL pools owe the leftover in lamports (claim); token pools in their token (claim_token).
    escrow.base_leftover = if quote.is_some() { 0 } else { leftover };

    if let Some(mut q) = quote {
        q.quote_leftover = leftover;
        let info = ctx.accounts.pool_quote.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        q.try_serialize(&mut &mut data[..])?;
    }
    if let Some(mut v) = vote {
        v.applied = holder_rewards;
        let info = ctx.accounts.holder_vote.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        v.try_serialize(&mut &mut data[..])?;
    }

    emit!(Launched {
        escrow: escrow_key,
        mint: mint_key,
        pool_total: total,
        platform_fee,
        buy_budget: budget,
        tokens_bought: tokens,
        base_leftover: leftover,
        launched_at: now,
        holder_rewards,
        holder_votes_on: votes_on,
        holder_votes_off: votes_off,
    });
    Ok(())
}
