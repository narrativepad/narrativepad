//! Raw CPI into pump.fun (`create_v2` + `buy_exact_quote_in_v2`), built by hand from the
//! vendored IDL (`idls/pump.json`, pump-public-docs@cb188ce) so we don't depend on pump's
//! client crate (Solana 2.x) from an Anchor 1.2 / Solana 3.x program.
//!
//! This module is the only venue-specific code. A different launch venue (e.g. Meteora DBC)
//! would replace it without touching escrow accounting.
//!
//! Safety model: pump validates its own accounts (PDAs, fee recipients, config). We pin the
//! pump program id, derive every account WE sign for or read, and check post-conditions in
//! `launch` (tokens actually landed in the vault's ATA; lamports spent <= pool).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;

use crate::constants::*;
use crate::errors::EscrowError;

/// Accounts pump needs that it validates itself, passed in this exact order as
/// `remaining_accounts` of `launch`. Kept in one place so the client and program agree.
pub mod ra {
    // create_v2 (pump-owned / mayhem-owned)
    pub const MINT_AUTHORITY: usize = 0;
    pub const BONDING_CURVE: usize = 1;
    pub const ASSOCIATED_BONDING_CURVE: usize = 2;
    pub const GLOBAL: usize = 3;
    pub const MAYHEM_PROGRAM: usize = 4;
    pub const GLOBAL_PARAMS: usize = 5;
    pub const SOL_VAULT: usize = 6;
    pub const MAYHEM_STATE: usize = 7;
    pub const MAYHEM_TOKEN_VAULT: usize = 8;
    pub const EVENT_AUTHORITY: usize = 9;
    // buy_exact_quote_in_v2
    pub const QUOTE_MINT: usize = 10;
    pub const QUOTE_TOKEN_PROGRAM: usize = 11;
    pub const FEE_RECIPIENT: usize = 12;
    pub const ASSOCIATED_QUOTE_FEE_RECIPIENT: usize = 13;
    pub const BUYBACK_FEE_RECIPIENT: usize = 14;
    pub const ASSOCIATED_QUOTE_BUYBACK_FEE_RECIPIENT: usize = 15;
    pub const ASSOCIATED_QUOTE_BONDING_CURVE: usize = 16;
    pub const ASSOCIATED_QUOTE_USER: usize = 17;
    pub const CREATOR_VAULT: usize = 18;
    pub const ASSOCIATED_CREATOR_VAULT: usize = 19;
    pub const SHARING_CONFIG: usize = 20;
    pub const GLOBAL_VOLUME_ACCUMULATOR: usize = 21;
    pub const USER_VOLUME_ACCUMULATOR: usize = 22;
    pub const ASSOCIATED_USER_VOLUME_ACCUMULATOR: usize = 23;
    pub const FEE_CONFIG: usize = 24;
    pub const FEE_PROGRAM: usize = 25;
    pub const COUNT: usize = 26;
}

pub fn bonding_curve_address(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"bonding-curve", mint.as_ref()], &PUMP_PROGRAM_ID).0
}

/// Associated token address (works for off-curve owners such as our vault PDA).
pub fn ata_address(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), token_program.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

fn meta(info: &AccountInfo, writable: bool, signer: bool) -> AccountMeta {
    if writable {
        AccountMeta::new(*info.key, signer)
    } else {
        AccountMeta::new_readonly(*info.key, signer)
    }
}

fn borsh_string(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(&(s.len() as u32).to_le_bytes());
    out.extend_from_slice(s.as_bytes());
}

pub struct CreateV2Accounts<'a, 'info> {
    pub mint: &'a AccountInfo<'info>,
    pub user: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    pub associated_token_program: &'a AccountInfo<'info>,
    pub pump_program: &'a AccountInfo<'info>,
    pub ra: &'a [AccountInfo<'info>],
}

/// The account pump makes a holder-rewards coin's creator: `["holder-rewards", mint]`.
pub fn holder_rewards_address(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"holder-rewards", mint.as_ref()], &PUMP_PROGRAM_ID).0
}

