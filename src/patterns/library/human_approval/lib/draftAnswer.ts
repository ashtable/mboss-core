import type { AnswerDraft, QuestionAsked } from './humanApprovalTypes.js';

/**
 * Writes the answer an agent would give.
 *
 * Whatever this returns is held in the workflow
 * database until a person answers the email after
 * it — days later, across restarts and deploys, if
 * that is how long they take. Nothing goes out
 * until they do.
 *
 * Call your model provider from here. Draw the
 * block as an API call if you would rather see the
 * service named on the canvas; it compiles the
 * same way either way.
 */
export async function draftAnswer(asked: QuestionAsked): Promise<AnswerDraft> {
  return {
    requestId: asked.requestId,
    question: asked.question,
    answer: 'Replace this with what your agent came back with.',
    citations: [],
  };
}
