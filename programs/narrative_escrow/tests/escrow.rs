//! Escrow integration tests (LiteSVM + mock pump). Coverage map vs. the brief §3:
//!   deposit caps ............ deposit_* tests
//!   ordering ................ deposit_order_indices_and_receipt_aggregation
//!   refund paths ............ refund_* tests
//!   launch failure .......... launch_failure_*, launch_postconditions_*
//!   double-claim ............ claim_vesting_schedule_and_no_double_claim
//!   rounding dust ........... rounding_dust_is_bounded_and_burnable
//!   signer / PDA checks ..... *_rejects_* tests
//!   holder rewards (D-022) .. holder_* tests
//!   token pools (D-023) ..... token_pool* tests
mod common;

use anchor_lang::error::ErrorCode as Anchor;
use anchor_lang::prelude::Pubkey;
use common::*;
use narrative_escrow::constants::*;
use narrative_escrow::errors::EscrowError as E;
use narrative_escrow::math;
use narrative_escrow::state::Phase;
use solana_keypair::Keypair;
use solana_signer::Signer;

fn code(e: E) -> u32 {
    e.into()
}
fn anchor(e: Anchor) -> u32 {
    e.into()
}

// ---- config ---------------------------------------------------------------------------------

#[test]
fn init_config_only_by_upgrade_authority() {
    let mut env = Env::bare();
    let params = env.default_config();
    let stranger = env.funded(5);
    expect_err(
        env.send(&[init_config_ix(&stranger.pubkey(), params.clone())], &stranger, &[]),
        code(E::NotUpgradeAuthority),
    );

    let admin = env.admin.insecure_clone();
    let mut too_high = params.clone();
    too_high.fee_bps = MAX_FEE_BPS + 1;
    expect_err(env.send(&[init_config_ix(&admin.pubkey(), too_high)], &admin, &[]), code(E::FeeTooHigh));

    ok(env.send(&[init_config_ix(&admin.pubkey(), params)], &admin, &[]));
    let cfg = env.config();
    assert_eq!(cfg.admin, admin.pubkey());
    assert_eq!(cfg.fee_bps, 100);
}

#[test]
fn update_config_rejects_non_admin_and_does_not_touch_existing_escrows() {
    let mut env = Env::new();
    let escrow = env.create_default("Before");

    let mut params = env.default_config();
    params.fee_bps = 200;
    let stranger = env.funded(1);
    expect_err(
        env.send(&[update_config_ix(&stranger.pubkey(), params.clone(), None)], &stranger, &[]),
        anchor(Anchor::ConstraintHasOne),
    );
    let admin = env.admin.insecure_clone();
    ok(env.send(&[update_config_ix(&admin.pubkey(), params, None)], &admin, &[]));
    assert_eq!(env.config().fee_bps, 200);
    assert_eq!(env.escrow(&escrow).fee_bps, 100, "existing escrow keeps its frozen fee");
}

// ---- create_escrow --------------------------------------------------------------------------

#[test]
fn create_escrow_rejects_non_operator_and_bad_params() {
    let mut env = Env::new();

    let p = env.spec("Coin");
    let stranger = env.funded(5);
    expect_err(
        env.send(&[create_escrow_ix(&stranger.pubkey(), p)], &stranger, &[]),
        anchor(Anchor::ConstraintHasOne),
    );

    let mut p = env.spec("Coin");
    p.name = "Coin2".into(); // hash no longer matches
    expect_err(env.create(p), code(E::LockHashMismatch));

    let mut p = env.spec("Coin");
    p.pool_cap = 101 * SOL; // above config.max_pool_cap
    expect_err(env.create(p), code(E::InvalidLimits));

    let mut p = env.spec("Coin");
    p.launch_deadline = p.launch_after + 10; // launch window too short
    expect_err(env.create(p), code(E::InvalidSchedule));

    let mut p = env.spec("Coin");
    p.tranche_count = 0;
    expect_err(env.create(p), code(E::InvalidTranches));

    let mut p = env.spec("Coin");
    p.symbol = "WAYTOOLONGSYMBOL".into();
    expect_err(env.create(p), code(E::InvalidMetadata));

    let p = env.spec("Coin");
    let id = p.narrative_id;
    ok(env.create(p));
    let e = env.escrow(&escrow_pda(&id));
    assert_eq!(e.fee_bps, 100);
    assert_eq!(e.creator_fee_proposer_bps, 3_000);
    assert_eq!(e.creator_fee_platform_bps, 2_000);
    assert_eq!(e.treasury, env.treasury);
    // Vault funded to the rent floor by the operator.
    assert_eq!(env.lamports(&vault_pda(&escrow_pda(&id))), env.svm.minimum_balance_for_rent_exemption(0));
}

// ---- deposits -------------------------------------------------------------------------------

#[test]
fn deposit_only_inside_window() {
    let mut env = Env::new();
    let mut p = env.spec("Window");
    p.deposit_start = T0 + 100;
    p.deposit_end = T0 + 700;
    p.launch_after = T0 + 800;
    p.launch_deadline = T0 + 2000;
    let id = p.narrative_id;
    ok(env.create(p));
    let escrow = escrow_pda(&id);
    let alice = env.funded(10);

    expect_err(env.deposit(&alice, &escrow, SOL), code(E::NotPooling)); // too early
    env.set_time(T0 + 100);
    ok(env.deposit(&alice, &escrow, SOL));
    env.set_time(T0 + 700);
    expect_err(env.deposit(&alice, &escrow, SOL), code(E::NotPooling)); // window closed
}

