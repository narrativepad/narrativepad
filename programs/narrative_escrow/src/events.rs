use anchor_lang::prelude::*;

#[event]
pub struct EscrowCreated {
    pub escrow: Pubkey,
    pub narrative_id: [u8; 16],
    pub lock_hash: [u8; 32],
    pub proposer: Pubkey,
    pub pool_cap: u64,
    pub pool_min: u64,
    pub per_wallet_max: u64,
    pub fee_bps: u16,
    pub deposit_start: i64,
    pub deposit_end: i64,
    pub launch_after: i64,
    pub launch_deadline: i64,
}

#[event]
pub struct Deposited {
    pub escrow: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
    pub order_index: u32,
    pub slot: u64,
    pub timestamp: i64,
    pub wallet_total: u64,
    pub pool_total: u64,
}

#[event]
pub struct Refunded {
    pub escrow: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Launched {
    pub escrow: Pubkey,
    pub mint: Pubkey,
    pub pool_total: u64,
    pub platform_fee: u64,
    pub buy_budget: u64,
    pub tokens_bought: u64,
    pub base_leftover: u64,
    pub launched_at: i64,
}

#[event]
pub struct Claimed {
    pub escrow: Pubkey,
    pub wallet: Pubkey,
    pub tokens: u64,
    pub leftover_lamports: u64,
    pub creator_fee_lamports: u64,
    pub unlocked_tranches: u8,
}

#[event]
pub struct CreatorFeesDistributed {
    pub escrow: Pubkey,
    pub total: u64,
    pub proposer_share: u64,
    pub platform_share: u64,
    pub depositors_share: u64,
}

#[event]
pub struct DustBurned {
    pub escrow: Pubkey,
    pub amount: u64,
}
