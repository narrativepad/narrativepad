use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Signer is not the program upgrade authority")]
    NotUpgradeAuthority,
    #[msg("Platform fee exceeds the hard cap")]
    FeeTooHigh,
    #[msg("Creator-fee split exceeds 100%")]
    InvalidCreatorFeeSplit,
    #[msg("Invalid name, symbol or uri length")]
    InvalidMetadata,
    #[msg("Lock hash does not match the supplied metadata")]
    LockHashMismatch,
    #[msg("Invalid deposit limits")]
    InvalidLimits,
    #[msg("Invalid schedule")]
    InvalidSchedule,
    #[msg("Invalid tranche configuration")]
    InvalidTranches,
    #[msg("Deposit window is not open")]
    NotPooling,
    #[msg("Deposit is below the minimum")]
    DepositTooSmall,
    #[msg("Deposit would exceed the per-wallet maximum")]
    WalletCapExceeded,
    #[msg("Deposit would exceed the pool cap")]
    PoolCapExceeded,
    #[msg("Escrow is not launchable right now")]
    NotLaunchable,
    #[msg("Escrow is not refundable")]
    NotRefundable,
    #[msg("Escrow has not launched")]
    NotLaunched,
    #[msg("Nothing to claim yet")]
    NothingToClaim,
    #[msg("Account does not match the expected address")]
    InvalidAccount,
    #[msg("Unexpected program id")]
    InvalidProgram,
    #[msg("Launch payer must be the vault or a transaction signer")]
    InvalidLaunchPayer,
    #[msg("Pump bonding curve is not in the expected state")]
    InvalidBondingCurve,
    #[msg("Opening buy would fill too much of the bonding curve")]
    CurveOverfill,
    #[msg("Pool too small to cover fees and launch rent")]
    PoolTooSmall,
    #[msg("Launch spent more than the pool")]
    LaunchOverspent,
    #[msg("Launch received fewer tokens than required")]
    LaunchUnderfilled,
    #[msg("Creator fee surplus below the distribution minimum")]
    NothingToDistribute,
    #[msg("Dust can only be burned after every depositor has fully claimed")]
    ClaimsOutstanding,
    #[msg("Remaining token balance is larger than rounding dust")]
    NotDust,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
