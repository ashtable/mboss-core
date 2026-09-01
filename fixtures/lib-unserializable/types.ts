import type { Socket } from 'node:net';
import type { Readable } from 'node:stream';

/**
 * A code-behind whose exported types cannot travel
 * between blocks, one per reason a type can fail
 * to.
 *
 * It compiles cleanly: nothing here is a type
 * error, which is the point. Every one of these
 * would type-check in the author's editor and only
 * come apart once a value of it had been written
 * to the workflow database and read back.
 */

/** A callback member: behaviour, not data. */
export interface Ticket {
  id: string;
  onDone: () => void;
}

/** Bytes in memory rather than a value. */
export interface Upload {
  id: string;
  body: Buffer;
}

/** A stream: readable once, in this process. */
export interface Feed {
  id: string;
  stream: Readable;
}

/** An open connection to somewhere else. */
export interface Conn {
  id: string;
  socket: Socket;
}

/**
 * A class instance. Its fields survive the round
 * trip and its methods do not, so what comes back
 * is a different thing wearing the same type.
 */
export class Session {
  constructor(readonly id: string) {}

  refresh(): void {}
}

/** The same fault, one level down. */
export interface Job {
  id: string;
  payload: { onDone: () => void };
}

/** Nothing wrong with this one. */
export interface Plain {
  id: string;
  at: Date;
  tags: string[];
}
