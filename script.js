const papers = [...document.querySelectorAll("[data-paper]")];

const clamp = (value, min = 0, max = 1) =>
  Math.min(Math.max(value, min), max);

let ticking = false;

function updatePapers() {
  const vh = window.innerHeight;

  papers.forEach((paper, index) => {
    const rect = paper.getBoundingClientRect();

    const visiblePx = Math.max(
      0,
      Math.min(rect.bottom, vh) - Math.max(rect.top, 0)
    );

    const visible = clamp(visiblePx / Math.min(rect.height, vh));

    let enter = 1;

    if (index !== 0 && rect.top > 0) {
      const start = vh * 0.98;
      const finish = vh * 0.20;
      enter = clamp((start - rect.top) / (start - finish));
    }

    if (rect.top <= 0 && rect.bottom > 0) {
      enter = 1;
    }

    let fold = 0;

    if (rect.top < 0 && visible < 0.70) {
      fold = clamp((0.70 - visible) / 0.70);
    }

    const shown = clamp(Math.min(enter, 1 - fold));

    const roll = paper.querySelector(".paper__roll");
    const rollWidth = roll ? roll.offsetWidth : 128;
    const rollOverlap = rollWidth * 0.74;
    const rollX = shown * rect.width - rollOverlap;

    const entering =
      index !== 0 &&
      rect.top > 0 &&
      enter < 0.999 &&
      visible > 0;

    const folding =
      rect.top < 0 &&
      visible > 0 &&
      visible < 0.70;

    let rollOpacity = 0;

    if (entering) {
      rollOpacity = clamp((1 - enter) / 0.10);
    }

    if (folding) {
      const appear = clamp(fold / 0.08);
      const disappear = clamp(shown / 0.08);
      rollOpacity = appear * disappear;
    }

    paper.style.setProperty("--enter", enter.toFixed(4));
    paper.style.setProperty("--fold", fold.toFixed(4));
    paper.style.setProperty("--shown", shown.toFixed(4));
    paper.style.setProperty("--roll-x", `${rollX.toFixed(2)}px`);
    paper.style.setProperty("--roll-opacity", rollOpacity.toFixed(4));

    paper.classList.toggle("is-entering", entering);
    paper.classList.toggle("is-folding", folding);
  });

  ticking = false;
}

function requestUpdate() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(updatePapers);
}

updatePapers();
window.addEventListener("scroll", requestUpdate, { passive: true });
window.addEventListener("resize", requestUpdate);
