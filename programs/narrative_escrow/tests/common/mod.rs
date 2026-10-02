//! LiteSVM harness for the escrow. The real program is loaded from target/deploy, and the
//! test-only mock (tests/mock_pump) is loaded at pump.fun's program id.
//!
//! Build first:
//!   anchor build
//!   cargo build-sbf --manifest-path tests/mock_pump/Cargo.toml --sbf-out-dir target/deploy
#![allow(dead_code)]

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

use narrative_escrow::constants::*;
use narrative_escrow::instructions::{ConfigParams, CreateEscrowParams};
use narrative_escrow::state::{Config, Escrow, Receipt};
use narrative_escrow::{self as ne, math, pump};

pub const SOL: u64 = 1_000_000_000;
pub const T0: i64 = 1_800_000_000;

const ESCROW_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/narrative_escrow.so");
const MOCK_PUMP_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/mock_pump.so");

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

/// Arbitrary stand-ins for pump's fee recipients (the mock ignores them).
pub const FEE_RECIPIENT: Pubkey = Pubkey::new_from_array([7u8; 32]);
pub const BUYBACK_RECIPIENT: Pubkey = Pubkey::new_from_array([8u8; 32]);

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub operator: Keypair,
    pub treasury: Pubkey,
    pub proposer: Pubkey,
    nonce: u8,
}

