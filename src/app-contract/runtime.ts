/**
 * The runtime modules a generated workflow is
 * allowed to import, and the exports it is allowed
 * to reach for.
 *
 * The compiler emits imports from this table
 * rather than from string literals scattered
 * through the emitters, and a conformance test in
 * the scaffold checks the table against the real
 * modules. Drift between what the compiler thinks
 * the runtime offers and what it offers then fails
 * in one place with a readable message, rather
 * than inside a generated file that nobody wrote.
 *
 * Every export list is sorted, because that is the
 * order the emitted import statements use and a
 * stable order is what makes a generated file
 * comparable against the last one.
 */
export const RUNTIME = {
  /**
   * Types only. This is the one type-level
   * dependency the compiler's output has on the
   * runtime, and the file it names imports nothing
   * itself.
   */
  contract: {
    specifier: '../app/contract.js',
    exports: [
      'EmailFormField',
      'EventWait',
      'FieldCondition',
      'NodeEmail',
      'NodeEmailAttach',
      'PayloadCheck',
      'ScheduleEntry',
      'TriggerDescriptor',
      'WaitDescriptor',
      'WaitRegistration',
      'WorkflowEntry',
    ],
  },
  db: { specifier: '../app/db.js', exports: ['appDb'] },
  mail: { specifier: '../app/mail.js', exports: ['sendNodeEmail'] },
  mailer: {
    specifier: '../app/mailer.js',
    exports: ['isTransientSendFailure'],
  },
  waits: {
    specifier: '../app/waits.js',
    exports: ['clearWaitCorrelation', 'registerWaitCorrelation'],
  },
} as const;
