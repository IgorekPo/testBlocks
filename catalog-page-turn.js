import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

const stages = [...document.querySelectorAll(".page-stage")];
const canvas = document.querySelector("#page-turn");

if (!stages.length || !canvas) {
  throw new Error("Не найдены .page-stage или canvas#page-turn.");
}

// Передаём каждому DOM-блоку изображение его папирусного фона.
// Эти фоновые листы закрывают содержимое секций, которые ещё не активны.
const PAPYRUS_REMOTE_BASE =
  "https://raw.githubusercontent.com/IgorekPo/testBlocks/main/images";

function getRemotePaperPath(imagePath) {
  const fileName = imagePath?.split(/[\\/]/).pop();
  if (fileName === "papyrus-beige.webp" || fileName === "papyrus-green-beige.webp") {
    return `${PAPYRUS_REMOTE_BASE}/${fileName}`;
  }
  return null;
}

const pageScenes = stages.map((stage, index) => {
  const pageScene = stage.querySelector(".page-scene");
  const imagePath = stage.dataset.paper;

  if (!pageScene || !imagePath) {
    console.error(`Секция ${index + 1}: не найдена .page-scene или data-paper.`);
    return null;
  }

  // Сразу задаём известный резервный URL. Если локальный WebP существует,
  // loadTextures ниже заменит его локальным путём. Так на входе нет пустых фонов.
  const initialPaperPath = getRemotePaperPath(imagePath) || imagePath;
  pageScene.style.setProperty("--paper-image", `url("${initialPaperPath}")`);
  return pageScene;
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Направление перелистывания: от нижнего левого угла преимущественно вправо,
// с небольшим движением вверх. Угол влияет на диагональ линии сгиба.
const CURL_ANGLE = THREE.MathUtils.degToRad(16);
const CURL_DIRECTION = new THREE.Vector2(
  Math.cos(CURL_ANGLE),
  Math.sin(CURL_ANGLE)
);

// Плотность сетки. Чем больше сегментов, тем плавнее изгиб,
// но тем выше нагрузка на устройство.
const SEGMENTS_X = 150;
const SEGMENTS_Y = 110;

// Ширина зоны загиба относительно высоты листа.
const CURL_WIDTH_FACTOR = 0.52;
const CURL_DEPTH_FACTOR = 0.92;
const TURN_HIDE_THRESHOLD = 0.997;
// Небольшая пауза перед началом перелистывания каждой следующей страницы.
// Вторая пауза (после полного открытия) задаётся свободной частью высоты секции.
const TURN_START_DELAY = 0.12;

let renderer;
let scene;
let camera;
let paperMesh;
let shadowMesh;
let paperMaterial;
let shadowMaterial;
let geometry;
let shadowGeometry;
let basePositions;
let planeWidth = 0;
let planeHeight = 2;
let curlWidth = 1;
let textures = [];
let activeTextureIndex = -1;
let ticking = false;
let lastProgress = -1;
let lastActiveIndex = -1;

function createRenderer() {
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch (error) {
    console.error("Не удалось создать WebGL renderer:", error);
    canvas.hidden = true;
    return false;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  return true;
}

function createScene() {
  scene = new THREE.Scene();

  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.OrthographicCamera(
    -aspect,
    aspect,
    1,
    -1,
    0.1,
    50
  );
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  // Мягкий общий свет и направленный источник подчёркивают форму изгиба.
  const ambientLight = new THREE.HemisphereLight(
    0xfff0d5,
    0x49311d,
    1.25
  );
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffe8c7, 2.1);
  keyLight.position.set(-3, 4, 6);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.55);
  fillLight.position.set(4, -2, 4);
  scene.add(fillLight);
}

function createMaterials() {
  paperMaterial = new THREE.MeshStandardMaterial({
    map: textures.find(Boolean) ?? null,
    side: THREE.DoubleSide,
    roughness: 0.88,
    metalness: 0,
    transparent: true,
    alphaTest: 0.015,
    depthWrite: true,
  });

  // Обратная сторона листа немного темнее лицевой.
  paperMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      if (!gl_FrontFacing) {
        diffuseColor.rgb *= 0.78;
      }`
    );
  };

  shadowMaterial = new THREE.MeshBasicMaterial({
    map: textures.find(Boolean) ?? null,
    color: 0x21150b,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.2,
    alphaTest: 0.015,
    depthTest: false,
    depthWrite: false,
  });
}

function rebuildGeometry() {
  const aspect = window.innerWidth / window.innerHeight;
  planeWidth = aspect * 2;
  planeHeight = 2;
  curlWidth = planeHeight * CURL_WIDTH_FACTOR;

  camera.left = -aspect;
  camera.right = aspect;
  camera.top = 1;
  camera.bottom = -1;
  camera.updateProjectionMatrix();

  const nextGeometry = new THREE.PlaneGeometry(
    planeWidth,
    planeHeight,
    SEGMENTS_X,
    SEGMENTS_Y
  );
  const nextShadowGeometry = nextGeometry.clone();
  const nextBasePositions = nextGeometry.attributes.position.array.slice();

  if (paperMesh) {
    paperMesh.geometry.dispose();
    paperMesh.geometry = nextGeometry;
  }

  if (shadowMesh) {
    shadowMesh.geometry.dispose();
    shadowMesh.geometry = nextShadowGeometry;
  }

  geometry = nextGeometry;
  shadowGeometry = nextShadowGeometry;
  basePositions = nextBasePositions;

  deformPage(0);
}

function smoothStep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Деформирует каждый vertex сетки.
 *
 * До линии сгиба лист остаётся плоским. За линией сгиба точки проходят
 * цилиндрическую дугу до разворота на 180 градусов. Поэтому первым
 * начинает двигаться нижний левый угол, а фронт сгиба идёт по диагонали.
 */
function deformPage(progress) {
  if (!geometry || !shadowGeometry || !basePositions) return;

  const pagePositions = geometry.attributes.position.array;
  const shadowPositions = shadowGeometry.attributes.position.array;

  const maxSweep =
    planeWidth * CURL_DIRECTION.x + planeHeight * CURL_DIRECTION.y;
  const foldPosition = progress * maxSweep;

  for (let i = 0; i < basePositions.length; i += 3) {
    const originalX = basePositions[i];
    const originalY = basePositions[i + 1];

    // Координаты с началом в нижнем левом углу листа.
    const localX = originalX + planeWidth * 0.5;
    const localY = originalY + planeHeight * 0.5;

    // s — положение вдоль движения сгиба, q — вдоль самой линии сгиба.
    const s =
      localX * CURL_DIRECTION.x + localY * CURL_DIRECTION.y;
    const q =
      -localX * CURL_DIRECTION.y + localY * CURL_DIRECTION.x;

    const distanceBehindFold = foldPosition - s;

    let turnedS = s;
    let lift = 0;

    if (distanceBehindFold > 0) {
      const t = distanceBehindFold / curlWidth;
      const angle = Math.PI * smoothStep(t);

      // Поворот точки вокруг движущейся диагональной линии сгиба.
      turnedS = foldPosition - distanceBehindFold * Math.cos(angle);
      // Основная выпуклость дуги + очень небольшой зазор между
      // уже перевёрнутой частью листа и ещё не перевёрнутой.
      // Этот зазор предотвращает z-fighting там, где лист накладывается сам на себя.
      lift =
        distanceBehindFold *
          Math.sin(angle) *
          CURL_DEPTH_FACTOR +
        0.018 * smoothStep(t);
    }

    // Возвращаем координаты из базиса (s, q) в XY-плоскость.
    const turnedXLocal =
      turnedS * CURL_DIRECTION.x - q * CURL_DIRECTION.y;
    const turnedYLocal =
      turnedS * CURL_DIRECTION.y + q * CURL_DIRECTION.x;

    const turnedX = turnedXLocal - planeWidth * 0.5;
    const turnedY = turnedYLocal - planeHeight * 0.5;

    pagePositions[i] = turnedX;
    pagePositions[i + 1] = turnedY;
    pagePositions[i + 2] = lift;

    // Смещённая копия создаёт мягкую тень рядом с поднятой частью листа.
    // На плоских участках она почти полностью скрыта самой страницей.
    const shadowOffset = lift * 0.42;
    shadowPositions[i] = turnedX - shadowOffset;
    shadowPositions[i + 1] = turnedY - shadowOffset * 0.24;
    shadowPositions[i + 2] = -0.035;
  }

  geometry.attributes.position.needsUpdate = true;
  shadowGeometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  shadowGeometry.computeVertexNormals();
}

function setActiveTexture(index) {
  if (index === activeTextureIndex) return;

  const texture = textures[index];
  activeTextureIndex = index;

  if (!texture || !paperMaterial || !shadowMaterial) {
    if (paperMesh) paperMesh.visible = false;
    if (shadowMesh) shadowMesh.visible = false;
    return;
  }

  paperMaterial.map = texture;
  paperMaterial.needsUpdate = true;

  shadowMaterial.map = texture;
  shadowMaterial.needsUpdate = true;

  paperMesh.visible = true;
  shadowMesh.visible = true;
}

function getActiveStage() {
  // Определяем секцию, чья sticky-сцена сейчас находится во viewport.
  for (let i = 0; i < stages.length; i += 1) {
    const rect = stages[i].getBoundingClientRect();

    if (rect.top <= 0 && rect.bottom > 0) {
      return {
        index: i,
        // Первые 12% высоты экрана — пауза. Это не даёт листу появляться
        // сразу при входе в секцию. Увеличенная высота .page-stage оставляет
        // такую же дополнительную паузу перед обратным закрытием.
        progress: clamp((-rect.top / window.innerHeight) - TURN_START_DELAY, 0, 1),
      };
    }
  }

  // На случай дробных пикселей в самом начале или конце документа.
  if (window.scrollY <= 0) {
    return { index: 0, progress: 0 };
  }

  const lastIndex = stages.length - 1;
  return { index: lastIndex, progress: 1 };
}

function renderCurrentFrame() {
  if (!renderer || !paperMesh || !shadowMesh) return;

  const { index, progress } = getActiveStage();

  // Только активная секция отдаёт управление canvas.
  // Все остальные остаются закрытыми собственным папирусным листом.
  pageScenes.forEach((pageScene, sceneIndex) => {
    if (pageScene) {
      pageScene.classList.toggle("is-active", sceneIndex === index);
    }
  });

  const isFinished = progress >= TURN_HIDE_THRESHOLD;

  if (index !== lastActiveIndex) {
    lastActiveIndex = index;
    lastProgress = -1;
    setActiveTexture(index);
  }

  if (index === 0 || isFinished || !textures[index]) {
    paperMesh.visible = false;
    shadowMesh.visible = false;
  } else {
    paperMesh.visible = true;
    shadowMesh.visible = true;

    // Не пересчитываем сетку, если прокрутка не изменила прогресс.
    if (Math.abs(progress - lastProgress) > 0.0001) {
      deformPage(progress);
      lastProgress = progress;
    }

    // Тень немного сильнее во время подъёма страницы.
    shadowMaterial.opacity = 0.12 + Math.sin(progress * Math.PI) * 0.16;
  }

  renderer.render(scene, camera);
}

function requestRender() {
  if (ticking) return;

  ticking = true;
  requestAnimationFrame(() => {
    renderCurrentFrame();
    ticking = false;
  });
}

function handleResize() {
  if (!renderer) return;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  rebuildGeometry();
  lastProgress = -1;
  requestRender();
}

function canLoadImage(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = source;
  });
}

async function resolvePaperPath(imagePath) {
  // Сначала пробуем папку images в проекте пользователя.
  if (await canLoadImage(imagePath)) return imagePath;

  // Если локальных файлов нет, используем ровно те текстуры, которые
  // применяются в работающем testBlocks.
  const remotePath = getRemotePaperPath(imagePath);
  if (remotePath && await canLoadImage(remotePath)) return remotePath;

  return null;
}

async function loadTextures() {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  return Promise.all(
    stages.map(async (stage, index) => {
      const imagePath = stage.dataset.paper;

      if (!imagePath) {
        console.error(`У секции ${index + 1} отсутствует data-paper.`);
        return null;
      }

      const resolvedPath = await resolvePaperPath(imagePath);
      if (!resolvedPath) {
        console.error(`Не удалось найти текстуру папируса: ${imagePath}`);
        return null;
      }

      // Один и тот же разрешённый путь используется и CSS-фоном, и текстурой
      // Three.js. Поэтому DOM-страница и перелистываемый лист совпадают.
      pageScenes[index]?.style.setProperty("--paper-image", `url("${resolvedPath}")`);

      try {
        const texture = await loader.loadAsync(resolvedPath);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = Math.min(
          renderer.capabilities.getMaxAnisotropy(),
          8
        );
        return texture;
      } catch (error) {
        console.error(`Не удалось загрузить папирус: ${resolvedPath}`, error);
        return null;
      }
    })
  );
}
async function init() {
  if (!createRenderer()) return;

  createScene();
  textures = await loadTextures();

  createMaterials();
  rebuildGeometry();

  shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadowMesh.frustumCulled = false;
  shadowMesh.renderOrder = 1;

  paperMesh = new THREE.Mesh(geometry, paperMaterial);
  paperMesh.frustumCulled = false;
  paperMesh.renderOrder = 2;

  scene.add(shadowMesh, paperMesh);

  window.addEventListener("scroll", requestRender, { passive: true });
  window.addEventListener("resize", handleResize);
  window.addEventListener("load", requestRender, { once: true });

  requestRender();
  console.log(`Page curl запущен. Найдено страниц: ${stages.length}`);
}

init().catch((error) => {
  console.error("Ошибка запуска перелистывания:", error);
});