/// pump's `Global.is_holder_reward_enabled`. When it is off, `create_v2` rejects holder-reward
/// coins (`HolderRewardDisabled`), so the launch falls back to normal creator fees instead of
/// failing. Only pump's real Global is read; pump re-validates the same account in the CPI.
pub fn holder_rewards_enabled(global: &AccountInfo) -> Result<bool> {
    let expected = Pubkey::find_program_address(&[b"global"], &PUMP_PROGRAM_ID).0;
    require_keys_eq!(*global.key, expected, EscrowError::InvalidAccount);
    require_keys_eq!(*global.owner, PUMP_PROGRAM_ID, EscrowError::InvalidAccount);
    let data = global.try_borrow_data()?;
    Ok(data.len() > PUMP_GLOBAL_HOLDER_REWARD_FLAG_OFFSET && data[PUMP_GLOBAL_HOLDER_REWARD_FLAG_OFFSET] != 0)
}

/// pump's list of quote mints admitted outside Global's whitelist: `["quote-control"]`.
pub fn quote_control_address() -> Pubkey {
    Pubkey::find_program_address(&[b"quote-control"], &PUMP_PROGRAM_ID).0
}

/// The remaining accounts that make `create_v2` create a token-paired coin (D-023): the quote
/// mint, the curve's account for it, its token program, and the quote-control PDA when the
/// mint isn't in Global's whitelist. Omitted entirely for SOL.
pub struct QuoteAccounts<'a, 'info> {
    pub mint: &'a AccountInfo<'info>,
    pub associated_bonding_curve: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    pub quote_control: Option<&'a AccountInfo<'info>>,
}

/// `create_v2(name, symbol, uri, creator, is_mayhem_mode=false, cashback=false,
/// creator_fee_bps=0, is_holder_reward)`. Account order per idls/pump.json.
#[allow(clippy::too_many_arguments)]
pub fn create_v2<'a, 'info>(
    a: &CreateV2Accounts<'a, 'info>,
    name: &str,
    symbol: &str,
    uri: &str,
    creator: &Pubkey,
    is_holder_reward: bool,
    quote: Option<&QuoteAccounts<'a, 'info>>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let r = a.ra;
    let mut accounts = vec![
        meta(a.mint, true, true),
        meta(&r[ra::MINT_AUTHORITY], false, false),
        meta(&r[ra::BONDING_CURVE], true, false),
        meta(&r[ra::ASSOCIATED_BONDING_CURVE], true, false),
        meta(&r[ra::GLOBAL], false, false),
        meta(a.user, true, true),
        meta(a.system_program, false, false),
        meta(a.token_program, false, false),
        meta(a.associated_token_program, false, false),
        meta(&r[ra::MAYHEM_PROGRAM], true, false),
        meta(&r[ra::GLOBAL_PARAMS], false, false),
        meta(&r[ra::SOL_VAULT], true, false),
        meta(&r[ra::MAYHEM_STATE], true, false),
        meta(&r[ra::MAYHEM_TOKEN_VAULT], true, false),
        meta(&r[ra::EVENT_AUTHORITY], false, false),
        meta(a.pump_program, false, false),
    ];

    let mut data = Vec::with_capacity(8 + 4 * 3 + name.len() + symbol.len() + uri.len() + 32 + 11);
    data.extend_from_slice(&PUMP_IX_CREATE_V2);
    borsh_string(&mut data, name);
    borsh_string(&mut data, symbol);
    borsh_string(&mut data, uri);
    data.extend_from_slice(creator.as_ref());
    data.push(0); // is_mayhem_mode = false
    data.push(0); // is_cashback_enabled = OptionBool(false) (deprecated; must be false)
    data.extend_from_slice(&0u64.to_le_bytes()); // creator_fee_bps = OptionU64(0) (standard schedule)
    // is_holder_reward = OptionBool: true routes creator fees to the coin's holders (pump makes
    // the holder-rewards PDA the creator); false sends them to `creator`, our vault (D-006, D-022).
    data.push(is_holder_reward as u8);

    // Token pairs (D-023): pump reads the quote from remaining accounts after its named ones.
    let mut extra: Vec<AccountInfo<'info>> = Vec::new();
    if let Some(q) = quote {
        accounts.push(meta(q.mint, false, false));
        accounts.push(meta(q.associated_bonding_curve, true, false));
        accounts.push(meta(q.token_program, false, false));
        extra.extend([q.mint.clone(), q.associated_bonding_curve.clone(), q.token_program.clone()]);
        if let Some(qc) = q.quote_control {
            accounts.push(meta(qc, false, false));
            extra.push(qc.clone());
        }
    }

    let ix = Instruction { program_id: PUMP_PROGRAM_ID, accounts, data };
    let mut infos = vec![
        a.mint.clone(),
        r[ra::MINT_AUTHORITY].clone(),
        r[ra::BONDING_CURVE].clone(),
        r[ra::ASSOCIATED_BONDING_CURVE].clone(),
        r[ra::GLOBAL].clone(),
        a.user.clone(),
        a.system_program.clone(),
        a.token_program.clone(),
        a.associated_token_program.clone(),
        r[ra::MAYHEM_PROGRAM].clone(),
        r[ra::GLOBAL_PARAMS].clone(),
        r[ra::SOL_VAULT].clone(),
        r[ra::MAYHEM_STATE].clone(),
        r[ra::MAYHEM_TOKEN_VAULT].clone(),
        r[ra::EVENT_AUTHORITY].clone(),
        a.pump_program.clone(),
    ];
    infos.extend(extra);
    anchor_lang::solana_program::program::invoke_signed(&ix, &infos, signer_seeds)
        .map_err(Into::into)
}

