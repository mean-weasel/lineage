export function shouldRevealCopiedText(label: string, text: string) {
  const normalized = `${label} ${text}`.toLowerCase();
  return normalized.includes('agent') || normalized.includes('command') || normalized.includes('selection') || normalized.includes('next context');
}
