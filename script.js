const textarea = document.querySelector("#typing-surface");
const leaveButton = document.querySelector("#leave-trace");
const typeAgainButton = document.querySelector("#type-again");
const exportButton = document.querySelector("#export-png");
const micButton = document.querySelector("#enable-mic");
const soundStatus = document.querySelector("#sound-status");
const characterCount = document.querySelector("#character-count");
const inputStage = document.querySelector("#input-stage");
const outputStage = document.querySelector("#output-stage");
const sheet = document.querySelector("#trace-sheet");
const liveClump = document.querySelector("#live-clump");

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 1400;
const HEIGHT = 1800;
const PAPER = "#F5F1EA";
const PINK_FIELD = "#F1C9DC";
const GREY_FIELD = "#BFC1C6";
const HOT = "#F45A3C";
const HALO = "#F39AB1";
const PINK_LINE = "#E6AFC4";
const CHARCOAL = "#2B2B2B";
const MUTED = "#716C68";
const RULE = "rgba(43,43,43,0.24)";

const KEY_LAYOUT = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
  ["space", "⌫", ".", ",", "?", "!"],
];

const state = createEmptyState();
let audioContext;
let analyser;
let microphoneSource;
let soundData;
let soundFrame = 0;
let microphoneStream;
let currentAmplitude = 0;
let microphoneState = "inactive";

function createEmptyState() {
  return {
    startedAt: 0,
    lastAt: 0,
    events: [],
    keyFrequency: new Map(),
    deletions: 0,
    pauses: [],
    repeated: new Map(),
    lastPrintable: "",
    soundPeaks: [],
  };
}

function resetState() {
  const fresh = createEmptyState();
  Object.assign(state, fresh);
  currentAmplitude = 0;
  renderLiveClump();
}

function isPrintableKey(event) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function normaliseKey(key) {
  if (key === " ") return "space";
  if (key === "Backspace" || key === "Delete") return "⌫";
  return key.toLowerCase();
}

function recordKey(event) {
  const now = performance.now();
  if (!state.startedAt) state.startedAt = now;

  const delta = state.lastAt ? now - state.lastAt : 0;
  if (delta > 1000) {
    state.pauses.push({ at: now - state.startedAt, duration: delta });
  }

  const printable = isPrintableKey(event);
  const isDeletion = event.key === "Backspace" || event.key === "Delete";
  const key = printable ? event.key : isDeletion ? "⌫" : event.key;
  const action = isDeletion ? "delete" : printable ? "type" : "control";
  const normalized = normaliseKey(key);
  const amplitude = currentAmplitude;

  if (printable) {
    state.keyFrequency.set(normalized, (state.keyFrequency.get(normalized) || 0) + 1);
    if (normalized === state.lastPrintable) {
      state.repeated.set(normalized, (state.repeated.get(normalized) || 0) + 1);
    }
    state.lastPrintable = normalized;
  }

  if (isDeletion) {
    state.deletions += 1;
    state.keyFrequency.set("⌫", (state.keyFrequency.get("⌫") || 0) + 1);
    state.lastPrintable = "";
  }

  state.events.push({
    key,
    normalized,
    action,
    at: now - state.startedAt,
    delta,
    amplitude,
    valueLength: textarea.value.length,
  });
  state.lastAt = now;
  renderLiveClump();
}

textarea.addEventListener("keydown", recordKey);
textarea.addEventListener("input", () => {
  const length = textarea.value.trim().length;
  characterCount.textContent = textarea.value.length.toString();
  leaveButton.disabled = length === 0 || state.events.length === 0;
  renderLiveClump();
});

