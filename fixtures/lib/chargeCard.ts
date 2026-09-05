import type { ExpenseClaim, Payment } from './expense.js';

/**
 * Charges the claim through the payment service.
 *
 * The one handler in this code-behind that really
 * reaches another system, so a scan of it has
 * something for the rule about transactions to
 * find. No workflow fixture names it.
 */
export async function chargeCard(claim: ExpenseClaim): Promise<Payment> {
  const answer = await fetch('https://payments.example/charges', {
    method: 'POST',
    body: JSON.stringify(claim),
  });

  return (await answer.json()) as Payment;
}
