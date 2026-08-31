use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("Fd9qA4pYkS43ordqGUVyYnaFZqAgRL1qZwa6nCBhC7Xq");
pub const MAX_SELLERS: usize = 4;

#[program]
pub mod cosign_escrow {
    use super::*;

    pub fn initialize_escrow(ctx: Context<InitializeEscrow>, task_hash: [u8; 32], sellers: Vec<Pubkey>, amount_per_seller: u64, expires_at: i64) -> Result<()> {
        validate_pool(&sellers, amount_per_seller)?;
        let now = Clock::get()?.unix_timestamp;
        require!(expires_at > now && expires_at <= now + 7 * 86400, EscrowError::InvalidExpiry);
        let total = amount_per_seller.checked_mul(sellers.len() as u64).ok_or(EscrowError::Overflow)?;
        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.authority = ctx.accounts.authority.key();
        escrow.task_hash = task_hash;
        escrow.amount_per_seller = amount_per_seller;
        escrow.expires_at = expires_at;
        escrow.count = sellers.len() as u8;
        escrow.bump = ctx.bumps.escrow;
        for (i, seller) in sellers.iter().enumerate() { escrow.sellers[i] = *seller; }
        transfer(CpiContext::new(ctx.accounts.system_program.to_account_info(), Transfer { from: ctx.accounts.buyer.to_account_info(), to: escrow.to_account_info() }), total)?;
        msg!("COSIGN initialize");
        Ok(())
    }

    pub fn release(ctx: Context<Release>, slot: u8, evidence_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        validate_settlement(escrow, slot, evidence_hash)?;
        require!(Clock::get()?.unix_timestamp < escrow.expires_at, EscrowError::Expired);
        require_keys_eq!(ctx.accounts.seller.key(), escrow.sellers[slot as usize], EscrowError::WrongRecipient);
        let amount = escrow.amount_per_seller;
        **escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += amount;
        escrow.states[slot as usize] = 1;
        escrow.evidence_hashes[slot as usize] = evidence_hash;
        msg!("COSIGN release slot={}", slot);
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>, slot: u8, evidence_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        validate_settlement(escrow, slot, evidence_hash)?;
        let caller = ctx.accounts.caller.key();
        require!(caller == escrow.authority || (caller == escrow.buyer && Clock::get()?.unix_timestamp >= escrow.expires_at), EscrowError::Unauthorized);
        let amount = escrow.amount_per_seller;
        **escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.buyer.to_account_info().try_borrow_mut_lamports()? += amount;
        escrow.states[slot as usize] = 2;
        escrow.evidence_hashes[slot as usize] = evidence_hash;
        msg!("COSIGN refund slot={}", slot);
        Ok(())
    }
}

fn validate_pool(sellers: &[Pubkey], amount: u64) -> Result<()> {
    require!(!sellers.is_empty() && sellers.len() <= MAX_SELLERS, EscrowError::InvalidPool);
    require!(amount > 0 && amount <= 100_000_000, EscrowError::InvalidAmount);
    for (i, seller) in sellers.iter().enumerate() {
        require!(*seller != Pubkey::default() && !sellers[..i].contains(seller), EscrowError::InvalidPool);
    }
    Ok(())
}

fn validate_settlement(escrow: &Escrow, slot: u8, hash: [u8; 32]) -> Result<()> {
    require!((slot as usize) < escrow.count as usize, EscrowError::InvalidSlot);
    require!(escrow.states[slot as usize] == 0, EscrowError::AlreadySettled);
    require!(hash != [0; 32], EscrowError::MissingEvidence);
    Ok(())
}

#[derive(Accounts)]
#[instruction(task_hash: [u8; 32])]
pub struct InitializeEscrow<'info> {
    #[account(mut)] pub buyer: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(init, payer = buyer, space = 8 + Escrow::INIT_SPACE, seeds = [b"escrow", buyer.key().as_ref(), &task_hash], bump)]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority, seeds = [b"escrow", escrow.buyer.as_ref(), &escrow.task_hash], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: Key is checked against the initialized seller slot before transfer.
    #[account(mut)] pub seller: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    pub caller: Signer<'info>,
    #[account(mut, has_one = buyer, seeds = [b"escrow", escrow.buyer.as_ref(), &escrow.task_hash], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    /// CHECK: constrained by has_one = buyer; the original buyer receives refunds.
    #[account(mut)] pub buyer: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub authority: Pubkey,
    pub task_hash: [u8; 32],
    pub sellers: [Pubkey; MAX_SELLERS],
    pub amount_per_seller: u64,
    pub expires_at: i64,
    pub states: [u8; MAX_SELLERS],
    pub evidence_hashes: [[u8; 32]; MAX_SELLERS],
    pub count: u8,
    pub bump: u8,
}

#[error_code]
pub enum EscrowError {
    #[msg("Seller pool must contain 1 to 4 distinct nonzero recipients")] InvalidPool,
    #[msg("Allocation must be positive and at most 0.1 SOL")] InvalidAmount,
    #[msg("Expiry must be in the next seven days")] InvalidExpiry,
    #[msg("Arithmetic overflow")] Overflow,
    #[msg("Allocation index out of range")] InvalidSlot,
    #[msg("Allocation already settled")] AlreadySettled,
    #[msg("Settlement requires an evidence commitment")] MissingEvidence,
    #[msg("Escrow has expired")] Expired,
    #[msg("Recipient differs from initialized seller")] WrongRecipient,
    #[msg("Only the verifier may settle; buyer may refund after expiry")] Unauthorized,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn escrow() -> Escrow { Escrow { buyer: Pubkey::new_unique(), authority: Pubkey::new_unique(), task_hash: [1; 32], sellers: [Pubkey::new_unique(); 4], amount_per_seller: 50_000_000, expires_at: 1000, states: [0; 4], evidence_hashes: [[0; 32]; 4], count: 4, bump: 255 } }
    #[test] fn bounds() { assert!(validate_pool(&[], 1).is_err()); assert!(validate_pool(&[Pubkey::new_unique(); 5], 1).is_err()); assert!(validate_pool(&[Pubkey::new_unique()], 0).is_err()); assert!(validate_pool(&[Pubkey::new_unique()], 100_000_001).is_err()); }
    #[test] fn unique_recipients() { let p = Pubkey::new_unique(); assert!(validate_pool(&[p, p], 1).is_err()); assert!(validate_pool(&[Pubkey::default()], 1).is_err()); assert!(validate_pool(&[p, Pubkey::new_unique()], 50_000_000).is_ok()); }
    #[test] fn settlement_guard() { let mut e = escrow(); assert!(validate_settlement(&e, 4, [1; 32]).is_err()); assert!(validate_settlement(&e, 0, [0; 32]).is_err()); assert!(validate_settlement(&e, 0, [1; 32]).is_ok()); e.states[0] = 1; assert!(validate_settlement(&e, 0, [1; 32]).is_err()); e.states[0] = 2; assert!(validate_settlement(&e, 0, [1; 32]).is_err()); }
    #[test] fn independent_allocations() { let mut e = escrow(); e.states[0] = 1; e.states[1] = 2; assert!(validate_settlement(&e, 2, [1; 32]).is_ok()); assert!(validate_settlement(&e, 3, [1; 32]).is_ok()); }
}
