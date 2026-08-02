export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div className="loading" role="status">{label}…</div>;
}
