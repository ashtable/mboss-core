/**
 * An intake request, the answers a person sends
 * back on the form, and what the app keeps.
 *
 * Its own file rather than an addition to
 * `types.ts`, so the manifest's `typeSources` is
 * exercised on a second source file and the
 * compiler has to import from two of them.
 */

/** What arrives when somebody asks for help. */
export interface IntakeRequest {
  requestId: string;
  contact: { email: string; name: string };
  summary: string;
}

/** What came back on the form. */
export interface IntakeAnswers {
  name: string;
  urgent: boolean;
  details: string;
  /** Whether there is enough here to act on. The
   *  retry fixture branches on it. */
  complete: boolean;
}

/** The row the app keeps afterwards. */
export interface IntakeRecord {
  recordId: string;
  name: string;
}

export async function recordIntake(
  answers: IntakeAnswers,
): Promise<IntakeRecord> {
  return { recordId: `r-${answers.name}`, name: answers.name };
}
