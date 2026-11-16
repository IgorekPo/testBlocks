import * as THREE from "three";

const hero = document.querySelector(".hero");
const canvas = document.querySelector("#liquidCanvas");
const motionButton = document.querySelector("#motionButton");

let renderer;
let frameId = 0;
let sensorEnabled = false;

let scene;
let camera;

const materials = [];
const sideLayers = [];

const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

const pointer = new THREE.Vector2(0, 0);
const targetPointer = new THREE.Vector2(0, 0);

// Инерция движения жидкости на телефоне
const motionOffset = new THREE.Vector2(0, 0);
const motionVelocity = new THREE.Vector2(0, 0);
const motionInput = new THREE.Vector2(0, 0);

let lastGamma = null;
let lastBeta = null;

const clock = new THREE.Clock();

const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D uTexture;
  uniform float uTime;
  uniform vec2 uPointer;
  uniform vec2 uResolution;
  uniform vec2 uImageResolution;
  uniform float uMotion;
  uniform float uCover;
  uniform float uLayerMotion;
  uniform float uPhase;

  varying vec2 vUv;

  // Аналог object-fit: cover для центрального изображения.
  vec2 coverUv(vec2 uv) {
    float screenAspect = uResolution.x / uResolution.y;
    float imageAspect = uImageResolution.x / uImageResolution.y;

    vec2 scaled = vec2(1.0);

    if (screenAspect > imageAspect) {
      scaled.y = imageAspect / screenAspect;
    } else {
      scaled.x = screenAspect / imageAspect;
    }

    // Масштаб центрального изображения сохраняем: 3.0
    return (uv - 0.5) * scaled * 2.0 + 0.5;
  }

  void main() {
    // Центральный слой использует cover, боковые — обычные UV.
    vec2 uv = mix(vUv, coverUv(vUv), uCover);

    vec2 centered = uv - 0.5;

    float waveA = sin(
      uv.y * 8.0 + uTime * 0.42 + uPointer.x * 2.8 + uPhase
    );

    float waveB = cos(
      uv.x * 7.0 - uTime * 0.34 + uPointer.y * 2.8 + uPhase
    );

    float radius = length(
      uv - vec2(
        0.5 + uPointer.x * 0.16,
        0.5 + uPointer.y * 0.16
      )
    );

    float ripple = sin(radius * 34.0 - uTime * 1.05 + uPhase) * 0.0022;

    float influence = exp(
      -distance(
        uv,
        vec2(
          0.5 + uPointer.x * 0.2,
          0.5 + uPointer.y * 0.2
        )
      ) * 4.2
    );

    vec2 displacement = vec2(waveA, waveB) * 0.006;

// Сохраняем эффект круговой ряби.
displacement += centered * ripple;

// Направление от центра изображения к курсору.
vec2 direction = normalize(
  vec2(uPointer.x, uPointer.y) + vec2(0.0001)
);

// Насколько далеко курсор находится от центра.
float pointerDistance = length(uPointer);

// Сила растяжения.
float stretch = smoothstep(0.0, 1.0, pointerDistance);

// Вытягиваем изображение в сторону курсора.
displacement -= direction
  * influence
  * stretch
  * 0.15
  * uLayerMotion;

// Дополнительное локальное притяжение к курсору.
displacement +=
  vec2(-uPointer.x, uPointer.y)
  * influence
  * 0.025
  * uLayerMotion;

    uv += displacement * uMotion;

    vec4 color = texture2D(uTexture, uv);

    float light = 1.0 + influence * 0.12 * uMotion;

    gl_FragColor = vec4(
      color.rgb * light * 1.15,
      color.a
    );
  }
