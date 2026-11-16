import * as THREE from "three";

const hero = document.querySelector(".hero");
const canvas = document.querySelector("#liquidCanvas");
const motionButton = document.querySelector("#motionButton");

let renderer;
let material;
let texture;
let frameId = 0;
let sensorEnabled = false;
let reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

const pointer = new THREE.Vector2(0, 0);
const targetPointer = new THREE.Vector2(0, 0);
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
  varying vec2 vUv;

  // Аналог object-fit: cover: заполняем весь экран, не искажая изображение.
  vec2 coverUv(vec2 uv) {
    float screenAspect = uResolution.x / uResolution.y;
    float imageAspect = uImageResolution.x / uImageResolution.y;
    vec2 scaled = vec2(1.0);

    if (screenAspect > imageAspect) {
      scaled.y = imageAspect / screenAspect;
    } else {
      scaled.x = screenAspect / imageAspect;
    }

    return (uv - 0.5) * scaled + 0.5;
  }

  void main() {
    vec2 uv = coverUv(vUv);
    vec2 centered = uv - 0.5;

    float waveA = sin(uv.y * 8.0 + uTime * 0.42 + uPointer.x * 2.8);
    float waveB = cos(uv.x * 7.0 - uTime * 0.34 + uPointer.y * 2.8);
    float radius = length(uv - vec2(0.5 + uPointer.x * 0.16, 0.5 + uPointer.y * 0.16));
    float ripple = sin(radius * 34.0 - uTime * 1.05) * 0.0022;
    float influence = exp(-distance(uv, vec2(0.5 + uPointer.x * 0.2, 0.5 + uPointer.y * 0.2)) * 4.2);

    vec2 displacement = vec2(waveA, waveB) * 0.006;
    displacement += centered * ripple;
    displacement += vec2(-uPointer.x, uPointer.y) * influence * 0.014;

    uv += displacement * uMotion;
    vec4 color = texture2D(uTexture, uv);
    float light = 1.0 + influence * 0.12 * uMotion;
    gl_FragColor = vec4(color.rgb * light * 1.15, color.a);
  }
`;

function showFallback() {
  if (!canvas || !hero) return;
  canvas.style.display = "none";
  hero.style.backgroundImage = 'url("assets/golden-liquid.webp")';
  hero.style.backgroundSize = "contain";
  hero.style.backgroundPosition = "center";
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

    const loader = new THREE.TextureLoader();
    loader.load(
      "assets/golden-liquid.webp",
      (loadedTexture) => {
        texture = loadedTexture;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        material = new THREE.ShaderMaterial({
          uniforms: {
            uTexture: { value: texture },
            uTime: { value: 0 },
            uPointer: { value: pointer },
            uResolution: {
              value: new THREE.Vector2(hero.clientWidth, hero.clientHeight),
            },
            uImageResolution: {
              value: new THREE.Vector2(
                texture.image.width,
                texture.image.height,
              ),
            },
            uMotion: { value: reducedMotion ? 0 : 1 },
          },
          vertexShader,
          fragmentShader,
          transparent: true,
          depthWrite: false,
        });

        const geometry = new THREE.PlaneGeometry(2, 2);
        const plane = new THREE.Mesh(geometry, material);
        const scene = new THREE.Scene();
        scene.add(plane);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        animate(scene, camera);
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

function animate(scene, camera) {
  cancelAnimationFrame(frameId);
  const render = () => {
    frameId = requestAnimationFrame(render);
    pointer.lerp(targetPointer, 0.045);
    material.uniforms.uTime.value = reducedMotion ? 0 : clock.getElapsedTime();
    material.uniforms.uPointer.value.copy(pointer);
    renderer.render(scene, camera);
  };
  render();
}

function resize() {
  if (!renderer || !hero || !material) return;
  const width = hero.clientWidth;
  const height = hero.clientHeight;
  renderer.setSize(width, height, false);
  material.uniforms.uResolution.value.set(width, height);
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
  if (!sensorEnabled) targetPointer.set(0, 0);
}

function onOrientation(event) {
  if (!sensorEnabled) return;
  const gamma = THREE.MathUtils.clamp((event.gamma || 0) / 15, -1, 1);
  const beta = THREE.MathUtils.clamp((event.beta || 0) / 15, -1, 1);
  targetPointer.set(gamma, beta);
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
    window.addEventListener("deviceorientation", onOrientation, true);
    motionButton.innerHTML = "РУХ УВІМКНЕНО <span>✓</span>";
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
  } else if (renderer && material) {
    clock.start();
    const scene = material;
    // Resume the existing render loop through the stored scene/camera below.
    if (window.__heroLiquidScene && window.__heroLiquidCamera) {
      animate(window.__heroLiquidScene, window.__heroLiquidCamera);
    }
  }
});

// Keep scene references so animation can resume after the tab becomes visible.
const originalAnimate = animate;
animate = function (scene, camera) {
  window.__heroLiquidScene = scene;
  window.__heroLiquidCamera = camera;
  originalAnimate(scene, camera);
};

init();
