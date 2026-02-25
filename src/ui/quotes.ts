export interface FounderQuote {
  text: string;
  by: string;
  note?: string;
}

// Note: These are paraphrased (not verbatim) to avoid reproducing copyrighted quote text.
const QUOTES: FounderQuote[] = [
  { text: "Ship something small, learn fast, then iterate.", by: "Reid Hoffman", note: "paraphrase" },
  { text: "Most startups don’t fail from lack of ideas—they fail from lack of execution.", by: "Mark Cuban", note: "paraphrase" },
  { text: "If you’re not embarrassed by your first version, you waited too long.", by: "Reid Hoffman", note: "paraphrase" },
  { text: "Make a product people genuinely want, then keep improving it.", by: "Paul Graham", note: "paraphrase" },
  { text: "Spend your energy on the few things that matter; say no to the rest.", by: "Steve Jobs", note: "paraphrase" },
  { text: "Your brand is what people say when you’re not in the room.", by: "Jeff Bezos", note: "paraphrase" },
  { text: "Customer obsession beats competitor obsession.", by: "Jeff Bezos", note: "paraphrase" },
  { text: "Measure what matters, but don’t mistake metrics for meaning.", by: "Andy Grove", note: "paraphrase" },
  { text: "Great companies are built by solving real problems, not chasing hype.", by: "Satya Nadella", note: "paraphrase" },
  { text: "Be relentless about product quality—details compound.", by: "Steve Jobs", note: "paraphrase" },
  { text: "Distribution is as important as product.", by: "Peter Thiel", note: "paraphrase" },
  { text: "Hire people who raise the bar—and keep it high.", by: "Jeff Bezos", note: "paraphrase" },
  { text: "In the early days, talk to users constantly.", by: "Brian Chesky", note: "paraphrase" },
  { text: "When growth stalls, go back to fundamentals: value and retention.", by: "Marc Benioff", note: "paraphrase" },
  { text: "Risk is reduced by learning faster than everyone else.", by: "Eric Ries", note: "paraphrase" },
  { text: "Treat constraints as fuel for creativity.", by: "Sara Blakely", note: "paraphrase" },
];

export const pickWeeklyQuote = (week: number): FounderQuote => {
  const idx = Math.max(0, week - 1) % QUOTES.length;
  return QUOTES[idx];
};
