//! Escrow integration tests (LiteSVM + mock pump). Coverage map vs. the brief §3:
//!   deposit caps ............ deposit_* tests
//!   ordering ................ deposit_order_indices_and_receipt_aggregation
//!   refund paths ............ refund_* tests
//!   launch failure .......... launch_failure_*, launch_postconditions_*
//!   double-claim ............ claim_vesting_schedule_and_no_double_claim
//!   rounding dust ........... rounding_dust_is_bounded_and_burnable
//!   signer / PDA checks ..... *_rejects_* tests
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
