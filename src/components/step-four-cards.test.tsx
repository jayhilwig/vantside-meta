import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyMemoryState } from "../../backend/career-memory";
import { saveRound } from "../lib/interview-rounds";
import { CompanyIcon, RoundCard } from "./journey-app";

test("opportunity branding has no initials placeholder without a real logo", () => {
  assert.equal(renderToStaticMarkup(<CompanyIcon/>), "");
  assert.match(renderToStaticMarkup(<CompanyIcon logo="data:image/png;base64,iVBORw0KGgo="/>), /<img/);
});

test("round date and editable status share one card container", () => {
  const state = emptyMemoryState();
  state.opportunities = [{ id: "job-a", company: "VIA", role: "Designer", description: "Design", confirmedAt: "2026-11-02T00:00:00.000Z" }];
  const round = saveRound(state, "job-a", "Hiring Manager", "", "completed", undefined, { interviewDate: "2026-11-05" }).rounds[0];
  const markup = renderToStaticMarkup(<RoundCard round={round} selected onEdit={() => {}} onDelete={() => {}} onStatusChange={() => {}}/>);
  assert.match(markup, /class="round-card selected"/);
  assert.match(markup, /<div class="round-card-meta"><span class="round-date"[^>]*>2026-11-05<\/span><label class="round-status-control">/);
  assert.match(markup, /<select[^>]*><option value="planned">Upcoming<\/option>/);
  assert.match(markup, /<option value="completed" selected="">Completed<\/option>/);
  assert.match(markup, /Status for Hiring Manager/);
});
