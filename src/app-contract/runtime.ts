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
   *
   * `type` is on the module rather than on each
   * name because it is a fact about the file:
   * `contract.ts` declares types and nothing else,
   * which a test in the scaffold enforces. It is
   * here so the emitters read it instead of
   * restating it at every call site —
   * `verbatimModuleSyntax` rejects a statement
   * that mixes the two, so getting it wrong is a
   * generated file that does not compile.
   */
  contract: {
    specifier: '../app/contract.js',
    type: true,
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
  db: { specifier: '../app/db.js', type: false, exports: ['appDb'] },
  mail: {
    specifier: '../app/mail.js',
    type: false,
    exports: ['sendNodeEmail'],
  },
  mailer: {
    specifier: '../app/mailer.js',
    type: false,
    exports: ['isTransientSendFailure'],
  },
  waits: {
    specifier: '../app/waits.js',
    type: false,
    exports: ['clearWaitCorrelation', 'registerWaitCorrelation'],
  },
} as const;

/**
 * Every name the runtime binds at run time, as
 * opposed to the types it declares.
 *
 * A generated file may not give one of its own
 * locals one of these names: the file imports the
 * binding, so a local of the same name would
 * shadow it. The emitter reserves them from here
 * rather than from a list of its own, because a
 * list of its own is a list that can fall behind
 * this one.
 */
export const RUNTIME_VALUES: readonly string[] = Object.values(RUNTIME)
  .filter((module) => !module.type)
  .flatMap((module) => [...module.exports]);
