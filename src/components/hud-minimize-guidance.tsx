export function HudMinimizeGuidance({ open }: { open: boolean }) {
  if (!open) return null;
  return <p className="hud-minimize-guidance" role="status">Your interview HUD is ready. For the best experience, minimize VantSide and keep the app running while you interview.</p>;
}