`;

function showFallback() {
  if (!canvas || !hero) return;

  canvas.style.display = "none";

  hero.style.backgroundImage = 'url("assets/golden-liquid.webp")';
  hero.style.backgroundSize = "contain";
  hero.style.backgroundPosition = "center";
  hero.style.backgroundRepeat = "no-repeat";
}

function prepareTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
}

function createMaterial(texture, settings = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTexture: { value: texture },
      uTime: { value: 0 },
      uPointer: { value: pointer },

      uResolution: {
        value: new THREE.Vector2(hero.clientWidth, hero.clientHeight),
      },

      uImageResolution: {
        value: new THREE.Vector2(texture.image.width, texture.image.height),
      },

      uMotion: {
        value: reducedMotion ? 0 : 1,
      },

      uCover: {
        value: settings.cover ? 1 : 0,
      },

      uLayerMotion: {
        value: settings.motion ?? 1,
      },

      uPhase: {
        value: settings.phase ?? 0,
      },
    },

    vertexShader,
    fragmentShader,

    transparent: true,
    depthWrite: false,
  });

  materials.push(material);

  return material;
}

// Создаём центральный слой.
function createMainLayer(texture) {
  const material = createMaterial(texture, {
    cover: true,
    motion: 1,
    phase: 0,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);

  mesh.renderOrder = 0;

  scene.add(mesh);
}

// Рассчитываем размер и положение боковых изображений.
function updateSideLayer(layer) {
  const screenAspect = hero.clientWidth / hero.clientHeight;
  const imageAspect = layer.texture.image.width / layer.texture.image.height;

  // Ширина изображения относительно экрана.
  let width = 2 * layer.width;

  let height = (width * screenAspect) / imageAspect;

  // Ограничиваем высоту, чтобы изображение не занимало весь экран.
  const maxHeight = 1.05;

  if (height > maxHeight) {
    height = maxHeight;
    width = (height * imageAspect) / screenAspect;
  }

  layer.mesh.scale.set(width / 2, height / 2, 1);

  const offset = 0.035;

  if (layer.position === "left") {
    layer.mesh.position.x = -1 + width / 2 + offset;
  } else {
    layer.mesh.position.x = 1 - width / 2 - offset;
  }

  // Нижний край изображения находится рядом с нижним краем Hero.
  layer.mesh.position.y = -1 + height / 2 + offset;
}

// Загружаем и добавляем боковое изображение.
function addSideLayer(path, position, settings) {
  const loader = new THREE.TextureLoader();

  loader.load(
    path,
    (texture) => {
      prepareTexture(texture);

      const material = createMaterial(texture, {
        cover: false,
        motion: settings.motion,
        phase: settings.phase,
      });

      const geometry = new THREE.PlaneGeometry(2, 2);
      const mesh = new THREE.Mesh(geometry, material);

      mesh.renderOrder = 1;

      scene.add(mesh);

      const layer = {
        texture,
        material,
        mesh,
        position,
        width: settings.width,
      };

      sideLayers.push(layer);

      updateSideLayer(layer);
    },
    undefined,
    (error) => {
      console.error(`Не удалось загрузить ${path}`, error);
    },
  );
}

function init() {
  if (!canvas || !hero || !window.WebGLRenderingContext) {
    showFallback();
    return;
  }

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    renderer.setSize(hero.clientWidth, hero.clientHeight, false);

    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();

    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const loader = new THREE.TextureLoader();

    loader.load(
      "assets/golden-liquid.webp",
      (texture) => {
        prepareTexture(texture);

        // Центральное изображение.
        createMainLayer(texture);

        // Нижний левый слой.
        addSideLayer("assets/left.webp", "left", {
          width: 0.22,
          motion: 3.25,
          phase: 1.4,
        });

        // Нижний правый слой.
        addSideLayer("assets/right.webp", "right", {
          width: 0.42,
          motion: 0.85,
          phase: 1.1,
        });

        animate();
      },
      undefined,
      (error) => {
        console.error("Не удалось загрузить assets/golden-liquid.webp", error);

        showFallback();
      },
    );
  } catch (error) {
    console.warn("WebGL недоступен — используется статичный фон.", error);

    showFallback();
  }
}

function animate() {
  cancelAnimationFrame(frameId);

  const render = () => {
    frameId = requestAnimationFrame(render);

    if (sensorEnabled) {
      // Передаём импульс от телефона жидкости.
      motionVelocity.x += motionInput.x * 0.008;
      motionVelocity.y += motionInput.y * 0.008;

      // Постепенно убираем входящий импульс.
      motionInput.multiplyScalar(0.85);

      // Пружинная инерция.
      motionVelocity.x -= motionOffset.x * 0.018;
      motionVelocity.y -= motionOffset.y * 0.018;

      // Плавное затухание.
      motionVelocity.multiplyScalar(0.985);

      // Движение жидкости.
      motionOffset.add(motionVelocity);

      motionOffset.x = THREE.MathUtils.clamp(motionOffset.x, -1.5, 1.5);

      motionOffset.y = THREE.MathUtils.clamp(motionOffset.y, -1.5, 1.5);

      pointer.lerp(motionOffset, 0.08);
    } else {
      pointer.lerp(targetPointer, 0.045);
    }

    const time = reducedMotion ? 0 : clock.getElapsedTime();

    // Обновляем все три слоя.
    materials.forEach((material) => {
      material.uniforms.uTime.value = time;
      material.uniforms.uPointer.value.copy(pointer);
    });

    renderer.render(scene, camera);
  };

  render();
}

function resize() {
  if (!renderer || !hero) return;

  const width = hero.clientWidth;
  const height = hero.clientHeight;

  renderer.setSize(width, height, false);

  materials.forEach((material) => {
    material.uniforms.uResolution.value.set(width, height);
  });

  // Пересчитываем размеры боковых изображений.
  sideLayers.forEach(updateSideLayer);
}

function onPointerMove(event) {
  if (!hero || sensorEnabled) return;

  const rect = hero.getBoundingClientRect();

  targetPointer.x = THREE.MathUtils.clamp(
    ((event.clientX - rect.left) / rect.width - 0.5) * 2,
    -1,
    1,
  );

  targetPointer.y = THREE.MathUtils.clamp(
    -((event.clientY - rect.top) / rect.height - 0.5) * 2,
    -1,
    1,
  );
}

function resetPointer() {
  if (!sensorEnabled) {
    targetPointer.set(0, 0);
  }
}

function onOrientation(event) {
  if (!sensorEnabled) return;

  const gamma = event.gamma || 0;
  const beta = event.beta || 0;

  if (lastGamma === null || lastBeta === null) {
    lastGamma = gamma;
    lastBeta = beta;
    return;
  }

  const deltaGamma = gamma - lastGamma;
  const deltaBeta = beta - lastBeta;

  lastGamma = gamma;
  lastBeta = beta;

  motionInput.x = THREE.MathUtils.clamp(deltaGamma, -3, 3);

  motionInput.y = THREE.MathUtils.clamp(deltaBeta, -3, 3);
}

async function enableMotion() {
  if (!("DeviceOrientationEvent" in window)) {
    motionButton.textContent = "РУХ НЕДОСТУПНИЙ";
    return;
  }

  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();

      if (permission !== "granted") {
        motionButton.textContent = "ДОЗВІЛ НЕ НАДАНО";
        return;
      }
    }

    sensorEnabled = true;

    lastGamma = null;
    lastBeta = null;

    window.addEventListener("deviceorientation", onOrientation, true);

    motionButton.style.display = "none";
  } catch (error) {
    console.warn("Не вдалося отримати дозвіл на датчики руху.", error);

    motionButton.textContent = "НЕ ВДАЛОСЯ УВІМКНУТИ";
  }
}

hero?.addEventListener("pointermove", onPointerMove, { passive: true });

hero?.addEventListener("pointerleave", resetPointer, { passive: true });

motionButton?.addEventListener("click", enableMotion);

window.addEventListener("resize", resize);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(frameId);
  } else if (renderer && scene && camera) {
    clock.start();
    animate();
  }
});

init();
