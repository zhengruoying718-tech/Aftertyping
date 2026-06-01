const textarea = document.querySelector("#typing-surface");
const leaveButton = document.querySelector("#leave-trace");
const typeAgainButton = document.querySelector("#type-again");
const exportSvgButton = document.querySelector("#export-svg");
const exportPngButton = document.querySelector("#export-png");
const micButton = document.querySelector("#enable-mic");
const soundStatus = document.querySelector("#sound-status");
const characterCount = document.querySelector("#character-count");
const liveTrace = document.querySelector("#live-trace");
const soundScore = document.querySelector("#sound-score");
const textTracePanel = document.querySelector("#text-trace-panel");
const soundScorePanel = document.querySelector("#sound-score-panel");
const textTraceTab = document.querySelector("#text-trace-tab");
const soundScoreTab = document.querySelector("#sound-score-tab");
const leftNoteNumber = document.querySelector("#left-note-number");
const leftNoteText = document.querySelector("#left-note-text");
const rightNoteNumber = document.querySelector("#right-note-number");
const rightNoteText = document.querySelector("#right-note-text");
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
const SOUND_SCORE_WIDTH = 1120;
const SOUND_SCORE_MIN_HEIGHT = 430;
const TRACE_FONT = '"Stamp Typo Regular", "Courier New", monospace';
const UI_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const RESULT_NOTES = {
  text: {
    leftNumber: "00 / AFTER",
    leftText: "The sentence is no longer the main object. What remains is the pressure, correction, and rhythm of the action.",
    rightNumber: "03 / RULES",
    rightText: "Deleted letters remain as faint interruptions. Repetition thickens. Pauses open measured distances in the line.",
  },
  sound: {
    leftNumber: "00 / SOUND",
    leftText: "Keyboard sound is translated into a behavioural score. What remains is not language, but rhythm, hesitation, revision, fluency, and structural change.",
    rightNumber: "03 / SOUND RULES",
    rightText: "Blue marks record input. Yellow bars record thinking pauses. Orange-red bars record revision. Green diamonds record fluent bursts. Purple marks record structural shifts.",
  },
};

textarea.maxLength = MAX_CHARACTERS;

const SOUND_SCORE_COLORS = {
  background: "#F6F1E8",
  guide: "#D8D1C7",
  label: "#151515",
  secondary: "#6E675F",
  input: "#2F8CFF",
  thinking: "#F2D35E",
  revision: "#F4633A",
  flow: "#17C6A3",
  shift: "#8A63D2",
};

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
let currentResultView = "text";

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
    soundScoreActions: [],
    pendingRevisionShift: false,
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
  setResultView("text");
  soundScore.replaceChildren();
  soundScore.setAttribute("viewBox", `0 0 ${SOUND_SCORE_WIDTH} ${SOUND_SCORE_MIN_HEIGHT}`);
  soundScore.setAttribute("height", String(SOUND_SCORE_MIN_HEIGHT));
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

  recordSoundScoreEdit(edit, now, delta);

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

function recordSoundScoreEdit(edit, now, delta) {
  const at = now - state.startedAt;
  const amplitude = getNearbyAmplitude(at);

  if (delta > 800) {
    state.soundScoreActions.push({
      type: "thinking",
      timestamp: at,
      duration: delta,
      amplitude,
      source: "pause",
    });
  }

  if (edit.deletedCount) {
    state.soundScoreActions.push({
      type: "revision",
      timestamp: at,
      duration: Math.max(1, edit.deletedCount),
      amplitude,
      source: "deletion",
    });

    const recentDeletionCount = state.soundScoreActions
      .filter((action) => action.type === "revision" && at - action.timestamp <= 1500)
      .reduce((total, action) => total + (action.duration || 1), 0);
    if (recentDeletionCount >= 5) state.pendingRevisionShift = true;
  }

  if (!edit.insertedText) return;

  if (delta > 2500) {
    state.soundScoreActions.push({
      type: "shift",
      timestamp: at,
      duration: delta,
      amplitude,
      source: "pause",
    });
  }

  if (state.pendingRevisionShift) {
    state.soundScoreActions.push({
      type: "shift",
      timestamp: at,
      duration: 0,
      amplitude,
      source: "revision",
    });
    state.pendingRevisionShift = false;
  }

  Array.from(edit.insertedText).forEach((character, index) => {
    const timestamp = at + index * 6;
    if (character === "\n") {
      state.soundScoreActions.push({
        type: "shift",
        timestamp,
        duration: 0,
        amplitude,
        source: "enter",
      });
      return;
    }

    state.soundScoreActions.push({
      type: "input",
      timestamp,
      duration: 0,
      amplitude,
      interval: index === 0 ? delta : 120 + ((index % 5) * 18),
      source: "keydown",
    });
  });
}

