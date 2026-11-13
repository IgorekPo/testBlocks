(() => {
  const overlay = document.querySelector('.page-transition');
  if (!overlay) return;

  const remotePaper = (path) => {
    const fileName = path?.split(/[\\/]/).pop();
    if (fileName === 'papyrus-beige.webp' || fileName === 'papyrus-green-beige.webp') {
      return `https://raw.githubusercontent.com/IgorekPo/testBlocks/main/images/${fileName}`;
    }
    return 'https://raw.githubusercontent.com/IgorekPo/testBlocks/main/images/papyrus-beige.webp';
  };

  document.querySelectorAll('a[data-page-transition]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      const rect = link.getBoundingClientRect();
      const stage = link.closest('.page-stage');
      const paperPath = stage?.dataset.paper;
      const paperUrl = remotePaper(paperPath);

      overlay.style.setProperty('--transition-x', `${rect.left + rect.width / 2}px`);
      overlay.style.setProperty('--transition-y', `${rect.top + rect.height / 2}px`);
      overlay.style.backgroundImage = `url("${paperUrl}")`;
      void overlay.offsetWidth;
      overlay.classList.add('is-active');
      window.setTimeout(() => { window.location.href = link.href; }, 700);
    });
  });
})();
