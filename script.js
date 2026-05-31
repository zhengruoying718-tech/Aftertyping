const textarea = document.querySelector("#typing-surface");
const leaveButton = document.querySelector("#leave-trace");
const typeAgainButton = document.querySelector("#type-again");
const exportSvgButton = document.querySelector("#export-svg");
const exportPngButton = document.querySelector("#export-png");
const micButton = document.querySelector("#enable-mic");
const soundStatus = document.querySelector("#sound-status");
const characterCount = document.querySelector("#character-count");
const liveTrace = document.querySelector("#live-trace");
const homeLiveTrace = document.querySelector("#home-live-trace");
const homeLivePrimary = document.querySelector("#home-live-primary");
const homeLiveSecondary = document.querySelector("#home-live-secondary");
const arrivalControls = document.querySelector("#arrival-controls");
const respondButton = document.querySelector("#respond-trace");
const typingControls = document.querySelector("#typing-controls");
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
const MAX_CHARACTERS = 500;
const HOME_TRACE_WIDTH = 1120;
const HOME_TRACE_HEIGHT = 230;
const TRACE_FONT = '"Stamp Typo Regular", "Courier New", monospace';
const UI_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

textarea.maxLength = MAX_CHARACTERS;

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
let interactionMode = "arrival";
let lastTextareaValue = "";
let pendingInputAction = null;
let tracePanelHeight = TRACE_HEIGHT;
let homeTracePanelHeight = HOME_TRACE_HEIGHT;
let previousTrace = loadPreviousTrace() || createSimulatedPreviousTrace();

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
    activeTraceByPosition: [],
    lastTypedCharacter: "",
  };
}

function loadPreviousTrace() {
  try {
    const saved = window.localStorage.getItem("aftertyping.previousTrace");
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.traceItems) || !parsed.traceItems.length) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function persistCurrentTrace() {
  const trace = {
    actionCount: state.events.length,
    traceItems: state.traceItems.map((item) => ({
      character: item.character,
      normalized: item.normalized,
      action: item.action,
      pauseGap: item.pauseGap || 0,
      deleted: Boolean(item.deleted),
      repeated: Boolean(item.repeated),
      amplitude: item.amplitude || 0,
    })),
  };

  previousTrace = trace;

  try {
    window.localStorage.setItem("aftertyping.previousTrace", JSON.stringify(trace));
  } catch (error) {
    // Local persistence is optional; the trace still remains for this session.
  }
}

function createSimulatedPreviousTrace() {
  const fragment = [
    ["s", {}],
    ["o", {}],
    ["m", { deleted: true }],
    ["e", { pauseGap: 50 }],
    ["o", {}],
    ["n", {}],
    ["e", { repeated: true }],
    [" ", {}],
    ["w", { pauseGap: 100 }],
    ["a", {}],
    ["s", { deleted: true }],
    [" ", {}],
    ["h", {}],
    ["e", { repeated: true }],
    ["r", {}],
    ["e", { repeated: true }],
    [".", { deleted: true, pauseGap: 150 }],
  ];

  return {
    actionCount: 43,
    traceItems: fragment.map(([character, options]) => ({
      character,
      normalized: normaliseStoredCharacter(character),
      action: "type",
      pauseGap: options.pauseGap || 0,
      deleted: Boolean(options.deleted),
      repeated: Boolean(options.repeated),
      amplitude: 0,
    })),
  };
}

function normaliseStoredCharacter(character) {
  if (character === " ") return "space";
  if (character === "\n") return "line-break";
  return character.toLowerCase();
}

function showArrivalTrace() {
  interactionMode = "arrival";
  textarea.hidden = true;
  typingControls.hidden = true;
  arrivalControls.hidden = false;
  homeLivePrimary.textContent = "A TRACE WAS LEFT HERE BEFORE YOU ARRIVED";
  homeLiveSecondary.textContent = "source sentence withheld";
  characterCount.textContent = String(previousTrace.actionCount || previousTrace.traceItems.length);
  renderHomeTrace();
}

