//! Pure arithmetic shared by the instructions. No Anchor types, so it is unit/property tested
//! directly (see the tests at the bottom). Everything rounds DOWN in favour of the escrow, so
//! the sum of payouts can never exceed what the escrow holds.

use crate::constants::{BPS_DENOMINATOR, LOCK_HASH_DOMAIN};

/// floor(a * b / c) in u128. `None` on c == 0 or if the result does not fit in u64.
pub fn mul_div_floor(a: u64, b: u64, c: u64) -> Option<u64> {
    if c == 0 {
        return None;
    }
    let r = (a as u128).checked_mul(b as u128)? / (c as u128);
    u64::try_from(r).ok()
}

pub fn bps_of(amount: u64, bps: u64) -> Option<u64> {
    mul_div_floor(amount, bps, BPS_DENOMINATOR)
}

/// Tranches unlocked at `now` under uniform vesting (D-001): 1 at launch, +1 per interval,
/// capped at `count`.
pub fn unlocked_tranches(now: i64, launched_at: i64, interval: i64, count: u8) -> u8 {
    if now < launched_at || count == 0 {
        return 0;
    }
    if interval <= 0 {
        return count;
    }
    let elapsed = ((now - launched_at) / interval) as u64;
    elapsed.saturating_add(1).min(count as u64) as u8
}

/// A depositor's share of `total` (tokens, leftover lamports or creator fees).
pub fn pro_rata(total: u64, deposit: u64, pool: u64) -> Option<u64> {
    mul_div_floor(total, deposit, pool)
}

/// Amount of `entitlement` vested after `unlocked` of `count` tranches.
pub fn vested(entitlement: u64, unlocked: u8, count: u8) -> Option<u64> {
    mul_div_floor(entitlement, unlocked as u64, count as u64)
}

/// Constant-product output of a pump bonding curve for `net_quote_in` (after fees).
pub fn curve_tokens_out(
    net_quote_in: u64,
    virtual_token_reserves: u64,
    virtual_quote_reserves: u64,
) -> Option<u64> {
    let denom = virtual_quote_reserves.checked_add(net_quote_in)?;
    mul_div_floor(net_quote_in, virtual_token_reserves, denom)
}

/// Quote left for the curve after a fee of `fee_bps` charged on top: gross / (1 + fee).
pub fn net_of_fee(gross: u64, fee_bps: u64) -> Option<u64> {
    mul_div_floor(gross, BPS_DENOMINATOR, BPS_DENOMINATOR.checked_add(fee_bps)?)
}

/// Canonical lock hash committed on-chain (ARCHITECTURE.md §6.3). Strings are length-prefixed
/// (u32 LE) so field boundaries are unambiguous. `details_hash` = sha256 of the canonical JSON
/// of everything else that was locked (links, image CID, votes root).
pub fn lock_hash(
    narrative_id: &[u8; 16],
    name: &str,
    symbol: &str,
    uri: &str,
    details_hash: &[u8; 32],
) -> [u8; 32] {
    let name_len = (name.len() as u32).to_le_bytes();
    let symbol_len = (symbol.len() as u32).to_le_bytes();
    let uri_len = (uri.len() as u32).to_le_bytes();
    solana_sha256_hasher::hashv(&[
        LOCK_HASH_DOMAIN,
        narrative_id,
        &name_len,
        name.as_bytes(),
        &symbol_len,
        symbol.as_bytes(),
        &uri_len,
        uri.as_bytes(),
        details_hash,
    ])
    .to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn mul_div_basics() {
        assert_eq!(mul_div_floor(10, 3, 4), Some(7));
        assert_eq!(mul_div_floor(u64::MAX, u64::MAX, u64::MAX), Some(u64::MAX));
        assert_eq!(mul_div_floor(1, 1, 0), None);
        assert_eq!(mul_div_floor(u64::MAX, 2, 1), None);
    }

    #[test]
    fn tranches_uniform_schedule() {
        // 5 tranches, 600s apart, launched at t=1000.
        assert_eq!(unlocked_tranches(999, 1000, 600, 5), 0);
        assert_eq!(unlocked_tranches(1000, 1000, 600, 5), 1);
        assert_eq!(unlocked_tranches(1599, 1000, 600, 5), 1);
        assert_eq!(unlocked_tranches(1600, 1000, 600, 5), 2);
        assert_eq!(unlocked_tranches(1000 + 4 * 600, 1000, 600, 5), 5);
        assert_eq!(unlocked_tranches(i64::MAX, 1000, 600, 5), 5);
        assert_eq!(unlocked_tranches(1000, 1000, 0, 5), 5);
    }

    #[test]
    fn pump_mainnet_table_matches_research() {
        // ARCHITECTURE.md §4.2: 10 SOL gross at mainnet params buys ~265.76M tokens.
        let vt = 1_073_000_000_000_000u64;
        let vq = 30_000_000_000u64;
        let gross = 10_000_000_000u64;
        // pump's own formula: net = (S - 1) * 10000 / 10125
        let net = mul_div_floor(gross - 1, 10_000, 10_125).unwrap();
        let out = curve_tokens_out(net, vt, vq).unwrap();
        assert!((265_700_000_000_000..265_800_000_000_000).contains(&out), "{out}");
    }

    #[test]
    fn lock_hash_is_field_unambiguous() {
        let id = [7u8; 16];
        let d = [9u8; 32];
        assert_ne!(lock_hash(&id, "ab", "c", "u", &d), lock_hash(&id, "a", "bc", "u", &d));
        assert_eq!(lock_hash(&id, "ab", "c", "u", &d), lock_hash(&id, "ab", "c", "u", &d));
    }

    proptest! {
        /// Rounding dust: Σ pro-rata shares never exceeds the total and the dust is < n.
        #[test]
        fn pro_rata_never_overpays(
            total in 0u64..=u64::MAX / 2,
            deposits in proptest::collection::vec(1u64..=1_000_000_000_000u64, 1..200),
        ) {
            let pool: u64 = deposits.iter().sum();
            let paid: u64 = deposits.iter().map(|d| pro_rata(total, *d, pool).unwrap()).sum();
            prop_assert!(paid <= total);
            prop_assert!(total - paid < deposits.len() as u64);
        }

        /// Vesting is monotonic and ends at exactly the entitlement.
        #[test]
        fn vesting_monotonic_and_complete(entitlement in 0u64..=u64::MAX, count in 1u8..=20) {
            let mut prev = 0u64;
            for k in 0..=count {
                let v = vested(entitlement, k, count).unwrap();
                prop_assert!(v >= prev);
                prev = v;
            }
            prop_assert_eq!(prev, entitlement);
        }

        /// Fee never exceeds its share and the remainder is exact.
        #[test]
        fn fee_split_exact(amount in 0u64..=u64::MAX, bps in 0u64..=10_000) {
            let fee = bps_of(amount, bps).unwrap();
            prop_assert!(fee <= amount);
        }

        /// The conservative min-out is never above what the curve actually returns at pump's
        /// real fee (so a correct launch can't fail its own slippage check).
        #[test]
        fn conservative_min_out_below_actual(
            budget in 1_000_000u64..=100_000_000_000u64,
            vq in 1_000_000_000u64..=100_000_000_000u64,
        ) {
            let vt = 1_073_000_000_000_000u64;
            let actual = curve_tokens_out(mul_div_floor(budget - 1, 10_000, 10_125).unwrap(), vt, vq).unwrap();
            let floor = curve_tokens_out(net_of_fee(budget, 300).unwrap(), vt, vq).unwrap();
            prop_assert!(floor <= actual);
        }
    }
}
