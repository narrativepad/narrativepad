//! Guards against pump.fun ABI drift: `src/pump.rs` hand-encodes pump's instructions, so this
//! checks the encoding assumptions against the vendored IDL (idls/pump.json). When pump ships
//! an upgrade, re-vendor the IDL and this test tells you what moved.
use narrative_escrow::constants::*;
use serde_json::Value;

fn idl() -> Value {
    serde_json::from_str(include_str!("../../../idls/pump.json")).unwrap()
}

fn ix(idl: &Value, name: &str) -> Value {
    idl["instructions"].as_array().unwrap().iter().find(|i| i["name"] == name).cloned()
        .unwrap_or_else(|| panic!("instruction {name} missing from IDL"))
}

fn bytes(v: &Value) -> Vec<u8> {
    v.as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u8).collect()
}

/// (name, writable, signer) in IDL order.
fn accounts(ix: &Value) -> Vec<(String, bool, bool)> {
    ix["accounts"].as_array().unwrap().iter().map(|a| (
        a["name"].as_str().unwrap().to_string(),
        a["writable"].as_bool().unwrap_or(false),
        a["signer"].as_bool().unwrap_or(false),
    )).collect()
}

fn arg_names(ix: &Value) -> Vec<String> {
    ix["args"].as_array().unwrap().iter().map(|a| a["name"].as_str().unwrap().to_string()).collect()
}

#[test]
fn program_id_matches() {
    assert_eq!(idl()["address"].as_str().unwrap(), PUMP_PROGRAM_ID.to_string());
}

#[test]
fn create_v2_layout_matches() {
    let i = ix(&idl(), "create_v2");
    assert_eq!(bytes(&i["discriminator"]), PUMP_IX_CREATE_V2);
    assert_eq!(arg_names(&i), [
        "name", "symbol", "uri", "creator", "is_mayhem_mode",
        "is_cashback_enabled", "creator_fee_bps", "is_holder_reward",
    ]);
    let expected: [(&str, bool, bool); 16] = [
        ("mint", true, true), ("mint_authority", false, false), ("bonding_curve", true, false),
        ("associated_bonding_curve", true, false), ("global", false, false), ("user", true, true),
        ("system_program", false, false), ("token_program", false, false),
        ("associated_token_program", false, false), ("mayhem_program_id", true, false),
        ("global_params", false, false), ("sol_vault", true, false), ("mayhem_state", true, false),
        ("mayhem_token_vault", true, false), ("event_authority", false, false), ("program", false, false),
    ];
    let got = accounts(&i);
    assert_eq!(got.len(), expected.len());
    for (g, e) in got.iter().zip(expected) {
        assert_eq!((g.0.as_str(), g.1, g.2), e);
    }
}

#[test]
fn buy_exact_quote_in_v2_layout_matches() {
    let i = ix(&idl(), "buy_exact_quote_in_v2");
    assert_eq!(bytes(&i["discriminator"]), PUMP_IX_BUY_EXACT_QUOTE_IN_V2);
    assert_eq!(arg_names(&i), ["spendable_quote_in", "min_tokens_out"]);
    let expected: [(&str, bool, bool); 27] = [
        ("global", false, false), ("base_mint", false, false), ("quote_mint", false, false),
        ("base_token_program", false, false), ("quote_token_program", false, false),
        ("associated_token_program", false, false), ("fee_recipient", true, false),
        ("associated_quote_fee_recipient", true, false), ("buyback_fee_recipient", true, false),
        ("associated_quote_buyback_fee_recipient", true, false), ("bonding_curve", true, false),
        ("associated_base_bonding_curve", true, false), ("associated_quote_bonding_curve", true, false),
        ("user", true, true), ("associated_base_user", true, false), ("associated_quote_user", true, false),
        ("creator_vault", true, false), ("associated_creator_vault", true, false),
        ("sharing_config", false, false), ("global_volume_accumulator", false, false),
        ("user_volume_accumulator", true, false), ("associated_user_volume_accumulator", true, false),
        ("fee_config", false, false), ("fee_program", false, false), ("system_program", false, false),
        ("event_authority", false, false), ("program", false, false),
    ];
    let got = accounts(&i);
    assert_eq!(got.len(), expected.len());
    for (g, e) in got.iter().zip(expected) {
        assert_eq!((g.0.as_str(), g.1, g.2), e);
    }
}

#[test]
fn bonding_curve_layout_matches() {
    let idl = idl();
    let acc = idl["accounts"].as_array().unwrap().iter().find(|a| a["name"] == "BondingCurve").unwrap();
    assert_eq!(bytes(&acc["discriminator"]), PUMP_ACCOUNT_BONDING_CURVE);
    let ty = idl["types"].as_array().unwrap().iter().find(|t| t["name"] == "BondingCurve").unwrap();
    let fields: Vec<(String, String)> = ty["type"]["fields"].as_array().unwrap().iter()
        .map(|f| (f["name"].as_str().unwrap().into(), f["type"].to_string())).collect();
    // pump::read_curve reads these at fixed offsets 8/16/24, 48 and 49..81.
    let head: Vec<(&str, &str)> = fields.iter().take(7).map(|(n, t)| (n.as_str(), t.as_str())).collect();
    assert_eq!(head, [
        ("virtual_token_reserves", "\"u64\""), ("virtual_quote_reserves", "\"u64\""),
        ("real_token_reserves", "\"u64\""), ("real_quote_reserves", "\"u64\""),
        ("token_total_supply", "\"u64\""), ("complete", "\"bool\""), ("creator", "\"pubkey\""),
    ]);
}