function getNearbyAmplitude(at) {
  const nearby = state.soundPeaks
    .filter((peak) => Math.abs(peak.at - at) <= 120)
    .reduce((strongest, peak) => Math.max(strongest, peak.amplitude || 0), 0);
  return nearby || currentAmplitude || 0.12;
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
  renderSoundScore();
  setResultView("text");
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
  if (home) {
    return {
      compact: false,
      dense: false,
      lineHeight: 42,
      characterAdvance: 19,
      spaceAdvance: 26,
      pauseScale: 0.55,
      left: 42,
      top: 92,
      right: 42,
      bottom: 44,
      minHeight: HOME_TRACE_HEIGHT,
      width: HOME_TRACE_WIDTH,
    };
  }

  return {
    compact: false,
    dense: false,
    lineHeight: LINE_HEIGHT,
    characterAdvance: BASE_ADVANCE,
    spaceAdvance: SPACE_ADVANCE,
    pauseScale: 1,
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
    const pauseLimit = home ? 122 : 220;
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
  const settings = getTraceLayoutSettings(state.traceItems, false);
  let x = TRACE_LEFT;
  let y = TRACE_TOP;
  const maxX = TRACE_WIDTH - TRACE_RIGHT;
  const lineHeight = settings.lineHeight;
  const baseAdvance = settings.characterAdvance;
  const spaceAdvance = settings.spaceAdvance;
  const pauseScale = settings.pauseScale;
  const baseFontSize = 36;
  const repeatedFontSize = 39;
  let deletedRun = null;

  if (!state.traceItems.length) {
    svgText("type to disturb this field", TRACE_LEFT, 212, {
      size: 42,
      fill: COLORS.text,
      family: TRACE_FONT,
      opacity: 0.42,
    });
    return;
  }

  const flushDeletedRun = () => {
    if (!deletedRun) return;
    svgLine(deletedRun.x1, deletedRun.y, deletedRun.x2, deletedRun.y, COLORS.deleted, { width: 1.4, opacity: 0.56 });
    deletedRun = null;
  };

  const extendDeletedRun = (x1, x2, lineY) => {
    const strikeY = lineY - 12;
    if (!deletedRun || Math.abs(deletedRun.y - strikeY) > 1 || x1 < deletedRun.x1) {
      flushDeletedRun();
      deletedRun = { x1, x2, y: strikeY };
      return;
    }

    deletedRun.x2 = Math.max(deletedRun.x2, x2);
  };

  state.traceItems.forEach((item) => {
    const advance = item.normalized === "space" ? spaceAdvance : baseAdvance;
    const scaledPauseGap = item.pauseGap ? Math.min(item.pauseGap * pauseScale, 220) : 0;

    if (scaledPauseGap && deletedRun) flushDeletedRun();
    x += scaledPauseGap;

    if (x > maxX - advance) {
      flushDeletedRun();
      x = TRACE_LEFT;
      y += lineHeight;
    }

    if (item.normalized === "line-break") {
      flushDeletedRun();
      x = TRACE_LEFT;
      y += lineHeight;
      return;
    }

    if (item.pauseGap) {
      const markerX = Math.max(TRACE_LEFT, x - scaledPauseGap + 10);
      const markerWidth = Math.min(Math.max(scaledPauseGap - 16, 14), 190);
      svgRect(markerX, y - 29, markerWidth, 34, "none", COLORS.text, { opacity: 0.18, dasharray: "4 8" });
      svgText("pause", markerX + 6, y - 36, { size: 9, fill: COLORS.text, opacity: 0.48, family: UI_FONT, spacing: 1.2 });
    }

    if (item.normalized === "space") {
      if (item.deleted && deletedRun) deletedRun.x2 = Math.max(deletedRun.x2, x + spaceAdvance);
      if (!item.deleted) flushDeletedRun();
      x += spaceAdvance;
      return;
    }

    const active = !frozen && now - item.createdAt < ACTIVE_MS;
    const fill = item.deleted ? COLORS.deleted : item.repeated ? COLORS.repeated : active ? COLORS.active : COLORS.settled;
    const opacity = frozen
      ? item.deleted ? 0.58 : item.repeated ? 0.82 : 0.28
      : item.deleted ? 0.64 : item.repeated ? 0.98 : active ? 1 : 0.76;
    const fontSize = item.repeated ? repeatedFontSize : baseFontSize;
    const itemY = item.deleted ? y + 12 : y;
    const itemX = item.repeated ? x - 4 : x;

    if (item.repeated) {
      svgText(item.character, itemX + 4, itemY + 1, { size: fontSize, fill: COLORS.active, family: TRACE_FONT, opacity: 0.42 });
      svgText(item.character, itemX + 8, itemY + 2, { size: fontSize, fill: COLORS.repeated, family: TRACE_FONT, opacity: 0.28 });
    }

    svgText(item.character, itemX, itemY, { size: fontSize, fill, family: TRACE_FONT, opacity });

    if (item.deleted) {
      extendDeletedRun(itemX - 2, itemX + 24, itemY);
    } else {
      flushDeletedRun();
    }

    x += item.repeated ? baseAdvance * 0.72 : advance;
  });

  flushDeletedRun();
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
  const settings = getTraceLayoutSettings(traceItems, true);
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
  const lineHeight = settings.lineHeight;
  const characterAdvance = settings.characterAdvance;
  const spaceAdvance = settings.spaceAdvance;
  const pauseScale = settings.pauseScale;
  const baseSize = 27;
  const repeatedSize = 29;
  let x = 42;
  let y = 92;
  const maxX = HOME_TRACE_WIDTH - 42;
  let deletedRun = null;

  if (!traceItems.length) {
    homeSvgText("trace forms here while typing", 42, 126, {
      size: 26,
      fill: COLORS.text,
      family: TRACE_FONT,
      opacity: 0.38,
    });
    return;
  }

  const flushDeletedRun = () => {
    if (!deletedRun) return;
    homeSvgLine(deletedRun.x1, deletedRun.y, deletedRun.x2, deletedRun.y, COLORS.deleted, { width: 1.1, opacity: 0.52 });
    deletedRun = null;
  };

  const extendDeletedRun = (x1, x2, lineY) => {
    const strikeY = lineY - 9;
    if (!deletedRun || Math.abs(deletedRun.y - strikeY) > 1 || x1 < deletedRun.x1) {
      flushDeletedRun();
      deletedRun = { x1, x2, y: strikeY };
      return;
    }

    deletedRun.x2 = Math.max(deletedRun.x2, x2);
  };

  traceItems.forEach((item) => {
    const advance = item.normalized === "space" ? spaceAdvance : characterAdvance;
    const scaledPauseGap = item.pauseGap ? Math.min(item.pauseGap * pauseScale, 122) : 0;

    if (scaledPauseGap && deletedRun) flushDeletedRun();
    x += scaledPauseGap;

    if (x > maxX - advance) {
      flushDeletedRun();
      x = 42;
      y += lineHeight;
    }

    if (item.normalized === "line-break") {
      flushDeletedRun();
      x = 42;
      y += lineHeight;
      return;
    }

    if (item.pauseGap) {
      const gapWidth = Math.min(Math.max(scaledPauseGap - 12, 18), 104);
      homeSvgLine(Math.max(42, x - gapWidth), y - 19, x - 8, y - 19, COLORS.text, { width: 1, opacity: 0.24, dasharray: "3 7" });
    }

    if (item.normalized === "space") {
      if (item.deleted && deletedRun) deletedRun.x2 = Math.max(deletedRun.x2, x + spaceAdvance);
      if (!item.deleted) flushDeletedRun();
      x += advance;
      return;
    }

    const active = interactionMode === "typing" && !frozen && now - item.createdAt < ACTIVE_MS;
    const fill = item.deleted ? COLORS.deleted : item.repeated ? COLORS.repeated : active ? COLORS.active : COLORS.settled;
    const opacity = interactionMode === "arrival" || interactionMode === "after"
      ? item.deleted ? 0.56 : item.repeated ? 0.78 : 0.3
      : item.deleted ? 0.66 : item.repeated ? 0.96 : active ? 1 : 0.76;
    const size = item.repeated ? repeatedSize : baseSize;
    const itemY = item.deleted ? y + 8 : y;
    const itemX = item.repeated ? x - 3 : x;

    if (item.repeated) {
      homeSvgText(item.character, itemX + 4, itemY + 1, { size, fill: COLORS.active, family: TRACE_FONT, opacity: interactionMode === "typing" ? 0.35 : 0.18 });
      homeSvgText(item.character, itemX + 7, itemY + 1, { size, fill: COLORS.repeated, family: TRACE_FONT, opacity: interactionMode === "typing" ? 0.24 : 0.16 });
    }

    homeSvgText(item.character, itemX, itemY, { size, fill, family: TRACE_FONT, opacity });

    if (item.deleted) {
      extendDeletedRun(itemX - 1, itemX + 19, itemY);
    } else {
      flushDeletedRun();
    }

    x += item.repeated ? characterAdvance * 0.72 : advance;
  });

  flushDeletedRun();
}

function setResultView(view) {
  const showSound = view === "sound";
  textTracePanel.hidden = showSound;
  soundScorePanel.hidden = !showSound;
  textTraceTab.classList.toggle("is-selected", !showSound);
  soundScoreTab.classList.toggle("is-selected", showSound);
  textTraceTab.setAttribute("aria-selected", String(!showSound));
  soundScoreTab.setAttribute("aria-selected", String(showSound));
  resultStage.classList.toggle("is-sound-score", showSound);
  currentResultView = showSound ? "sound" : "text";

  const notes = showSound ? RESULT_NOTES.sound : RESULT_NOTES.text;
  leftNoteNumber.textContent = notes.leftNumber;
  leftNoteText.textContent = notes.leftText;
  rightNoteNumber.textContent = notes.rightNumber;
  rightNoteText.textContent = notes.rightText;
}

function renderSoundScore() {
  const marks = layoutSoundScoreMarks(buildSoundScoreMarks());
  const scoreHeight = Math.max(SOUND_SCORE_MIN_HEIGHT, marks.notationBottom + 28);
  soundScore.setAttribute("viewBox", `0 0 ${SOUND_SCORE_WIDTH} ${scoreHeight}`);
  soundScore.setAttribute("height", String(scoreHeight));
  soundScore.replaceChildren();

  soundSvgRect(0, 0, SOUND_SCORE_WIDTH, scoreHeight, SOUND_SCORE_COLORS.background, "none");
  for (let y = 74; y < scoreHeight - 28; y += 12) {
    soundSvgLine(44, y, SOUND_SCORE_WIDTH - 44, y, SOUND_SCORE_COLORS.guide, { width: 0.65, opacity: 0.4 });
  }

  soundSvgText("02 / KEYBOARD SOUND SCORE", 58, 48, {
    size: 13,
    fill: SOUND_SCORE_COLORS.label,
    family: UI_FONT,
    weight: 700,
    spacing: 1.4,
  });

  drawSoundScoreLegend();

  if (!marks.items.length) {
    soundSvgText("no keyboard actions recorded", 58, 132, {
      size: 12,
      fill: SOUND_SCORE_COLORS.secondary,
      family: UI_FONT,
      spacing: 1.1,
    });
  } else {
    marks.items.forEach((mark) => drawSoundScoreMark(mark));
  }
}

function buildSoundScoreMarks() {
  const baseActions = state.soundScoreActions
    .filter((action) => ["input", "thinking", "revision", "shift"].includes(action.type))
    .map((action) => ({ ...action }));
  const flowMarks = buildFlowMarks(baseActions);
  const grouped = groupRevisionMarks([...baseActions, ...flowMarks]);
  return grouped.sort((a, b) => a.timestamp - b.timestamp || categoryOrder(a.type) - categoryOrder(b.type));
}

function buildFlowMarks(actions) {
  const flowMarks = [];
  let burst = [];

  const flushBurst = () => {
    if (burst.length >= 6) {
      const intervals = burst.slice(1).map((action, index) => action.timestamp - burst[index].timestamp);
      const average = intervals.reduce((total, value) => total + value, 0) / intervals.length;
      if (average < 220) {
        const middle = burst[Math.floor(burst.length / 2)];
        flowMarks.push({
          type: "flow",
          timestamp: middle.timestamp,
          duration: burst[burst.length - 1].timestamp - burst[0].timestamp,
          amplitude: middle.amplitude || 0.12,
          source: "burst",
          count: burst.length,
        });
      }
    }
    burst = [];
  };

  actions.sort((a, b) => a.timestamp - b.timestamp).forEach((action) => {
    if (action.type !== "input") {
      flushBurst();
      return;
    }

    if (burst.length && action.timestamp - burst[burst.length - 1].timestamp >= 320) flushBurst();
    burst.push(action);
  });

  flushBurst();
  return flowMarks;
}

function groupRevisionMarks(actions) {
  const grouped = [];
  const revisions = actions.filter((action) => action.type === "revision").sort((a, b) => a.timestamp - b.timestamp);
  const consumedRevisions = new Set();

  revisions.forEach((action, index) => {
    if (consumedRevisions.has(index)) return;
    let groupEnd = action.timestamp;
    let count = action.duration || 1;
    let amplitude = action.amplitude || 0.12;
    consumedRevisions.add(index);

    revisions.slice(index + 1).forEach((nextAction, offset) => {
      const nextIndex = index + 1 + offset;
      if (!consumedRevisions.has(nextIndex) && nextAction.timestamp - groupEnd <= 450) {
        consumedRevisions.add(nextIndex);
        groupEnd = nextAction.timestamp;
        count += nextAction.duration || 1;
        amplitude = Math.max(amplitude, nextAction.amplitude || 0.12);
      }
    });

    grouped.push({
      ...action,
      duration: count,
      amplitude,
    });
  });

  actions.forEach((action) => {
    if (action.type !== "revision") grouped.push(action);
  });

  return grouped;
}

function layoutSoundScoreMarks(actions) {
  const items = [];
  const left = 58;
  const right = SOUND_SCORE_WIDTH - 58;
  const rowHeight = 38;
  let x = left;
  let y = 116;
  let previousAt = 0;

  actions.forEach((action) => {
    const gap = clamp((action.timestamp - previousAt) / 32, 7, 70);
    const size = getSoundScoreMarkSize(action);
    if (x + gap + size.width > right) {
      x = left;
      y += rowHeight;
    } else {
      x += gap;
    }

    items.push({ ...action, ...size, x, y });
    x += size.width;
    previousAt = action.timestamp;
  });

  return { items, notationBottom: y + rowHeight };
}

function getSoundScoreMarkSize(action) {
  if (action.type === "thinking") {
    return { width: action.duration >= 2500 ? 66 : action.duration >= 1500 ? 44 : 22, height: 3 };
  }

  if (action.type === "revision") {
    const count = action.duration || 1;
    return { width: count >= 5 ? 48 : count >= 2 ? 28 : 14, height: 5 };
  }

  if (action.type === "flow") {
    const count = action.count || 6;
    const size = count >= 15 ? 15 : count >= 9 ? 12 : 9;
    return { width: size, height: size };
  }

  if (action.type === "shift") {
    const height = action.source === "pause" ? 24 : action.source === "revision" ? 22 : 18;
    return { width: 8, height };
  }

  return {
    width: 3,
    height: getInputMarkHeight(action),
  };
}

function getInputMarkHeight(action) {
  const amplitude = action.amplitude || 0;
  if (amplitude > 0.025) return clamp(5 + amplitude * 70, 5, 16);

  const interval = action.interval || 180;
  const intervalVariation = clamp((260 - interval) / 28, -3, 5);
  const timestampVariation = ((Math.floor((action.timestamp || 0) / 37) % 5) - 2) * 0.9;
  return clamp(10 + intervalVariation + timestampVariation, 5, 16);
}

function drawSoundScoreLegend() {
  const legend = [
    ["INPUT", SOUND_SCORE_COLORS.input],
    ["THINKING", SOUND_SCORE_COLORS.thinking],
    ["REVISION", SOUND_SCORE_COLORS.revision],
    ["FLOW", SOUND_SCORE_COLORS.flow],
    ["SHIFT", SOUND_SCORE_COLORS.shift],
  ];
  let x = SOUND_SCORE_WIDTH - 360;

  legend.forEach(([label, color]) => {
    soundSvgRect(x, 39, 5, 5, color, "none", { opacity: 0.74 });
    soundSvgText(label, x + 10, 44, {
      size: 7,
      fill: SOUND_SCORE_COLORS.secondary,
      family: UI_FONT,
      spacing: 1.15,
      opacity: 0.84,
    });
    x += label === "THINKING" || label === "REVISION" ? 80 : 58;
  });
}

function drawSoundScoreMark(mark) {
  if (mark.type === "input") {
    const opacity = clamp(0.54 + (mark.amplitude || 0.12) * 2.4, 0.58, 0.92);
    soundSvgRect(mark.x, mark.y - mark.height / 2, mark.width, mark.height, SOUND_SCORE_COLORS.input, "none", { opacity });
    return;
  }

  if (mark.type === "thinking") {
    soundSvgRect(mark.x, mark.y - 1.5, mark.width, mark.height, SOUND_SCORE_COLORS.thinking, "none", { opacity: 0.86 });
    return;
  }

  if (mark.type === "revision") {
    soundSvgRect(mark.x, mark.y - 2.5, mark.width, mark.height, SOUND_SCORE_COLORS.revision, "none", { opacity: 0.9 });
    return;
  }

  if (mark.type === "flow") {
    const cx = mark.x + mark.width / 2;
    const cy = mark.y;
    const half = mark.height / 2;
    soundSvgPolygon(`${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}`, SOUND_SCORE_COLORS.flow, { opacity: 0.88 });
    return;
  }

  if (mark.type === "shift") {
    const cx = mark.x + mark.width / 2;
    const halfWidth = mark.width / 2;
    const halfHeight = mark.height / 2;
    soundSvgPolygon(`${cx},${mark.y - halfHeight} ${cx + halfWidth},${mark.y} ${cx},${mark.y + halfHeight} ${cx - halfWidth},${mark.y}`, SOUND_SCORE_COLORS.shift, { opacity: 0.88 });
  }
}

function categoryOrder(type) {
  return ["thinking", "revision", "input", "flow", "shift"].indexOf(type);
}

function soundSvgEl(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  });
  soundScore.appendChild(node);
  return node;
}

