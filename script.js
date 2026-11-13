import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

const stages = [...document.querySelectorAll(".page-stage")];
const canvas = document.querySelector("#page-turn");

if (!stages.length || !canvas) {
  throw new Error("Не найдены .page-stage или canvas#page-turn.");
}
const pageScenes = stages.map((stage, index) => {
  const pageScene = stage.querySelector(".page-scene");
  const imagePath = stage.dataset.paper;

  if (!pageScene || !imagePath) {
    console.error(
      `Секция ${index + 1}: не найдена .page-scene или data-paper.`,
    );
    return null;
  }

  pageScene.style.setProperty("--paper-image", `url("${imagePath}")`);

  return pageScene;
});
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Направление перелистывания: от нижнего левого угла преимущественно вправо,
// с небольшим движением вверх. Угол влияет на диагональ линии сгиба.
const CURL_ANGLE = THREE.MathUtils.degToRad(16);
const CURL_DIRECTION = new THREE.Vector2(
  Math.cos(CURL_ANGLE),
  Math.sin(CURL_ANGLE),
);

// Плотность сетки. Чем больше сегментов, тем плавнее изгиб,
// но тем выше нагрузка на устройство.
const SEGMENTS_X = 150;
const SEGMENTS_Y = 110;

// Ширина зоны загиба относительно высоты листа.
const CURL_WIDTH_FACTOR = 0.52;
const CURL_DEPTH_FACTOR = 0.92;
const TURN_HIDE_THRESHOLD = 0.997;

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
  camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 50);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  // Мягкий общий свет и направленный источник подчёркивают форму изгиба.
  const ambientLight = new THREE.HemisphereLight(0xfff0d5, 0x49311d, 1.25);
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
      }`,
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
    SEGMENTS_Y,
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
    const s = localX * CURL_DIRECTION.x + localY * CURL_DIRECTION.y;
    const q = -localX * CURL_DIRECTION.y + localY * CURL_DIRECTION.x;

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
        distanceBehindFold * Math.sin(angle) * CURL_DEPTH_FACTOR +
        0.018 * smoothStep(t);
    }

    // Возвращаем координаты из базиса (s, q) в XY-плоскость.
    const turnedXLocal = turnedS * CURL_DIRECTION.x - q * CURL_DIRECTION.y;
    const turnedYLocal = turnedS * CURL_DIRECTION.y + q * CURL_DIRECTION.x;

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
        progress: clamp(-rect.top / window.innerHeight, 0, 1),
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

  // Закрываем все неактивные секции.
  // Только текущая секция передаётся под управление Three.js.
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

      try {
        const texture = await loader.loadAsync(imagePath);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = Math.min(
          renderer.capabilities.getMaxAnisotropy(),
          8,
        );
        return texture;
      } catch (error) {
        console.error(`Не удалось загрузить папирус: ${imagePath}`, error);
        return null;
      }
    }),
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