#[test]
fn deposit_enforces_min_wallet_cap_and_pool_cap() {
    let mut env = Env::new();
    let mut p = env.spec("Caps");
    p.pool_cap = 6 * SOL;
    p.per_wallet_max = 4 * SOL;
    let id = p.narrative_id;
    ok(env.create(p));
    let escrow = escrow_pda(&id);
    let (alice, bob) = (env.funded(20), env.funded(20));

    expect_err(env.deposit(&alice, &escrow, SOL / 10 - 1), code(E::DepositTooSmall));
    expect_err(env.deposit(&alice, &escrow, 4 * SOL + 1), code(E::WalletCapExceeded));
    ok(env.deposit(&alice, &escrow, 3 * SOL));
    // Top-up past the wallet cap.
    expect_err(env.deposit(&alice, &escrow, SOL + 1), code(E::WalletCapExceeded));
    ok(env.deposit(&alice, &escrow, SOL)); // exactly at wallet cap
    // Pool cap: 4 SOL in, cap 6 SOL.
    expect_err(env.deposit(&bob, &escrow, 2 * SOL + 1), code(E::PoolCapExceeded));
    ok(env.deposit(&bob, &escrow, 2 * SOL)); // exact fill
    expect_err(env.deposit(&bob, &escrow, SOL / 10), code(E::PoolCapExceeded));

    let e = env.escrow(&escrow);
    assert_eq!(e.total_deposited, 6 * SOL);
    assert_eq!(e.depositor_count, 2);
    let rent_floor = env.svm.minimum_balance_for_rent_exemption(0);
    assert_eq!(env.lamports(&vault_pda(&escrow)), rent_floor + 6 * SOL);
}

#[test]
fn deposit_order_indices_and_receipt_aggregation() {
    let mut env = Env::new();
    let escrow = env.create_default("Order");
    let (a, b) = (env.funded(10), env.funded(10));
    ok(env.deposit(&a, &escrow, SOL));
    ok(env.deposit(&b, &escrow, 2 * SOL));
    ok(env.deposit(&a, &escrow, SOL / 2));

    let ra = env.receipt(&receipt_pda(&escrow, &a.pubkey()));
    let rb = env.receipt(&receipt_pda(&escrow, &b.pubkey()));
    assert_eq!((ra.first_order_index, ra.deposit_count, ra.amount), (0, 2, SOL + SOL / 2));
    assert_eq!((rb.first_order_index, rb.deposit_count, rb.amount), (1, 1, 2 * SOL));
    let e = env.escrow(&escrow);
    assert_eq!(e.next_order_index, 3);
    assert_eq!(e.depositor_count, 2);
}

#[test]
fn deposit_rejects_foreign_vault() {
    let mut env = Env::new();
    let e1 = env.create_default("One");
    let e2 = env.create_default("Two");
    let alice = env.funded(10);
    let ix = deposit_ix_with_vault(&alice.pubkey(), &e1, &vault_pda(&e2), SOL);
    expect_err(env.send(&[ix], &alice, &[]), anchor(Anchor::ConstraintSeeds));
}

// ---- refunds --------------------------------------------------------------------------------

#[test]
fn refund_when_pool_below_minimum() {
    let mut env = Env::new();
    let escrow = env.create_default("Small");
    let alice = env.funded(10);
    ok(env.deposit(&alice, &escrow, SOL / 2)); // pool_min is 1 SOL

    // Not refundable while the window is open.
    expect_err(env.send(&[refund_ix(&escrow, &alice.pubkey())], &alice, &[]), code(E::NotRefundable));

    env.set_time(T0 + 600);
    assert_eq!(env.escrow(&escrow).phase(T0 + 600), Phase::Refundable);
    let before = env.lamports(&alice.pubkey());
    let receipt = receipt_pda(&escrow, &alice.pubkey());
    let receipt_rent = env.lamports(&receipt);
    // Anyone may push the refund; funds still go to alice.
    let crank = env.funded(1);
    ok(env.send(&[refund_ix(&escrow, &alice.pubkey())], &crank, &[]));
    assert_eq!(env.lamports(&alice.pubkey()), before + SOL / 2 + receipt_rent);
    assert!(!env.exists(&receipt), "receipt closed");

    // Double refund impossible (receipt closed).
    expect_err(
        env.send(&[refund_ix(&escrow, &alice.pubkey())], &crank, &[]),
        anchor(Anchor::AccountNotInitialized),
    );
    // And no launch once refundable.
    env.set_time(T0 + 720);
    expect_err(env.launch(&crank, &escrow, 1), code(E::NotLaunchable));
}

#[test]
fn refund_after_deadline_without_launch() {
    let mut env = Env::new();
    let escrow = env.create_default("Late");
    let (a, b) = (env.funded(10), env.funded(10));
    ok(env.deposit(&a, &escrow, 2 * SOL));
    ok(env.deposit(&b, &escrow, 3 * SOL));

    env.set_time(T0 + 720); // launchable, nobody cranks
    expect_err(env.send(&[refund_ix(&escrow, &a.pubkey())], &a, &[]), code(E::NotRefundable));
    env.set_time(T0 + 2520); // deadline
    let crank = env.funded(1);
    expect_err(env.launch(&crank, &escrow, 1), code(E::NotLaunchable));

    let vault = vault_pda(&escrow);
    ok(env.send(&[refund_ix(&escrow, &a.pubkey())], &a, &[]));
    ok(env.send(&[refund_ix(&escrow, &b.pubkey())], &b, &[]));
    let e = env.escrow(&escrow);
    assert_eq!(e.total_refunded, 5 * SOL);
    assert_eq!(env.lamports(&vault), env.svm.minimum_balance_for_rent_exemption(0), "vault back to rent floor");
}

