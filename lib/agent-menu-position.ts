export interface AgentMenuPosition {
  top: number;
  left: number;
  placement: 'top' | 'bottom';
  maxHeight: number;
}

export interface AgentMenuPositionInput {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface AgentMenuPositionOptions {
  menuWidth?: number;
  menuHeight?: number;
  offset?: number;
}

export function getAgentMenuPosition(
  buttonRect: AgentMenuPositionInput,
  viewport: { width: number; height: number },
  options: AgentMenuPositionOptions = {}
): AgentMenuPosition {
  const menuWidth = options.menuWidth ?? 208;
  const menuHeight = options.menuHeight ?? 240;
  const offset = options.offset ?? 8;

  const spaceBelow = viewport.height - buttonRect.bottom;
  const spaceAbove = buttonRect.top;
  const placement = spaceBelow >= menuHeight || spaceBelow >= spaceAbove ? 'bottom' : 'top';

  const top = placement === 'bottom'
    ? Math.min(viewport.height - menuHeight - offset, Math.max(offset, buttonRect.bottom + offset))
    : Math.max(offset, buttonRect.top - menuHeight - offset);

  const left = Math.min(viewport.width - menuWidth - offset, Math.max(offset, buttonRect.right - menuWidth));

  return {
    top,
    left,
    placement,
    maxHeight: Math.min(menuHeight, viewport.height - offset * 2),
  };
}
