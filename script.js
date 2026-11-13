(() => {
  const sections = [...document.querySelectorAll(".papyrus")];

  if (!sections.length) return;

  const clamp = (value, min = 0, max = 1) =>
    Math.min(Math.max(value, min), max);

  let ticking = false;

  function update() {
    const viewportHeight = window.innerHeight;

    sections.forEach((section, index) => {
      const sheet = section.querySelector(".papyrus__sheet");
      const tube = section.querySelector(".tube");

      const rect = section.getBoundingClientRect();

      // Первая секция всегда полностью открыта.
      if (index === 0) {
        sheet.style.clipPath = "inset(0 0 0 0)";
        sheet.style.webkitClipPath = "inset(0 0 0 0)";
        return;
      }

      if (!sheet) return;

      const sectionHeight = rect.height;

      if (sectionHeight <= 0 || viewportHeight <= 0) return;

      // Начало раскрытия: в экран вошло 25% секции.
      const startTop = viewportHeight - sectionHeight * 0.25;

      // Конец раскрытия: центр секции совпал с центром экрана.
      const finishTop = (viewportHeight - sectionHeight) / 2;

      const distance = startTop - finishTop;

      const progress =
        distance === 0
          ? rect.top <= finishTop
            ? 1
            : 0
          : clamp((startTop - rect.top) / distance);

      // =================================
      // РАСКРЫТИЕ ПАПИРУСА
      // =================================

      const hiddenRight = (1 - progress) * 100;

      const clip = `inset(0 ${hiddenRight}% 0 0)`;

      sheet.style.clipPath = clip;
      sheet.style.webkitClipPath = clip;

      // =================================
      // ДВИЖЕНИЕ ТУБУСА
      // =================================

      if (!tube) return;

      const tubeWidth = tube.offsetWidth;

      // Центр тубуса совпадает с границей раскрытия.
      const tubeX = progress * rect.width - tubeWidth / 2;

      tube.style.setProperty("--tube-x", `${tubeX}px`);

      // Показываем тубус, пока папирус раскрывается.
      const fadeIn = clamp(progress / 0.025);
      const fadeOut = clamp((1 - progress) / 0.025);

      tube.style.opacity = String(fadeIn * fadeOut);
    });

    ticking = false;
  }

  // =================================
  // ОПТИМИЗАЦИЯ
  // =================================

  function requestUpdate() {
    if (ticking) return;

    ticking = true;

    requestAnimationFrame(update);
  }

  window.addEventListener("scroll", requestUpdate, {
    passive: true,
  });

  window.addEventListener("resize", requestUpdate);

  window.addEventListener("load", requestUpdate);

  window.addEventListener("pageshow", requestUpdate);

  // Следим за изменением размеров секций.
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(requestUpdate);

    sections.forEach((section) => {
      observer.observe(section);
    });
  }

  // Первоначальный расчёт.
  update();
})();
