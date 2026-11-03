export function HudMinimizeGuidance({ open }: { open: boolean }) {
  if (!open) return null;
  return <aside className="hud-minimize-guidance" role="status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18M8 21h8"/></svg><p><strong>Keep VantSide open.</strong> Minimize it if you like; your HUD stays visible over the interview.</p></aside>;
}