#[test]
fn refund_rejects_wrong_wallet_or_receipt() {
    let mut env = Env::new();
    let escrow = env.create_default("Mixup");
    let (a, b) = (env.funded(10), env.funded(10));
    ok(env.deposit(&a, &escrow, SOL / 2));
    ok(env.deposit(&b, &escrow, SOL / 4));
    env.set_time(T0 + 600);
    // a's receipt but b as destination
    let ix = refund_ix_raw(&escrow, &receipt_pda(&escrow, &a.pubkey()), &b.pubkey());
    expect_err_in(env.send(&[ix], &b, &[]), &[anchor(Anchor::ConstraintSeeds), anchor(Anchor::ConstraintHasOne)]);
}

#[test]
fn no_refund_after_launch() {
    let mut env = Env::new();
    let (escrow, _mint, wallets) = env.launched("Launched", &[2 * SOL]);
    let a = &wallets[0];
    expect_err(env.send(&[refund_ix(&escrow, &a.pubkey())], a, &[]), code(E::NotRefundable));
    env.set_time(T0 + 100_000);
    expect_err(env.send(&[refund_ix(&escrow, &a.pubkey())], a, &[]), code(E::NotRefundable));
}

// ---- launch ---------------------------------------------------------------------------------

#[test]
fn launch_happy_path() {
    let mut env = Env::new();
    let escrow = env.create_default("Happy");
    let (a, b, c) = (env.funded(10), env.funded(10), env.funded(10));
    ok(env.deposit(&a, &escrow, 2 * SOL));
    ok(env.deposit(&b, &escrow, 3 * SOL));
    ok(env.deposit(&c, &escrow, 5 * SOL));
    let total = 10 * SOL;

    let crank = env.funded(1);
    env.set_time(T0 + 600); // closing
    expect_err(env.launch(&crank, &escrow, 1), code(E::NotLaunchable));

    env.set_time(T0 + 720);
    let treasury_before = env.lamports(&env.treasury.clone());
    let meta = ok(env.launch(&crank, &escrow, 1));
    println!("launch CU: {}", meta.compute_units_consumed);

    let e = env.escrow(&escrow);
    let mint = mint_pda(&escrow, 1);
    let fee = total / 100;
    assert!(e.launched);
    assert_eq!(e.mint, mint);
    assert_eq!(env.lamports(&env.treasury.clone()), treasury_before + fee, "platform fee exactly 1%");

    // Opening buy at the mock's (= pump's SDK) arithmetic on a fresh mainnet-shaped curve.
    let budget = total - fee - LAUNCH_RENT_RESERVE;
    let net = math::mul_div_floor(budget - 1, 10_000, 10_125).unwrap();
    let expected = math::curve_tokens_out(net, 1_073_000_000_000_000, 30_000_000_000).unwrap();
    assert_eq!(e.tokens_bought, expected);
    assert_eq!(env.token_balance(&t22_ata(&vault_pda(&escrow), &mint)), expected);
    // Everything not spent by the launch is owed back to depositors.
    let vault_now = env.lamports(&vault_pda(&escrow));
    let rent_floor = env.svm.minimum_balance_for_rent_exemption(0);
    assert_eq!(vault_now, rent_floor + e.base_leftover);
    assert!(e.base_leftover <= LAUNCH_RENT_RESERVE);

    // Cannot launch twice.
    expect_err(env.launch(&crank, &escrow, 2), code(E::NotLaunchable));
}

#[test]
fn launch_with_cranker_paying_create_rent() {
    let mut env = Env::new();
    let escrow = env.create_default("Fallback");
    let a = env.funded(10);
    ok(env.deposit(&a, &escrow, 3 * SOL));
    env.set_time(T0 + 720);
    let crank = env.funded(2);
    let ix = launch_ix(&crank.pubkey(), &escrow, &env.treasury.clone(), 1, Some(crank.pubkey()));
    ok(env.send(&[ix], &crank, &[]));
    assert!(env.escrow(&escrow).launched);
}

#[test]
fn launch_rejects_foreign_create_payer() {
    let mut env = Env::new();
    let escrow = env.create_default("Payer");
    let a = env.funded(10);
    ok(env.deposit(&a, &escrow, 3 * SOL));
    env.set_time(T0 + 720);
    let crank = env.funded(2);
    let ix = launch_ix(&crank.pubkey(), &escrow, &env.treasury.clone(), 1, Some(a.pubkey()));
    expect_err(env.send(&[ix], &crank, &[]), code(E::InvalidLaunchPayer));
}

