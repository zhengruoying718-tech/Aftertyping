const textarea = document.querySelector("#typing-surface");
const leaveButton = document.querySelector("#leave-trace");
const typeAgainButton = document.querySelector("#type-again");
const exportButton = document.querySelector("#export-png");
const characterCount = document.querySelector("#character-count");
const inputStage = document.querySelector("#input-stage");
const outputStage = document.querySelector("#output-stage");
const sheet = document.querySelector("#trace-sheet");

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 1190;
const HEIGHT = 1684;
const CHARCOAL = "#171615";
const MUTED = "#6e6a62";
const LINE = "#d9d4ca";
const PAPER = "#fbfaf6";
const MINT = "#eaf5ee";
const VIOLET = "#b5a1cf";
const ORANGE = "#ef6b3f";
const RED = "#d72424";

const state = createEmptyState();

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
  };
}

function resetState() {
  const fresh = createEmptyState();
  Object.assign(state, fresh);
}

function isPrintableKey(event) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
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

  if (printable) {
    const normalized = event.key.toLowerCase();
    state.keyFrequency.set(normalized, (state.keyFrequency.get(normalized) || 0) + 1);
    if (normalized === state.lastPrintable) {
      state.repeated.set(normalized, (state.repeated.get(normalized) || 0) + 1);
    }
    state.lastPrintable = normalized;
  }

  if (isDeletion) {
    state.deletions += 1;
    state.lastPrintable = "";
  }

  state.events.push({
    key,
    action,
    at: now - state.startedAt,
    delta,
    valueLength: textarea.value.length,
  });
  state.lastAt = now;
}