impl Env {
    /// Programs loaded, clock at T0, upgrade authority = admin, but no config yet.
    pub fn bare() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(ne::ID, ESCROW_SO)
            .expect("missing target/deploy/narrative_escrow.so (run `anchor build`)");
        svm.add_program_from_file(PUMP_PROGRAM_ID, MOCK_PUMP_SO)
            .expect("missing target/deploy/mock_pump.so (see header of this file)");
        let admin = Keypair::new();
        let operator = Keypair::new();
        let treasury = Keypair::new().pubkey();
        let proposer = Keypair::new().pubkey();
        for k in [admin.pubkey(), operator.pubkey(), treasury, proposer] {
            svm.airdrop(&k, 100 * SOL).unwrap();
        }
        let mut env = Env { svm, admin, operator, treasury, proposer, nonce: 0 };
        env.set_upgrade_authority(env.admin.pubkey());
        env.set_time(T0);
        env
    }

    /// `bare()` + `init_config` with the default (D-006/D-007) parameters.
    pub fn new() -> Self {
        let mut env = Self::bare();
        let params = env.default_config();
        let admin = env.admin.insecure_clone();
        env.send(&[init_config_ix(&admin.pubkey(), params)], &admin, &[]).expect("init_config");
        env
    }

    pub fn default_config(&self) -> ConfigParams {
        ConfigParams {
            operator: self.operator.pubkey(),
            treasury: self.treasury,
            fee_bps: 100,
            creator_fee_proposer_bps: 3_000,
            creator_fee_platform_bps: 2_000,
            max_pool_cap: 100 * SOL,
        }
    }

    /// LiteSVM deploys programs without an upgrade authority; patch the ProgramData header
    /// (bincode: u32 tag=3, u64 slot, Option<Pubkey>) so `init_config`'s check can be tested.
    pub fn set_upgrade_authority(&mut self, authority: Pubkey) {
        let (pd, _) = Pubkey::find_program_address(&[ne::ID.as_ref()], &bpf_loader_upgradeable::ID);
        let mut acc = self.svm.get_account(&pd).expect("programdata");
        acc.data[12] = 1;
        acc.data[13..45].copy_from_slice(authority.as_ref());
        self.svm.set_account(pd, acc).unwrap();
    }

    pub fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = unix_timestamp;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
    }

    pub fn send(&mut self, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> TxResult {
        self.svm.expire_blockhash();
        let mut all = vec![compute_limit_ix(1_400_000)];
        all.extend_from_slice(ixs);
        let mut signers: Vec<&Keypair> = vec![payer];
        signers.extend_from_slice(extra);
        let tx = Transaction::new_signed_with_payer(
            &all,
            Some(&payer.pubkey()),
            &signers,
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx)
    }

    pub fn funded(&mut self, sol: u64) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), sol * SOL).unwrap();
        k
    }

    pub fn lamports(&self, key: &Pubkey) -> u64 {
        self.svm.get_balance(key).unwrap_or(0)
    }

    pub fn exists(&self, key: &Pubkey) -> bool {
        self.svm.get_account(key).map(|a| a.lamports > 0).unwrap_or(false)
    }

    pub fn token_balance(&self, token_account: &Pubkey) -> u64 {
        let acc = self.svm.get_account(token_account).expect("token account");
        u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
    }

    pub fn escrow(&self, key: &Pubkey) -> Escrow {
        let acc = self.svm.get_account(key).expect("escrow");
        Escrow::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    pub fn receipt(&self, key: &Pubkey) -> Receipt {
        let acc = self.svm.get_account(key).expect("receipt");
        Receipt::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    pub fn config(&self) -> Config {
        let acc = self.svm.get_account(&config_pda()).expect("config");
        Config::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    /// Default escrow: deposits T0..T0+600, launch window T0+720..T0+2520,
    /// 5 tranches x 600s, cap 20 SOL, min 1 SOL, per wallet 5 SOL, min deposit 0.1 SOL.
    pub fn spec(&mut self, name: &str) -> CreateEscrowParams {
        self.nonce += 1;
        let mut narrative_id = [0u8; 16];
        narrative_id[0] = self.nonce;
        narrative_id[1..1 + name.len().min(15)].copy_from_slice(&name.as_bytes()[..name.len().min(15)]);
        let symbol = "NPAD".to_string();
        let uri = "ipfs://bafkreiexamplecidexamplecidexamplecidexample".to_string();
        let details_hash = [42u8; 32];
        CreateEscrowParams {
            narrative_id,
            lock_hash: math::lock_hash(&narrative_id, name, &symbol, &uri, &details_hash),
            name: name.to_string(),
            symbol,
            uri,
            details_hash,
            proposer: self.proposer,
            per_wallet_max: 5 * SOL,
            pool_cap: 20 * SOL,
            pool_min: SOL,
            min_deposit: SOL / 10,
            deposit_start: T0,
            deposit_end: T0 + 600,
            launch_after: T0 + 720,
            launch_deadline: T0 + 2520,
            tranche_count: 5,
            tranche_interval: 600,
        }
    }

    pub fn create(&mut self, params: CreateEscrowParams) -> TxResult {
        let op = self.operator.insecure_clone();
        self.send(&[create_escrow_ix(&op.pubkey(), params)], &op, &[])
    }

    /// Creates an escrow from `spec(name)` and returns its address.
    pub fn create_default(&mut self, name: &str) -> Pubkey {
        let p = self.spec(name);
        let id = p.narrative_id;
        self.create(p).expect("create_escrow");
        escrow_pda(&id)
    }

    pub fn deposit(&mut self, who: &Keypair, escrow: &Pubkey, amount: u64) -> TxResult {
        self.send(&[deposit_ix(&who.pubkey(), escrow, amount)], who, &[])
    }

    pub fn launch(&mut self, cranker: &Keypair, escrow: &Pubkey, nonce: u64) -> TxResult {
        let ix = launch_ix(&cranker.pubkey(), escrow, &self.treasury, nonce, None);
        self.send(&[ix], cranker, &[])
    }

    /// One depositor per amount, clock moved to `launch_after`, launched with nonce 1.
    /// Returns (escrow, mint, depositors).
    pub fn launched(&mut self, name: &str, deposits: &[u64]) -> (Pubkey, Pubkey, Vec<Keypair>) {
        let escrow = self.create_default(name);
        let mut wallets = Vec::new();
        for amount in deposits {
            let w = self.funded(amount / SOL + 2);
            ok(self.deposit(&w, &escrow, *amount));
            wallets.push(w);
        }
        let launch_after = self.escrow(&escrow).launch_after;
        self.set_time(launch_after);
        let cranker = self.funded(1);
        ok(self.launch(&cranker, &escrow, 1));
        (escrow, mint_pda(&escrow, 1), wallets)
    }

    pub fn claim(&mut self, wallet: &Keypair, escrow: &Pubkey, mint: &Pubkey) -> TxResult {
        self.send(&[claim_ix(&wallet.pubkey(), escrow, &wallet.pubkey(), mint)], wallet, &[])
    }
}

// ---- assertions ----------------------------------------------------------------------------

pub fn err_code(res: TxResult) -> u32 {
    use anchor_lang::solana_program::instruction::error::InstructionError;
    let fail = res.expect_err("expected the transaction to fail");
    match fail.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => code,
        other => panic!("unexpected error {other:?}\nlogs: {:#?}", fail.meta.logs),
    }
}

pub fn expect_err(res: TxResult, expected: impl Into<u32>) {
    let expected = expected.into();
    let fail = res.expect_err("expected the transaction to fail");
    let logs = fail.meta.logs.clone();
    let code = err_code(Err(fail));
    assert_eq!(code, expected, "logs: {logs:#?}");
}

pub fn expect_err_in(res: TxResult, any_of: &[u32]) {
    let fail = res.expect_err("expected the transaction to fail");
    let logs = fail.meta.logs.clone();
    let code = err_code(Err(fail));
    assert!(any_of.contains(&code), "code {code} not in {any_of:?}; logs: {logs:#?}");
}

pub fn ok(res: TxResult) -> TransactionMetadata {
    match res {
        Ok(meta) => meta,
        Err(fail) => panic!("transaction failed: {:?}\nlogs: {:#?}", fail.err, fail.meta.logs),
    }
}

// ---- PDAs ------------------------------------------------------------------------------------

pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[SEED_CONFIG], &ne::ID).0
}
pub fn escrow_pda(narrative_id: &[u8; 16]) -> Pubkey {
    Pubkey::find_program_address(&[SEED_ESCROW, narrative_id], &ne::ID).0
}
pub fn vault_pda(escrow: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[SEED_VAULT, escrow.as_ref()], &ne::ID).0
}
pub fn receipt_pda(escrow: &Pubkey, wallet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[SEED_RECEIPT, escrow.as_ref(), wallet.as_ref()], &ne::ID).0
}
pub fn mint_pda(escrow: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(&[SEED_MINT, escrow.as_ref(), &nonce.to_le_bytes()], &ne::ID).0
}
pub fn t22_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    pump::ata_address(owner, mint, &TOKEN_2022_PROGRAM_ID)
}

