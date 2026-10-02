pub mod burn_dust;
pub mod claim;
pub mod config;
pub mod create_escrow;
pub mod deposit;
pub mod distribute_creator_fees;
pub mod launch;
pub mod refund;
pub mod sweep_wsol;

pub use burn_dust::*;
pub use claim::*;
pub use config::*;
pub use create_escrow::*;
pub use deposit::*;
pub use distribute_creator_fees::*;
pub use launch::*;
pub use refund::*;
pub use sweep_wsol::*;

use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::SEED_VAULT;

/// Moves lamports out of an escrow's vault PDA (system-owned, so the System program must do
/// it with the vault's seeds). Every lamport that leaves a vault goes through here.
pub(crate) fn vault_transfer<'info>(
    system_program: &Program<'info, System>,
    vault: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    escrow: &Pubkey,
    vault_bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[SEED_VAULT, escrow.as_ref(), &[vault_bump]];
    system_program::transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            system_program::Transfer { from: vault.clone(), to: to.clone() },
            &[seeds],
        ),
        amount,
    )
}
