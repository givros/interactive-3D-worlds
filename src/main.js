import {
  Color,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from "three";
import "./style.css";

const MIN_FOV = 35;
const MAX_FOV = 95;
const DEFAULT_FOV = MAX_FOV;
const DEFAULT_LON = 180;
const DEFAULT_LAT = 0;
const ZOOM_STEP = 6;
const ROTATION_SPEED = 0.1;
const MIN_LAT = -85;
const MAX_LAT = 85;

const panoramaModules = import.meta.glob("../*.png", {
  eager: true,
  import: "default",
});

const panoramas = Object.entries(panoramaModules)
  .map(([path, src]) => {
    const fileName = path.split("/").pop();
    const baseName = fileName.replace(/\.[^.]+$/, "");

    return {
      fileName,
      name: formatPlaceName(baseName),
      src,
    };
  })
  .sort((left, right) => left.fileName.localeCompare(right.fileName, "en"));

const app = document.getElementById("app");
const viewer = document.getElementById("viewer");
const panelCurrent = document.getElementById("panelCurrent");
const panelMeta = document.getElementById("panelMeta");
const placesPanel = document.getElementById("placesPanel");
const placesList = document.getElementById("placesList");
const panelToggle = document.getElementById("panelToggle");
const loadingState = document.getElementById("loadingState");
const loadingText = document.getElementById("loadingText");
const emptyState = document.getElementById("emptyState");
const zoomInButton = document.getElementById("zoomInButton");
const zoomOutButton = document.getElementById("zoomOutButton");
const fullscreenButton = document.getElementById("fullscreenButton");

const state = {
  currentIndex: 0,
  lon: DEFAULT_LON,
  lat: DEFAULT_LAT,
  currentTexture: null,
  loadToken: 0,
  isPanelCollapsed: false,
  dragStart: { x: 0, y: 0, lon: DEFAULT_LON, lat: DEFAULT_LAT },
  pinchStartDistance: 0,
  pinchStartFov: DEFAULT_FOV,
  activePointers: new Map(),
};

const scene = new Scene();
scene.background = new Color("#050c11");

const camera = new PerspectiveCamera(
  DEFAULT_FOV,
  window.innerWidth / window.innerHeight,
  1,
  2200,
);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = SRGBColorSpace;
renderer.domElement.setAttribute("aria-hidden", "true");
viewer.appendChild(renderer.domElement);

const sphereGeometry = new SphereGeometry(1000, 96, 64);
sphereGeometry.scale(-1, 1, 1);

const sphereMaterial = new MeshBasicMaterial({ color: 0xffffff });
const sphereMesh = new Mesh(sphereGeometry, sphereMaterial);
scene.add(sphereMesh);

const textureLoader = new TextureLoader();
const cameraTarget = new Vector3();

if (panoramas.length === 0) {
  emptyState.hidden = false;
  placesPanel.hidden = true;
  disableControls();
} else {
  renderPlaceCards();
  updateUi();
  setupInteractions();
  renderer.setAnimationLoop(renderFrame);
  loadPanorama(0);
}

function formatPlaceName(input) {
  return input
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (character) => character.toUpperCase());
}

