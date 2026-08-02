export function StatusBadge({ value }: { value: string }) {
  const key = value.toLowerCase().replaceAll(' ', '-');
  return <span className={`status status-${key}`}>{value}</span>;
}
