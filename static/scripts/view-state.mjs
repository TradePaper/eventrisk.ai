// @ts-check

/**
 * @typedef {{
 *   skeleton?: { hidden: boolean } | null;
 *   error?: { hidden: boolean; querySelector?: (selector: string) => { textContent: string } | null } | null;
 *   plot?: { hidden: boolean } | null;
 * }} ViewStateTarget
 */

/**
 * @param {ViewStateTarget} target
 * @param {"loading" | "ready" | "error"} status
 * @param {string} [message]
 */
export function applyViewState(target, status, message = "") {
  target.skeleton && (target.skeleton.hidden = status !== "loading");
  target.error && (target.error.hidden = status !== "error");
  target.plot && (target.plot.hidden = status !== "ready");

  const detail = target.error?.querySelector?.(".chart-error-detail");
  if (detail) {
    detail.textContent = status === "error" ? message : "";
  }
}