function resetState() {
  const fresh = createEmptyState();
  Object.assign(state, fresh);
  frozen = false;
  currentAmplitude = 0;
  interactionMode = "typing";
  textarea.value = "";
  lastTextareaValue = "";
  pendingInputAction = null;
  textarea.disabled = false;
  textarea.hidden = false;
  typingControls.hidden = false;
  arrivalControls.hidden = true;
  homeLivePrimary.textContent = "NEW TRACE SURFACE";
  homeLiveSecondary.textContent = "your action forms separately";
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
  if (key === "\n") return "line-break";
  return key.toLowerCase();
}

function pauseGap(delta) {
  if (delta < 1000) return 0;
  if (delta < 2000) return 50;
  if (delta < 3000) return 100;
  if (delta < 4000) return 150;
  return 220;
}

function recordInputIntent(event) {
  if (frozen) {
    event.preventDefault();
    return;
  }

  const inputType = event.inputType || "";
  const isInsertion = inputType.startsWith("insert");
  const isDeletion = inputType.startsWith("delete");
  if (!isInsertion && !isDeletion) {
    pendingInputAction = null;
    return;
  }

  const selectionStart = textarea.selectionStart ?? lastTextareaValue.length;
  const selectionEnd = textarea.selectionEnd ?? selectionStart;
  let deleteStart = selectionStart;
  let deleteEnd = selectionEnd;

  if (isDeletion && selectionStart === selectionEnd) {
    if (inputType === "deleteContentBackward") {
      deleteStart = Math.max(0, selectionStart - 1);
      deleteEnd = selectionStart;
    } else if (inputType === "deleteContentForward") {
      deleteStart = selectionStart;
      deleteEnd = Math.min(lastTextareaValue.length, selectionStart + 1);
    }
  }

  pendingInputAction = {
    inputType,
    isInsertion,
    isDeletion,
    value: lastTextareaValue,
    selectionStart,
    selectionEnd,
    deleteStart,
    deleteEnd,
  };
}

function recordInputChange() {
  const currentValue = textarea.value;
  const previousValue = lastTextareaValue;
  const edit = getTextareaEdit(previousValue, currentValue);

  updateCountAndButton();

  if (!edit.deletedCount && !edit.insertedText) {
    pendingInputAction = null;
    renderLiveTrace();
    renderHomeTrace();
    return;
  }

  const now = performance.now();
  if (!state.startedAt) state.startedAt = now;
  const delta = state.lastAt ? now - state.lastAt : 0;
  const gap = pauseGap(delta);

  if (gap) {
    state.pauses.push({ at: now - state.startedAt, duration: delta, gap });
  }

  if (edit.deletedCount) {
    markDeletedTraceRange(edit.start, edit.start + edit.deletedCount, now, delta, gap);
  }

  if (edit.insertedText) {
    insertTraceTextAt(edit.insertedText, edit.start, now, delta, edit.deletedCount ? 0 : gap);
  }

  lastTextareaValue = currentValue;
  pendingInputAction = null;
  state.lastAt = now;
  renderLiveTrace();
  renderHomeTrace();
}

function getTextareaEdit(previousValue, currentValue) {
  const pendingEdit = getPendingTextareaEdit(previousValue, currentValue);
  if (pendingEdit) return pendingEdit;

  let start = 0;
  while (
    start < previousValue.length &&
    start < currentValue.length &&
    previousValue[start] === currentValue[start]
  ) {
    start += 1;
  }

  let previousEnd = previousValue.length;
  let currentEnd = currentValue.length;
  while (
    previousEnd > start &&
    currentEnd > start &&
    previousValue[previousEnd - 1] === currentValue[currentEnd - 1]
  ) {
    previousEnd -= 1;
    currentEnd -= 1;
  }

  return {
    start,
    deletedCount: previousEnd - start,
    insertedText: currentValue.slice(start, currentEnd),
  };
}

