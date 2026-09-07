import type { Evidence, ResearchBrief } from './deepResearchTypes.js';

/**
 * Gathers what has been written about the
 * question.
 *
 * The loop hands this the same brief every round —
 * the block reads the payload the run started with
 * and nothing else — so a real implementation
 * makes progress by keeping a record of its own,
 * keyed on the topic, of what it has already read.
 *
 * The stand-in comes back with enough on the first
 * round, so a project created today runs this
 * workflow all the way to the report.
 */
export async function searchSources(brief: ResearchBrief): Promise<Evidence> {
  return {
    topic: brief.topic,
    question: brief.question,
    sources: [
      {
        url: 'https://example.com/a',
        title: 'A first source',
        excerpt: 'Replace this with what your search came back with.',
      },
      {
        url: 'https://example.com/b',
        title: 'A second source',
        excerpt: 'Three of these is what the next block calls enough.',
      },
      {
        url: 'https://example.com/c',
        title: 'A third source',
        excerpt: 'Yours to change, along with the bar it is measured against.',
      },
    ],
  };
}