leaveButton.addEventListener("click", () => {
  if (!textarea.value.trim()) return;
  const trace = buildTrace(textarea.value, state);
  renderTraceSheet(trace);
  inputStage.classList.remove("is-active");
  inputStage.setAttribute("aria-hidden", "true");
  window.setTimeout(() => {
    outputStage.classList.add("is-active");
    outputStage.removeAttribute("aria-hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, 260);
});

typeAgainButton.addEventListener("click", () => {
  textarea.value = "";
  characterCount.textContent = "0";
  leaveButton.disabled = true;
  resetState();
  outputStage.classList.remove("is-active");
  outputStage.setAttribute("aria-hidden", "true");
  window.setTimeout(() => {
    inputStage.classList.add("is-active");
    inputStage.removeAttribute("aria-hidden");
    textarea.focus();
  }, 260);
});

exportButton.addEventListener("click", exportPng);
micButton.addEventListener("click", enableMicrophone);
renderLiveClump();

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
  if (!analyser) return;
  analyser.getByteTimeDomainData(soundData);
  let sum = 0;
  for (let index = 0; index < soundData.length; index += 1) {
    const centered = (soundData[index] - 128) / 128;
    sum += centered * centered;
  }
  currentAmplitude = Math.sqrt(sum / soundData.length);

  if (state.startedAt && currentAmplitude > 0.045) {
    const at = performance.now() - state.startedAt;
    const previous = state.soundPeaks[state.soundPeaks.length - 1];
    if (!previous || at - previous.at > 80) {
      state.soundPeaks.push({ at, amplitude: currentAmplitude });
      if (state.soundPeaks.length > 220) state.soundPeaks.shift();
    }
  }

  soundFrame = requestAnimationFrame(monitorAmplitude);
}

function buildTrace(text, typingState) {
  const events = typingState.events.filter((event) => event.action !== "control");
  const duration = Math.max(1, typingState.lastAt - typingState.startedAt);
  const printableEvents = events.filter((event) => event.action === "type");
  const keystrokes = events.length;
  const speed = keystrokes / (duration / 1000 || 1);
  const repeatedCharacters = Array.from(typingState.repeated.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([character, count]) => `${character}×${count + 1}`);

  return {
    id: createTraceId(text, duration, keystrokes),
    createdAt: new Date(),
    text,
    events,
    frequency: Array.from(typingState.keyFrequency.entries()).sort((a, b) => b[1] - a[1]),
    duration,
    speed,
    pauses: typingState.pauses,
    deletions: typingState.deletions,
    keystrokes,
    repeatedCharacters,
    printableEvents,
    soundPeaks: typingState.soundPeaks,
    microphoneState,
  };
}

function createTraceId(text, duration, keystrokes) {
  let hash = 0;
  const source = `${text}|${Math.round(duration)}|${keystrokes}|${Date.now()}`;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(index);
    hash |= 0;
  }
  return `AT-${Math.abs(hash).toString(36).slice(0, 6).toUpperCase()}`;
}

function renderLiveClump() {
  const trace = buildTrace(textarea.value || "", state);
  liveClump.replaceChildren();
  svgRect(liveClump, 0, 0, 980, 260, "transparent", "none");
  drawRulings(liveClump, 18, 54, 944, 160, 16, "rgba(43,43,43,0.16)");
  drawClumpInto(liveClump, trace, 26, 72, 925, 145, { live: true });
  if (!textarea.value) {
    svgText(liveClump, "typing pulses will disturb this field", 28, 142, { size: 18, fill: "rgba(43,43,43,0.42)", family: "Georgia, Times New Roman, serif" });
  }
}

function renderTraceSheet(trace) {
  sheet.replaceChildren();
  addDefs(sheet);
  svgRect(sheet, 0, 0, WIDTH, HEIGHT, PAPER, "none");
  drawHeader(trace);
  drawClumpPanel(trace, 92, 262, 1216, 315);
  drawKeyboardPanel(trace, 92, 658, 1216, 365);
  drawRhythmPanel(trace, 92, 1100, 1216, 360);
  drawMetadataPanel(trace, 92, 1542, 1216, 150);
}

function addDefs(target) {
  const defs = svgEl("defs");
  const blur = svgEl("filter", { id: "soft-blur", x: "-35%", y: "-35%", width: "170%", height: "170%" });
  blur.appendChild(svgEl("feGaussianBlur", { stdDeviation: "15" }));
  defs.appendChild(blur);

  const tinyBlur = svgEl("filter", { id: "tiny-blur", x: "-25%", y: "-25%", width: "150%", height: "150%" });
  tinyBlur.appendChild(svgEl("feGaussianBlur", { stdDeviation: "3" }));
  defs.appendChild(tinyBlur);
  target.appendChild(defs);
}

function drawHeader(trace) {
  svgText(sheet, "Aftertyping", 92, 112, {
    family: "Georgia, Times New Roman, serif",
    size: 76,
    spacing: -4,
  });
  svgText(sheet, "A residual notation of a typing action. The sentence is withheld; only rhythm, pressure, correction, and keyboard sound remain.", 94, 166, {
    size: 17,
    fill: MUTED,
  });
  svgText(sheet, trace.id, 1190, 107, { size: 13, spacing: 2.2, fill: MUTED });
  svgLine(sheet, 92, 208, 1308, 208, "rgba(43,43,43,0.32)");
}

function panelLabel(number, title, subtitle, x, y) {
  svgText(sheet, number.padStart(2, "0"), x, y - 22, { size: 11, fill: MUTED, spacing: 2.1 });
  svgText(sheet, title, x + 46, y - 24, { size: 21, family: "Georgia, Times New Roman, serif" });
  svgText(sheet, subtitle, x + 46, y - 4, { size: 10.5, fill: MUTED, spacing: 1.2 });
}

function drawPanelGround(x, y, w, h, fill, options = {}) {
  svgRect(sheet, x, y, w, h, fill, "none", { opacity: options.opacity || 1 });
  svgLine(sheet, x, y, x + w, y, options.stroke || PINK_LINE, { opacity: 0.75 });
  svgLine(sheet, x, y + h, x + w, y + h, options.stroke || PINK_LINE, { opacity: 0.75 });
}

function drawClumpPanel(trace, x, y, w, h) {
  panelLabel("1", "Input / Live Kerning Clump Field", "keypresses compress, pause, double, interrupt, and drift letter spacing", x, y);
  drawPanelGround(x, y, w, h, PINK_FIELD, { stroke: PINK_LINE });
  drawRulings(sheet, x + 24, y + 44, w - 48, h - 88, 17, "rgba(43,43,43,0.17)");
  drawClumpInto(sheet, trace, x + 36, y + 78, w - 72, h - 130, { live: false });
  trace.events.filter((event) => event.action === "delete").slice(0, 18).forEach((event, index) => {
    const dx = x + 44 + (index * 54) % (w - 120);
    const dy = y + h - 56 + Math.floor((index * 54) / (w - 120)) * 15;
    svgLine(sheet, dx, dy, dx + 34, dy - 9, CHARCOAL, { width: 1.2, opacity: 0.42 });
  });
}

function drawClumpInto(target, trace, x, y, w, h, options = {}) {
  const textValue = trace.text.replace(/\s+/g, " ").slice(0, 150);
  const characters = textValue.split("");
  let cursorX = x;
  let cursorY = y + 42;
  let eventIndex = 0;

  characters.forEach((character, index) => {
    const event = trace.printableEvents[eventIndex] || { delta: 260, amplitude: 0 };
    if (character !== " ") eventIndex += 1;
    const previous = characters[index - 1]?.toLowerCase();
    const repeated = character.toLowerCase() === previous && character !== " ";
    const pauseGap = event.delta > 1000 ? Math.min(72, event.delta / 32) : 0;
    const fastCompression = event.delta && event.delta < 145 ? -9 : 0;
    const soundLift = Math.min(28, (event.amplitude || 0) * 280);
    const drift = Math.sin(index * 1.46) * (event.delta > 650 ? 15 : 5) + soundLift;
    const fontSize = options.live ? 30 : 35;

    if (cursorX > x + w - 58 || event.delta > 1500) {
      cursorX = x + Math.sin(index) * 18;
      cursorY += options.live ? 48 : 60;
    }
    if (cursorY > y + h) return;

    if (character !== " ") {
      const fill = repeated ? HOT : event.delta > 700 ? HALO : CHARCOAL;
      svgText(target, character, cursorX + drift, cursorY + Math.cos(index) * 8, {
        family: "Georgia, Times New Roman, serif",
        size: repeated ? fontSize + 7 : fontSize,
        fill,
        opacity: repeated ? 0.78 : 0.48,
        rotate: repeated ? -5 : event.delta > 700 ? 4 : 0,
      });
      if (repeated || event.delta < 130) {
        svgText(target, character, cursorX + drift + 4, cursorY + Math.cos(index) * 8 + 3, {
          family: "Georgia, Times New Roman, serif",
          size: fontSize + 4,
          fill: HOT,
          opacity: 0.24,
        });
      }
    }

    cursorX += 24 + fastCompression + pauseGap + (character === " " ? 18 : 0);
  });
}

function drawKeyboardPanel(trace, x, y, w, h) {
  panelLabel("2", "Keyboard Heat Residue", "a shared key surface after use; frequent keys retain warmer pressure", x, y);
  drawPanelGround(x, y, w, h, GREY_FIELD, { stroke: "rgba(43,43,43,0.24)" });
  drawRulings(sheet, x + 22, y + 38, w - 44, h - 72, 22, "rgba(245,241,234,0.28)");

  const heatLayer = svgEl("g", { filter: "url(#soft-blur)" });
  sheet.appendChild(heatLayer);
  const max = Math.max(1, ...trace.frequency.map(([, count]) => count));
  const keyMap = createKeyboardCoordinates(x, y, w, h);

  trace.frequency.forEach(([key, count]) => {
    const coordinate = keyMap.get(key);
    if (!coordinate) return;
    const intensity = count / max;
    svgCircle(heatLayer, coordinate.cx, coordinate.cy, 26 + intensity * 38, HALO, { opacity: 0.17 + intensity * 0.18 });
    svgCircle(heatLayer, coordinate.cx, coordinate.cy, 10 + intensity * 22, HOT, { opacity: 0.2 + intensity * 0.34 });
  });

  keyMap.forEach((coordinate, key) => {
    const count = trace.frequency.find(([frequencyKey]) => frequencyKey === key)?.[1] || 0;
    const intensity = count / max;
    svgRect(sheet, coordinate.x, coordinate.y, coordinate.w, coordinate.h, "transparent", count ? PINK_LINE : "rgba(245,241,234,0.42)", { opacity: count ? 0.92 : 0.48, rx: 2 });
    svgText(sheet, key, coordinate.cx - (key.length > 1 ? 14 : 4), coordinate.cy + 4, { size: 12, fill: CHARCOAL, opacity: count ? 0.78 : 0.36, spacing: 1.2 });
    if (count) {
      svgText(sheet, String(count).padStart(2, "0"), coordinate.x + 5, coordinate.y + 13, { size: 8, fill: CHARCOAL, opacity: 0.52 });
      svgCircle(sheet, coordinate.cx, coordinate.cy, 2.2 + intensity * 3.4, HOT, { opacity: 0.7 });
    }
  });
}

function createKeyboardCoordinates(x, y, w, h) {
  const map = new Map();
  const keyW = 76;
  const keyH = 40;
  const gap = 11;
  const startY = y + 66;
  KEY_LAYOUT.forEach((row, rowIndex) => {
    const rowWidth = row.reduce((total, key) => total + (key === "space" ? keyW * 3.4 : keyW), 0) + gap * (row.length - 1);
    let cursorX = x + (w - rowWidth) / 2 + rowIndex * 14;
    row.forEach((key) => {
      const currentW = key === "space" ? keyW * 3.4 : keyW;
      const currentY = startY + rowIndex * 54;
      map.set(key, { x: cursorX, y: currentY, w: currentW, h: keyH, cx: cursorX + currentW / 2, cy: currentY + keyH / 2 });
      cursorX += currentW + gap;
    });
  });
  return map;
}

function drawRhythmPanel(trace, x, y, w, h) {
  panelLabel("3", "Rhythm + Sound Timeline", "typing events move left to right; pauses open the score, deletions cut it", x, y);
  drawPanelGround(x, y, w, h, PINK_FIELD, { stroke: PINK_LINE });
  drawRulings(sheet, x + 24, y + 40, w - 48, h - 78, 13, "rgba(43,43,43,0.18)");

  const left = x + 42;
  const right = x + w - 42;
  const usable = right - left;
  const duration = Math.max(1, trace.duration);
  const lanes = [y + 84, y + 132, y + 180, y + 228, y + 276];

  for (let tick = 0; tick <= 12; tick += 1) {
    const tx = left + (usable / 12) * tick;
    svgLine(sheet, tx, y + 52, tx, y + h - 44, CHARCOAL, { opacity: tick % 3 === 0 ? 0.22 : 0.1 });
    svgText(sheet, String(tick).padStart(2, "0"), tx - 6, y + h - 22, { size: 8, fill: MUTED, opacity: 0.72 });
  }

  trace.pauses.forEach((pause) => {
    const px = left + (pause.at / duration) * usable;
    const gap = clamp((pause.duration / duration) * usable, 22, 120);
    svgRect(sheet, px - gap, y + 54, gap, h - 102, PAPER, "none", { opacity: 0.7 });
    svgLine(sheet, px, y + 54, px, y + h - 48, CHARCOAL, { width: 1, opacity: 0.35, dasharray: "3 8" });
  });

  trace.events.forEach((event, index) => {
    const eventX = left + (event.at / duration) * usable;
    const lane = lanes[index % lanes.length];
    const fast = event.delta && event.delta < 150;
    const repeated = event.normalized && trace.events[index - 1]?.normalized === event.normalized;
    const height = event.action === "delete" ? 54 : 14 + Math.min(44, (fast ? 36 : 14) + (event.amplitude || 0) * 180);
    const color = event.action === "delete" ? CHARCOAL : fast || event.amplitude > 0.055 ? HOT : HALO;

    if (event.action === "delete") {
      svgRect(sheet, eventX - 6, lane - 24, 12, height, CHARCOAL, "none", { opacity: 0.66 });
      svgLine(sheet, eventX + 10, lane - 22, eventX - 16, lane + 22, PAPER, { width: 2, opacity: 0.88 });
    } else {
      svgRect(sheet, eventX - (fast ? 3 : 1.6), lane - height / 2, fast ? 6 : 3.2, height, color, "none", { opacity: fast ? 0.78 : 0.48 });
      if (repeated) svgRect(sheet, eventX + 5, lane - height / 2, 2.5, height, HOT, "none", { opacity: 0.58 });
    }
  });

  trace.soundPeaks.forEach((peak) => {
    const peakX = left + (peak.at / duration) * usable;
    const lane = lanes[4] + Math.sin(peak.at * 0.01) * 18;
    const radius = clamp(peak.amplitude * 220, 3, 18);
    svgCircle(sheet, peakX, lane, radius, peak.amplitude > 0.08 ? HOT : HALO, { opacity: 0.28, filter: "url(#tiny-blur)" });
  });
}

function drawMetadataPanel(trace, x, y, w, h) {
  panelLabel("4", "Metadata / Export Area", "quiet archive label for the residual action", x, y);
  drawPanelGround(x, y, w, h, PAPER, { stroke: "rgba(43,43,43,0.28)" });
  drawRulings(sheet, x + 24, y + 28, w - 48, h - 56, 20, "rgba(43,43,43,0.12)");

  const metadata = [
    ["trace id", trace.id],
    ["date / time", formatDate(trace.createdAt)],
    ["duration", `${(trace.duration / 1000).toFixed(2)} sec`],
    ["keystrokes", String(trace.keystrokes)],
    ["typing speed", `${trace.speed.toFixed(1)} keys/sec`],
    ["pauses", String(trace.pauses.length)],
    ["deletions", String(trace.deletions)],
    ["repeated characters", trace.repeatedCharacters.slice(0, 5).join("  ") || "none recorded"],
    ["microphone", trace.microphoneState === "enabled" ? "enabled / live amplitude only" : "not enabled"],
  ];

  metadata.forEach(([label, value], index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const mx = x + 36 + col * (w / 3);
    const my = y + 46 + row * 34;
    svgText(sheet, label, mx, my, { size: 9, fill: MUTED, spacing: 1.7 });
    svgText(sheet, value, mx, my + 17, { size: 12.5, fill: CHARCOAL });
  });
}

function drawRulings(target, x, y, w, h, spacing, stroke) {
  for (let lineY = y; lineY <= y + h; lineY += spacing) {
    svgLine(target, x, lineY, x + w, lineY, stroke, { width: 0.8 });
  }
}

function exportPng() {
  const clone = sheet.cloneNode(true);
  clone.setAttribute("width", String(WIDTH));
  clone.setAttribute("height", String(HEIGHT));
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(clone);
  const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * 2;
    canvas.height = HEIGHT * 2;
    const context = canvas.getContext("2d");
    context.fillStyle = PAPER;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const link = document.createElement("a");
    link.download = `aftertyping-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };
  image.src = url;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function svgEl(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  });
  return node;
}

function svgRect(target, x, y, width, height, fill = "none", stroke = "none", options = {}) {
  const node = svgEl("rect", { x, y, width, height, fill, stroke, opacity: options.opacity, rx: options.rx, filter: options.filter });
  target.appendChild(node);
  return node;
}

function svgCircle(target, cx, cy, r, fill, options = {}) {
  const node = svgEl("circle", { cx, cy, r, fill, opacity: options.opacity, filter: options.filter });
  target.appendChild(node);
  return node;
}

function svgLine(target, x1, y1, x2, y2, stroke, options = {}) {
  const node = svgEl("line", {
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
  target.appendChild(node);
  return node;
}

function svgText(target, content, x, y, options = {}) {
  const node = svgEl("text", {
    x,
    y,
    fill: options.fill || CHARCOAL,
    opacity: options.opacity,
    "font-family": options.family || "Inter, Arial, sans-serif",
    "font-size": options.size || 14,
    "font-weight": options.weight || 400,
    "letter-spacing": options.spacing,
    filter: options.filter,
  });
  if (options.rotate) node.setAttribute("transform", `rotate(${options.rotate} ${x} ${y})`);
  node.textContent = content;
  target.appendChild(node);
  return node;
}
