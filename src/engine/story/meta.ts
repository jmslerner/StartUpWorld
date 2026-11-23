// Ids and titles of the pack's 14 events, shared by the events and their later scenes (so neither imports the other).
// Pack IDs are snake_case; the game's event ids are kebab-case.

export const STORY_TITLES = {
  "gpu-landlord": "The GPU Landlord", // gpu_landlord
  "agent-all-hands": "Agent All-Hands", // agent_all_hands
  "waterfront-property": "Waterfront Property", // waterfront_property
  "single-source-of-revenue": "A Single Source of Revenue", // single_source_of_revenue
  "moat-download-button": "The Moat Has a Download Button", // moat_download_button
  "agent-has-receipts": "The Agent Has Receipts", // agent_has_receipts
  "ten-megawatts-of-powerpoint": "Ten Megawatts of PowerPoint", // ten_megawatts_of_powerpoint
  "state-of-the-slide": "State of the Slide", // state_of_the_slide
  "apology-indexed": "Your Apology Has Been Indexed", // apology_indexed
  "silent-training-opt-in": "We Updated Your Privacy", // silent_training_opt_in
  "unicorn-terms-trap": "Congratulations on Your Valuation", // unicorn_terms_trap
  "vc-rescue-board-control": "Founder Mode, Observer Seat", // vc_rescue_board_control
  "founder-personal-brand-spiral": "The Founder Is the Product", // founder_personal_brand_spiral
  "circular-compute-revenue": "Revenue, With a Return Address", // circular_compute_revenue
} as const;

export type StoryEventId = keyof typeof STORY_TITLES;

export const STORY_EVENT_IDS = Object.keys(STORY_TITLES) as StoryEventId[];

/** The pack's "Suggested connections": the second event is likelier once the first has run. */
export const STORY_CHAINS: Partial<Record<StoryEventId, StoryEventId>> = {
  "single-source-of-revenue": "waterfront-property",
  "ten-megawatts-of-powerpoint": "gpu-landlord",
  "agent-has-receipts": "agent-all-hands",
  "unicorn-terms-trap": "state-of-the-slide",
  "vc-rescue-board-control": "circular-compute-revenue",
  "apology-indexed": "silent-training-opt-in",
};

export const CHAIN_WEIGHT_MULT = 2.5;

/** The pack's recurring cast. */
export const CAST = {
  finance: "Priya Shah",
  cto: "Lena Ortiz",
  data: "Jules Park",
  comms: "Sloane Bell",
  vc: "Trent Voss",
  fund: "Apex Predatory Capital",
} as const;
