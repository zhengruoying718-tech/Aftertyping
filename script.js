const textarea = document.querySelector("#typing-surface");
const leaveButton = document.querySelector("#leave-trace");
const typeAgainButton = document.querySelector("#type-again");
const micButton = document.querySelector("#enable-mic");
const soundStatus = document.querySelector("#sound-status");
const characterCount = document.querySelector("#character-count");
const holdStatus = document.querySelector("#hold-status");
const liveTrace = document.querySelector("#live-trace");

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
const TRACE_FONT = '"Stamp Typo Regular", "Courier New", monospace';
const UI_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const COLORS = {
  panel: "#F2A1CC",
  rule: "#CC7FAA",
  text: "#2B2B2B",
  active: "#FF6A2B",
  settled: "#F5F3EF",
  repeated: "#D83B1D",
  deleted: "#BDB8B2",
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
  leaveButton.disabled = true;
  leaveButton.textContent = "LEAVE TRACE";
  typeAgainButton.hidden = true;
  holdStatus.textContent = "Live surface awaiting action.";
  textarea.focus();
  renderLiveTrace();
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
  leaveButton.disabled = frozen || state.traceItems.length === 0;
}

function holdTrace() {
  if (!state.traceItems.length) return;
  frozen = true;
  textarea.disabled = true;
  leaveButton.textContent = "TRACE HELD";
  leaveButton.disabled = true;
  typeAgainButton.hidden = false;
  holdStatus.textContent = "Trace held. Type again to begin another action.";
  renderLiveTrace();
}

async function enableMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    microphoneState = "unavailable";
    soundStatus.textContent = "Sound trace unavailable. Typing rhythm only.";
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
    soundStatus.textContent = "Microphone enabled. Live amplitude only; no audio is recorded.";
    monitorAmplitude();
  } catch (error) {
    microphoneState = "unavailable";
    soundStatus.textContent = "Sound trace unavailable. Typing rhythm only.";
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
    const opacity = item.deleted ? 0.38 : item.repeated ? 0.98 : active ? 1 : 0.76;
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
  settleFrame = requestAnimationFrame(() => window.setTimeout(renderLiveTrace, 180));
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