function getPendingTextareaEdit(previousValue, currentValue) {
  if (!pendingInputAction || pendingInputAction.value !== previousValue) return null;

  const deleteStart = clamp(pendingInputAction.deleteStart, 0, previousValue.length);
  const deleteEnd = clamp(pendingInputAction.deleteEnd, deleteStart, previousValue.length);
  const deletedCount = deleteEnd - deleteStart;
  const insertedCount = currentValue.length - (previousValue.length - deletedCount);
  if (insertedCount < 0) return null;

  const insertedText = currentValue.slice(deleteStart, deleteStart + insertedCount);
  const expectedValue = `${previousValue.slice(0, deleteStart)}${insertedText}${previousValue.slice(deleteEnd)}`;
  if (expectedValue !== currentValue) return null;

  return {
    start: deleteStart,
    deletedCount,
    insertedText,
  };
}

function insertTraceTextAt(text, position, now, delta, gap) {
  const items = Array.from(text).map((character, index) => createTypedTraceItem(character, now, index === 0 ? delta : 0, index === 0 ? gap : 0));
  if (!items.length) return;
  state.activeTraceByPosition.splice(position, 0, ...items);
  state.traceItems.push(...items);
  state.events.push(...items);
}

function createTypedTraceItem(character, now, delta, gap) {
  const normalized = normaliseKey(character);
  const previous = state.lastTypedCharacter;
  const repeated = previous === normalized && normalized !== "space" && normalized !== "line-break";

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

  state.lastTypedCharacter = normalized;
  return item;
}

function markDeletedTraceRange(start, end, now, delta, gap) {
  const deleteStart = clamp(start, 0, state.activeTraceByPosition.length);
  const deleteEnd = clamp(end, deleteStart, state.activeTraceByPosition.length);
  if (deleteEnd <= deleteStart) return;

  const deletedItems = state.activeTraceByPosition.slice(deleteStart, deleteEnd);
  deletedItems.forEach((item, index) => {
    item.deleted = true;
    item.deletedAt = now;
    item.deletePauseGap = index === 0 ? gap : 0;
  });

  state.activeTraceByPosition.splice(deleteStart, deleteEnd - deleteStart);
  state.deletions += deletedItems.length;
  state.keyFrequency.set("backspace", (state.keyFrequency.get("backspace") || 0) + 1);
  state.events.push({
    action: "delete",
    character: "⌫",
    normalized: "backspace",
    at: now - state.startedAt,
    delta,
    pauseGap: gap,
    amplitude: currentAmplitude,
    deletedCount: deletedItems.length,
    createdAt: now,
  });

  const previousItem = state.activeTraceByPosition[deleteStart - 1];
  state.lastTypedCharacter = previousItem ? previousItem.normalized : "";
}

function updateCountAndButton() {
  characterCount.textContent = textarea.value.length.toString();
  resultCharacterCount.textContent = textarea.value.length.toString();
  leaveButton.disabled = frozen || state.traceItems.length === 0;
}

