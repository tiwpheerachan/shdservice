/**
 * Inline theme bootstrap (runs before paint, so dark mode does not flash).
 * Kept in its own dependency-free module: the middleware hashes this exact text
 * into the /track CSP ('sha256-…'), so editing it cannot silently break that page.
 */
export const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("shd-theme");
    var mode = stored || "system";
    var dark =
      mode === "dark" ||
      (mode === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.themeMode = mode;
  } catch (e) {}
})();
`;
