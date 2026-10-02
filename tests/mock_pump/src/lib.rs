//! TEST ONLY. A minimal stand-in for pump.fun, loaded at pump's program id inside LiteSVM so
//! the escrow's `launch` can be tested deterministically, including hostile behaviour.
//! Instruction names, discriminators, argument encoding and account ORDER match the real
//! program (idls/pump.json); the internals are simplified. Never deploy this.
//!
//! The coin name selects a behaviour, so escrow tests can exercise failure paths:
//!   "FAIL_CREATE…" create_v2 errors           "FAIL_BUY…"  buy errors
//!   "OVERSPEND…"   buy drains the vault        "SHORT…"     buy delivers 1 base unit
//!   "BAD_CREATOR…" curve records another creator

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, CreateAccount, Transfer};
use anchor_spl::associated_token::{self, Create as CreateAta};
use anchor_spl::token_2022::{self, InitializeMint2, MintTo, TransferChecked};

declare_id!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

pub const BONDING_CURVE_DISC: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];
pub const INITIAL_VIRTUAL_TOKEN_RESERVES: u64 = 1_073_000_000_000_000;
pub const INITIAL_VIRTUAL_QUOTE_RESERVES: u64 = 30_000_000_000;
pub const INITIAL_REAL_TOKEN_RESERVES: u64 = 793_100_000_000_000;
pub const TOKEN_TOTAL_SUPPLY: u64 = 1_000_000_000_000_000;
pub const DECIMALS: u8 = 6;
const CURVE_LEN: usize = 126;
const MODE_OFFSET: usize = 125;

pub mod mode {
    pub const NORMAL: u8 = 0;
    pub const FAIL_BUY: u8 = 1;
    pub const OVERSPEND: u8 = 2;
    pub const SHORT: u8 = 3;
}

