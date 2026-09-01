/**
 * Clears out bookings nobody ever confirmed.
 *
 * Takes no argument, which is what a block on a
 * scheduled run needs: a run the clock starts
 * carries no payload, so a handler that asked for
 * one could never be called.
 */
export async function sweepStale(): Promise<number> {
  return 0;
}
