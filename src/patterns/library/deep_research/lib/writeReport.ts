import type { Evidence, ResearchReport } from './deepResearchTypes.js';

/**
 * Turns the gathered evidence into the answer.
 *
 * Drawn as a code block because that is what it
 * is: no service on the other end, no database
 * write, just the composition you want. Call a
 * model from here and the block becomes an API
 * call instead — draw it that way and the canvas
 * will say which service it reaches.
 */
export async function writeReport(evidence: Evidence): Promise<ResearchReport> {
  const lines = evidence.sources.map(
    (source) => `- [${source.title}](${source.url}) — ${source.excerpt}`,
  );

  return {
    topic: evidence.topic,
    markdown: [`# ${evidence.topic}`, '', evidence.question, '', ...lines].join(
      '\n',
    ),
    citedUrls: evidence.sources.map((source) => source.url),
  };
}
