const textarea = document.querySelector("#typing-surface");
const leaveButton = document.querySelector("#leave-trace");
const typeAgainButton = document.querySelector("#type-again");
const micButton = document.querySelector("#enable-mic");
const soundStatus = document.querySelector("#sound-status");
const characterCount = document.querySelector("#character-count");
const liveTrace = document.querySelector("#live-trace");
const homeLiveTrace = document.querySelector("#home-live-trace");
const homeStage = document.querySelector("#home-stage");
const resultStage = document.querySelector("#result-stage");
const sourceText = document.querySelector("#source-text");
const resultCharacterCount = document.querySelector("#result-character-count");
const resultSoundStatus = document.querySelector("#result-sound-status");

const SVG_NS = "http://www.w3.org/2000/svg";
const TRACE_WIDTH = 1120;
const TRACE_HEIGHT = 430;
const TRACE_LEFT = 58;
const TRACE_RIGHT = 58;
const TRACE_TOP = 86;
const LINE_HEIGHT = 58;
const BASE_ADVANCE = 24;
const SPACE_ADVANCE = 34;
const ACTIVE_MS = 1300;
const HOME_TRACE_WIDTH = 1120;
const HOME_TRACE_HEIGHT = 230;
const TRACE_FONT = '"Stamp Typo Regular", "Courier New", monospace';
const UI_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const COLORS = {
  panel: "#F2A1CC",
  rule: "#CC7FAA",
  text: "#2B2B2B",
  active: "#FF6A2B",
  settled: "#F5F3EF",
  repeated: "#D83B1D",
  deleted: "#8A7883",
  annotation: "rgba(43,43,43,0.62)",
};

const state = createEmptyState();
let audioContext;
let analyser;
let microphoneSource;
let microphoneStream;
let soundData;
let soundFrame = 0;
let currentAmplitude = 0;
let microphoneState = "inactive";
let frozen = false;
let settleFrame = 0;

function createEmptyState() {
  return {
    startedAt: 0,
    lastAt: 0,
    events: [],
    traceItems: [],
    keyFrequency: new Map(),
    pauses: [],
    deletions: 0,
    repeated: new Map(),
    soundPeaks: [],
    lastTypedCharacter: "",
  };
}

function resetState() {
  const fresh = createEmptyState();
  Object.assign(state, fresh);
  frozen = false;
  currentAmplitude = 0;
  textarea.value = "";
  textarea.disabled = false;
  characterCount.textContent = "0";
  resultCharacterCount.textContent = "0";
  leaveButton.disabled = true;
  leaveButton.textContent = "LEAVE TRACE";
  sourceText.textContent = "";
  showHomeStage();
  textarea.focus();
  renderLiveTrace();
  renderHomeTrace();
}

function isPrintableKey(event) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function normaliseKey(key) {
  if (key === " ") return "space";
  return key.toLowerCase();
}

function pauseGap(delta) {
  if (delta < 1000) return 0;
  if (delta < 2000) return 50;
  if (delta < 3000) return 100;
  if (delta < 4000) return 150;
  return 220;
}

function recordKey(event) {
  if (frozen) {
    event.preventDefault();
    return;
  }

  const printable = isPrintableKey(event);
  const isDeletion = event.key === "Backspace" || event.key === "Delete";
  if (!printable && !isDeletion) return;

  const now = performance.now();
  if (!state.startedAt) state.startedAt = now;
  const delta = state.lastAt ? now - state.lastAt : 0;
  const gap = pauseGap(delta);

  if (gap) {
    state.pauses.push({ at: now - state.startedAt, duration: delta, gap });
  }

  if (printable) {
    addTypedTraceItem(event.key, now, delta, gap);
  } else if (isDeletion) {
    markDeletedTraceItem(now, delta, gap);
  }

  state.lastAt = now;
  renderLiveTrace();
  renderHomeTrace();
}

