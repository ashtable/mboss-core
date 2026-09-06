# Decisions

Why parts of this library are shaped the way they are, so that each one is
argued once instead of every time somebody reads the tree.

These eight were written together, and the reason is worth recording: an
architecture review of this repository proposed undoing six of them. Every one
of those proposals was refused on reading the code — the shape was deliberate,
and the argument for it existed only in a module header or a commit message
where a reviewer would not think to look. That is what an ADR is for. If a
future review suggests collapsing the two refusal channels or deleting the
vendored copies again, the answer is here.

An ADR records what was decided and what it cost. It is not a promise the
decision was right, and it is not a rule. Anything here can be reopened by
someone who has read it and disagrees; what it prevents is reopening it by
someone who has not.

| #                                                            | Decision                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| [0001](0001-two-refusal-channels.md)                         | Keep the compiler's refusals out of the validation rules          |
| [0002](0002-diagnostic-codes-are-a-wire-contract.md)         | Diagnostic codes are a wire contract, not a derived enum          |
| [0003](0003-one-misfit-and-v13-asks-about-declared-types.md) | Answer with one misfit, and let V13 ask only about declared types |
| [0004](0004-hand-the-planner-the-answer.md)                  | Hand the planner the answer, not the manifest                     |
| [0005](0005-the-writer-holds-the-ruler.md)                   | The writer holds the ruler; the emitters decide where to break    |
| [0006](0006-vendor-five-modules-byte-for-byte.md)            | Vendor five core modules into the generated app, byte for byte    |
| [0007](0007-email-off-the-barrel.md)                         | Keep email out of the barrel and hold both subpaths to leaves     |
| [0008](0008-reach-the-filesystem-directly.md)                | Reach the filesystem directly, and test on a real one             |

The words these use are defined in [`CONTEXT.md`](../../CONTEXT.md).

## Writing one

Number it next, name it after the decision rather than the area, and say what it
costs under **Consequences** — an ADR that only lists benefits is an
advertisement. Under **What holds it**, name the test or the type that would go
red if somebody undid the decision by accident, and if nothing would, say so
plainly. Four of these eight have a part that nothing enforces, and knowing
which part is most of their value.