fn mode_for(name: &str) -> u8 {
    if name.starts_with("FAIL_BUY") {
        mode::FAIL_BUY
    } else if name.starts_with("OVERSPEND") {
        mode::OVERSPEND
    } else if name.starts_with("SHORT") {
        mode::SHORT
    } else {
        mode::NORMAL
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OptionBool(pub bool);

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OptionU64(pub u64);

#[error_code]
pub enum MockError {
    CreateFailed,
    BuyFailed,
    Slippage,
}

fn put_u64(d: &mut [u8], off: usize, v: u64) {
    d[off..off + 8].copy_from_slice(&v.to_le_bytes());
}
fn get_u64(d: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(d[off..off + 8].try_into().unwrap())
}

#[program]
pub mod mock_pump {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn create_v2(
        ctx: Context<CreateV2>,
        name: String,
        _symbol: String,
        _uri: String,
        creator: Pubkey,
        _is_mayhem_mode: bool,
        _is_cashback_enabled: OptionBool,
        _creator_fee_bps: OptionU64,
        _is_holder_reward: OptionBool,
    ) -> Result<()> {
        require!(!name.starts_with("FAIL_CREATE"), MockError::CreateFailed);
        let a = &ctx.accounts;
        let rent = Rent::get()?;
        let sys = a.system_program.key();
        let tok = a.token_program.key();

        system_program::create_account(
            CpiContext::new(sys, CreateAccount { from: a.user.to_account_info(), to: a.mint.to_account_info() }),
            rent.minimum_balance(82),
            82,
            &token_2022::ID,
        )?;
        token_2022::initialize_mint2(
            CpiContext::new(tok, InitializeMint2 { mint: a.mint.to_account_info() }),
            DECIMALS,
            &a.mint_authority.key(),
            None,
        )?;

        let mint_key = a.mint.key();
        let bc_bump = [ctx.bumps.bonding_curve];
        let bc_seeds: &[&[u8]] = &[b"bonding-curve", mint_key.as_ref(), &bc_bump];
        system_program::create_account(
            CpiContext::new_with_signer(
                sys,
                CreateAccount { from: a.user.to_account_info(), to: a.bonding_curve.to_account_info() },
                &[bc_seeds],
            ),
            rent.minimum_balance(CURVE_LEN),
            CURVE_LEN as u64,
            &crate::ID,
        )?;
        {
            let mut d = a.bonding_curve.try_borrow_mut_data()?;
            d[..8].copy_from_slice(&BONDING_CURVE_DISC);
            put_u64(&mut d, 8, INITIAL_VIRTUAL_TOKEN_RESERVES);
            put_u64(&mut d, 16, INITIAL_VIRTUAL_QUOTE_RESERVES);
            put_u64(&mut d, 24, INITIAL_REAL_TOKEN_RESERVES);
            put_u64(&mut d, 32, 0);
            put_u64(&mut d, 40, TOKEN_TOTAL_SUPPLY);
            d[48] = 0;
            let recorded = if name.starts_with("BAD_CREATOR") { crate::ID } else { creator };
            d[49..81].copy_from_slice(recorded.as_ref());
            d[MODE_OFFSET] = mode_for(&name);
        }

        associated_token::create(CpiContext::new(
            a.associated_token_program.key(),
            CreateAta {
                payer: a.user.to_account_info(),
                associated_token: a.associated_bonding_curve.to_account_info(),
                authority: a.bonding_curve.to_account_info(),
                mint: a.mint.to_account_info(),
                system_program: a.system_program.to_account_info(),
                token_program: a.token_program.to_account_info(),
            },
        ))?;
        let ma_bump = [ctx.bumps.mint_authority];
        let ma_seeds: &[&[u8]] = &[b"mint-authority", &ma_bump];
        token_2022::mint_to(
            CpiContext::new_with_signer(
                tok,
                MintTo {
                    mint: a.mint.to_account_info(),
                    to: a.associated_bonding_curve.to_account_info(),
                    authority: a.mint_authority.to_account_info(),
                },
                &[ma_seeds],
            ),
            TOKEN_TOTAL_SUPPLY,
        )?;
        Ok(())
    }

    pub fn buy_exact_quote_in_v2(
        ctx: Context<BuyExactQuoteInV2>,
        spendable_quote_in: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        let a = &ctx.accounts;
        let (vt, vq, rt, rq, m) = {
            let d = a.bonding_curve.try_borrow_data()?;
            (get_u64(&d, 8), get_u64(&d, 16), get_u64(&d, 24), get_u64(&d, 32), d[MODE_OFFSET])
        };
        require!(m != mode::FAIL_BUY, MockError::BuyFailed);

        // Same arithmetic as pump's SDK at a 125 bps total fee.
        let net = (spendable_quote_in.saturating_sub(1) as u128 * 10_000 / 10_125) as u64;
        let out = ((net as u128 * vt as u128) / (vq as u128 + net as u128)) as u64;
        let out = out.min(rt);
        if m != mode::SHORT {
            require!(out >= min_tokens_out, MockError::Slippage);
        }

        // OVERSPEND drains the buyer (the escrow vault) completely. That is more than the pool
        // after the fee, since the vault also holds its rent floor, so the escrow's post-condition
        // `spent <= pool_after_fee` must reject it. A smaller overspend that stays inside the
        // 0.05 SOL launch reserve is allowed by design, and asking for more than the vault holds
        // fails in the System Program before the post-condition ever runs.
        let take = if m == mode::OVERSPEND { a.user.lamports() } else { spendable_quote_in };
        system_program::transfer(
            CpiContext::new(
                a.system_program.key(),
                Transfer { from: a.user.to_account_info(), to: a.bonding_curve.to_account_info() },
            ),
            take,
        )?;

        let send = if m == mode::SHORT { 1 } else { out };
        let mint_key = a.base_mint.key();
        let bc_bump = [ctx.bumps.bonding_curve];
        let bc_seeds: &[&[u8]] = &[b"bonding-curve", mint_key.as_ref(), &bc_bump];
        token_2022::transfer_checked(
            CpiContext::new_with_signer(
                a.base_token_program.key(),
                TransferChecked {
                    from: a.associated_base_bonding_curve.to_account_info(),
                    mint: a.base_mint.to_account_info(),
                    to: a.associated_base_user.to_account_info(),
                    authority: a.bonding_curve.to_account_info(),
                },
                &[bc_seeds],
            ),
            send,
            DECIMALS,
        )?;

        let mut d = a.bonding_curve.try_borrow_mut_data()?;
        put_u64(&mut d, 8, vt - out);
        put_u64(&mut d, 16, vq + net);
        put_u64(&mut d, 24, rt - out);
        put_u64(&mut d, 32, rq + net);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateV2<'info> {
    #[account(mut)]
    pub mint: Signer<'info>,
    /// CHECK: mock PDA used as mint authority.
    #[account(seeds = [b"mint-authority"], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: created here.
    #[account(mut, seeds = [b"bonding-curve", mint.key().as_ref()], bump)]
    pub bonding_curve: UncheckedAccount<'info>,
    /// CHECK: created here via the ATA program.
    #[account(mut)]
    pub associated_bonding_curve: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub global: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Token-2022.
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: ATA program.
    pub associated_token_program: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub mayhem_program_id: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub global_params: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub sol_vault: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub mayhem_state: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub mayhem_token_vault: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct BuyExactQuoteInV2<'info> {
    /// CHECK: unused by the mock.
    pub global: UncheckedAccount<'info>,
    /// CHECK: the coin.
    pub base_mint: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub quote_mint: UncheckedAccount<'info>,
    /// CHECK: Token-2022.
    pub base_token_program: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub quote_token_program: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub associated_token_program: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub fee_recipient: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub associated_quote_fee_recipient: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub buyback_fee_recipient: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub associated_quote_buyback_fee_recipient: UncheckedAccount<'info>,
    /// CHECK: verified by seeds.
    #[account(mut, seeds = [b"bonding-curve", base_mint.key().as_ref()], bump)]
    pub bonding_curve: UncheckedAccount<'info>,
    /// CHECK: curve's token account.
    #[account(mut)]
    pub associated_base_bonding_curve: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub associated_quote_bonding_curve: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: buyer's token account.
    #[account(mut)]
    pub associated_base_user: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub associated_quote_user: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub creator_vault: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub associated_creator_vault: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub sharing_config: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub global_volume_accumulator: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub user_volume_accumulator: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    #[account(mut)]
    pub associated_user_volume_accumulator: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub fee_config: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub fee_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: unused by the mock.
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: unused by the mock.
    pub program: UncheckedAccount<'info>,
}
