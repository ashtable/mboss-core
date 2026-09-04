/**
 * An expense claim, the ways it can end, and the
 * two handlers that choose between them.
 *
 * The approval fixture is drawn over these: one
 * arm pays, the other files the refusal, and the
 * receipt the payment produces is what an
 * artifact-link email points at. The branch
 * fixtures let code make the same choice, which is
 * why the last two functions answer with a
 * decision rather than with a payload.
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

/** The three desks a claim can land on. */
export type Routing = 'pay' | 'refuse' | 'hold';

/** Whether the claim can be paid without anybody
 *  looking at it. */
export async function autoApprove(claim: ExpenseClaim): Promise<boolean> {
  return claim.amount < 100;
}

/**
 * Which desk the claim goes to.
 *
 * Written as an alias rather than a union spelled
 * out here, because that is the shape a manifest
 * cannot read off the return type's text.
 */
export async function routeClaim(claim: ExpenseClaim): Promise<Routing> {
  if (claim.amount < 100) return 'pay';

  return claim.memo === '' ? 'refuse' : 'hold';
}
