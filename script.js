const papers = [...document.querySelectorAll("[data-paper]")];

const clamp = (value, min = 0, max = 1) =>
  Math.min(Math.max(value, min), max);

let ticking = false;
let lastScrollY = window.scrollY;
let scrollDirection = 1; // 1 = вниз, -1 = вверх

function updatePapers() {
  const vh = window.innerHeight;
  const currentScrollY = window.scrollY;
  const delta = currentScrollY - lastScrollY;

  // Небольшой dead-zone, чтобы микродрожание браузера
  // не переключало направление на каждом пикселе.
  if (Math.abs(delta) > 1) {
    scrollDirection = delta > 0 ? 1 : -1;
  }

  papers.forEach((paper, index) => {
    const rect = paper.getBoundingClientRect();

    const visiblePx = Math.max(
      0,
      Math.min(rect.bottom, vh) - Math.max(rect.top, 0)
    );

    const visible = clamp(
      visiblePx / Math.min(rect.height, vh)
    );

    let enter = 1;
    let fold = 0;
    let shown = 1;

    /* =====================================================
       СКРОЛЛ ВНИЗ

       Только раскрываем новую секцию слева -> направо.
       Предыдущие секции НЕ сворачиваем вообще.
       ===================================================== */
    if (scrollDirection > 0) {
      if (index !== 0 && rect.top > 0) {
        const start = vh * 0.98;
        const finish = vh * 0.20;

        enter = clamp(
          (start - rect.top) / (start - finish)
        );
      }

      // Если секция уже дошла до верхней части окна,
      // она считается полностью раскрытой.
      if (rect.top <= vh * 0.20) {
        enter = 1;
      }

      fold = 0;
      shown = enter;
    }

    /* =====================================================
       СКРОЛЛ ВВЕРХ

       Ничего не "раскрываем заново".
       Секция, из которой пользователь уходит вниз экрана,
       начинает сворачиваться ТОЛЬКО когда её видимость
       становится меньше 70%.

       70% видимости -> fold = 0
        0% видимости -> fold = 1
       ===================================================== */
    if (scrollDirection < 0) {
      enter = 1;

      const leavingThroughBottom =
        rect.top > 0 &&
        rect.top < vh &&
        visible < 0.70;

      if (leavingThroughBottom) {
        fold = clamp(
          (0.70 - visible) / 0.70
        );
      } else if (rect.top >= vh) {
        // Секция уже полностью ушла вниз за экран.
        fold = 1;
      }

      // Секции выше текущей остаются полностью раскрытыми.
      if (rect.bottom <= 0 || rect.top <= 0) {
        fold = 0;
      }

      shown = clamp(1 - fold);
    }

    /* =====================================================
       СВЁРТОК

       shown = 0  -> слева
       shown = 1  -> справа

       Поэтому:
       вниз:  0 -> 1 = слева -> направо
       вверх: 1 -> 0 = справа -> налево
       ===================================================== */
    const roll = paper.querySelector(".paper__roll");
    const rollWidth = roll ? roll.offsetWidth : 128;
    const rollOverlap = rollWidth * 0.70;

    const rollX =
      shown * rect.width - rollOverlap;

    const entering =
      scrollDirection > 0 &&
      index !== 0 &&
      rect.top > 0 &&
      rect.top < vh &&
      enter < 0.999 &&
      visible > 0;

    const folding =
      scrollDirection < 0 &&
      rect.top > 0 &&
      rect.top < vh &&
      visible > 0 &&
      visible < 0.70 &&
      fold > 0;

    let rollOpacity = 0;

    if (entering) {
      // Появляется слева и исчезает,
      // когда лист полностью раскрылся справа.
      rollOpacity = clamp(
        (1 - enter) / 0.10
      );
    }

    if (folding) {
      // При обратном скролле появляется справа
      // и уходит влево вместе со сворачиваемым листом.
      const appear = clamp(fold / 0.08);
      const disappear = clamp(shown / 0.08);

      rollOpacity = appear * disappear;
    }

    paper.style.setProperty(
      "--enter",
      enter.toFixed(4)
    );

    paper.style.setProperty(
      "--fold",
      fold.toFixed(4)
    );

    paper.style.setProperty(
      "--shown",
      shown.toFixed(4)
    );

    paper.style.setProperty(
      "--roll-x",
      `${rollX.toFixed(2)}px`
    );

    paper.style.setProperty(
      "--roll-opacity",
      rollOpacity.toFixed(4)
    );

    paper.classList.toggle(
      "is-entering",
      entering
    );

    paper.classList.toggle(
      "is-folding",
      folding
    );
  });

  lastScrollY = currentScrollY;
  ticking = false;
}

function requestUpdate() {
  if (ticking) return;

  ticking = true;
  requestAnimationFrame(updatePapers);
}

updatePapers();

window.addEventListener(
  "scroll",
  requestUpdate,
  { passive: true }
);

window.addEventListener(
  "resize",
  requestUpdate
);
