import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HudPreparationStatus } from "./hud-preparation-status";
import { ConversationalPracticeApp } from "./conversational-practice-app";
import { InterviewPracticeApp } from "./interview-practice-app";

test("shared preparation copy is accessible and fallback remains nonblocking", () => {
  const preparing = renderToStaticMarkup(<HudPreparationStatus state="preparing"/>);
  assert.match(preparing, /Preparing your interview/);
  assert.match(preparing, /Creating quick-reference cues from your Career Memory/);
  assert.match(preparing, /role="status"/);
  assert.equal((preparing.match(/<i><\/i>/g) ?? []).length, 4);
  assert.match(renderToStaticMarkup(<HudPreparationStatus state="fallback"/>), /Ready with approved Career Memory excerpts/);
  assert.equal(renderToStaticMarkup(<HudPreparationStatus state="ready"/>), "");
});

test("Practice and Go Live cannot start capture in their initial preparation state", () => {
  const projects = [{ projectId: "platform", title: "Platform", facts: [
    { id: "fact-one", text: "Designed API onboarding flows.", source: "Approved interview evidence" },
  ] }];
  const practice = renderToStaticMarkup(<ConversationalPracticeApp profile={null} projects={projects}
    context={{ company: "Example", role: "Designer", round: "Recruiter", description: "Design API tools",
      requirements: [], strengths: [], areas: [] }} savedReview={null} savedPending={[]}
    onSaveReview={async () => {}} onCompleted={async () => {}} onBack={() => {}} onProposals={async () => []}
    onApprove={async () => {}} onDiscard={async () => {}}/>);
  assert.match(practice, /Preparing your interview/);
  assert.match(practice, /disabled=""[^>]*>Start Interview<\/button>/);
  const live = renderToStaticMarkup(<InterviewPracticeApp projects={projects}
    opportunity={{ company: "Example", role: "Designer" }} onBack={() => {}} onCompleted={async () => {}}/>);
  assert.match(live, /Preparing your interview/);
  assert.match(live, /disabled=""[^>]*>Start Listening<\/button>/);
});