// ---- instruction builders -------------------------------------------------------------------

pub fn compute_limit_ix(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction {
        program_id: anchor_lang::prelude::pubkey!("ComputeBudget111111111111111111111111111111"),
        accounts: vec![],
        data,
    }
}

pub fn init_config_ix(admin: &Pubkey, params: ConfigParams) -> Instruction {
    let (program_data, _) = Pubkey::find_program_address(&[ne::ID.as_ref()], &bpf_loader_upgradeable::ID);
    Instruction {
        program_id: ne::ID,
        accounts: ne::accounts::InitConfig {
            admin: *admin,
            config: config_pda(),
            program: ne::ID,
            program_data,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: ne::instruction::InitConfig { params }.data(),
    }
}

pub fn update_config_ix(admin: &Pubkey, params: ConfigParams, new_admin: Option<Pubkey>) -> Instruction {
    Instruction {
        program_id: ne::ID,
        accounts: ne::accounts::UpdateConfig { admin: *admin, config: config_pda() }.to_account_metas(None),
        data: ne::instruction::UpdateConfig { params, new_admin }.data(),
    }
}

pub fn create_escrow_ix(operator: &Pubkey, params: CreateEscrowParams) -> Instruction {
    let escrow = escrow_pda(&params.narrative_id);
    Instruction {
        program_id: ne::ID,
        accounts: ne::accounts::CreateEscrow {
            operator: *operator,
            config: config_pda(),
            escrow,
            vault: vault_pda(&escrow),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: ne::instruction::CreateEscrow { params }.data(),
    }
}

pub fn deposit_ix(depositor: &Pubkey, escrow: &Pubkey, amount: u64) -> Instruction {
    deposit_ix_with_vault(depositor, escrow, &vault_pda(escrow), amount)
}

pub fn deposit_ix_with_vault(depositor: &Pubkey, escrow: &Pubkey, vault: &Pubkey, amount: u64) -> Instruction {
    Instruction {
        program_id: ne::ID,
        accounts: ne::accounts::Deposit {
            depositor: *depositor,
            escrow: *escrow,
            vault: *vault,
            receipt: receipt_pda(escrow, depositor),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: ne::instruction::Deposit { amount }.data(),
    }
}

pub fn refund_ix(escrow: &Pubkey, wallet: &Pubkey) -> Instruction {
    refund_ix_raw(escrow, &receipt_pda(escrow, wallet), wallet)
}

pub fn refund_ix_raw(escrow: &Pubkey, receipt: &Pubkey, wallet: &Pubkey) -> Instruction {
    Instruction {
        program_id: ne::ID,
        accounts: ne::accounts::Refund {
            escrow: *escrow,
            vault: vault_pda(escrow),
            receipt: *receipt,
            wallet: *wallet,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: ne::instruction::Refund {}.data(),
    }
}

pub struct LaunchAccounts {
    pub cranker: Pubkey,
    pub escrow: Pubkey,
    pub vault: Pubkey,
    pub create_payer: Pubkey,
    pub mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub treasury: Pubkey,
    pub pump_program: Pubkey,
    pub token_program: Pubkey,
    pub associated_token_program: Pubkey,
}

pub fn launch_accounts(cranker: &Pubkey, escrow: &Pubkey, treasury: &Pubkey, nonce: u64) -> LaunchAccounts {
    let vault = vault_pda(escrow);
    let mint = mint_pda(escrow, nonce);
    LaunchAccounts {
        cranker: *cranker,
        escrow: *escrow,
        vault,
        create_payer: vault,
        mint,
        vault_token_account: t22_ata(&vault, &mint),
        treasury: *treasury,
        pump_program: PUMP_PROGRAM_ID,
        token_program: TOKEN_2022_PROGRAM_ID,
        associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
    }
}

pub fn launch_ix_from(a: &LaunchAccounts, nonce: u64, remaining: Vec<AccountMeta>) -> Instruction {
    let mut accounts = ne::accounts::Launch {
        cranker: a.cranker,
        escrow: a.escrow,
        vault: a.vault,
        create_payer: a.create_payer,
        mint: a.mint,
        vault_token_account: a.vault_token_account,
        treasury: a.treasury,
        pump_program: a.pump_program,
        token_program: a.token_program,
        associated_token_program: a.associated_token_program,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);
    accounts.extend(remaining);
    Instruction { program_id: ne::ID, accounts, data: ne::instruction::Launch { mint_nonce: nonce }.data() }
}

/// `create_payer`: None = the vault pays pump's create rent (default); Some = fallback §4.3b.
pub fn launch_ix(
    cranker: &Pubkey,
    escrow: &Pubkey,
    treasury: &Pubkey,
    nonce: u64,
    create_payer: Option<Pubkey>,
) -> Instruction {
    let mut a = launch_accounts(cranker, escrow, treasury, nonce);
    if let Some(p) = create_payer {
        a.create_payer = p;
    }
    let remaining = launch_remaining(&a.vault, &a.mint);
    launch_ix_from(&a, nonce, remaining)
}

/// pump's accounts in `pump::ra` order (same flags as the real IDL).
pub fn launch_remaining(vault: &Pubkey, mint: &Pubkey) -> Vec<AccountMeta> {
    let pda = |seeds: &[&[u8]], program: &Pubkey| Pubkey::find_program_address(seeds, program).0;
    let w = |k: Pubkey| AccountMeta::new(k, false);
    let r = |k: Pubkey| AccountMeta::new_readonly(k, false);
    let t22 = TOKEN_2022_PROGRAM_ID;
    let spl = SPL_TOKEN_PROGRAM_ID;
    let wsol_ata = |owner: &Pubkey| pump::ata_address(owner, &WSOL_MINT, &spl);

    let bonding_curve = pda(&[b"bonding-curve", mint.as_ref()], &PUMP_PROGRAM_ID);
    let sol_vault = pda(&[b"sol-vault"], &MAYHEM_PROGRAM_ID);
    let creator_vault = pda(&[b"creator-vault", vault.as_ref()], &PUMP_PROGRAM_ID);
    let user_volume = pda(&[b"user_volume_accumulator", vault.as_ref()], &PUMP_PROGRAM_ID);

    let metas = vec![
        r(pda(&[b"mint-authority"], &PUMP_PROGRAM_ID)),
        w(bonding_curve),
        w(pump::ata_address(&bonding_curve, mint, &t22)),
        r(pda(&[b"global"], &PUMP_PROGRAM_ID)),
        w(MAYHEM_PROGRAM_ID),
        r(pda(&[b"global-params"], &MAYHEM_PROGRAM_ID)),
        w(sol_vault),
        w(pda(&[b"mayhem-state", mint.as_ref()], &MAYHEM_PROGRAM_ID)),
        w(pump::ata_address(&sol_vault, mint, &t22)),
        r(pda(&[b"__event_authority"], &PUMP_PROGRAM_ID)),
        r(WSOL_MINT),
        r(spl),
        w(FEE_RECIPIENT),
        w(wsol_ata(&FEE_RECIPIENT)),
        w(BUYBACK_RECIPIENT),
        w(wsol_ata(&BUYBACK_RECIPIENT)),
        w(wsol_ata(&bonding_curve)),
        w(wsol_ata(vault)),
        w(creator_vault),
        w(wsol_ata(&creator_vault)),
        r(pda(&[b"sharing-config", mint.as_ref()], &PUMP_FEE_PROGRAM_ID)),
        r(pda(&[b"global_volume_accumulator"], &PUMP_PROGRAM_ID)),
        w(user_volume),
        w(wsol_ata(&user_volume)),
        r(pda(&[b"fee_config", PUMP_PROGRAM_ID.as_ref()], &PUMP_FEE_PROGRAM_ID)),
        r(PUMP_FEE_PROGRAM_ID),
    ];
    assert_eq!(metas.len(), pump::ra::COUNT);
    metas
}

pub fn claim_ix(caller: &Pubkey, escrow: &Pubkey, wallet: &Pubkey, mint: &Pubkey) -> Instruction {
    let vault = vault_pda(escrow);
    Instruction {
        program_id: ne::ID,
        accounts: ne::accounts::Claim {
            caller: *caller,
            escrow: *escrow,
            vault,
            receipt: receipt_pda(escrow, wallet),
            wallet: *wallet,
            mint: *mint,
            vault_token_account: t22_ata(&vault, mint),
            wallet_token_account: t22_ata(wallet, mint),
            token_program: TOKEN_2022_PROGRAM_ID,
            associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: ne::instruction::Claim {}.data(),
    }
}

pub fn distribute_ix(escrow: &Pubkey, proposer: &Pubkey, treasury: &Pubkey) -> Instruction {
    Instruction {
        program_id: ne::ID,
        accounts: ne::accounts::DistributeCreatorFees {
            escrow: *escrow,
            vault: vault_pda(escrow),
            proposer: *proposer,
            treasury: *treasury,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: ne::instruction::DistributeCreatorFees {}.data(),
    }
}

pub fn burn_dust_ix(escrow: &Pubkey, mint: &Pubkey) -> Instruction {
    let vault = vault_pda(escrow);
    Instruction {
        program_id: ne::ID,
        accounts: ne::accounts::BurnDust {
            escrow: *escrow,
            vault,
            mint: *mint,
            vault_token_account: t22_ata(&vault, mint),
            token_program: TOKEN_2022_PROGRAM_ID,
        }
        .to_account_metas(None),
        data: ne::instruction::BurnDust {}.data(),
    }
}