function disableControls() {
  zoomInButton.disabled = true;
  zoomOutButton.disabled = true;
  fullscreenButton.disabled = true;
  panelToggle.disabled = true;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setFieldOfView(nextFov) {
  camera.fov = clamp(nextFov, MIN_FOV, MAX_FOV);
  camera.updateProjectionMatrix();
}

function adjustZoom(delta) {
  setFieldOfView(camera.fov + delta);
  updateUi();
}

function updateUi() {
  const currentPanorama = panoramas[state.currentIndex];

  if (!currentPanorama) {
    return;
  }

  panelCurrent.textContent = currentPanorama.name;
  panelMeta.textContent = state.isPanelCollapsed
    ? "Tap the arrow to expand the places list."
    : `${panoramas.length} panoramas available. Tap or click a place to open it.`;

  Array.from(placesList.children).forEach((card, index) => {
    const isActive = index === state.currentIndex;
    card.classList.toggle("is-active", isActive);
    card.setAttribute("aria-pressed", String(isActive));

    const note = card.querySelector(".place-note");
    const pill = card.querySelector(".place-pill");

    if (note) {
      note.textContent = isActive ? "Current place" : "Open";
    }

    if (pill) {
      pill.textContent = isActive ? "Active" : "Visit";
    }
  });
}

function setPanelCollapsed(nextValue) {
  state.isPanelCollapsed = nextValue;
  placesPanel.classList.toggle("is-collapsed", nextValue);
  panelToggle.setAttribute("aria-expanded", String(!nextValue));
  panelToggle.setAttribute(
    "aria-label",
    nextValue ? "Expand the places list" : "Collapse the places list",
  );
  updateUi();
}

function renderPlaceCards() {
  const fragment = document.createDocumentFragment();

  panoramas.forEach((panorama, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "place-card";
    button.dataset.panoramaIndex = String(index);
    button.setAttribute("aria-label", `Open ${panorama.name}`);
    button.setAttribute("aria-pressed", String(index === state.currentIndex));

    button.innerHTML = `
      <div class="place-preview" style="background-image: url('${panorama.src}')"></div>
      <div class="place-info">
        <div>
          <span class="place-name">${panorama.name}</span>
          <span class="place-note">${index === state.currentIndex ? "Current place" : "Open"}</span>
        </div>
        <span class="place-pill">${index === state.currentIndex ? "Active" : "Visit"}</span>
      </div>
    `;

    fragment.appendChild(button);
  });

  placesList.replaceChildren(fragment);
}

function showLoading(message) {
  loadingText.textContent = message;
  loadingState.classList.add("is-visible");
}

function hideLoading() {
  loadingState.classList.remove("is-visible");
}

function loadTexture(source) {
  return new Promise((resolve, reject) => {
    textureLoader.load(source, resolve, undefined, reject);
  });
}

async function loadPanorama(index, collapseAfterLoad = false) {
  const panorama = panoramas[index];

  if (!panorama) {
    return;
  }

  if (index === state.currentIndex && state.currentTexture) {
    if (collapseAfterLoad) {
      setPanelCollapsed(true);
    }
    return;
  }

  const token = ++state.loadToken;
  showLoading(`Loading ${panorama.name}...`);

  try {
    const texture = await loadTexture(panorama.src);

    if (token !== state.loadToken) {
      texture.dispose();
      return;
    }

    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    if (state.currentTexture) {
      state.currentTexture.dispose();
    }

    sphereMaterial.map = texture;
    sphereMaterial.needsUpdate = true;

    state.currentTexture = texture;
    state.currentIndex = index;
    state.lon = DEFAULT_LON;
    state.lat = DEFAULT_LAT;

    setFieldOfView(DEFAULT_FOV);
    updateUi();
    hideLoading();

    if (collapseAfterLoad) {
      setPanelCollapsed(true);
    }
  } catch (error) {
    if (token !== state.loadToken) {
      return;
    }

    console.error("Failed to load panorama:", error);
    hideLoading();
    panelMeta.textContent = `Unable to load ${panorama.fileName}.`;
  }
}

function distanceBetween(pointA, pointB) {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function updatePointer(event) {
  state.activePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
  });
}

function restartDragFromRemainingPointer() {
  const remainingPointer = state.activePointers.values().next().value;

  if (!remainingPointer) {
    viewer.classList.remove("is-dragging");
    return;
  }

  state.dragStart = {
    x: remainingPointer.x,
    y: remainingPointer.y,
    lon: state.lon,
    lat: state.lat,
  };
  viewer.classList.add("is-dragging");
}