pub struct BuyAccounts<'a, 'info> {
    pub base_mint: &'a AccountInfo<'info>,
    pub base_token_program: &'a AccountInfo<'info>,
    pub associated_token_program: &'a AccountInfo<'info>,
    pub user: &'a AccountInfo<'info>,
    pub associated_base_user: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
    pub pump_program: &'a AccountInfo<'info>,
    pub ra: &'a [AccountInfo<'info>],
}

/// `buy_exact_quote_in_v2(spendable_quote_in, min_tokens_out)`. For SOL-paired coins the
/// quote mint is wSOL but native lamports move from `user`.
pub fn buy_exact_quote_in_v2(
    a: &BuyAccounts,
    spendable_quote_in: u64,
    min_tokens_out: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let r = a.ra;
    let accounts = vec![
        meta(&r[ra::GLOBAL], false, false),
        meta(a.base_mint, false, false),
        meta(&r[ra::QUOTE_MINT], false, false),
        meta(a.base_token_program, false, false),
        meta(&r[ra::QUOTE_TOKEN_PROGRAM], false, false),
        meta(a.associated_token_program, false, false),
        meta(&r[ra::FEE_RECIPIENT], true, false),
        meta(&r[ra::ASSOCIATED_QUOTE_FEE_RECIPIENT], true, false),
        meta(&r[ra::BUYBACK_FEE_RECIPIENT], true, false),
        meta(&r[ra::ASSOCIATED_QUOTE_BUYBACK_FEE_RECIPIENT], true, false),
        meta(&r[ra::BONDING_CURVE], true, false),
        meta(&r[ra::ASSOCIATED_BONDING_CURVE], true, false),
        meta(&r[ra::ASSOCIATED_QUOTE_BONDING_CURVE], true, false),
        meta(a.user, true, true),
        meta(a.associated_base_user, true, false),
        meta(&r[ra::ASSOCIATED_QUOTE_USER], true, false),
        meta(&r[ra::CREATOR_VAULT], true, false),
        meta(&r[ra::ASSOCIATED_CREATOR_VAULT], true, false),
        meta(&r[ra::SHARING_CONFIG], false, false),
        meta(&r[ra::GLOBAL_VOLUME_ACCUMULATOR], false, false),
        meta(&r[ra::USER_VOLUME_ACCUMULATOR], true, false),
        meta(&r[ra::ASSOCIATED_USER_VOLUME_ACCUMULATOR], true, false),
        meta(&r[ra::FEE_CONFIG], false, false),
        meta(&r[ra::FEE_PROGRAM], false, false),
        meta(a.system_program, false, false),
        meta(&r[ra::EVENT_AUTHORITY], false, false),
        meta(a.pump_program, false, false),
    ];

    let mut data = Vec::with_capacity(24);
    data.extend_from_slice(&PUMP_IX_BUY_EXACT_QUOTE_IN_V2);
    data.extend_from_slice(&spendable_quote_in.to_le_bytes());
    data.extend_from_slice(&min_tokens_out.to_le_bytes());

    let ix = Instruction { program_id: PUMP_PROGRAM_ID, accounts, data };
    let infos = [
        r[ra::GLOBAL].clone(),
        a.base_mint.clone(),
        r[ra::QUOTE_MINT].clone(),
        a.base_token_program.clone(),
        r[ra::QUOTE_TOKEN_PROGRAM].clone(),
        a.associated_token_program.clone(),
        r[ra::FEE_RECIPIENT].clone(),
        r[ra::ASSOCIATED_QUOTE_FEE_RECIPIENT].clone(),
        r[ra::BUYBACK_FEE_RECIPIENT].clone(),
        r[ra::ASSOCIATED_QUOTE_BUYBACK_FEE_RECIPIENT].clone(),
        r[ra::BONDING_CURVE].clone(),
        r[ra::ASSOCIATED_BONDING_CURVE].clone(),
        r[ra::ASSOCIATED_QUOTE_BONDING_CURVE].clone(),
        a.user.clone(),
        a.associated_base_user.clone(),
        r[ra::ASSOCIATED_QUOTE_USER].clone(),
        r[ra::CREATOR_VAULT].clone(),
        r[ra::ASSOCIATED_CREATOR_VAULT].clone(),
        r[ra::SHARING_CONFIG].clone(),
        r[ra::GLOBAL_VOLUME_ACCUMULATOR].clone(),
        r[ra::USER_VOLUME_ACCUMULATOR].clone(),
        r[ra::ASSOCIATED_USER_VOLUME_ACCUMULATOR].clone(),
        r[ra::FEE_CONFIG].clone(),
        r[ra::FEE_PROGRAM].clone(),
        a.system_program.clone(),
        r[ra::EVENT_AUTHORITY].clone(),
        a.pump_program.clone(),
    ];
    anchor_lang::solana_program::program::invoke_signed(&ix, &infos, signer_seeds)
        .map_err(Into::into)
}