function soundSvgRect(x, y, width, height, fill = "none", stroke = "none", options = {}) {
  return soundSvgEl("rect", {
    x,
    y,
    width,
    height,
    fill,
    stroke,
    opacity: options.opacity,
  });
}

function soundSvgLine(x1, y1, x2, y2, stroke, options = {}) {
  return soundSvgEl("line", {
    x1,
    y1,
    x2,
    y2,
    stroke,
    "stroke-width": options.width || 1,
    opacity: options.opacity,
  });
}

function soundSvgPolygon(points, fill, options = {}) {
  return soundSvgEl("polygon", {
    points,
    fill,
    opacity: options.opacity,
  });
}

function soundSvgText(content, x, y, options = {}) {
  const node = soundSvgEl("text", {
    x,
    y,
    fill: options.fill || SOUND_SCORE_COLORS.label,
    opacity: options.opacity,
    "font-family": options.family || UI_FONT,
    "font-size": options.size || 12,
    "font-weight": options.weight || 400,
    "letter-spacing": options.spacing,
  });
  node.textContent = content;
  return node;
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


function getCurrentExportTarget() {
  const isSound = currentResultView === "sound";
  const selector = isSound ? "#sound-score" : "#live-trace";
  const svg = document.querySelector(selector);
  const label = isSound ? "Sound Score" : "Text Trace";
  const slug = isSound ? "sound-score" : "text-trace";
  const background = isSound ? SOUND_SCORE_COLORS.background : COLORS.panel;

  if (!svg) {
    console.error(`Export target missing for ${label}.`, { currentResultView, selector });
    window.alert("Export failed. Please try again.");
    return null;
  }

  return { svg, label, slug, background, selector };
}

function getExportSvgClone() {
  const target = getCurrentExportTarget();
  if (!target) return null;

  const clone = target.svg.cloneNode(true);
  const fallbackViewBox = target.svg === soundScore
    ? `0 0 ${SOUND_SCORE_WIDTH} ${SOUND_SCORE_MIN_HEIGHT}`
    : `0 0 ${TRACE_WIDTH} ${TRACE_HEIGHT}`;
  const viewBox = clone.getAttribute("viewBox") || fallbackViewBox;
  const [, , viewBoxWidth, viewBoxHeight] = viewBox.split(/\s+/).map(Number);

  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(viewBoxWidth));
  clone.setAttribute("height", String(viewBoxHeight));
  clone.setAttribute("viewBox", viewBox);
  clone.setAttribute("role", "img");
  clone.setAttribute("aria-label", `Aftertyping exported ${target.label}`);

  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = `Aftertyping ${target.label}`;
  clone.prepend(title);

  return { clone, target, viewBoxWidth, viewBoxHeight };
}

