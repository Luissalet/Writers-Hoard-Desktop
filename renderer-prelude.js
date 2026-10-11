// Parser-blocking: this must run before React is evaluated. Keeping it in a
// separate file lets the renderer reject arbitrary inline scripts.
(() => {
  const redirect = sessionStorage.redirect;
  delete sessionStorage.redirect;
  if (redirect && redirect !== location.href) {
    history.replaceState(null, '', redirect);
  }

  // React DOM 19.2 development instrumentation recursively diffs the very
  // large world-generation props when this optional hook is present.
  try {
    console.timeStamp = undefined;
  } catch {
    // A read-only console hook is harmless; React remains usable.
  }
})();
