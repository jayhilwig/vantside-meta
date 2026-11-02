export function HudVisibilityIcon({ hidden = false }: { hidden?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 12s3.5-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z"/>
    <circle cx="12" cy="12" r="2.6"/>
    {hidden && <path d="M3 21 21 3"/>}
  </svg>;
}