function addTypedTraceItem(character, now, delta, gap) {
  const normalized = normaliseKey(character);
  const previous = state.lastTypedCharacter;
  const repeated = previous === normalized && normalized !== "space";

  state.keyFrequency.set(normalized, (state.keyFrequency.get(normalized) || 0) + 1);
  if (repeated) state.repeated.set(normalized, (state.repeated.get(normalized) || 0) + 1);

  const item = {
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${state.traceItems.length}`,
    character,
    normalized,
    action: "type",
    at: now - state.startedAt,
    delta,
    pauseGap: gap,
    amplitude: currentAmplitude,
    deleted: false,
    repeated,
    createdAt: now,
  };

  state.traceItems.push(item);
  state.events.push(item);
  state.lastTypedCharacter = normalized;
}

function markDeletedTraceItem(now, delta, gap) {
  const target = [...state.traceItems].reverse().find((item) => item.action === "type" && !item.deleted && item.normalized !== "space");

  state.deletions += 1;
  state.keyFrequency.set("backspace", (state.keyFrequency.get("backspace") || 0) + 1);
  state.events.push({
    action: "delete",
    character: "⌫",
    normalized: "backspace",
    at: now - state.startedAt,
    delta,
    pauseGap: gap,
    amplitude: currentAmplitude,
    createdAt: now,
  });

  if (target) {
    target.deleted = true;
    target.deletedAt = now;
    target.deletePauseGap = gap;
  }

  state.lastTypedCharacter = "";
}

function updateCountAndButton() {
  characterCount.textContent = textarea.value.length.toString();
  resultCharacterCount.textContent = textarea.value.length.toString();
  leaveButton.disabled = frozen || state.traceItems.length === 0;
}

function holdTrace() {
  if (!state.traceItems.length) return;
  frozen = true;
  textarea.disabled = true;
  leaveButton.textContent = "TRACE HELD";
  leaveButton.disabled = true;
  sourceText.textContent = textarea.value.trim() || "[sentence withheld]";
  resultCharacterCount.textContent = textarea.value.length.toString();
  resultSoundStatus.textContent = soundStatus.textContent;
  renderLiveTrace();
  showResultStage();
}

function showHomeStage() {
  resultStage.hidden = true;
  resultStage.classList.remove("is-active");
  resultStage.setAttribute("aria-hidden", "true");
  homeStage.hidden = false;
  window.setTimeout(() => {
    homeStage.classList.add("is-active");
    homeStage.removeAttribute("aria-hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, 20);
}

function showResultStage() {
  homeStage.classList.remove("is-active");
  homeStage.setAttribute("aria-hidden", "true");
  window.setTimeout(() => {
    homeStage.hidden = true;
    resultStage.hidden = false;
    window.setTimeout(() => {
      resultStage.classList.add("is-active");
      resultStage.removeAttribute("aria-hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 20);
  }, 260);
}

async function enableMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    microphoneState = "unavailable";
    soundStatus.textContent = "SOUND TRACE UNAVAILABLE";
    resultSoundStatus.textContent = soundStatus.textContent;
    return;
  }

  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
    microphoneSource.connect(analyser);
    soundData = new Uint8Array(analyser.fftSize);
    microphoneState = "enabled";
    micButton.disabled = true;
    soundStatus.textContent = "SOUND TRACE ENABLED";
    resultSoundStatus.textContent = soundStatus.textContent;
    monitorAmplitude();
  } catch (error) {
    microphoneState = "unavailable";
    soundStatus.textContent = "SOUND TRACE UNAVAILABLE";
    resultSoundStatus.textContent = soundStatus.textContent;
  }
}

function monitorAmplitude() {
  if (!analyser || !soundData) return;
  analyser.getByteTimeDomainData(soundData);

  let sum = 0;
  for (const value of soundData) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }

  currentAmplitude = Math.sqrt(sum / soundData.length);
  if (currentAmplitude > 0.035 && state.startedAt && !frozen) {
    const at = performance.now() - state.startedAt;
    const previous = state.soundPeaks[state.soundPeaks.length - 1];
    if (!previous || at - previous.at > 90) {
      state.soundPeaks.push({ at, amplitude: currentAmplitude });
      if (state.soundPeaks.length > 180) state.soundPeaks.shift();
    }
  }

  soundFrame = requestAnimationFrame(monitorAmplitude);
}

function renderLiveTrace() {
  liveTrace.replaceChildren();
  drawTraceBackground();
  drawTraceItems();
  drawSoundNeedles();
  drawPanelAnnotations();
  scheduleSettleRender();
}

function drawTraceBackground() {
  svgRect(0, 0, TRACE_WIDTH, TRACE_HEIGHT, COLORS.panel, "none");
  for (let y = 34; y < TRACE_HEIGHT - 34; y += 18) {
    svgLine(36, y, TRACE_WIDTH - 36, y, COLORS.rule, { width: 0.8, opacity: 0.58 });
  }
  svgText("INPUT SURFACE", 48, 48, { size: 12, fill: COLORS.text, opacity: 0.72, family: UI_FONT, spacing: 2 });
  svgText("sequence retained / content withheld", TRACE_WIDTH - 330, 48, { size: 12, fill: COLORS.text, opacity: 0.62, family: UI_FONT, spacing: 1.5 });
}

function drawTraceItems() {
  const now = performance.now();
  let x = TRACE_LEFT;
  let y = TRACE_TOP;
  const maxX = TRACE_WIDTH - TRACE_RIGHT;

  if (!state.traceItems.length) {
    svgText("type to disturb this field", TRACE_LEFT, 212, {
      size: 42,
      fill: COLORS.text,
      family: TRACE_FONT,
      opacity: 0.42,
    });
    return;
  }

  state.traceItems.forEach((item) => {
    const advance = item.normalized === "space" ? SPACE_ADVANCE : BASE_ADVANCE;
    x += item.pauseGap || 0;

    if (x > maxX - advance) {
      x = TRACE_LEFT;
      y += LINE_HEIGHT;
    }

    if (y > TRACE_HEIGHT - 70) {
      y = TRACE_TOP + ((state.traceItems.indexOf(item) % 4) * LINE_HEIGHT);
      x = TRACE_LEFT + ((state.traceItems.indexOf(item) % 9) * 12);
    }

    if (item.pauseGap) {
      const markerX = Math.max(TRACE_LEFT, x - item.pauseGap + 10);
      const markerWidth = Math.min(item.pauseGap - 16, 190);
      svgRect(markerX, y - 29, markerWidth, 34, "none", COLORS.text, { opacity: 0.18, dasharray: "4 8" });
      svgText("pause", markerX + 6, y - 36, { size: 9, fill: COLORS.text, opacity: 0.48, family: UI_FONT, spacing: 1.2 });
    }

    if (item.normalized === "space") {
      x += SPACE_ADVANCE;
      return;
    }

    const active = !frozen && now - item.createdAt < ACTIVE_MS;
    const fill = item.deleted ? COLORS.deleted : item.repeated ? COLORS.repeated : active ? COLORS.active : COLORS.settled;
    const opacity = item.deleted ? 0.64 : item.repeated ? 0.98 : active ? 1 : 0.76;
    const fontSize = item.repeated ? 39 : 36;
    const itemY = item.deleted ? y + 12 : y;
    const itemX = item.repeated ? x - 4 : x;

    if (item.repeated) {
      svgText(item.character, itemX + 4, itemY + 1, { size: fontSize, fill: COLORS.active, family: TRACE_FONT, opacity: 0.42 });
      svgText(item.character, itemX + 8, itemY + 2, { size: fontSize, fill: COLORS.repeated, family: TRACE_FONT, opacity: 0.28 });
    }

    svgText(item.character, itemX, itemY, { size: fontSize, fill, family: TRACE_FONT, opacity });

    if (item.deleted) {
      svgLine(itemX - 2, itemY - 13, itemX + 20, itemY - 22, COLORS.text, { width: 1.6, opacity: 0.46 });
      svgLine(itemX + 2, itemY - 2, itemX + 24, itemY - 10, COLORS.text, { width: 1.2, opacity: 0.28 });
    }

    x += item.repeated ? BASE_ADVANCE * 0.72 : advance;
  });
}

function drawSoundNeedles() {
  if (microphoneState !== "enabled" || !state.soundPeaks.length) return;
  const duration = Math.max(1, state.lastAt - state.startedAt);
  const width = TRACE_WIDTH - TRACE_LEFT - TRACE_RIGHT;

  state.soundPeaks.slice(-70).forEach((peak) => {
    const x = TRACE_LEFT + (peak.at / duration) * width;
    const height = clamp(peak.amplitude * 260, 8, 44);
    svgLine(x, TRACE_HEIGHT - 64, x, TRACE_HEIGHT - 64 - height, COLORS.active, { width: 1.4, opacity: 0.42 });
  });
}

function drawPanelAnnotations() {
  svgLine(118, 66, 118, 94, COLORS.text, { width: 0.9, opacity: 0.42 });
  svgText("active input", 132, 76, { size: 10, fill: COLORS.text, opacity: 0.62, family: UI_FONT, spacing: 1.4 });
  svgLine(858, 354, 936, 354, COLORS.text, { width: 0.9, opacity: 0.34, dasharray: "3 7" });
  svgText("empty distance records hesitation", 704, 359, { size: 10, fill: COLORS.text, opacity: 0.56, family: UI_FONT, spacing: 1.1 });
}

function scheduleSettleRender() {
  cancelAnimationFrame(settleFrame);
  if (frozen || !state.traceItems.some((item) => performance.now() - item.createdAt < ACTIVE_MS)) return;
  settleFrame = requestAnimationFrame(() => window.setTimeout(() => {
    renderLiveTrace();
    renderHomeTrace();
  }, 180));
}

function renderHomeTrace() {
  homeLiveTrace.replaceChildren();
  homeSvgRect(0, 0, HOME_TRACE_WIDTH, HOME_TRACE_HEIGHT, COLORS.panel, "none");
  for (let y = 26; y < HOME_TRACE_HEIGHT - 24; y += 16) {
    homeSvgLine(28, y, HOME_TRACE_WIDTH - 28, y, COLORS.rule, { width: 0.8, opacity: 0.52 });
  }

  const now = performance.now();
  let x = 42;
  let y = 92;
  const maxX = HOME_TRACE_WIDTH - 42;

  if (!state.traceItems.length) {
    homeSvgText("trace forms here while typing", 42, 126, {
      size: 26,
      fill: COLORS.text,
      family: TRACE_FONT,
      opacity: 0.38,
    });
    return;
  }

  state.traceItems.forEach((item, index) => {
    const advance = item.normalized === "space" ? 26 : 19;
    x += item.pauseGap ? Math.min(item.pauseGap * 0.55, 122) : 0;

    if (x > maxX - advance) {
      x = 42;
      y += 42;
    }

    if (y > HOME_TRACE_HEIGHT - 34) {
      y = 92 + ((index % 3) * 42);
      x = 42 + ((index % 11) * 9);
    }

    if (item.pauseGap) {
      const gapWidth = Math.min(Math.max(item.pauseGap * 0.55 - 12, 18), 104);
      homeSvgLine(Math.max(42, x - gapWidth), y - 19, x - 8, y - 19, COLORS.text, { width: 1, opacity: 0.24, dasharray: "3 7" });
    }

    if (item.normalized === "space") {
      x += advance;
      return;
    }

    const active = !frozen && now - item.createdAt < ACTIVE_MS;
    const fill = item.deleted ? COLORS.deleted : item.repeated ? COLORS.repeated : active ? COLORS.active : COLORS.settled;
    const opacity = item.deleted ? 0.66 : item.repeated ? 0.96 : active ? 1 : 0.76;
    const size = item.repeated ? 29 : 27;
    const itemY = item.deleted ? y + 8 : y;
    const itemX = item.repeated ? x - 3 : x;

    if (item.repeated) {
      homeSvgText(item.character, itemX + 4, itemY + 1, { size, fill: COLORS.active, family: TRACE_FONT, opacity: 0.35 });
      homeSvgText(item.character, itemX + 7, itemY + 1, { size, fill: COLORS.repeated, family: TRACE_FONT, opacity: 0.24 });
    }

    homeSvgText(item.character, itemX, itemY, { size, fill, family: TRACE_FONT, opacity });

    if (item.deleted) {
      homeSvgLine(itemX - 1, itemY - 10, itemX + 18, itemY - 17, COLORS.text, { width: 1.2, opacity: 0.36 });
    }

    x += item.repeated ? advance * 0.72 : advance;
  });
}

function homeSvgEl(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  });
  homeLiveTrace.appendChild(node);
  return node;
}

function homeSvgRect(x, y, width, height, fill = "none", stroke = "none", options = {}) {
  return homeSvgEl("rect", {
    x,
    y,
    width,
    height,
    fill,
    stroke,
    opacity: options.opacity,
    "stroke-dasharray": options.dasharray,
  });
}

function homeSvgLine(x1, y1, x2, y2, stroke, options = {}) {
  return homeSvgEl("line", {
    x1,
    y1,
    x2,
    y2,
    stroke,
    "stroke-width": options.width || 1,
    opacity: options.opacity,
    "stroke-dasharray": options.dasharray,
    "stroke-linecap": "round",
  });
}

function homeSvgText(content, x, y, options = {}) {
  const node = homeSvgEl("text", {
    x,
    y,
    fill: options.fill || COLORS.text,
    opacity: options.opacity,
    "font-family": options.family || UI_FONT,
    "font-size": options.size || 14,
    "font-weight": options.weight || 400,
    "letter-spacing": options.spacing,
  });
  node.textContent = content;
  return node;
}

function svgEl(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  });
  liveTrace.appendChild(node);
  return node;
}

function svgRect(x, y, width, height, fill = "none", stroke = "none", options = {}) {
  return svgEl("rect", {
    x,
    y,
    width,
    height,
    fill,
    stroke,
    opacity: options.opacity,
    "stroke-dasharray": options.dasharray,
  });
}

function svgLine(x1, y1, x2, y2, stroke, options = {}) {
  return svgEl("line", {
    x1,
    y1,
    x2,
    y2,
    stroke,
    "stroke-width": options.width || 1,
    opacity: options.opacity,
    "stroke-dasharray": options.dasharray,
    "stroke-linecap": "round",
  });
}

function svgText(content, x, y, options = {}) {
  const node = svgEl("text", {
    x,
    y,
    fill: options.fill || COLORS.text,
    opacity: options.opacity,
    "font-family": options.family || UI_FONT,
    "font-size": options.size || 14,
    "font-weight": options.weight || 400,
    "letter-spacing": options.spacing,
  });
  node.textContent = content;
  return node;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

textarea.addEventListener("keydown", recordKey);
textarea.addEventListener("input", () => {
  updateCountAndButton();
  renderLiveTrace();
  renderHomeTrace();
});
leaveButton.addEventListener("click", holdTrace);
typeAgainButton.addEventListener("click", resetState);
micButton.addEventListener("click", enableMicrophone);

window.addEventListener("beforeunload", () => {
  if (soundFrame) cancelAnimationFrame(soundFrame);
  microphoneStream?.getTracks().forEach((track) => track.stop());
  audioContext?.close();
});

renderLiveTrace();
renderHomeTrace();
