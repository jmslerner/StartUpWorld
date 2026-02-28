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

  // Satirical / fictional
  { text: "Pivoting is just failing with better marketing.", by: "Anonymous VC", note: "satirical" },
  { text: "We're not losing money, we're investing in growth.", by: "Every Series A Founder", note: "satirical" },
  { text: "Culture is what happens when the CEO leaves the room. Chaos. Chaos is what happens.", by: "Startup Proverb", note: "satirical" },
  { text: "The burn rate is fine. Everything is fine.", by: "Founders, Historically", note: "satirical" },
  { text: "Move fast and break things. Then hire someone to fix the things.", by: "Revised Facebook Motto", note: "satirical" },
  { text: "Product-market fit is when customers pay you instead of you paying customers.", by: "Obvious in Hindsight", note: "satirical" },
  { text: "We're pre-revenue but post-narrative.", by: "Every AI Startup Pitch Deck", note: "satirical" },
  { text: "Technical debt is just regular debt with better PR.", by: "Engineering Folklore", note: "satirical" },
  { text: "Your runway is a suggestion, not a promise.", by: "Gravity", note: "satirical" },
  { text: "The best time to raise was six months ago. The second best time is before you need to.", by: "Startup Wisdom", note: "paraphrase" },
  { text: "If your cofounder and your cap table both look healthy, one of them is lying.", by: "Sand Hill Road Proverb", note: "satirical" },
  { text: "Valuation is a story told to people who want to believe it.", by: "Late-Stage Realism", note: "satirical" },
];

export const pickWeeklyQuote = (week: number): FounderQuote => {
  const idx = Math.max(0, week - 1) % QUOTES.length;
  return QUOTES[idx];
};
