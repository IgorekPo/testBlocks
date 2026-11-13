document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-page-link]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const target = new URL(link.href, window.location.href);
  if (target.origin !== window.location.origin) return;

  event.preventDefault();
  document.documentElement.classList.add("is-leaving");
  window.setTimeout(() => {
    window.location.href = target.href;
  }, 320);
});
