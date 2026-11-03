import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HudMinimizeGuidance } from "./hud-minimize-guidance";

test("shared minimize guidance appears only while either interview HUD is open", () => {
  assert.equal(renderToStaticMarkup(<HudMinimizeGuidance open={false}/>), "");
  const practice = renderToStaticMarkup(<HudMinimizeGuidance open={true}/>);
  const goLive = renderToStaticMarkup(<HudMinimizeGuidance open={true}/>);
  assert.equal(practice, goLive);
  assert.match(practice, /Keep VantSide open/);
  assert.match(practice, /Minimize it if you like; your HUD stays visible over the interview/);
  assert.match(practice, /<svg[^>]*aria-hidden="true"/);
  assert.match(practice, /role="status"/);
});
