/* global window, document */
// Apply the persisted admin theme before first paint (external file: works under a strict script-src CSP).
(function () {
  try {
    var t = window.localStorage.getItem('gc_admin_theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch {
    /* storage unavailable: keep the dark default */
  }
})();
