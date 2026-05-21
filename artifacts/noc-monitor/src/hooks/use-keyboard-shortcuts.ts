import { useEffect, useCallback } from "react";

type ShortcutHandler = () => void;

export interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  handler: ShortcutHandler;
  description?: string;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(shortcuts: ShortcutDef[]): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      for (const shortcut of shortcuts) {
        const keyMatch = e.key === shortcut.key || e.key.toLowerCase() === shortcut.key.toLowerCase();

        // If the shortcut requires ctrl/meta, the event must have it.
        // If the shortcut does NOT require ctrl/meta, the event must NOT have it
        // (prevents plain "f" from firing on Ctrl+F, Meta+F, etc.)
        const requiresCtrl = shortcut.ctrl === true;
        const hasCtrl = e.ctrlKey || e.metaKey;
        const ctrlMatch = requiresCtrl ? hasCtrl : !hasCtrl;

        const requiresShift = shortcut.shift === true;
        const shiftMatch = requiresShift ? e.shiftKey : !e.shiftKey;

        // Never intercept Alt combinations unless explicitly defined
        if (e.altKey) continue;

        if (keyMatch && ctrlMatch && shiftMatch) {
          e.preventDefault();
          shortcut.handler();
          break;
        }
      }
    },
    [shortcuts],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
