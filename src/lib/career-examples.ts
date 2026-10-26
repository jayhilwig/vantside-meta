export const careerExamples = [
  {
    projectId: "atlas-onboarding",
    title: "Atlas onboarding",
    summary: "Synthetic product-design example",
    facts: [
      { id: "atlas-research", text: "Mapped first-run friction through moderated research sessions." },
      { id: "atlas-handoff", text: "Found a gap between setup completion and the first useful action." },
      { id: "atlas-checklist", text: "Simplified the onboarding checklist around one next step at a time." },
    ],
  },
  {
    projectId: "relay-workflow",
    title: "Relay team workflow",
    summary: "Synthetic product-design example",
    facts: [
      { id: "relay-shadowing", text: "Observed how support teams coordinated complex handoffs." },
      { id: "relay-states", text: "Made ownership and next actions visible across a shared queue." },
      { id: "relay-prototype", text: "Tested a clearer status model with representative users." },
    ],
  },
  {
    projectId: "northstar-insights",
    title: "Northstar research insights",
    summary: "Synthetic product-design example",
    facts: [
      { id: "northstar-synthesis", text: "Grouped interview observations into recurring user needs." },
      { id: "northstar-priorities", text: "Connected research themes to product decisions and open questions." },
      { id: "northstar-readout", text: "Created a concise readout for a cross-functional review." },
    ],
  },
] as const;

export type CareerExample = (typeof careerExamples)[number];
export type CareerFactId = (typeof careerExamples)[number]["facts"][number]["id"];