#[test]
fn launch_rejects_account_substitution() {
    let mut env = Env::new();
    let escrow = env.create_default("Subst");
    let a = env.funded(10);
    ok(env.deposit(&a, &escrow, 3 * SOL));
    env.set_time(T0 + 720);
    let crank = env.funded(2);
    let treasury = env.treasury;
    let base = || launch_accounts(&crank.pubkey(), &escrow, &treasury, 1);
    let rem = |acc: &LaunchAccounts| launch_remaining(&acc.vault, &acc.mint);

    // Fake pump program (would receive the vault's signature).
    let mut acc = base();
    acc.pump_program = anchor_lang::system_program::ID;
    let r = rem(&acc);
    expect_err(env.send(&[launch_ix_from(&acc, 1, r)], &crank, &[]), code(E::InvalidProgram));

    // Fake token programs.
    let mut acc = base();
    acc.token_program = SPL_TOKEN_PROGRAM_ID;
    let r = rem(&acc);
    expect_err(env.send(&[launch_ix_from(&acc, 1, r)], &crank, &[]), code(E::InvalidProgram));

    // Treasury swapped for the cranker.
    let mut acc = base();
    acc.treasury = crank.pubkey();
    let r = rem(&acc);
    expect_err(env.send(&[launch_ix_from(&acc, 1, r)], &crank, &[]), code(E::InvalidAccount));

    // Tokens routed to the cranker's account instead of the vault's.
    let mut acc = base();
    acc.vault_token_account = t22_ata(&crank.pubkey(), &acc.mint);
    let r = rem(&acc);
    expect_err(env.send(&[launch_ix_from(&acc, 1, r)], &crank, &[]), code(E::InvalidAccount));

    // Mint that isn't this escrow's PDA.
    let mut acc = base();
    acc.mint = Keypair::new().pubkey();
    let r = rem(&acc);
    expect_err(env.send(&[launch_ix_from(&acc, 1, r)], &crank, &[]), anchor(Anchor::ConstraintSeeds));

    // Bonding curve of a different mint.
    let acc = base();
    let mut r = rem(&acc);
    r[narrative_escrow::pump::ra::BONDING_CURVE].pubkey = Keypair::new().pubkey();
    expect_err(env.send(&[launch_ix_from(&acc, 1, r)], &crank, &[]), code(E::InvalidAccount));

    // Fee program swapped.
    let acc = base();
    let mut r = rem(&acc);
    r[narrative_escrow::pump::ra::FEE_PROGRAM].pubkey = anchor_lang::system_program::ID;
    expect_err(env.send(&[launch_ix_from(&acc, 1, r)], &crank, &[]), code(E::InvalidProgram));

    // Too few remaining accounts.
    let acc = base();
    let mut r = rem(&acc);
    r.pop();
    expect_err(env.send(&[launch_ix_from(&acc, 1, r)], &crank, &[]), code(E::InvalidAccount));

    // A different holder-vote account, to skip the pool's vote.
    let mut acc = base();
    acc.holder_vote = Keypair::new().pubkey();
    let r = rem(&acc);
    expect_err(env.send(&[launch_ix_from(&acc, 1, r)], &crank, &[]), anchor(Anchor::ConstraintSeeds));

    // After all that, an honest launch still works and nothing moved.
    assert_eq!(env.escrow(&escrow).total_deposited, 3 * SOL);
    ok(env.launch(&crank, &escrow, 1));
}

#[test]
fn launch_failure_keeps_state_then_refunds_after_deadline() {
    let mut env = Env::new();
    let escrow = env.create_default("FAIL_BUY coin");
    let (a, b) = (env.funded(10), env.funded(10));
    ok(env.deposit(&a, &escrow, 2 * SOL));
    ok(env.deposit(&b, &escrow, 2 * SOL));
    let vault = vault_pda(&escrow);
    let vault_before = env.lamports(&vault);

    env.set_time(T0 + 720);
    let crank = env.funded(1);
    assert!(env.launch(&crank, &escrow, 1).is_err());
    assert!(env.launch(&crank, &escrow, 2).is_err(), "retries fail too");
    let e = env.escrow(&escrow);
    assert!(!e.launched);
    assert_eq!(env.lamports(&vault), vault_before, "failed launch moved nothing (fee included)");
    assert_eq!(env.lamports(&env.treasury.clone()), 100 * SOL, "no fee charged");

    env.set_time(T0 + 2520);
    let (a_before, b_before) = (env.lamports(&a.pubkey()), env.lamports(&b.pubkey()));
    ok(env.send(&[refund_ix(&escrow, &a.pubkey())], &crank, &[]));
    ok(env.send(&[refund_ix(&escrow, &b.pubkey())], &crank, &[]));
    assert!(env.lamports(&a.pubkey()) >= a_before + 2 * SOL);
    assert!(env.lamports(&b.pubkey()) >= b_before + 2 * SOL);
}

#[test]
fn launch_postconditions_catch_hostile_venue() {
    for (name, expected) in [
        ("OVERSPEND coin", code(E::LaunchOverspent)),
        ("SHORT coin", code(E::LaunchUnderfilled)),
        ("BAD_CREATOR coin", code(E::InvalidBondingCurve)),
    ] {
        let mut env = Env::new();
        let escrow = env.create_default(name);
        let a = env.funded(10);
        ok(env.deposit(&a, &escrow, 3 * SOL));
        env.set_time(T0 + 720);
        let crank = env.funded(1);
        expect_err(env.launch(&crank, &escrow, 1), expected);
        assert!(!env.escrow(&escrow).launched, "{name}");
    }
}

#[test]
fn launch_rejects_curve_overfill() {
    let mut env = Env::new();
    let mut p = env.spec("Whale");
    p.pool_cap = 80 * SOL;
    p.per_wallet_max = 80 * SOL;
    let id = p.narrative_id;
    ok(env.create(p));
    let escrow = escrow_pda(&id);
    let whale = env.funded(100);
    ok(env.deposit(&whale, &escrow, 80 * SOL)); // ~60 SOL would hit 90% of real reserves
    env.set_time(T0 + 720);
    let crank = env.funded(1);
    expect_err(env.launch(&crank, &escrow, 1), code(E::CurveOverfill));
}

// ---- claims ---------------------------------------------------------------------------------