function holdTrace() {
  if (!state.traceItems.length) return;
  frozen = true;
  interactionMode = "after";
  textarea.disabled = true;
  leaveButton.textContent = "TRACE HELD";
  leaveButton.disabled = true;
  sourceText.textContent = "SOURCE SENTENCE WITHHELD / ACTION RECORDED / TRACE LEFT FOR THE NEXT VIEWER.";
  resultCharacterCount.textContent = state.events.length.toString();
  resultSoundStatus.textContent = soundStatus.textContent;
  persistCurrentTrace();
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

function getTraceLayoutSettings(traceItems, home = false) {
  const traceLength = traceItems.length;
  const compact = traceLength > 240;
  const dense = traceLength > 360;

  if (home) {
    return {
      compact,
      dense,
      lineHeight: dense ? 24 : compact ? 30 : 42,
      characterAdvance: dense ? 8 : compact ? 12 : 19,
      spaceAdvance: dense ? 12 : compact ? 16 : 26,
      pauseScale: dense ? 0.16 : compact ? 0.28 : 0.55,
      left: 42,
      top: 92,
      right: 42,
      bottom: 44,
      minHeight: HOME_TRACE_HEIGHT,
      width: HOME_TRACE_WIDTH,
    };
  }

  return {
    compact,
    dense,
    lineHeight: dense ? 32 : compact ? 38 : LINE_HEIGHT,
    characterAdvance: dense ? 12 : compact ? 15 : BASE_ADVANCE,
    spaceAdvance: dense ? 18 : compact ? 22 : SPACE_ADVANCE,
    pauseScale: dense ? 0.32 : compact ? 0.45 : 1,
    left: TRACE_LEFT,
    top: TRACE_TOP,
    right: TRACE_RIGHT,
    bottom: 76,
    minHeight: TRACE_HEIGHT,
    width: TRACE_WIDTH,
  };
}

function measureTraceHeight(traceItems, home = false) {
  if (!traceItems.length) return home ? HOME_TRACE_HEIGHT : TRACE_HEIGHT;

  const settings = getTraceLayoutSettings(traceItems, home);
  let x = settings.left;
  let y = settings.top;
  let maxY = y;
  const maxX = settings.width - settings.right;

  traceItems.forEach((item) => {
    const advance = item.normalized === "space" ? settings.spaceAdvance : settings.characterAdvance;
    const pauseLimit = home
      ? settings.dense ? 44 : settings.compact ? 72 : 122
      : settings.dense ? 74 : settings.compact ? 104 : 220;
    x += item.pauseGap ? Math.min(item.pauseGap * settings.pauseScale, pauseLimit) : 0;

    if (x > maxX - advance) {
      x = settings.left;
      y += settings.lineHeight;
    }

    if (item.normalized === "line-break") {
      x = settings.left;
      y += settings.lineHeight;
      maxY = Math.max(maxY, y);
      return;
    }

    if (item.normalized === "space") {
      x += settings.spaceAdvance;
      maxY = Math.max(maxY, y);
      return;
    }

    x += item.repeated ? settings.characterAdvance * 0.72 : advance;
    maxY = Math.max(maxY, y + (item.deleted ? 14 : 0));
  });

  return Math.ceil(Math.max(settings.minHeight, maxY + settings.bottom));
}

function renderLiveTrace() {
  tracePanelHeight = measureTraceHeight(state.traceItems, false);
  liveTrace.setAttribute("viewBox", `0 0 ${TRACE_WIDTH} ${tracePanelHeight}`);
  liveTrace.setAttribute("height", String(tracePanelHeight));
  liveTrace.replaceChildren();
  drawTraceBackground();
  drawTraceItems();
  drawSoundNeedles();
  drawPanelAnnotations();
  scheduleSettleRender();
}

function drawTraceBackground() {
  svgRect(0, 0, TRACE_WIDTH, tracePanelHeight, COLORS.panel, "none");
  for (let y = 34; y < tracePanelHeight - 34; y += 18) {
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
  const traceLength = state.traceItems.length;
  const compact = traceLength > 240;
  const dense = traceLength > 360;
  const lineHeight = dense ? 32 : compact ? 38 : LINE_HEIGHT;
  const baseAdvance = dense ? 12 : compact ? 15 : BASE_ADVANCE;
  const spaceAdvance = dense ? 18 : compact ? 22 : SPACE_ADVANCE;
  const pauseScale = dense ? 0.32 : compact ? 0.45 : 1;
  const baseFontSize = dense ? 19 : compact ? 24 : 36;
  const repeatedFontSize = dense ? 21 : compact ? 26 : 39;

  if (!state.traceItems.length) {
    svgText("type to disturb this field", TRACE_LEFT, 212, {
      size: 42,
      fill: COLORS.text,
      family: TRACE_FONT,
      opacity: 0.42,
    });
    return;
  }

  state.traceItems.forEach((item, index) => {
    const advance = item.normalized === "space" ? spaceAdvance : baseAdvance;
    const scaledPauseGap = item.pauseGap ? Math.min(item.pauseGap * pauseScale, dense ? 74 : compact ? 104 : 220) : 0;
    x += scaledPauseGap;

    if (x > maxX - advance) {
      x = TRACE_LEFT;
      y += lineHeight;
    }

    if (item.normalized === "line-break") {
      x = TRACE_LEFT;
      y += lineHeight;
      return;
    }

    if (item.pauseGap) {
      const markerX = Math.max(TRACE_LEFT, x - scaledPauseGap + 10);
      const markerWidth = Math.min(Math.max(scaledPauseGap - 16, 14), dense ? 60 : compact ? 90 : 190);
      svgRect(markerX, y - (dense ? 18 : 29), markerWidth, dense ? 22 : compact ? 28 : 34, "none", COLORS.text, { opacity: 0.18, dasharray: "4 8" });
      if (!dense) svgText("pause", markerX + 6, y - (compact ? 24 : 36), { size: 9, fill: COLORS.text, opacity: 0.48, family: UI_FONT, spacing: 1.2 });
    }

    if (item.normalized === "space") {
      x += spaceAdvance;
      return;
    }

    const active = !frozen && now - item.createdAt < ACTIVE_MS;
    const fill = item.deleted ? COLORS.deleted : item.repeated ? COLORS.repeated : active ? COLORS.active : COLORS.settled;
    const opacity = frozen
      ? item.deleted ? 0.58 : item.repeated ? 0.82 : 0.28
      : item.deleted ? 0.64 : item.repeated ? 0.98 : active ? 1 : 0.76;
    const fontSize = item.repeated ? repeatedFontSize : baseFontSize;
    const itemY = item.deleted ? y + (dense ? 7 : compact ? 9 : 12) : y;
    const itemX = item.repeated ? x - (dense ? 2 : compact ? 3 : 4) : x;

    if (item.repeated) {
      svgText(item.character, itemX + (dense ? 2 : 4), itemY + 1, { size: fontSize, fill: COLORS.active, family: TRACE_FONT, opacity: 0.42 });
      svgText(item.character, itemX + (dense ? 4 : 8), itemY + 2, { size: fontSize, fill: COLORS.repeated, family: TRACE_FONT, opacity: 0.28 });
    }

    svgText(item.character, itemX, itemY, { size: fontSize, fill, family: TRACE_FONT, opacity });

    if (item.deleted) {
      svgLine(itemX - 2, itemY - (dense ? 8 : 13), itemX + (dense ? 13 : 20), itemY - (dense ? 13 : 22), COLORS.text, { width: dense ? 1 : 1.6, opacity: 0.46 });
      if (!dense) svgLine(itemX + 2, itemY - 2, itemX + (compact ? 18 : 24), itemY - (compact ? 8 : 10), COLORS.text, { width: 1.2, opacity: 0.28 });
    }

    x += item.repeated ? baseAdvance * 0.72 : advance;
  });
}

function drawSoundNeedles() {
  if (microphoneState !== "enabled" || !state.soundPeaks.length) return;
  const duration = Math.max(1, state.lastAt - state.startedAt);
  const width = TRACE_WIDTH - TRACE_LEFT - TRACE_RIGHT;

  state.soundPeaks.slice(-70).forEach((peak) => {
    const x = TRACE_LEFT + (peak.at / duration) * width;
    const height = clamp(peak.amplitude * 260, 8, 44);
    svgLine(x, tracePanelHeight - 64, x, tracePanelHeight - 64 - height, COLORS.active, { width: 1.4, opacity: 0.42 });
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
  const traceItems = interactionMode === "arrival" ? previousTrace.traceItems : state.traceItems;
  const actionCount = interactionMode === "arrival" ? previousTrace.actionCount || traceItems.length : state.events.length;
  homeTracePanelHeight = measureTraceHeight(traceItems, true);
  homeLiveTrace.setAttribute("viewBox", `0 0 ${HOME_TRACE_WIDTH} ${homeTracePanelHeight}`);
  homeLiveTrace.setAttribute("height", String(homeTracePanelHeight));
  homeLiveTrace.replaceChildren();
  homeSvgRect(0, 0, HOME_TRACE_WIDTH, homeTracePanelHeight, COLORS.panel, "none");
  for (let y = 26; y < homeTracePanelHeight - 24; y += 16) {
    homeSvgLine(28, y, HOME_TRACE_WIDTH - 28, y, COLORS.rule, { width: 0.8, opacity: 0.52 });
  }
  homeSvgText(`${actionCount} actions / source sentence withheld`, HOME_TRACE_WIDTH - 340, 38, {
    size: 10,
    fill: COLORS.text,
    family: UI_FONT,
    opacity: 0.54,
    spacing: 1.1,
  });

  if (interactionMode === "arrival") {
    homeSvgText("pause gap", 44, 42, { size: 9, fill: COLORS.text, family: UI_FONT, opacity: 0.54, spacing: 1.1 });
    homeSvgText("deleted trace", 178, 42, { size: 9, fill: COLORS.text, family: UI_FONT, opacity: 0.54, spacing: 1.1 });
    homeSvgText("repeated action", 342, 42, { size: 9, fill: COLORS.text, family: UI_FONT, opacity: 0.54, spacing: 1.1 });
  }

  const now = performance.now();
  const traceLength = traceItems.length;
  const compact = traceLength > 240;
  const dense = traceLength > 360;
  const lineHeight = dense ? 24 : compact ? 30 : 42;
  const characterAdvance = dense ? 8 : compact ? 12 : 19;
  const spaceAdvance = dense ? 12 : compact ? 16 : 26;
  const pauseScale = dense ? 0.16 : compact ? 0.28 : 0.55;
  const baseSize = dense ? 14 : compact ? 20 : 27;
  const repeatedSize = dense ? 16 : compact ? 22 : 29;
  let x = 42;
  let y = 92;
  const maxX = HOME_TRACE_WIDTH - 42;

  if (!traceItems.length) {
    homeSvgText("trace forms here while typing", 42, 126, {
      size: 26,
      fill: COLORS.text,
      family: TRACE_FONT,
      opacity: 0.38,
    });
    return;
  }

  traceItems.forEach((item, index) => {
    const advance = item.normalized === "space" ? spaceAdvance : characterAdvance;
    const scaledPauseGap = item.pauseGap ? Math.min(item.pauseGap * pauseScale, dense ? 44 : compact ? 72 : 122) : 0;
    x += scaledPauseGap;

    if (x > maxX - advance) {
      x = 42;
      y += lineHeight;
    }

    if (item.normalized === "line-break") {
      x = 42;
      y += lineHeight;
      return;
    }

    if (item.pauseGap) {
      const gapWidth = Math.min(Math.max(scaledPauseGap - 12, dense ? 8 : 18), dense ? 38 : compact ? 58 : 104);
      homeSvgLine(Math.max(42, x - gapWidth), y - (dense ? 11 : 19), x - 8, y - (dense ? 11 : 19), COLORS.text, { width: 1, opacity: 0.24, dasharray: "3 7" });
    }

    if (item.normalized === "space") {
      x += advance;
      return;
    }

    const active = interactionMode === "typing" && !frozen && now - item.createdAt < ACTIVE_MS;
    const fill = item.deleted ? COLORS.deleted : item.repeated ? COLORS.repeated : active ? COLORS.active : COLORS.settled;
    const opacity = interactionMode === "arrival" || interactionMode === "after"
      ? item.deleted ? 0.56 : item.repeated ? 0.78 : 0.3
      : item.deleted ? 0.66 : item.repeated ? 0.96 : active ? 1 : 0.76;
    const size = item.repeated ? repeatedSize : baseSize;
    const itemY = item.deleted ? y + (dense ? 5 : 8) : y;
    const itemX = item.repeated ? x - (dense ? 2 : 3) : x;

    if (item.repeated) {
      homeSvgText(item.character, itemX + 4, itemY + 1, { size, fill: COLORS.active, family: TRACE_FONT, opacity: interactionMode === "typing" ? 0.35 : 0.18 });
      homeSvgText(item.character, itemX + 7, itemY + 1, { size, fill: COLORS.repeated, family: TRACE_FONT, opacity: interactionMode === "typing" ? 0.24 : 0.16 });
    }

    homeSvgText(item.character, itemX, itemY, { size, fill, family: TRACE_FONT, opacity });

    if (item.deleted) {
      homeSvgLine(itemX - 1, itemY - (dense ? 6 : 10), itemX + (dense ? 10 : 18), itemY - (dense ? 10 : 17), COLORS.text, { width: dense ? 1 : 1.2, opacity: 0.36 });
    }

    x += item.repeated ? characterAdvance * 0.72 : advance;
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


function getTraceSvgClone() {
  const clone = liveTrace.cloneNode(true);
  const viewBox = clone.getAttribute("viewBox") || `0 0 ${TRACE_WIDTH} ${TRACE_HEIGHT}`;
  const [, , viewBoxWidth = TRACE_WIDTH, viewBoxHeight = TRACE_HEIGHT] = viewBox.split(/\s+/).map(Number);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(viewBoxWidth));
  clone.setAttribute("height", String(viewBoxHeight));
  clone.setAttribute("viewBox", viewBox);
  clone.setAttribute("role", "img");
  clone.setAttribute("aria-label", "Aftertyping exported trace panel");

  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = "Aftertyping trace panel";
  clone.prepend(title);

  return clone;
}

function serializeTraceSvg() {
  const clone = getTraceSvgClone();
  const serialized = new XMLSerializer().serializeToString(clone);
  return serialized.startsWith("<?xml") ? serialized : `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadTraceSvg() {
  const source = serializeTraceSvg();
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, "aftertyping-trace.svg");
}

function downloadTracePng() {
  const source = serializeTraceSvg();
  const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  const viewBox = liveTrace.getAttribute("viewBox") || `0 0 ${TRACE_WIDTH} ${TRACE_HEIGHT}`;
  const [, , viewBoxWidth = TRACE_WIDTH, viewBoxHeight = TRACE_HEIGHT] = viewBox.split(/\s+/).map(Number);
  const scale = 2;

  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = viewBoxWidth * scale;
    canvas.height = viewBoxHeight * scale;
    const context = canvas.getContext("2d");
    context.fillStyle = COLORS.panel;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

    const link = document.createElement("a");
    link.download = `aftertyping-trace-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  image.onerror = () => {
    URL.revokeObjectURL(url);
  };

  image.src = url;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

textarea.addEventListener("beforeinput", recordInputIntent);
textarea.addEventListener("input", recordInputChange);
leaveButton.addEventListener("click", holdTrace);
respondButton.addEventListener("click", resetState);
typeAgainButton.addEventListener("click", resetState);
exportSvgButton.addEventListener("click", downloadTraceSvg);
exportPngButton.addEventListener("click", downloadTracePng);
micButton.addEventListener("click", enableMicrophone);

window.addEventListener("beforeunload", () => {
  if (soundFrame) cancelAnimationFrame(soundFrame);
  microphoneStream?.getTracks().forEach((track) => track.stop());
  audioContext?.close();
});

renderLiveTrace();
showArrivalTrace();
