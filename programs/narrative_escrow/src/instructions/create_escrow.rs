use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::EscrowError;
use crate::events::EscrowCreated;
use crate::math;
use crate::state::{Config, Escrow, HolderVote, PoolQuote};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateEscrowParams {
    pub narrative_id: [u8; 16],
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub details_hash: [u8; 32],
    pub lock_hash: [u8; 32],
    pub proposer: Pubkey,
    pub per_wallet_max: u64,
    pub pool_cap: u64,
    pub pool_min: u64,
    pub min_deposit: u64,
    pub deposit_start: i64,
    pub deposit_end: i64,
    pub launch_after: i64,
    pub launch_deadline: i64,
    pub tranche_count: u8,
    pub tranche_interval: i64,
}

#[derive(Accounts)]
#[instruction(params: CreateEscrowParams)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = operator)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = operator,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [SEED_ESCROW, params.narrative_id.as_ref()],
        bump
    )]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(mut, seeds = [SEED_VAULT, escrow.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
    /// The pool's holder-rewards tally (D-022); the operator pays its rent.
    #[account(
        init,
        payer = operator,
        space = 8 + HolderVote::INIT_SPACE,
        seeds = [SEED_HOLDER_VOTE, escrow.key().as_ref()],
        bump
    )]
    pub holder_vote: Box<Account<'info, HolderVote>>,
}

/// A token pool (D-023): same as `CreateEscrow`, plus the pool's quote token and the vault's
/// account for it. The operator pays every rent.
#[derive(Accounts)]
#[instruction(params: CreateEscrowParams)]
pub struct CreateTokenEscrow<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = operator)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = operator,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [SEED_ESCROW, params.narrative_id.as_ref()],
        bump
    )]
    pub escrow: Box<Account<'info, Escrow>>,
    #[account(mut, seeds = [SEED_VAULT, escrow.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        init,
        payer = operator,
        space = 8 + HolderVote::INIT_SPACE,
        seeds = [SEED_HOLDER_VOTE, escrow.key().as_ref()],
        bump
    )]
    pub holder_vote: Box<Account<'info, HolderVote>>,
    #[account(
        init,
        payer = operator,
        space = 8 + PoolQuote::INIT_SPACE,
        seeds = [SEED_POOL_QUOTE, escrow.key().as_ref()],
        bump
    )]
    pub pool_quote: Box<Account<'info, PoolQuote>>,
    #[account(mint::token_program = quote_token_program)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = operator,
        associated_token::mint = quote_mint,
        associated_token::authority = vault,
        associated_token::token_program = quote_token_program
    )]
    pub vault_quote_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// `token_pool`: amounts are in the pool token's units, so the lamport bounds (`max_pool_cap`,
/// `MIN_POOL_MIN`) don't apply; the launch's curve-overfill check bounds the pool instead.
fn validate(p: &CreateEscrowParams, config: &Config, now: i64, token_pool: bool) -> Result<()> {
    require!(
        !p.name.is_empty()
            && p.name.len() <= NAME_MAX_LEN
            && !p.symbol.is_empty()
            && p.symbol.len() <= SYMBOL_MAX_LEN
            && !p.uri.is_empty()
            && p.uri.len() <= URI_MAX_LEN,
        EscrowError::InvalidMetadata
    );
    require!(
        math::lock_hash(&p.narrative_id, &p.name, &p.symbol, &p.uri, &p.details_hash)
            == p.lock_hash,
        EscrowError::LockHashMismatch
    );

    require!(
        p.min_deposit > 0
            && p.min_deposit <= p.per_wallet_max
            && p.per_wallet_max <= p.pool_cap
            && (token_pool || p.pool_cap <= config.max_pool_cap)
            && p.pool_min >= if token_pool { 1 } else { MIN_POOL_MIN }
            && p.pool_min <= p.pool_cap,
        EscrowError::InvalidLimits
    );

    let opens = p.deposit_start.max(now);
    require!(
        p.deposit_end - opens >= MIN_DEPOSIT_WINDOW_SECS
            && p.deposit_end - p.deposit_start <= MAX_DEPOSIT_WINDOW_SECS
            && p.launch_after >= p.deposit_end
            && p.launch_deadline - p.launch_after >= MIN_LAUNCH_WINDOW_SECS
            && p.launch_deadline - p.deposit_end <= MAX_LAUNCH_WAIT_SECS,
        EscrowError::InvalidSchedule
    );

    require!(
        p.tranche_count >= 1
            && p.tranche_count <= MAX_TRANCHES
            && p.tranche_interval >= 0
            && p.tranche_interval <= MAX_TRANCHE_INTERVAL_SECS
            && (p.tranche_count == 1 || p.tranche_interval > 0),
        EscrowError::InvalidTranches
    );
    Ok(())
}