#[test]
fn claim_vesting_schedule_and_no_double_claim() {
    let mut env = Env::new();
    let (escrow, mint, wallets) = env.launched("Vest", &[2 * SOL, 3 * SOL]);
    let a = &wallets[0];
    let e = env.escrow(&escrow);
    let entitlement = math::pro_rata(e.tokens_bought, 2 * SOL, 5 * SOL).unwrap();
    let ata = t22_ata(&a.pubkey(), &mint);

    // Tranche 1 of 5 at launch. Leftover lamports paid on the first claim.
    let lamports_before = env.lamports(&a.pubkey());
    ok(env.claim(a, &escrow, &mint));
    assert_eq!(env.token_balance(&ata), entitlement / 5);
    let leftover_share = math::pro_rata(e.base_leftover, 2 * SOL, 5 * SOL).unwrap();
    assert!(env.lamports(&a.pubkey()) + 10_000_000 >= lamports_before + leftover_share);

    // Same tranche again: nothing.
    expect_err(env.claim(a, &escrow, &mint), code(E::NothingToClaim));

    // One interval later: 2/5.
    env.set_time(e.launched_at + 600);
    ok(env.claim(a, &escrow, &mint));
    assert_eq!(env.token_balance(&ata), math::vested(entitlement, 2, 5).unwrap());
    expect_err(env.claim(a, &escrow, &mint), code(E::NothingToClaim));

    // Far future: exactly the entitlement, never more.
    env.set_time(e.launched_at + 1_000_000);
    ok(env.claim(a, &escrow, &mint));
    assert_eq!(env.token_balance(&ata), entitlement);
    expect_err(env.claim(a, &escrow, &mint), code(E::NothingToClaim));
    let r = env.receipt(&receipt_pda(&escrow, &a.pubkey()));
    assert!(r.fully_claimed);
    assert_eq!(env.escrow(&escrow).receipts_fully_claimed, 1);
}

#[test]
fn claim_can_be_pushed_by_anyone_but_pays_the_depositor() {
    let mut env = Env::new();
    let (escrow, mint, wallets) = env.launched("Push", &[2 * SOL]);
    let a = &wallets[0];
    let crank = env.funded(1);
    ok(env.send(&[claim_ix(&crank.pubkey(), &escrow, &a.pubkey(), &mint)], &crank, &[]));
    assert!(env.token_balance(&t22_ata(&a.pubkey(), &mint)) > 0);
    assert!(!env.exists(&t22_ata(&crank.pubkey(), &mint)), "cranker received nothing");
}

#[test]
fn claim_rejects_other_wallets_receipt() {
    let mut env = Env::new();
    let (escrow, mint, wallets) = env.launched("Steal", &[2 * SOL, 2 * SOL]);
    let (a, b) = (&wallets[0], &wallets[1]);
    // b tries to route a's receipt to b's own wallet.
    let mut ix = claim_ix(&b.pubkey(), &escrow, &b.pubkey(), &mint);
    ix.accounts[3].pubkey = receipt_pda(&escrow, &a.pubkey());
    expect_err_in(env.send(&[ix], b, &[]), &[anchor(Anchor::ConstraintSeeds), anchor(Anchor::ConstraintHasOne)]);
}

#[test]
fn claim_before_launch_fails() {
    let mut env = Env::new();
    let escrow = env.create_default("Early");
    let a = env.funded(10);
    ok(env.deposit(&a, &escrow, 2 * SOL));
    let fake_mint = mint_pda(&escrow, 1);
    assert!(env.claim(&a, &escrow, &fake_mint).is_err());
}

#[test]
fn rounding_dust_is_bounded_and_burnable() {
    let mut env = Env::new();
    // Deliberately awkward amounts so pro-rata shares don't divide evenly.
    let deposits = [SOL + 1, SOL + 7, 3 * SOL - 13];
    let (escrow, mint, wallets) = env.launched("Dust", &deposits);
    let vault_ata = t22_ata(&vault_pda(&escrow), &mint);
    let bought = env.escrow(&escrow).tokens_bought;

    expect_err(env.send(&[burn_dust_ix(&escrow, &mint)], &wallets[0], &[]), code(E::ClaimsOutstanding));

    let launched_at = env.escrow(&escrow).launched_at;
    env.set_time(launched_at + 10 * 600);
    let mut paid = 0u64;
    for w in &wallets {
        ok(env.claim(w, &escrow, &mint));
        paid += env.token_balance(&t22_ata(&w.pubkey(), &mint));
    }
    let dust = env.token_balance(&vault_ata);
    assert_eq!(paid + dust, bought, "no tokens created or lost");
    assert!(dust < deposits.len() as u64, "dust {dust} must be < depositor count");

    if dust > 0 {
        ok(env.send(&[burn_dust_ix(&escrow, &mint)], &wallets[0], &[]));
        assert_eq!(env.token_balance(&vault_ata), 0);
    }
}

// ---- creator fees ---------------------------------------------------------------------------

#[test]
fn creator_fees_split_50_30_20_and_never_touch_pool_money() {
    let mut env = Env::new();
    let (escrow, mint, wallets) = env.launched("Fees", &[SOL, 3 * SOL]);
    let vault = vault_pda(&escrow);
    let (proposer, treasury) = (env.proposer, env.treasury);
    let crank = env.funded(1);

    // Nothing to distribute yet: the vault only holds the rent floor + depositors' leftover.
    expect_err(env.send(&[distribute_ix(&escrow, &proposer, &treasury)], &crank, &[]), code(E::NothingToDistribute));

    // pump's collect_creator_fee_v2 pays lamports to creator = vault. Simulate 1 SOL.
    env.svm.airdrop(&vault, SOL).unwrap();
    let (p0, t0) = (env.lamports(&proposer), env.lamports(&treasury));
    ok(env.send(&[distribute_ix(&escrow, &proposer, &treasury)], &crank, &[]));
    assert_eq!(env.lamports(&proposer) - p0, SOL * 30 / 100);
    assert_eq!(env.lamports(&treasury) - t0, SOL * 20 / 100);
    let e = env.escrow(&escrow);
    assert_eq!(e.creator_fees_depositors_total, SOL / 2);

    // Wrong proposer rejected.
    env.svm.airdrop(&vault, SOL).unwrap();
    expect_err(
        env.send(&[distribute_ix(&escrow, &crank.pubkey(), &treasury)], &crank, &[]),
        code(E::InvalidAccount),
    );

    // Depositors pull their 50% pro-rata (1:3) together with tokens.
    let (a, b) = (&wallets[0], &wallets[1]);
    let (a0, b0) = (env.lamports(&a.pubkey()), env.lamports(&b.pubkey()));
    ok(env.claim(a, &escrow, &mint));
    ok(env.claim(b, &escrow, &mint));
    let a_fee = math::pro_rata(SOL / 2, SOL, 4 * SOL).unwrap();
    let b_fee = math::pro_rata(SOL / 2, 3 * SOL, 4 * SOL).unwrap();
    let a_left = math::pro_rata(e.base_leftover, SOL, 4 * SOL).unwrap();
    let b_left = math::pro_rata(e.base_leftover, 3 * SOL, 4 * SOL).unwrap();
    // Each claimer also paid a tx fee and the ATA rent (they were the caller).
    let slack = 5_000_000;
    assert!(env.lamports(&a.pubkey()) + slack >= a0 + a_fee + a_left);
    assert!(env.lamports(&b.pubkey()) + slack >= b0 + b_fee + b_left);

    // The vault always covers what is still owed.
    let e = env.escrow(&escrow);
    let owed = e.vault_obligations().unwrap() + env.svm.minimum_balance_for_rent_exemption(0);
    assert!(env.lamports(&vault) >= owed);
}