/// The fields of pump's `BondingCurve` account that the launch needs.
pub struct CurveState {
    pub virtual_token_reserves: u64,
    pub virtual_quote_reserves: u64,
    pub real_token_reserves: u64,
    pub complete: bool,
    pub creator: Pubkey,
}

/// Reads a pump `BondingCurve` (layout from idls/pump.json: disc, 5x u64, bool, pubkey, ...).
pub fn read_curve(info: &AccountInfo) -> Result<CurveState> {
    require_keys_eq!(*info.owner, PUMP_PROGRAM_ID, EscrowError::InvalidBondingCurve);
    let data = info.try_borrow_data()?;
    require!(data.len() >= 81, EscrowError::InvalidBondingCurve);
    require!(data[..8] == PUMP_ACCOUNT_BONDING_CURVE, EscrowError::InvalidBondingCurve);
    let u64_at = |o: usize| u64::from_le_bytes(data[o..o + 8].try_into().unwrap());
    Ok(CurveState {
        virtual_token_reserves: u64_at(8),
        virtual_quote_reserves: u64_at(16),
        real_token_reserves: u64_at(24),
        complete: data[48] != 0,
        creator: Pubkey::new_from_array(data[49..81].try_into().unwrap()),
    })
}

/// The balance of a token pool's account for its token (D-023): owned by the pool token's
/// program (SPL Token or Token-2022), holding `mint`, owned by `owner`.
pub fn read_quote_balance(info: &AccountInfo, token_program: &Pubkey, mint: &Pubkey, owner: &Pubkey) -> Result<u64> {
    require_keys_eq!(*info.owner, *token_program, EscrowError::InvalidAccount);
    let data = info.try_borrow_data()?;
    require!(data.len() >= 72, EscrowError::InvalidAccount);
    require!(data[0..32] == mint.to_bytes() && data[32..64] == owner.to_bytes(), EscrowError::InvalidAccount);
    Ok(u64::from_le_bytes(data[64..72].try_into().unwrap()))
}

/// Reads (mint, owner, amount) from a Token-2022 token account's base layout (the coin's).
pub fn read_token_account(info: &AccountInfo) -> Result<(Pubkey, Pubkey, u64)> {
    require_keys_eq!(*info.owner, TOKEN_2022_PROGRAM_ID, EscrowError::InvalidAccount);
    let data = info.try_borrow_data()?;
    require!(data.len() >= 72, EscrowError::InvalidAccount);
    Ok((
        Pubkey::new_from_array(data[0..32].try_into().unwrap()),
        Pubkey::new_from_array(data[32..64].try_into().unwrap()),
        u64::from_le_bytes(data[64..72].try_into().unwrap()),
    ))
}