pub fn process_create_escrow(ctx: Context<CreateEscrow>, p: CreateEscrowParams) -> Result<()> {
    let a = &mut *ctx.accounts;
    let escrow_key = a.escrow.key();
    init_escrow(
        &mut a.escrow,
        escrow_key,
        &mut a.holder_vote,
        &a.config,
        p,
        (ctx.bumps.escrow, ctx.bumps.vault, ctx.bumps.holder_vote),
        &a.operator.to_account_info(),
        &a.vault.to_account_info(),
        &a.system_program,
        false,
    )
}

/// `via_quote_control`: pump admits the mint through its quote-control list (stocks and most
/// coins) rather than Global's whitelist (USDC), so the launch passes that PDA to `create_v2`.
pub fn process_create_token_escrow(ctx: Context<CreateTokenEscrow>, p: CreateEscrowParams, via_quote_control: bool) -> Result<()> {
    let a = &mut *ctx.accounts;
    // SOL pools are the SOL path; Token-2022's native mint isn't accepted by pump.
    let mint = a.quote_mint.key();
    require!(mint != WSOL_MINT && mint != TOKEN_2022_NATIVE_MINT, EscrowError::InvalidQuoteMint);
    let escrow_key = a.escrow.key();
    let q = &mut a.pool_quote;
    q.escrow = escrow_key;
    q.mint = mint;
    q.token_program = a.quote_token_program.key();
    q.decimals = a.quote_mint.decimals;
    q.via_quote_control = via_quote_control;
    q.bump = ctx.bumps.pool_quote;
    init_escrow(
        &mut a.escrow,
        escrow_key,
        &mut a.holder_vote,
        &a.config,
        p,
        (ctx.bumps.escrow, ctx.bumps.vault, ctx.bumps.holder_vote),
        &a.operator.to_account_info(),
        &a.vault.to_account_info(),
        &a.system_program,
        true,
    )
}

/// Shared by both pool kinds: validates, freezes the escrow's terms, starts the holder-rewards
/// tally and tops the vault up to its rent floor (the operator pays).
#[allow(clippy::too_many_arguments)]
fn init_escrow<'info>(
    escrow: &mut Escrow,
    escrow_key: Pubkey,
    holder_vote: &mut HolderVote,
    config: &Config,
    p: CreateEscrowParams,
    (escrow_bump, vault_bump, holder_vote_bump): (u8, u8, u8),
    operator: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    system_program: &Program<'info, System>,
    token_pool: bool,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    validate(&p, config, now, token_pool)?;

    escrow.narrative_id = p.narrative_id;
    escrow.lock_hash = p.lock_hash;
    escrow.details_hash = p.details_hash;
    escrow.name = p.name;
    escrow.symbol = p.symbol;
    escrow.uri = p.uri;
    escrow.proposer = p.proposer;
    // Fee terms are frozen into the escrow; later config changes can't touch this pool.
    escrow.treasury = config.treasury;
    escrow.fee_bps = config.fee_bps;
    escrow.creator_fee_proposer_bps = config.creator_fee_proposer_bps;
    escrow.creator_fee_platform_bps = config.creator_fee_platform_bps;
    escrow.per_wallet_max = p.per_wallet_max;
    escrow.pool_cap = p.pool_cap;
    escrow.pool_min = p.pool_min;
    escrow.min_deposit = p.min_deposit;
    escrow.deposit_start = p.deposit_start;
    escrow.deposit_end = p.deposit_end;
    escrow.launch_after = p.launch_after;
    escrow.launch_deadline = p.launch_deadline;
    escrow.tranche_count = p.tranche_count;
    escrow.tranche_interval = p.tranche_interval;
    escrow.bump = escrow_bump;
    escrow.vault_bump = vault_bump;

    holder_vote.escrow = escrow_key;
    holder_vote.bump = holder_vote_bump;

    // The vault must stay rent-exempt for its whole life (pump also requires its payer to
    // end rent-exempt). Top it up to the floor; the operator pays.
    let rent_floor = Rent::get()?.minimum_balance(0);
    let have = vault.lamports();
    if have < rent_floor {
        system_program::transfer(
            CpiContext::new(
                system_program.key(),
                system_program::Transfer { from: operator.clone(), to: vault.clone() },
            ),
            rent_floor - have,
        )?;
    }

    emit!(EscrowCreated {
        escrow: escrow_key,
        narrative_id: escrow.narrative_id,
        lock_hash: escrow.lock_hash,
        proposer: escrow.proposer,
        pool_cap: escrow.pool_cap,
        pool_min: escrow.pool_min,
        per_wallet_max: escrow.per_wallet_max,
        fee_bps: escrow.fee_bps,
        deposit_start: escrow.deposit_start,
        deposit_end: escrow.deposit_end,
        launch_after: escrow.launch_after,
        launch_deadline: escrow.launch_deadline,
    });
    Ok(())
}
