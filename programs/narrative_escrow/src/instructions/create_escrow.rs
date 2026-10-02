use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::EscrowError;
use crate::events::EscrowCreated;
use crate::math;
use crate::state::{Config, Escrow};

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
}

fn validate(p: &CreateEscrowParams, config: &Config, now: i64) -> Result<()> {
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
            && p.pool_cap <= config.max_pool_cap
            && p.pool_min >= MIN_POOL_MIN
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
    let now = Clock::get()?.unix_timestamp;
    validate(&p, &ctx.accounts.config, now)?;

    let config = &ctx.accounts.config;
    let escrow_key = ctx.accounts.escrow.key();
    let escrow = &mut ctx.accounts.escrow;
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
    escrow.bump = ctx.bumps.escrow;
    escrow.vault_bump = ctx.bumps.vault;

    // The vault must stay rent-exempt for its whole life (pump also requires its payer to
    // end rent-exempt). Top it up to the floor; the operator pays.
    let rent_floor = Rent::get()?.minimum_balance(0);
    let have = ctx.accounts.vault.lamports();
    if have < rent_floor {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.operator.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
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
