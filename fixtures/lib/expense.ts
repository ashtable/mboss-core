/**
 * An expense claim, and the two ways it can end.
 *
 * The approval fixture is drawn over these: one
 * arm pays, the other files the refusal, and the
 * receipt the payment produces is what an
 * artifact-link email points at.
 */

/** A claim as it is filed. */
export interface ExpenseClaim {
  claimId: string;
  amount: number;
  submitter: { email: string; name: string };
  memo: string;
}

/** A claim that was paid. */
export interface Payment {
  paymentId: string;
  amount: number;
  /** Where the receipt is kept. An email points a
   *  signed link at this. */
  receiptKey: string;
}

/** A claim that was not. */
export interface Refusal {
  claimId: string;
  reason: string;
}

export async function payClaim(claim: ExpenseClaim): Promise<Payment> {
  return {
    paymentId: `p-${claim.claimId}`,
    amount: claim.amount,
    receiptKey: `receipts/${claim.claimId}.pdf`,
  };
}

export async function fileRefusal(claim: ExpenseClaim): Promise<Refusal> {
  return { claimId: claim.claimId, reason: 'not approved' };
}

/**
 * Tidies up whichever way the claim went. Takes
 * nothing, so it can stand where two arms meet and
 * read neither of them.
 */
export async function closeClaim(): Promise<void> {
  return;
}
