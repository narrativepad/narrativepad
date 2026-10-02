use anchor_lang::prelude::*;

use crate::constants::{NAME_MAX_LEN, SYMBOL_MAX_LEN, URI_MAX_LEN};

/// Global settings. Changes only affect escrows created afterwards: every escrow copies the
/// values it needs at creation and never reads `Config` again.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// May create escrows (within the bounds below). Cannot move funds.
    pub operator: Pubkey,
    /// Receives the platform fee and the platform share of creator fees.
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub creator_fee_proposer_bps: u16,
    pub creator_fee_platform_bps: u16,
    /// Upper bound for any escrow's pool cap. Set per cluster so the opening buy stays well
    /// inside pump's bonding curve (devnet's curve is ~30x smaller than mainnet's).
    pub max_pool_cap: u64,
    pub bump: u8,
}

/// One escrow per narrative. Holds no lamports itself; pooled SOL sits in the `vault` PDA.
#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub narrative_id: [u8; 16],
    pub lock_hash: [u8; 32],
    pub details_hash: [u8; 32],
    #[max_len(NAME_MAX_LEN)]
    pub name: String,
    #[max_len(SYMBOL_MAX_LEN)]
    pub symbol: String,
    #[max_len(URI_MAX_LEN)]
    pub uri: String,

    pub proposer: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub creator_fee_proposer_bps: u16,
    pub creator_fee_platform_bps: u16,

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

    pub total_deposited: u64,
    pub total_refunded: u64,
    pub depositor_count: u32,
    pub next_order_index: u32,

    pub launched: bool,
    pub launched_at: i64,
    pub mint: Pubkey,
    pub tokens_bought: u64,
    pub tokens_claimed: u64,
    /// Pool lamports not spent by the launch; owed to depositors pro-rata.
    pub base_leftover: u64,
    pub base_leftover_claimed: u64,
    /// Cumulative creator-fee lamports credited to depositors (pro-rata, pull-based).
    pub creator_fees_depositors_total: u64,
    pub creator_fees_depositors_claimed: u64,
    /// Cumulative creator-fee income processed (all recipients), for display.
    pub creator_fees_distributed_total: u64,
    pub receipts_fully_claimed: u32,

    pub bump: u8,
    pub vault_bump: u8,
}

/// The escrow's lifecycle is a pure function of time and pool state (ARCHITECTURE.md §3.2).
/// No instruction can move an escrow between phases except `launch` (sets `launched`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Scheduled,
    Pooling,
    Closing,
    Launchable,
    Released,
    Refundable,
}

impl Escrow {
    pub fn phase(&self, now: i64) -> Phase {
        if self.launched {
            return Phase::Released;
        }
        if now < self.deposit_start {
            return Phase::Scheduled;
        }
        if now < self.deposit_end {
            return Phase::Pooling;
        }
        // Window closed and not launched. Refundable is permanent once reached: neither the
        // deadline nor an under-minimum total can be undone (no deposits after deposit_end).
        if now >= self.launch_deadline || self.total_deposited < self.pool_min {
            return Phase::Refundable;
        }
        if now < self.launch_after {
            return Phase::Closing;
        }
        Phase::Launchable
    }

    /// Lamports in the vault that belong to someone (rent floor excluded).
    pub fn vault_obligations(&self) -> Option<u64> {
        if self.launched {
            let leftover = self.base_leftover.checked_sub(self.base_leftover_claimed)?;
            let fees = self
                .creator_fees_depositors_total
                .checked_sub(self.creator_fees_depositors_claimed)?;
            leftover.checked_add(fees)
        } else {
            self.total_deposited.checked_sub(self.total_refunded)
        }
    }
}

/// The pool's holder-rewards vote (D-022): lamports deposited with each answer. Created with the
/// escrow (or on the first deposit for escrows from before D-022) and settled once by `launch`,
/// which turns pump's holder rewards on only if `on > off` and pump has them enabled.
#[account]
#[derive(InitSpace)]
pub struct HolderVote {
    pub escrow: Pubkey,
    pub on: u64,
    pub off: u64,
    /// Set by `launch`: the coin was created with pump's holder rewards.
    pub applied: bool,
    pub bump: u8,
}

impl HolderVote {
    /// Reads the tally behind an address checked by seeds. An account that was never created
    /// (an escrow from before D-022 with no new deposits) is an empty tally.
    pub fn read(info: &AccountInfo) -> Result<Option<HolderVote>> {
        if info.data_is_empty() {
            return Ok(None);
        }
        require_keys_eq!(*info.owner, crate::ID, crate::errors::EscrowError::InvalidAccount);
        let data = info.try_borrow_data()?;
        Ok(Some(HolderVote::try_deserialize(&mut &data[..])?))
    }

    /// Holder rewards win only with strictly more SOL behind "on"; a tie keeps them off.
    pub fn wants_on(vote: Option<&HolderVote>) -> bool {
        vote.map(|v| v.on > v.off).unwrap_or(false)
    }
}

/// A token pool (D-023): the pool is denominated in `mint`, the coin's pump quote token, held by
/// the vault's associated token account. `Escrow` amounts (deposits, caps, refunds, tokens owed)
/// are then in `mint` base units. Escrows without this account are SOL pools.
#[account]
#[derive(InitSpace)]
pub struct PoolQuote {
    pub escrow: Pubkey,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    /// pump admits `mint` through its quote-control list rather than Global's whitelist, so
    /// `create_v2` also needs the quote-control PDA.
    pub via_quote_control: bool,
    /// Quote tokens the launch didn't spend; owed to depositors pro-rata via `claim_token`.
    pub quote_leftover: u64,
    pub quote_leftover_claimed: u64,
    pub bump: u8,
}

impl PoolQuote {
    /// Reads the account behind an address checked by seeds; `None` means a SOL pool.
    pub fn read(info: &AccountInfo) -> Result<Option<PoolQuote>> {
        if info.data_is_empty() {
            return Ok(None);
        }
        require_keys_eq!(*info.owner, crate::ID, crate::errors::EscrowError::InvalidAccount);
        let data = info.try_borrow_data()?;
        Ok(Some(PoolQuote::try_deserialize(&mut &data[..])?))
    }

    /// SOL-only instructions take the PDA unchecked and call this, so a token pool's units can
    /// never be paid out as lamports (or the reverse).
    pub fn require_sol_pool(info: &AccountInfo) -> Result<()> {
        require!(info.data_is_empty(), crate::errors::EscrowError::TokenPool);
        Ok(())
    }
}

/// One per (escrow, depositor wallet). Every individual deposit is also emitted as an event
/// with its own order index; this account aggregates them.
#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub escrow: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
    pub first_order_index: u32,
    pub first_slot: u64,
    pub deposit_count: u32,
    pub tokens_claimed: u64,
    pub leftover_paid: bool,
    pub creator_fees_claimed: u64,
    pub fully_claimed: bool,
    pub bump: u8,
}
