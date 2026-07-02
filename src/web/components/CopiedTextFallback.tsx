import './CopiedTextFallback.css';

export function CopiedTextFallback({
  copiedText,
  onDismiss,
}: {
  copiedText: { label: string; text: string };
  onDismiss: () => void;
}) {
  return (
    <aside className="copy-fallback" aria-label={`Copied ${copiedText.label}`}>
      <div>
        <strong>Copied {copiedText.label}</strong>
        <p>Visible here too, so an agent handoff still works if browser clipboard access is blocked.</p>
      </div>
      <code>{copiedText.text}</code>
      <button onClick={onDismiss} type="button">Dismiss</button>
    </aside>
  );
}
