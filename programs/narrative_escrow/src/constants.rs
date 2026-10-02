use anchor_lang::prelude::*;

// ---- PDA seeds ----------------------------------------------------------------------------
pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_ESCROW: &[u8] = b"escrow";
pub const SEED_VAULT: &[u8] = b"vault";
pub const SEED_RECEIPT: &[u8] = b"receipt";
pub const SEED_MINT: &[u8] = b"mint";
/// Per-escrow holder-rewards tally (D-022). Its own account, so escrows created before it keep
/// their layout.
pub const SEED_HOLDER_VOTE: &[u8] = b"holder_vote";
/// Token pools (D-023): the coin's pump quote token, held by the vault's ATA. No account = SOL pool.
pub const SEED_POOL_QUOTE: &[u8] = b"pool_quote";

// ---- Fees ---------------------------------------------------------------------------------
pub const BPS_DENOMINATOR: u64 = 10_000;
/// Hard ceiling on the platform fee. Compile-time, so no admin can ever exceed it (D-007).
pub const MAX_FEE_BPS: u16 = 200;

// ---- Launch safety ------------------------------------------------------------------------
/// Lamports held back from the opening buy to pay rent for the accounts pump creates
/// (mint, bonding curve, ATAs, volume accumulator). Unspent remainder is refunded pro-rata.
pub const LAUNCH_RENT_RESERVE: u64 = 50_000_000; // 0.05 SOL
/// Token pools hold no SOL, so the cranker lends the vault this much for the launch's rents and
/// gets the unspent part back in the same instruction (D-023).
pub const TOKEN_LAUNCH_RENT: u64 = 50_000_000; // 0.05 SOL
/// Worst-case pump fee we assume when computing `min_tokens_out`. Pump charges 125 bps
/// today; if it ever charges more than this the launch reverts and the escrow refunds.
pub const MAX_ASSUMED_PUMP_FEE_BPS: u64 = 300;
/// The opening buy may take at most this share of the curve's real token reserves, so the
/// pool can never complete the curve on its own.
pub const MAX_CURVE_FILL_BPS: u64 = 9_000;

// ---- Escrow parameter bounds --------------------------------------------------------------
pub const NAME_MAX_LEN: usize = 32;
pub const SYMBOL_MAX_LEN: usize = 13;
pub const URI_MAX_LEN: usize = 200;
pub const MIN_POOL_MIN: u64 = 100_000_000; // 0.1 SOL
pub const MIN_DEPOSIT_WINDOW_SECS: i64 = 60;
pub const MAX_DEPOSIT_WINDOW_SECS: i64 = 7 * 24 * 60 * 60;
pub const MIN_LAUNCH_WINDOW_SECS: i64 = 60;
/// Longest time funds can sit between deposit close and the refund deadline.
pub const MAX_LAUNCH_WAIT_SECS: i64 = 24 * 60 * 60;
pub const MAX_TRANCHES: u8 = 20;
pub const MAX_TRANCHE_INTERVAL_SECS: i64 = 30 * 24 * 60 * 60;
/// Creator fees are only distributed in chunks of at least this many lamports, so every
/// recipient's share stays above the rent-exempt minimum of an empty account.
pub const MIN_CREATOR_FEE_DISTRIBUTION: u64 = 10_000_000; // 0.01 SOL

pub const LOCK_HASH_DOMAIN: &[u8] = b"narrativepad:lock:v1";

// ---- External programs (CPI targets are pinned; never taken from user input) ------------
pub const PUMP_PROGRAM_ID: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
pub const PUMP_FEE_PROGRAM_ID: Pubkey = pubkey!("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
pub const MAYHEM_PROGRAM_ID: Pubkey = pubkey!("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
/// Token-2022's native mint; pump rejects it as a quote.
pub const TOKEN_2022_NATIVE_MINT: Pubkey = pubkey!("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP");

// pump instruction discriminators (Anchor sighash; verified against idls/pump.json in tests)
pub const PUMP_IX_CREATE_V2: [u8; 8] = [214, 144, 76, 236, 95, 139, 49, 180];
pub const PUMP_IX_BUY_EXACT_QUOTE_IN_V2: [u8; 8] = [194, 171, 28, 70, 104, 77, 91, 47];
pub const PUMP_ACCOUNT_BONDING_CURVE: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];
/// pump `Global.is_holder_reward_enabled` (idls/pump.json: the last field of the 1087-byte layout;
/// later fields are appended after it, as devnet's 1088-byte Global shows).
pub const PUMP_GLOBAL_HOLDER_REWARD_FLAG_OFFSET: usize = 1086;