#[test]
fn distribute_before_launch_fails() {
    let mut env = Env::new();
    let escrow = env.create_default("NoLaunch");
    let crank = env.funded(1);
    let (p, t) = (env.proposer, env.treasury);
    expect_err(env.send(&[distribute_ix(&escrow, &p, &t)], &crank, &[]), code(E::NotLaunched));
}

// ---- holder rewards (D-022) -----------------------------------------------------------------

/// Deposits each `(sol, vote)`, moves to the launch window and launches with nonce 1.
fn launch_with_votes(env: &mut Env, name: &str, votes: &[(u64, bool)]) -> (Pubkey, Pubkey, TxResult) {
    let escrow = env.create_default(name);
    for (amount, on) in votes {
        let w = env.funded(amount / SOL + 2);
        ok(env.deposit_vote(&w, &escrow, *amount, *on));
    }
    let launch_after = env.escrow(&escrow).launch_after;
    env.set_time(launch_after);
    let crank = env.funded(1);
    let res = env.launch(&crank, &escrow, 1);
    (escrow, mint_pda(&escrow, 1), res)
}

#[test]
fn holder_vote_tallies_every_deposit_by_its_sol() {
    let mut env = Env::new();
    let escrow = env.create_default("Tally");
    let v = env.holder_vote(&escrow).expect("created with the escrow");
    assert_eq!((v.on, v.off, v.applied), (0, 0, false));
    let (a, b) = (env.funded(10), env.funded(10));
    ok(env.deposit_vote(&a, &escrow, 2 * SOL, true));
    ok(env.deposit_vote(&b, &escrow, 3 * SOL, false));
    ok(env.deposit_vote(&a, &escrow, SOL, true));
    let v = env.holder_vote(&escrow).unwrap();
    assert_eq!((v.on, v.off), (3 * SOL, 3 * SOL));
    assert_eq!(v.escrow, escrow);
}

#[test]
fn holder_rewards_on_when_more_sol_votes_on() {
    let mut env = Env::new();
    // Two wallets say off, one bigger wallet says on: SOL decides, not headcount.
    let (escrow, mint, res) = launch_with_votes(&mut env, "HolderOn", &[(3 * SOL, true), (SOL, false), (SOL, false)]);
    ok(res);
    assert_eq!(env.curve_creator(&mint), holder_rewards_pda(&mint), "pump made the holder-rewards PDA the creator");
    assert!(env.holder_vote(&escrow).unwrap().applied);
    assert!(env.escrow(&escrow).launched);
}

#[test]
fn holder_rewards_off_on_a_tie_or_an_off_majority() {
    for (name, votes) in [("Tie", vec![(2 * SOL, true), (2 * SOL, false)]), ("OffWins", vec![(SOL, true), (3 * SOL, false)])] {
        let mut env = Env::new();
        let (escrow, mint, res) = launch_with_votes(&mut env, name, &votes);
        ok(res);
        assert_eq!(env.curve_creator(&mint), vault_pda(&escrow), "{name}: creator fees stay with the vault");
        assert!(!env.holder_vote(&escrow).unwrap().applied, "{name}");
    }
}

#[test]
fn holder_rewards_fall_back_to_off_when_pump_disables_them() {
    // As on devnet: a pool that votes on must still launch rather than hit HolderRewardDisabled.
    let mut env = Env::new();
    env.set_pump_holder_rewards(false);
    let (escrow, mint, res) = launch_with_votes(&mut env, "PumpOff", &[(3 * SOL, true)]);
    ok(res);
    assert_eq!(env.curve_creator(&mint), vault_pda(&escrow));
    assert!(!env.holder_vote(&escrow).unwrap().applied);
}

#[test]
fn holder_rewards_need_the_matching_creator_vault() {
    // A client that predicts "off" when the vote says "on" passes the vault's creator vault;
    // pump rejects it and nothing moves. The launch then succeeds with the right accounts.
    let mut env = Env::new();
    let escrow = env.create_default("Predict");
    let a = env.funded(10);
    ok(env.deposit_vote(&a, &escrow, 3 * SOL, true));
    env.set_time(T0 + 720);
    let crank = env.funded(1);
    let wrong = launch_ix(&crank.pubkey(), &escrow, &env.treasury.clone(), 1, None);
    assert!(env.send(&[wrong], &crank, &[]).is_err());
    assert!(!env.escrow(&escrow).launched);
    ok(env.launch(&crank, &escrow, 1));
    assert!(env.holder_vote(&escrow).unwrap().applied);
}