textarea.addEventListener("keydown", recordKey);
textarea.addEventListener("input", () => {
  const length = textarea.value.trim().length;
  characterCount.textContent = textarea.value.length.toString();
  leaveButton.disabled = length === 0 || state.events.length === 0;
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

function renderTraceSheet(trace) {
  sheet.replaceChildren();
  addDefs();
  rect(0, 0, WIDTH, HEIGHT, PAPER, "none");
  drawHeader(trace);
  drawFrequency(trace, 78, 315, 492, 420);
  drawRhythm(trace, 620, 315, 492, 420);
  drawKerning(trace, 78, 820, 492, 515);
  drawGhost(trace, 620, 820, 492, 515);
  drawMetadata(trace, 78, 1452, 1034, 112);
}

function addDefs() {
  const defs = el("defs");
  const blur = el("filter", { id: "soft-blur", x: "-30%", y: "-30%", width: "160%", height: "160%" });
  blur.appendChild(el("feGaussianBlur", { stdDeviation: "18" }));
  defs.appendChild(blur);

  const ghostBlur = el("filter", { id: "ghost-blur", x: "-20%", y: "-20%", width: "140%", height: "140%" });
  ghostBlur.appendChild(el("feGaussianBlur", { stdDeviation: "2.6" }));
  defs.appendChild(ghostBlur);

  const grain = el("filter", { id: "paper-grain", x: "0", y: "0", width: "100%", height: "100%" });
  grain.appendChild(el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.85", numOctaves: "2", stitchTiles: "stitch", result: "noise" }));
  grain.appendChild(el("feColorMatrix", { type: "saturate", values: "0" }));
  grain.appendChild(el("feComponentTransfer", { result: "grain" }));
  defs.appendChild(grain);
  sheet.appendChild(defs);
}

function drawHeader(trace) {
  text("Aftertyping", 78, 116, {
    family: "Georgia, Times New Roman, serif",
    size: 74,
    weight: 400,
    spacing: -4,
  });
  text("A residual notation of a typing action. The sentence is withheld; the shared surface keeps only pressure, rhythm, correction, and afterimage.", 80, 172, {
    size: 18,
    fill: MUTED,
  });
  text(trace.id, 1014, 110, { size: 14, spacing: 2.4, fill: MUTED });
  line(78, 228, 1112, 228, LINE);
}

function drawModuleFrame(title, subtitle, x, y, w, h, number) {
  text(number.padStart(2, "0"), x, y - 28, { size: 12, fill: MUTED, spacing: 2.2 });
  text(title, x + 44, y - 30, { size: 20, family: "Georgia, Times New Roman, serif" });
  text(subtitle, x + 44, y - 8, { size: 11, fill: MUTED, spacing: 1.4 });
  rect(x, y, w, h, "transparent", LINE);
}

function drawFrequency(trace, x, y, w, h) {
  drawModuleFrame("Frequency Residue", "density field from repeated keys", x, y, w, h, "1");
  const field = el("g");
  field.setAttribute("filter", "url(#soft-blur)");
  sheet.appendChild(field);
  rect(x + 22, y + 24, w - 44, h - 74, MINT, "none", { opacity: 0.45, parent: field });

  const max = Math.max(1, ...trace.frequency.map(([, count]) => count));
  const centerX = x + w / 2;
  const centerY = y + h / 2 - 18;
  trace.frequency.slice(0, 22).forEach(([character, count], index) => {
    const angle = index * 2.399 + count * 0.21;
    const radius = 18 + index * 10.5;
    const intensity = count / max;
    const cx = clamp(centerX + Math.cos(angle) * radius + pseudo(character, 42), x + 58, x + w - 58);
    const cy = clamp(centerY + Math.sin(angle) * radius + pseudo(character, 31), y + 58, y + h - 104);
    const color = intensity > 0.72 ? RED : intensity > 0.38 ? ORANGE : VIOLET;
    circle(cx, cy, 28 + intensity * 64, color, { opacity: 0.16 + intensity * 0.28, parent: field });
  });

  trace.frequency.slice(0, 14).forEach(([character, count], index) => {
    const col = index % 7;
    const row = Math.floor(index / 7);
    const labelX = x + 34 + col * 62;
    const labelY = y + h - 44 + row * 19;
    text(character === " " ? "space" : character, labelX, labelY, { size: 12, fill: MUTED, opacity: 0.74 });
    text(String(count), labelX + 34, labelY, { size: 12, fill: CHARCOAL, opacity: 0.58 });
  });
}

function drawRhythm(trace, x, y, w, h) {
  drawModuleFrame("Rhythm Trace", "bursts, pauses, and corrections across time", x, y, w, h, "2");
  const left = x + 42;
  const right = x + w - 42;
  const baseline = y + h / 2;
  const usable = right - left;

  for (let i = 0; i <= 6; i += 1) {
    const gx = left + (usable / 6) * i;
    line(gx, y + 54, gx, y + h - 60, LINE, { opacity: i === 0 || i === 6 ? 0.75 : 0.34 });
    text(`${i}`, gx - 3, y + h - 32, { size: 10, fill: MUTED, opacity: 0.62 });
  }
  line(left, baseline, right, baseline, CHARCOAL, { opacity: 0.34 });

  const duration = Math.max(1, trace.duration);
  trace.events.forEach((event, index) => {
    const eventX = left + (event.at / duration) * usable;
    const fast = event.delta && event.delta < 150;
    const height = event.action === "delete" ? 54 : fast ? 74 : 38;
    const color = event.action === "delete" ? CHARCOAL : fast ? RED : event.delta > 650 ? VIOLET : ORANGE;
    if (event.action === "delete") {
      line(eventX - 8, baseline - height / 2, eventX + 8, baseline + height / 2, color, { width: 1.2, opacity: 0.72 });
      line(eventX + 8, baseline - height / 2, eventX - 8, baseline + height / 2, color, { width: 1.2, opacity: 0.72 });
    } else {
      line(eventX, baseline - height / 2, eventX, baseline + height / 2, color, { width: fast ? 1.7 : 1, opacity: 0.35 + Math.min(0.4, index / Math.max(1, trace.events.length)) });
      circle(eventX, baseline + Math.sin(index) * 38, fast ? 3.2 : 2.1, color, { opacity: 0.42 });
    }
  });

  trace.pauses.forEach((pause) => {
    const px = left + (pause.at / duration) * usable;
    const gap = clamp(pause.duration / duration * usable, 10, 76);
    rect(px - gap, y + 72, gap, h - 158, PAPER, "none", { opacity: 0.86 });
    line(px, y + 72, px, y + h - 86, VIOLET, { width: 1, opacity: 0.58, dasharray: "4 8" });
  });

  text("compressed marks indicate fast bursts; open intervals indicate silence", left, y + h - 72, { size: 12, fill: MUTED });
}

function drawKerning(trace, x, y, w, h) {
  drawModuleFrame("Kerning Clump", "spacing altered by speed, repetition, pause, and erasure", x, y, w, h, "3");
  const group = el("g");
  sheet.appendChild(group);
  const chars = trace.text.replace(/\s+/g, " ").slice(0, 95).split("");
  let cursorX = x + 45;
  let cursorY = y + 105;
  let eventIndex = 0;
  chars.forEach((character, index) => {
    const event = trace.printableEvents[eventIndex] || { delta: 220 };
    eventIndex += character === " " ? 0 : 1;
    const repeated = character.toLowerCase() === chars[index - 1]?.toLowerCase();
    const pauseGap = event.delta > 1000 ? 36 : 0;
    const fastCompression = event.delta && event.delta < 145 ? -8 : 0;
    const drift = Math.sin(index * 1.7) * (event.delta > 600 ? 14 : 5);
    const opacity = character === " " ? 0 : repeated ? 0.7 : 0.46;
    const fill = repeated ? RED : event.delta > 700 ? VIOLET : CHARCOAL;
    const fontSize = repeated ? 35 : 31;

    if (cursorX > x + w - 76 || event.delta > 1400) {
      cursorX = x + 45 + Math.sin(index) * 20;
      cursorY += 74 + (event.delta > 1400 ? 28 : 0);
    }
    if (cursorY > y + h - 65) return;

    if (character !== " ") {
      text(character, cursorX + drift, cursorY + Math.cos(index) * 9, {
        family: "Georgia, Times New Roman, serif",
        size: fontSize,
        fill,
        opacity,
        rotate: repeated ? -6 : event.delta > 700 ? 4 : 0,
        parent: group,
      });
      if (repeated) {
        text(character, cursorX + drift + 4, cursorY + Math.cos(index) * 9 + 3, {
          family: "Georgia, Times New Roman, serif",
          size: fontSize,
          fill: ORANGE,
          opacity: 0.28,
          parent: group,
        });
      }
    }
    cursorX += (character === " " ? 24 : 24) + fastCompression + pauseGap;
  });

  trace.events.filter((event) => event.action === "delete").slice(0, 16).forEach((event, index) => {
    const dx = x + 58 + (index % 8) * 51;
    const dy = y + h - 92 + Math.floor(index / 8) * 22;
    line(dx, dy, dx + 32, dy - 8, CHARCOAL, { opacity: 0.38, width: 1.2 });
  });
}

function drawGhost(trace, x, y, w, h) {
  drawModuleFrame("Ghost Text Residue", "partial afterimage of a sentence that is no longer held", x, y, w, h, "4");
  rect(x + 32, y + 52, w - 64, h - 104, MINT, "none", { opacity: 0.28 });
  const words = trace.text.trim().split(/\s+/).filter(Boolean).slice(0, 24);
  let gx = x + 54;
  let gy = y + 114;
  words.forEach((word, wordIndex) => {
    const seed = pseudo(word, 100);
    const visible = word.split("").filter((_, charIndex) => (charIndex + wordIndex + Math.round(seed)) % 3 !== 0).join("");
    const fragment = visible.length > 2 ? visible.slice(0, Math.ceil(visible.length * 0.62)) : visible;
    const opacity = 0.12 + ((wordIndex % 5) * 0.045);
    if (gx > x + w - 130) {
      gx = x + 54 + Math.abs(seed);
      gy += 66;
    }
    text(fragment, gx, gy + Math.sin(wordIndex) * 12, {
      family: "Georgia, Times New Roman, serif",
      size: 34 + (wordIndex % 3) * 7,
      fill: wordIndex % 4 === 0 ? ORANGE : wordIndex % 3 === 0 ? VIOLET : CHARCOAL,
      opacity,
      filter: wordIndex % 2 === 0 ? "url(#ghost-blur)" : "none",
    });
    if (wordIndex % 4 === 1) {
      line(gx - 8, gy + 10, gx + word.length * 17, gy + 4, PAPER, { width: 14, opacity: 0.72 });
    }
    gx += word.length * 21 + 42;
  });

  for (let i = 0; i < 26; i += 1) {
    const rx = x + 38 + ((i * 73) % (w - 76));
    const ry = y + 78 + ((i * 47) % (h - 150));
    line(rx, ry, rx + 36 + (i % 5) * 12, ry, VIOLET, { width: 0.8, opacity: 0.13 + (i % 4) * 0.03 });
  }
}

function drawMetadata(trace, x, y, w, h) {
  line(x, y - 40, x + w, y - 40, LINE);
  text("Trace Metadata", x, y, { size: 18, family: "Georgia, Times New Roman, serif" });
  const metadata = [
    ["trace id", trace.id],
    ["date / time", formatDate(trace.createdAt)],
    ["duration", `${(trace.duration / 1000).toFixed(2)} sec`],
    ["keystrokes", String(trace.keystrokes)],
    ["typing speed", `${trace.speed.toFixed(1)} keys/sec`],
    ["pauses > 1 sec", String(trace.pauses.length)],
    ["deletions", String(trace.deletions)],
    ["repeated characters", trace.repeatedCharacters.slice(0, 5).join("  ") || "none recorded"],
  ];

  metadata.forEach(([label, value], index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const mx = x + col * (w / 4);
    const my = y + 34 + row * 42;
    text(label, mx, my, { size: 10, fill: MUTED, spacing: 1.7 });
    text(value, mx, my + 18, { size: 13, fill: CHARCOAL });
  });
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

function pseudo(value, scale) {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) total += value.charCodeAt(i) * (i + 3);
  return ((total % (scale * 2)) - scale) / 2;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function el(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  });
  return node;
}

function rect(x, y, width, height, fill = "none", stroke = "none", options = {}) {
  const node = el("rect", { x, y, width, height, fill, stroke, opacity: options.opacity });
  if (options.rx) node.setAttribute("rx", options.rx);
  (options.parent || sheet).appendChild(node);
  return node;
}

function circle(cx, cy, r, fill, options = {}) {
  const node = el("circle", { cx, cy, r, fill, opacity: options.opacity });
  (options.parent || sheet).appendChild(node);
  return node;
}

function line(x1, y1, x2, y2, stroke, options = {}) {
  const node = el("line", {
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
  (options.parent || sheet).appendChild(node);
  return node;
}

function text(content, x, y, options = {}) {
  const node = el("text", {
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
  (options.parent || sheet).appendChild(node);
  return node;
}
