// The fixture code-behind's project, as far as it
// goes. `fixtures/lib/` stands in for a generated
// project's `lib/`, and a handler that runs inside
// a transaction reaches its datasource at
// `../src/app/db.js` — so the manifest scanner,
// which resolves what the handlers import, needs
// that path to lead somewhere.
//
// It leads to the real runtime module rather than
// to a stand-in of it. A scaffolded project gets
// this file byte for byte, so what the scan sees
// here is what a real project would have.
export { appDb, prismaClient } from '../../../src/scaffold/app/db.js';