#[test]
fn holder_vote_works_for_escrows_from_before_it() {
    // An escrow created before D-022 has no holder-vote account: its first deposit creates it.
    let mut env = Env::new();
    let escrow = env.create_default("Legacy");
    env.remove_account(&holder_vote_pda(&escrow));
    assert!(env.holder_vote(&escrow).is_none());
    let a = env.funded(10);
    ok(env.deposit_vote(&a, &escrow, 3 * SOL, true));
    assert_eq!(env.holder_vote(&escrow).unwrap().on, 3 * SOL);

    // And one whose tally never existed launches with holder rewards off.
    let other = env.create_default("Legacy2");
    let b = env.funded(10);
    ok(env.deposit_vote(&b, &other, 3 * SOL, true));
    env.remove_account(&holder_vote_pda(&other));
    env.set_time(T0 + 720);
    let crank = env.funded(1);
    ok(env.launch(&crank, &other, 1));
    assert_eq!(env.curve_creator(&mint_pda(&other, 1)), vault_pda(&other));
}

#[test]
fn holder_rewards_send_all_vault_income_to_depositors() {
    let mut env = Env::new();
    let (escrow, _mint, res) = launch_with_votes(&mut env, "AllToHolders", &[(SOL, true), (3 * SOL, true)]);
    ok(res);
    // pump pays holder rewards to token holders, and the vault holds tokens for depositors.
    env.svm.airdrop(&vault_pda(&escrow), SOL).unwrap();
    let (proposer, treasury) = (env.proposer, env.treasury);
    let (p0, t0) = (env.lamports(&proposer), env.lamports(&treasury));
    let crank = env.funded(1);
    ok(env.send(&[distribute_ix(&escrow, &proposer, &treasury)], &crank, &[]));
    assert_eq!(env.lamports(&proposer), p0, "no proposer share");
    assert_eq!(env.lamports(&treasury), t0, "no platform share");
    assert_eq!(env.escrow(&escrow).creator_fees_depositors_total, SOL);
}

// ---- token pools (D-023) --------------------------------------------------------------------

/// A token pool's depositor: some SOL for fees and rent, plus `tokens` of the pool token.
fn token_holder(env: &mut Env, mint: &Pubkey, tokens: u64) -> Keypair {
    let w = env.funded(1);
    env.fund_token(&w.pubkey(), mint, tokens);
    w
}

#[test]
fn token_pool_deposits_launches_and_claims_in_the_token() {
    let mut env = Env::new();
    let usdc = env.create_spl_mint(6);
    let escrow = env.create_token_default("UsdcPool", &usdc, false);
    let q = env.pool_quote(&escrow).expect("pool_quote");
    assert_eq!((q.mint, q.decimals, q.via_quote_control), (usdc, 6, false));
    // spec() limits (per wallet 5e9, cap 20e9, min 1e9) are read as USDC base units here.
    let a = token_holder(&mut env, &usdc, 10 * SOL);
    let b = token_holder(&mut env, &usdc, 10 * SOL);
    ok(env.deposit_token(&a, &escrow, &usdc, 2 * SOL, true));
    ok(env.deposit_token(&b, &escrow, &usdc, 3 * SOL, false));
    let vault = vault_pda(&escrow);
    assert_eq!(env.token_balance(&spl_ata(&vault, &usdc)), 5 * SOL);
    assert_eq!(env.token_balance(&spl_ata(&a.pubkey(), &usdc)), 8 * SOL);
    assert_eq!(env.holder_vote(&escrow).unwrap().on, 2 * SOL, "votes count in the pool's token");
    expect_err(env.deposit(&a, &escrow, SOL), code(E::TokenPool));

    env.set_time(T0 + 720);
    let crank = env.funded(1);
    let (crank0, vault_sol0) = (env.lamports(&crank.pubkey()), env.lamports(&vault));
    let treasury = env.treasury;
    ok(env.launch(&crank, &escrow, 1));
    let e = env.escrow(&escrow);
    let mint = mint_pda(&escrow, 1);
    let total = 5 * SOL;
    let fee = total / 100;
    assert!(e.launched);
    assert_eq!(env.token_balance(&spl_ata(&treasury, &usdc)), fee, "1% fee, paid in the pool token");
    // The whole pool after the fee buys: no SOL rent reserve is held back from a token pool.
    let budget = total - fee;
    let net = math::mul_div_floor(budget - 1, 10_000, 10_125).unwrap();
    assert_eq!(e.tokens_bought, math::curve_tokens_out(net, 1_073_000_000_000_000, 30_000_000_000).unwrap());
    let curve = narrative_escrow::pump::bonding_curve_address(&mint);
    assert_eq!(env.token_balance(&spl_ata(&curve, &usdc)), budget, "the curve received the pool's USDC");
    assert_eq!(env.token_balance(&spl_ata(&vault, &usdc)), 0);
    assert_eq!(env.pool_quote(&escrow).unwrap().quote_leftover, 0);
    assert_eq!(e.base_leftover, 0, "no lamports are owed to a token pool's depositors");
    // The cranker's loan came back minus the rents used; the vault is back at its floor.
    assert_eq!(env.lamports(&vault), vault_sol0);
    assert!(crank0 - env.lamports(&crank.pubkey()) < TOKEN_LAUNCH_RENT);

    // The SOL claim refuses a token pool; claim_token pays the coin.
    expect_err(env.claim(&a, &escrow, &mint), code(E::TokenPool));
    env.set_time(e.launched_at + 10 * 600);
    ok(env.send(&[claim_token_ix(&a.pubkey(), &escrow, &a.pubkey(), &mint, &usdc)], &a, &[]));
    let want = math::pro_rata(e.tokens_bought, 2 * SOL, total).unwrap();
    assert_eq!(env.token_balance(&t22_ata(&a.pubkey(), &mint)), want);
    expect_err(
        env.send(&[claim_token_ix(&a.pubkey(), &escrow, &a.pubkey(), &mint, &usdc)], &a, &[]),
        code(E::NothingToClaim),
    );
}

