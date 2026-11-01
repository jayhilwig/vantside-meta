import assert from "node:assert/strict";
import test from "node:test";
import { detectInterviewerQuestion } from "./interviewer-question";

test("detects complete spoken interview prompts with or without terminal punctuation", () => {
  assert.equal(detectInterviewerQuestion("How did you approach the API platform redesign?"), "How did you approach the API platform redesign?");
  assert.equal(detectInterviewerQuestion("How did you approach the API platform redesign"), "How did you approach the API platform redesign");
  assert.equal(detectInterviewerQuestion("That sounds useful. Walk me through a difficult decision you made"), "Walk me through a difficult decision you made");
  assert.equal(detectInterviewerQuestion("Tell me about a time you worked across product teams"), "Tell me about a time you worked across product teams");
});

test("statements, silence, and incomplete transcript fragments are not questions", () => {
  assert.equal(detectInterviewerQuestion(" "), null);
  assert.equal(detectInterviewerQuestion("I appreciate the detail about your previous work."), null);
  assert.equal(detectInterviewerQuestion("Could you"), null);
});
