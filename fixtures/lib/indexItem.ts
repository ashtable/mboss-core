import type { Indexed, Item } from './types.js';

/**
 * Indexes one item of a batch.
 *
 * Takes a single item rather than the batch,
 * which is what a queue block needs: each item is
 * a run of its own and is handed the item it is
 * for.
 */
export async function indexItem(item: Item): Promise<Indexed> {
  return { itemId: item.itemId, terms: item.body.split(' ').length };
}