#[test]
fn token_pool_refunds_in_the_token_even_to_a_closed_account() {
    let mut env = Env::new();
    let usdc = env.create_spl_mint(6);
    let escrow = env.create_token_default("UsdcRefund", &usdc, false);
    let a = token_holder(&mut env, &usdc, 10 * SOL);
    ok(env.deposit_token(&a, &escrow, &usdc, SOL / 2, true)); // under the 1e9 minimum
    env.set_time(T0 + 600);
    let crank = env.funded(1);
    expect_err(env.send(&[refund_ix(&escrow, &a.pubkey())], &crank, &[]), code(E::TokenPool));

    // The depositor closed their token account: the refund recreates it at the caller's cost.
    env.remove_account(&spl_ata(&a.pubkey(), &usdc));
    ok(env.send(&[refund_token_ix(&crank.pubkey(), &escrow, &a.pubkey(), &usdc)], &crank, &[]));
    assert_eq!(env.token_balance(&spl_ata(&a.pubkey(), &usdc)), SOL / 2, "100% back, in the token");
    assert_eq!(env.token_balance(&spl_ata(&vault_pda(&escrow), &usdc)), 0);
    assert!(!env.exists(&receipt_pda(&escrow, &a.pubkey())), "receipt closed to the depositor");
    expect_err(
        env.send(&[refund_token_ix(&crank.pubkey(), &escrow, &a.pubkey(), &usdc)], &crank, &[]),
        anchor(Anchor::AccountNotInitialized),
    );
}

#[test]
fn token_pools_and_sol_pools_never_mix() {
    let mut env = Env::new();
    let usdc = env.create_spl_mint(6);
    let a = token_holder(&mut env, &usdc, 10 * SOL);

    // A token deposit into a SOL pool: there is no pool token to match.
    let sol_pool = env.create_default("SolPool");
    expect_err(env.deposit_token(&a, &sol_pool, &usdc, SOL, false), anchor(Anchor::AccountNotInitialized));

    // WSOL as a pool token: SOL pools are the SOL path.
    env.set_spl_mint(WSOL_MINT, 9);
    let p = env.spec("WsolPool");
    let op = env.operator.insecure_clone();
    expect_err(env.send(&[create_token_escrow_ix(&op.pubkey(), p, &WSOL_MINT, false)], &op, &[]), code(E::InvalidQuoteMint));

    // A token pool launched with SOL's quote accounts, or without the treasury's token account.
    let escrow = env.create_token_default("Crossed", &usdc, false);
    ok(env.deposit_token(&a, &escrow, &usdc, 3 * SOL, false));
    env.set_time(T0 + 720);
    let crank = env.funded(1);
    let treasury = env.treasury;
    let as_sol = launch_ix(&crank.pubkey(), &escrow, &treasury, 1, None);
    expect_err(env.send(&[as_sol], &crank, &[]), code(E::InvalidAccount));
    let mut no_fee_account = launch_token_ix(&crank.pubkey(), &escrow, &treasury, 1, false, &usdc, false);
    no_fee_account.accounts.pop();
    expect_err(env.send(&[no_fee_account], &crank, &[]), code(E::InvalidAccount));
    ok(env.launch(&crank, &escrow, 1));
}

#[test]
fn token_pool_overspend_is_rejected() {
    let mut env = Env::new();
    let usdc = env.create_spl_mint(6);
    let escrow = env.create_token_default("OVERSPEND usdc", &usdc, false);
    let a = token_holder(&mut env, &usdc, 10 * SOL);
    ok(env.deposit_token(&a, &escrow, &usdc, 3 * SOL, false));
    // Extra tokens land in the vault; the hostile venue then takes everything it holds.
    env.fund_token(&vault_pda(&escrow), &usdc, SOL);
    env.set_time(T0 + 720);
    let crank = env.funded(1);
    expect_err(env.launch(&crank, &escrow, 1), code(E::LaunchOverspent));
    assert!(!env.escrow(&escrow).launched);
}

#[test]
fn token_pool_via_quote_control_passes_pumps_list() {
    let mut env = Env::new();
    let stock = env.create_spl_mint(8);
    let escrow = env.create_token_default("NvdaPool", &stock, true);
    let a = token_holder(&mut env, &stock, 10 * SOL);
    ok(env.deposit_token(&a, &escrow, &stock, 3 * SOL, true));
    env.set_time(T0 + 720);
    let crank = env.funded(1);
    let treasury = env.treasury;
    let holder = env.expects_holder_rewards(&escrow);
    let mut missing = launch_token_ix(&crank.pubkey(), &escrow, &treasury, 1, holder, &stock, true);
    missing.accounts.pop();
    expect_err(env.send(&[missing], &crank, &[]), code(E::InvalidAccount));
    ok(env.launch(&crank, &escrow, 1));
    assert!(env.holder_vote(&escrow).unwrap().applied, "holder rewards work on token pairs too");
}

#[test]
fn unused_pubkey_is_not_a_receipt() {
    // Sanity: a refund for a wallet that never deposited fails on the missing receipt.
    let mut env = Env::new();
    let escrow = env.create_default("Ghost");
    env.set_time(T0 + 600);
    let ghost = Pubkey::new_from_array([3u8; 32]);
    let crank = env.funded(1);
    expect_err(env.send(&[refund_ix(&escrow, &ghost)], &crank, &[]), anchor(Anchor::AccountNotInitialized));
}
