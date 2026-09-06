/**
 * The payloads the research workflow wires its
 * blocks together with.
 *
 * `topic` is what a real search keys its own
 * record of what it has already read on, because
 * every round of the loop is handed the same
 * brief. Renaming it means changing whatever
 * remembers.
 */

/** What somebody asked to have researched. */
export interface ResearchBrief {
  topic: string;
  question: string;
  maxSources: number;
}

/** One thing the search found worth quoting. */
export interface EvidenceSource {
  url: string;
  title: string;
  excerpt: string;
}

/** Everything gathered so far about the question. */
export interface Evidence {
  topic: string;
  question: string;
  sources: EvidenceSource[];
}

/** The answer, written out with its citations. */
export interface ResearchReport {
  topic: string;
  markdown: string;
  citedUrls: string[];
}
