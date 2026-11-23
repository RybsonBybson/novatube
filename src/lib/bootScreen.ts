/**
 * Launch splash helpers.
 *
 * The splash itself lives in `index.html` (outside the React root) so it paints
 * before the bundle is parsed. React keeps it on screen while the first update
 * check runs and then dismisses it, which is why the markup is driven from here
 * instead of being a component.
 */

function screenNode(): HTMLElement | null {
  return document.getElementById("boot-screen");
}

function statusNode(): HTMLElement | null {
  return document.getElementById("boot-status");
}

function barNode(): HTMLElement | null {
  return document.getElementById("boot-bar");
}

/** Set the line under the wordmark. `dir` follows the active language. */
export function setBootStatus(text: string, dir: "ltr" | "rtl" = "ltr"): void {
  const node = statusNode();
  if (!node) return;
  if (node.textContent !== text) node.textContent = text;
  node.setAttribute("dir", dir);
}

/**
 * `null` keeps the indeterminate shimmer running; a number switches the bar to
 * a determinate fill, which is what the download progress of an update uses.
 */
export function setBootProgress(percent: number | null): void {
  const bar = barNode();
  if (!bar) return;
  const fill = bar.firstElementChild as HTMLElement | null;

  if (percent === null) {
    bar.classList.remove("determinate");
    fill?.style.removeProperty("width");
    return;
  }

  bar.classList.add("determinate");
  if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

let dismissed = false;

/** Fade the splash out and drop it from the DOM. Safe to call more than once. */
export function hideBootScreen(): void {
  if (dismissed) return;
  dismissed = true;

  const node = screenNode();
  if (!node) return;

  const remove = () => node.remove();
  node.classList.add("leaving");
  node.addEventListener("transitionend", remove, { once: true });
  // Safety net for reduced-motion setups, where the transition may not fire.
  window.setTimeout(remove, 400);
}
