export type HoverPreviewPosition = { left: number; top: number };

export function hoverPreviewPosition(
  rect: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>,
  viewportWidth: number,
  viewportHeight: number,
): HoverPreviewPosition {
  const margin = 16;
  const gap = 16;
  const previewWidth = Math.min(420, Math.max(240, viewportWidth - (margin * 2)));
  const previewHeight = Math.min(440, Math.max(220, viewportHeight - (margin * 2)));
  const fitsRight = rect.right + gap + previewWidth <= viewportWidth - margin;
  const left = fitsRight
    ? rect.right + gap
    : Math.max(margin, rect.left - gap - previewWidth);
  const centeredTop = ((rect.top + rect.bottom) / 2) - (previewHeight / 2);
  const top = Math.min(
    Math.max(margin, centeredTop),
    Math.max(margin, viewportHeight - previewHeight - margin),
  );
  return { left: Math.round(left), top: Math.round(top) };
}
