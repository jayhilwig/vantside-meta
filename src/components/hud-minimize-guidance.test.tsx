import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HudMinimizeGuidance } from "./hud-minimize-guidance";

test("shared minimize guidance appears only while either interview HUD is open", () => {
  assert.equal(renderToStaticMarkup(<HudMinimizeGuidance open={false}/>), "");
  const practice = renderToStaticMarkup(<HudMinimizeGuidance open={true}/>);
  const goLive = renderToStaticMarkup(<HudMinimizeGuidance open={true}/>);
  assert.equal(practice, goLive);
  assert.match(practice, /minimize VantSide and keep the app running/);
  assert.match(practice, /role="status"/);
});
