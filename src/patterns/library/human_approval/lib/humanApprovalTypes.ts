/**
 * The payloads the sign-off workflow wires its
 * blocks together with.
 *
 * `asker.email` is the only place the run knows to
 * write back to: the trigger reads the requesting
 * user's address from that path, and the closing
 * email addresses whoever it found there. Renaming
 * it here means renaming it on the trigger too.
 */

/** A question, as it arrives on the event. */
export interface QuestionAsked {
  requestId: string;
  question: string;
  asker: { email: string; name: string };
}

/** What the agent came up with, before anybody
 *  has looked at it. */
export interface AnswerDraft {
  requestId: string;
  question: string;
  answer: string;
  citations: string[];
}
