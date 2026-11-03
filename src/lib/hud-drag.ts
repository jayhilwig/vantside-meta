const interactiveSelector = "button, a, input, select, textarea, [role='button'], [contenteditable='true']";

export function canDragHudHeader(button: number, target: Pick<Element, "closest"> | null): boolean {
  return button === 0 && target !== null && !target.closest(interactiveSelector);
}