function serializeSelectedSvg() {
  const exportData = getExportSvgClone();
  if (!exportData) return null;

  const serialized = new XMLSerializer().serializeToString(exportData.clone);
  const source = serialized.startsWith("<?xml") ? serialized : `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
  return { ...exportData, source };
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
  const exportData = serializeSelectedSvg();
  if (!exportData) return;

  const blob = new Blob([exportData.source], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, `aftertyping-${exportData.target.slug}.svg`);
}

function downloadTracePng() {
  const exportData = serializeSelectedSvg();
  if (!exportData) return;

  const svgBlob = new Blob([exportData.source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  const scale = 2;

  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = exportData.viewBoxWidth * scale;
    canvas.height = exportData.viewBoxHeight * scale;
    const context = canvas.getContext("2d");
    context.fillStyle = exportData.target.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

    const link = document.createElement("a");
    link.download = `aftertyping-${exportData.target.slug}.png`;
    link.href = canvas.toDataURL("image/png");
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  image.onerror = () => {
    console.error(`Export failed while rendering ${exportData.target.label} PNG.`);
    window.alert("Export failed. Please try again.");
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
textTraceTab.addEventListener("click", () => setResultView("text"));
soundScoreTab.addEventListener("click", () => setResultView("sound"));
micButton.addEventListener("click", enableMicrophone);

window.addEventListener("beforeunload", () => {
  if (soundFrame) cancelAnimationFrame(soundFrame);
  microphoneStream?.getTracks().forEach((track) => track.stop());
  audioContext?.close();
});

renderLiveTrace();
showArrivalTrace();
