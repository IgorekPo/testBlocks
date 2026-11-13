import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

(() => {
  const byId = (id) => document.getElementById(id);
  const required = [
    "catalogLayout", "catalogBook", "catalogBookUnderlay", "catalogBookLeaf",
    "catalogBookFront", "catalogBookBack", "catalogProductsCount",
    "catalogPageCounter", "catalogEmpty", "catalogPrev", "catalogNext",
    "catalogBookCurlHost", "catalogFilterTrigger", "catalogFilterClose", "catalogFilterBackdrop", "catalogFilterReset"
  ];
  const missing = required.filter((id) => !byId(id));
  if (missing.length) {
    console.error("Каталог не запущен. Не найдены элементы:", missing.join(", "));
    return;
  }

  const layout = byId("catalogLayout");
  const book = byId("catalogBook");
  const underlay = byId("catalogBookUnderlay");
  const leaf = byId("catalogBookLeaf");
  const front = byId("catalogBookFront");
  const back = byId("catalogBookBack");
  const curlCanvasHost = byId("catalogBookCurlHost");
  // Canvas не находится в DOM до первого html2canvas-снимка.
  // Это важно: html2canvas обходит DOM и может подготовить canvas-элементы
  // к чтению через Canvas2D. Один элемент нельзя затем использовать для WebGL.
  let curlCanvas = null;
  const count = byId("catalogProductsCount");
  const counter = byId("catalogPageCounter");
  const empty = byId("catalogEmpty");
  const prev = byId("catalogPrev");
  const next = byId("catalogNext");

  const colors = {
    green: { label: "Зелёный", accent: "#65734c" },
    red: { label: "Красный", accent: "#9b4234" },
    yellow: { label: "Жёлтый", accent: "#d0a63f" }
  };
  const meats = { chicken: "Курица", pork: "Свинина", fish: "Рыба" };
  const names = [
    "Травы Прованса", "Острый перец", "Медовая горчица", "Лесные травы",
    "Дымный перец", "Золотой мёд", "Зелёный базилик", "Красный чили",
    "Лимонный микс", "Пряный розмарин", "Томат и паприка", "Цитрус и шалфей",
    "Чеснок и травы", "Копчёная паприка", "Мягкий карри", "Средиземноморье"
  ];
  const products = Array.from({ length: 16 }, (_, i) => {
    const color = Object.keys(colors)[i % 3];
    const meat = Object.keys(meats)[Math.floor(i / 3) % 3];
    return { id: i + 1, name: names[i], color, meat };
  });

  // Константы и формула деформации совпадают с внешним page curl из testBlocks.
  const CURL_ANGLE = THREE.MathUtils.degToRad(16);
  const CURL_DIRECTION = new THREE.Vector2(Math.cos(CURL_ANGLE), Math.sin(CURL_ANGLE));
  const SEGMENTS_X = 150;
  const SEGMENTS_Y = 110;
  const CURL_WIDTH_FACTOR = 0.52;
  const CURL_DEPTH_FACTOR = 0.92;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const smoothStep = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };

  // Внутренняя страница книги тоже является листом папируса.
  // Сначала используем требуемый локальный файл, затем — копию из testBlocks.
  const CATALOG_PAPER_SOURCES = [
    "./images/papyrus-beige.webp",
    "https://raw.githubusercontent.com/IgorekPo/testBlocks/main/images/papyrus-beige.webp"
  ];
  let catalogPaperUrl = CATALOG_PAPER_SOURCES[0];

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Не удалось загрузить изображение: ${url}`));
      image.src = url;
    });
  }

  const catalogPaperReady = (async () => {
    for (const url of CATALOG_PAPER_SOURCES) {
      try {
        await loadImage(url);
        catalogPaperUrl = url;
        book.style.setProperty("--catalog-page-paper", `url("${url}")`);
        underlay.style.backgroundImage = `url("${url}")`;
        front.style.backgroundImage = `url("${url}")`;
        back.style.backgroundImage = `linear-gradient(90deg, rgba(94,65,34,.13), transparent 13%), url("${url}")`;
        return url;
      } catch (error) {
        // Пробуем следующий источник.
      }
    }
    console.warn("Не найдена papyrus-beige.webp. Используется однотонная подложка каталога.");
    return null;
  })();

  let filtered = [...products];
  let pages = [];
  let currentPage = 0;
  let pageSize = 8;
  let isTurning = false;
  let pointerState = null;
  let turnTargetPage = -1;
  let turnDirection = 1;
  let turnProgress = 0;
  let animationFrame = 0;
  let snapshotTexture = null;
  let mirroredSnapshotCanvas = null;

  // Отдельная сцена нужна только внутреннему блоку карточек.
  let curlRenderer = null;
  let curlScene = null;
  let curlCamera = null;
  let curlPaperMesh = null;
  let curlShadowMesh = null;
  let curlPaperMaterial = null;
  let curlShadowMaterial = null;
  let curlGeometry = null;
  let curlShadowGeometry = null;
  let curlBasePositions = null;
  let curlPlaneWidth = 0;
  let curlPlaneHeight = 2;
  let curlWidth = 1;

  function getPageSize() {
    if (window.matchMedia("(max-width: 600px)").matches) return 4;
    if (window.matchMedia("(max-width: 1100px)").matches) return 6;
    return 8;
  }

  function selectedValues(name) {
    return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
  }

  function getFiltered() {
    const selectedColors = selectedValues("color");
    const selectedMeats = selectedValues("meat");
    return products.filter((product) => {
      const colorOk = !selectedColors.length || selectedColors.includes(product.color);
      const meatOk = !selectedMeats.length || selectedMeats.includes(product.meat);
      return colorOk && meatOk;
    });
  }

  function productWord(value) {
    const lastTwo = value % 100;
    const last = value % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return "продуктов";
    if (last === 1) return "продукт";
    if (last >= 2 && last <= 4) return "продукта";
    return "продуктов";
  }

  function card(product) {
    const color = colors[product.color];
    return `
      <article class="product-card" style="--product-accent:${color.accent}">
        <div class="product-card__visual" aria-hidden="true">
          <div class="product-pack">
            <span class="product-pack__brand">SPICELAND</span>
            <span class="product-pack__line"></span>
            <span class="product-pack__number">${String(product.id).padStart(2, "0")}</span>
            <span class="product-pack__type">MARINADE</span>
          </div>
        </div>
        <div class="product-card__info">
          <h2 class="product-card__name">${product.name}</h2>
          <div class="product-card__meta"><span>${color.label}</span><span>·</span><span>${meats[product.meat]}</span></div>
        </div>
      </article>`;
  }

  function pageMarkup(items) {
    if (!items || !items.length) return "";
    return `<div class="catalog-product-grid">${items.map(card).join("")}</div>`;
  }

  function updateControls() {
    const pageCount = pages.length;
    counter.textContent = `${pageCount ? currentPage + 1 : 0} / ${pageCount}`;
    count.textContent = `${filtered.length} ${productWord(filtered.length)}`;
    prev.disabled = isTurning || currentPage <= 0 || pageCount === 0;
    next.disabled = isTurning || currentPage >= pageCount - 1 || pageCount === 0;
  }

  function render() {
    pageSize = getPageSize();
    filtered = getFiltered();
    pages = [];
    for (let i = 0; i < filtered.length; i += pageSize) pages.push(filtered.slice(i, i + pageSize));
    currentPage = Math.min(currentPage, Math.max(0, pages.length - 1));
    const current = pageMarkup(pages[currentPage]);
    const following = pageMarkup(pages[currentPage + 1]);
    underlay.innerHTML = following || current;
    front.innerHTML = current;
    back.innerHTML = following || current;
    empty.hidden = filtered.length !== 0;
    book.classList.toggle("is-empty", filtered.length === 0);
    updateControls();
  }

  function createCurlScene() {
    if (curlRenderer) return;

    const rect = book.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) throw new Error("Не удалось определить размер внутренней страницы каталога.");

    // Создаём отдельный canvas только после того, как html2canvas уже сделал
    // снимок страницы. У этого элемента никогда не будет Canvas2D-контекста.
    if (!curlCanvas) {
      curlCanvas = document.createElement("canvas");
      curlCanvas.className = "catalog-book__curl-canvas";
      curlCanvas.setAttribute("aria-hidden", "true");
      curlCanvasHost.append(curlCanvas);
    }

    try {
      curlRenderer = new THREE.WebGLRenderer({
        canvas: curlCanvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance"
      });
    } catch (error) {
      curlCanvas.remove();
      curlCanvas = null;
      throw new Error(`Не удалось создать отдельный WebGL-canvas каталога: ${error.message}`);
    }
    curlRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    curlRenderer.setSize(rect.width, rect.height, false);
    curlRenderer.setClearColor(0x000000, 0);
    curlRenderer.outputColorSpace = THREE.SRGBColorSpace;
    curlRenderer.toneMapping = THREE.NoToneMapping;

    curlScene = new THREE.Scene();
    const aspect = rect.width / rect.height;
    curlCamera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 50);
    curlCamera.position.set(0, 0, 10);
    curlCamera.lookAt(0, 0, 0);

    const ambientLight = new THREE.HemisphereLight(0xfff0d5, 0x49311d, 1.25);
    curlScene.add(ambientLight);
    const keyLight = new THREE.DirectionalLight(0xffe8c7, 2.1);
    keyLight.position.set(-3, 4, 6);
    curlScene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.55);
    fillLight.position.set(4, -2, 4);
    curlScene.add(fillLight);

    curlPlaneWidth = aspect * 2;
    curlPlaneHeight = 2;
    curlWidth = curlPlaneHeight * CURL_WIDTH_FACTOR;

    curlGeometry = new THREE.PlaneGeometry(curlPlaneWidth, curlPlaneHeight, SEGMENTS_X, SEGMENTS_Y);
    curlShadowGeometry = curlGeometry.clone();
    curlBasePositions = curlGeometry.attributes.position.array.slice();

    curlPaperMaterial = new THREE.MeshStandardMaterial({
      map: null,
      side: THREE.DoubleSide,
      roughness: 0.88,
      metalness: 0,
      transparent: true,
      alphaTest: 0.015,
      depthWrite: true
    });
    curlPaperMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (!gl_FrontFacing) {
          diffuseColor.rgb *= 0.78;
        }`
      );
    };

    curlShadowMaterial = new THREE.MeshBasicMaterial({
      map: null,
      color: 0x21150b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.2,
      alphaTest: 0.015,
      depthTest: false,
      depthWrite: false
    });

    curlShadowMesh = new THREE.Mesh(curlShadowGeometry, curlShadowMaterial);
    curlShadowMesh.frustumCulled = false;
    curlShadowMesh.renderOrder = 1;
    curlPaperMesh = new THREE.Mesh(curlGeometry, curlPaperMaterial);
    curlPaperMesh.frustumCulled = false;
    curlPaperMesh.renderOrder = 2;
    curlScene.add(curlShadowMesh, curlPaperMesh);
  }

  function resizeCurlScene() {
    if (!curlRenderer) return;
    const rect = book.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    const aspect = rect.width / rect.height;
    curlRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    curlRenderer.setSize(rect.width, rect.height, false);
    curlCamera.left = -aspect;
    curlCamera.right = aspect;
    curlCamera.top = 1;
    curlCamera.bottom = -1;
    curlCamera.updateProjectionMatrix();

    curlPlaneWidth = aspect * 2;
    curlPlaneHeight = 2;
    curlWidth = curlPlaneHeight * CURL_WIDTH_FACTOR;
    const nextGeometry = new THREE.PlaneGeometry(curlPlaneWidth, curlPlaneHeight, SEGMENTS_X, SEGMENTS_Y);
    const nextShadowGeometry = nextGeometry.clone();
    const nextBasePositions = nextGeometry.attributes.position.array.slice();
    curlGeometry.dispose();
    curlShadowGeometry.dispose();
    curlPaperMesh.geometry = nextGeometry;
    curlShadowMesh.geometry = nextShadowGeometry;
    curlGeometry = nextGeometry;
    curlShadowGeometry = nextShadowGeometry;
    curlBasePositions = nextBasePositions;
  }

  function deformCurlPage(progress) {
    if (!curlGeometry || !curlShadowGeometry || !curlBasePositions) return;

    const pagePositions = curlGeometry.attributes.position.array;
    const shadowPositions = curlShadowGeometry.attributes.position.array;
    const maxSweep = curlPlaneWidth * CURL_DIRECTION.x + curlPlaneHeight * CURL_DIRECTION.y;
    const foldPosition = progress * maxSweep;

    // Следующая страница (перетягивание влево) загибается с ПРАВОГО края
    // и движется влево. Предыдущая страница сохраняет обратное направление.
    // Для этого зеркалим только расчётную локальную координату X, а после
    // деформации возвращаем вершину в исходную систему координат. UV текстуры
    // не меняются, поэтому надпись и карточки на листе остаются читаемыми.
    const curlFromRight = turnDirection > 0;

    for (let i = 0; i < curlBasePositions.length; i += 3) {
      const originalX = curlBasePositions[i];
      const originalY = curlBasePositions[i + 1];
      const actualLocalX = originalX + curlPlaneWidth * 0.5;
      const localX = curlFromRight ? curlPlaneWidth - actualLocalX : actualLocalX;
      const localY = originalY + curlPlaneHeight * 0.5;
      const s = localX * CURL_DIRECTION.x + localY * CURL_DIRECTION.y;
      const q = -localX * CURL_DIRECTION.y + localY * CURL_DIRECTION.x;
      const distanceBehindFold = foldPosition - s;
      let turnedS = s;
      let lift = 0;

      if (distanceBehindFold > 0) {
        const t = distanceBehindFold / curlWidth;
        const angle = Math.PI * smoothStep(t);
        turnedS = foldPosition - distanceBehindFold * Math.cos(angle);
        lift = distanceBehindFold * Math.sin(angle) * CURL_DEPTH_FACTOR + 0.018 * smoothStep(t);
      }

      const turnedXLocal = turnedS * CURL_DIRECTION.x - q * CURL_DIRECTION.y;
      const turnedYLocal = turnedS * CURL_DIRECTION.y + q * CURL_DIRECTION.x;
      // Если загиб начинается справа, возвращаем X после зеркального расчёта.
      const finalLocalX = curlFromRight ? curlPlaneWidth - turnedXLocal : turnedXLocal;
      const turnedX = finalLocalX - curlPlaneWidth * 0.5;
      const turnedY = turnedYLocal - curlPlaneHeight * 0.5;
      pagePositions[i] = turnedX;
      pagePositions[i + 1] = turnedY;
      pagePositions[i + 2] = lift;

      const shadowOffset = lift * 0.42;
      shadowPositions[i] = turnedX - shadowOffset;
      shadowPositions[i + 1] = turnedY - shadowOffset * 0.24;
      shadowPositions[i + 2] = -0.035;
    }

    curlGeometry.attributes.position.needsUpdate = true;
    curlShadowGeometry.attributes.position.needsUpdate = true;
    curlGeometry.computeVertexNormals();
    curlShadowGeometry.computeVertexNormals();
  }

  function drawCurl(progress) {
    if (!curlRenderer) return;
    turnProgress = clamp(progress, 0, 1);
    deformCurlPage(turnProgress);
    curlShadowMaterial.opacity = 0.12 + Math.sin(turnProgress * Math.PI) * 0.16;
    curlRenderer.render(curlScene, curlCamera);
  }

  async function captureCurrentPage() {
    if (typeof window.html2canvas !== "function") {
      throw new Error("Не загрузилась библиотека html2canvas. Проверь подключение к интернету.");
    }

    // Дожидаемся папирусной текстуры, чтобы она попала на сам перелистываемый лист.
    await catalogPaperReady;

    const oldFrontTransform = front.style.transform;
    const oldFrontBackface = front.style.backfaceVisibility;
    const oldLeafTransform = leaf.style.transform;
    const oldLeafTransformStyle = leaf.style.transformStyle;

    // html2canvas клонирует DOM и обрабатывает расположенные в нём canvas.
    // На время снимка убираем WebGL-canvas из DOM, иначе некоторые браузеры
    // пытаются прочитать его как Canvas2D и WebGLRenderer уже не может
    // получить WebGL-контекст на том же элементе.
    const canvasParent = curlCanvas?.parentNode ?? null;
    const canvasNextSibling = curlCanvas?.nextSibling ?? null;
    if (curlCanvas?.isConnected) curlCanvas.remove();

    front.style.transform = "none";
    front.style.backfaceVisibility = "visible";
    leaf.style.transform = "none";
    leaf.style.transformStyle = "flat";

    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const snapshot = await window.html2canvas(front, {
        backgroundColor: "#ead8b8",
        scale: Math.min(window.devicePixelRatio || 1, 1.5),
        useCORS: true,
        allowTaint: false,
        logging: false,
        width: Math.max(1, Math.round(book.clientWidth)),
        height: Math.max(1, Math.round(book.clientHeight)),
        windowWidth: Math.max(document.documentElement.clientWidth, window.innerWidth),
        windowHeight: Math.max(document.documentElement.clientHeight, window.innerHeight)
      });

      if (!snapshot.width || !snapshot.height) {
        throw new Error("Снимок страницы каталога получился пустым.");
      }
      return snapshot;
    } finally {
      front.style.transform = oldFrontTransform;
      front.style.backfaceVisibility = oldFrontBackface;
      leaf.style.transform = oldLeafTransform;
      leaf.style.transformStyle = oldLeafTransformStyle;

      // Возвращаем постоянный WebGL-canvas после окончания снимка.
      if (curlCanvas && canvasParent && !curlCanvas.isConnected) {
        if (canvasNextSibling?.parentNode === canvasParent) {
          canvasParent.insertBefore(curlCanvas, canvasNextSibling);
        } else {
          canvasParent.append(curlCanvas);
        }
      }
    }
  }

  function orientSnapshot(snapshot, direction) {
    if (direction > 0) return snapshot;
    const mirrored = document.createElement("canvas");
    mirrored.width = snapshot.width;
    mirrored.height = snapshot.height;
    const context = mirrored.getContext("2d");
    context.translate(mirrored.width, 0);
    context.scale(-1, 1);
    context.drawImage(snapshot, 0, 0);
    return mirrored;
  }

  function prepareCurl(snapshot, direction, targetPage) {
    createCurlScene();
    resizeCurlScene();

    turnDirection = direction;
    turnTargetPage = targetPage;
    mirroredSnapshotCanvas = orientSnapshot(snapshot, direction);
    snapshotTexture = new THREE.CanvasTexture(mirroredSnapshotCanvas);
    snapshotTexture.colorSpace = THREE.SRGBColorSpace;
    snapshotTexture.anisotropy = Math.min(curlRenderer.capabilities.getMaxAnisotropy(), 8);

    curlPaperMaterial.map = snapshotTexture;
    curlPaperMaterial.needsUpdate = true;
    curlShadowMaterial.map = snapshotTexture;
    curlShadowMaterial.needsUpdate = true;

    underlay.innerHTML = pageMarkup(pages[targetPage]);
    curlCanvas.style.transform = direction < 0 ? "scaleX(-1)" : "none";
    book.classList.add("is-curling");
    drawCurl(0);
  }

  function releaseCurlResources() {
    book.classList.remove("is-curling");
    curlCanvas.style.transform = "none";
    if (curlRenderer) {
      curlRenderer.clear(true, true, true);
      curlRenderer.render(curlScene, curlCamera);
    }
    if (snapshotTexture) {
      snapshotTexture.dispose();
      snapshotTexture = null;
    }
    mirroredSnapshotCanvas = null;
    turnTargetPage = -1;
    turnProgress = 0;
  }

  function settleTurn(commit) {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    const targetPage = turnTargetPage;
    if (commit && targetPage >= 0) currentPage = targetPage;
    releaseCurlResources();
    isTurning = false;
    render();
  }

  function animateCurlTo(targetProgress, commit) {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    const from = turnProgress;
    const distance = Math.abs(targetProgress - from);
    const duration = Math.max(180, 760 * distance);
    const start = performance.now();

    const frame = (now) => {
      const raw = clamp((now - start) / duration, 0, 1);
      const eased = raw * raw * (3 - 2 * raw);
      const progress = from + (targetProgress - from) * eased;
      drawCurl(progress);
      if (raw < 1) {
        animationFrame = requestAnimationFrame(frame);
      } else {
        animationFrame = 0;
        settleTurn(commit);
      }
    };
    animationFrame = requestAnimationFrame(frame);
  }

  async function startTurn(direction) {
    if (isTurning || pages.length < 2) return;
    const targetPage = currentPage + direction;
    if (targetPage < 0 || targetPage >= pages.length) return;

    isTurning = true;
    updateControls();
    try {
      const snapshot = await captureCurrentPage();
      prepareCurl(snapshot, direction, targetPage);
      animateCurlTo(1, true);
    } catch (error) {
      console.error("Не удалось выполнить 3D-перелистывание каталога:", error);
      isTurning = false;
      render();
    }
  }

  function updateDragProgress(state) {
    if (!state.ready || !state.direction) return;
    const width = Math.max(book.clientWidth, 1);
    const directedDistance = state.direction > 0 ? -state.deltaX : state.deltaX;
    const progress = clamp(directedDistance / width, 0, 0.985);
    drawCurl(progress);
    state.progress = progress;
  }

  function finishDrag(state) {
    if (pointerState !== state || !state.ready) return;
    const shouldCommit = state.progress >= 0.22;
    pointerState = null;
    animateCurlTo(shouldCommit ? 1 : 0, shouldCommit);
  }

  async function beginDragCurl(state) {
    if (state.preparing || state.ready || !state.direction) return;
    state.preparing = true;
    isTurning = true;
    updateControls();

    const targetPage = currentPage + state.direction;
    try {
      const snapshot = await captureCurrentPage();
      if (state.cancelled) {
        isTurning = false;
        updateControls();
        return;
      }
      if (pointerState !== state && !state.released) return;
      prepareCurl(snapshot, state.direction, targetPage);
      state.ready = true;
      updateDragProgress(state);
      if (state.released) finishDrag(state);
    } catch (error) {
      console.error("Не удалось начать перетягивание страницы каталога:", error);
      isTurning = false;
      pointerState = null;
      render();
    }
  }

  function openFilters() {
    layout.classList.add("filters-open");
    byId("catalogFilterTrigger").setAttribute("aria-expanded", "true");
  }
  function closeFilters() {
    layout.classList.remove("filters-open");
    byId("catalogFilterTrigger").setAttribute("aria-expanded", "false");
  }

  document.querySelectorAll('input[name="color"], input[name="meat"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (isTurning) return;
      currentPage = 0;
      render();
    });
  });
  byId("catalogFilterReset").addEventListener("click", () => {
    if (isTurning) return;
    document.querySelectorAll('input[name="color"], input[name="meat"]').forEach((input) => { input.checked = false; });
    currentPage = 0;
    render();
  });
  byId("catalogFilterTrigger").addEventListener("click", openFilters);
  byId("catalogFilterClose").addEventListener("click", closeFilters);
  byId("catalogFilterBackdrop").addEventListener("click", closeFilters);
  prev.addEventListener("click", () => startTurn(-1));
  next.addEventListener("click", () => startTurn(1));

  // Мышь/палец действительно тянет страницу: сетка деформируется вслед за жестом.
  book.addEventListener("pointerdown", (event) => {
    if (isTurning || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (event.target.closest("button, a, input, label")) return;
    pointerState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      deltaX: 0,
      deltaY: 0,
      direction: 0,
      progress: 0,
      preparing: false,
      ready: false,
      released: false,
      cancelled: false
    };
    try { book.setPointerCapture(event.pointerId); } catch (_) {}
  });

  book.addEventListener("pointermove", (event) => {
    const state = pointerState;
    if (!state || state.pointerId !== event.pointerId || state.released) return;
    state.deltaX = event.clientX - state.startX;
    state.deltaY = event.clientY - state.startY;
    if (!state.direction) {
      if (Math.abs(state.deltaX) < 10 || Math.abs(state.deltaX) < Math.abs(state.deltaY) * 1.15) return;
      const direction = state.deltaX < 0 ? 1 : -1;
      const targetPage = currentPage + direction;
      if (targetPage < 0 || targetPage >= pages.length) return;
      state.direction = direction;
      event.preventDefault();
      beginDragCurl(state);
      return;
    }
    event.preventDefault();
    updateDragProgress(state);
  });

  book.addEventListener("pointerup", (event) => {
    const state = pointerState;
    if (!state || state.pointerId !== event.pointerId) return;
    state.released = true;
    if (!state.direction) {
      pointerState = null;
      return;
    }
    if (state.ready) finishDrag(state);
  });
  book.addEventListener("pointercancel", (event) => {
    const state = pointerState;
    if (!state || state.pointerId !== event.pointerId) return;
    state.released = true;
    state.cancelled = true;
    pointerState = null;
    if (state.ready) {
      animateCurlTo(0, false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && layout.classList.contains("filters-open")) {
      closeFilters();
      return;
    }
    if (event.target.closest("input, button, a, select, textarea")) return;
    const secondStage = document.querySelectorAll(".page-stage")[1];
    if (!secondStage) return;
    const rect = secondStage.getBoundingClientRect();
    if (!(rect.top <= 0 && rect.bottom > 0)) return;
    if (event.key === "ArrowLeft") startTurn(-1);
    if (event.key === "ArrowRight") startTurn(1);
  });

  window.addEventListener("resize", () => {
    const nextSize = getPageSize();
    if (nextSize !== pageSize) {
      if (isTurning) return;
      currentPage = 0;
      render();
    }
    if (curlRenderer && !isTurning) resizeCurlScene();
  });

  render();
})();