function setupInteractions() {
  viewer.addEventListener("dragstart", (event) => event.preventDefault());

  viewer.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    viewer.setPointerCapture(event.pointerId);
    updatePointer(event);

    if (state.activePointers.size === 1) {
      state.dragStart = {
        x: event.clientX,
        y: event.clientY,
        lon: state.lon,
        lat: state.lat,
      };
      viewer.classList.add("is-dragging");
      return;
    }

    if (state.activePointers.size === 2) {
      const [firstPoint, secondPoint] = Array.from(state.activePointers.values());
      state.pinchStartDistance = distanceBetween(firstPoint, secondPoint);
      state.pinchStartFov = camera.fov;
      viewer.classList.remove("is-dragging");
    }
  });

  viewer.addEventListener("pointermove", (event) => {
    if (!state.activePointers.has(event.pointerId)) {
      return;
    }

    updatePointer(event);

    if (state.activePointers.size === 1) {
      state.lon = (state.dragStart.x - event.clientX) * ROTATION_SPEED + state.dragStart.lon;
      state.lat = (event.clientY - state.dragStart.y) * ROTATION_SPEED + state.dragStart.lat;
      return;
    }

    if (state.activePointers.size === 2) {
      const [firstPoint, secondPoint] = Array.from(state.activePointers.values());
      const nextDistance = distanceBetween(firstPoint, secondPoint);
      const delta = state.pinchStartDistance - nextDistance;

      setFieldOfView(state.pinchStartFov + delta * 0.05);
      updateUi();
    }
  });

  const releasePointer = (event) => {
    state.activePointers.delete(event.pointerId);

    if (viewer.hasPointerCapture(event.pointerId)) {
      viewer.releasePointerCapture(event.pointerId);
    }

    if (state.activePointers.size === 0) {
      viewer.classList.remove("is-dragging");
      return;
    }

    if (state.activePointers.size === 1) {
      restartDragFromRemainingPointer();
    }
  };

  viewer.addEventListener("pointerup", releasePointer);
  viewer.addEventListener("pointercancel", releasePointer);

  viewer.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      adjustZoom(event.deltaY > 0 ? ZOOM_STEP : -ZOOM_STEP);
    },
    { passive: false },
  );

  viewer.addEventListener("dblclick", () => {
    toggleFullscreen();
  });

  placesList.addEventListener("click", (event) => {
    const target = event.target.closest("[data-panorama-index]");

    if (!target) {
      return;
    }

    const nextIndex = Number(target.dataset.panoramaIndex);
    loadPanorama(nextIndex, true);
  });

  panelToggle.addEventListener("click", () => {
    setPanelCollapsed(!state.isPanelCollapsed);
  });

  zoomInButton.addEventListener("click", () => {
    adjustZoom(-ZOOM_STEP);
  });

  zoomOutButton.addEventListener("click", () => {
    adjustZoom(ZOOM_STEP);
  });

  fullscreenButton.addEventListener("click", () => {
    toggleFullscreen();
  });

  document.addEventListener("fullscreenchange", updateFullscreenButton);

  window.addEventListener("keydown", (event) => {
    const activeTagName = document.activeElement?.tagName ?? "";

    if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTagName)) {
      return;
    }

    if (event.key === "+" || event.key === "=") {
      adjustZoom(-ZOOM_STEP);
      return;
    }

    if (event.key === "-") {
      adjustZoom(ZOOM_STEP);
      return;
    }

    if (event.key === "ArrowLeft") {
      state.lon -= 4;
      return;
    }

    if (event.key === "ArrowRight") {
      state.lon += 4;
      return;
    }

    if (event.key === "ArrowUp") {
      state.lat += 3;
      return;
    }

    if (event.key === "ArrowDown") {
      state.lat -= 3;
      return;
    }

    if (event.key.toLowerCase() === "f") {
      toggleFullscreen();
    }
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  updateFullscreenButton();
}

function isFullscreenActive() {
  return Boolean(document.fullscreenElement);
}

async function toggleFullscreen() {
  try {
    if (isFullscreenActive()) {
      await document.exitFullscreen();
      return;
    }

    if (document.fullscreenEnabled) {
      await app.requestFullscreen();
    }
  } catch (error) {
    console.error("Unable to toggle full screen:", error);
  }
}

function updateFullscreenButton() {
  fullscreenButton.setAttribute(
    "aria-label",
    isFullscreenActive() ? "Exit full screen" : "Enter full screen",
  );
}

function renderFrame() {
  state.lat = clamp(state.lat, MIN_LAT, MAX_LAT);

  const phi = MathUtils.degToRad(90 - state.lat);
  const theta = MathUtils.degToRad(state.lon);

  cameraTarget.set(
    500 * Math.sin(phi) * Math.cos(theta),
    500 * Math.cos(phi),
    500 * Math.sin(phi) * Math.sin(theta),
  );

  camera.lookAt(cameraTarget);
  renderer.render(scene, camera);
}
