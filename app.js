(() => {
  "use strict";

  const canvas = document.getElementById("wheelCanvas");
  const ctx = canvas.getContext("2d");
  const spinButton = document.getElementById("spinButton");
  const spinButtonText = document.getElementById("spinButtonText");
  const syncPill = document.getElementById("syncPill");
  const syncText = document.getElementById("syncText");
  const resultCard = document.getElementById("resultCard");
  const resultLabel = document.getElementById("resultLabel");
  const resultTitle = document.getElementById("resultTitle");
  const helperText = document.getElementById("helperText");
  const movieList = document.getElementById("movieList");
  const themeToggle = document.getElementById("themeToggle");
  const themeStorageKey = "movie-night-theme";

  function applyTheme(theme, save = false) {
    const isLight = theme === "light";
    document.documentElement.dataset.theme = isLight ? "light" : "dark";
    themeToggle.textContent = isLight ? "Use dark theme" : "Use light theme";
    themeToggle.setAttribute("aria-pressed", String(isLight));

    if (save) {
      try {
        window.localStorage.setItem(themeStorageKey, isLight ? "light" : "dark");
      } catch (error) {
        console.warn("Your theme preference could not be saved.", error);
      }
    }
  }

  let savedTheme = "dark";
  try {
    savedTheme = window.localStorage.getItem(themeStorageKey) || "dark";
  } catch (error) {
    console.warn("Your saved theme preference could not be read.", error);
  }
  applyTheme(savedTheme);
  themeToggle.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light", true);
  });

  const colors = [
    "#e55f47", "#273a57", "#d89a43", "#315b5b", "#8d4e68", "#59638a", "#c96d43",
    "#286e72", "#ad6f38", "#554b7c", "#b54949", "#376174", "#c58b3f", "#6e4e68"
  ];

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let movies = [];
  let movieHash = "";
  let wheelState = null;
  let serverOffsetMs = 0;
  let hasClockSync = false;
  let isOnline = false;
  let isSubmitting = false;
  let frameId = 0;
  let lastRenderedSize = 0;
  let lastFinishedSpin = -1;
  let lastListSelection = -2;
  let currentRotation = 0;

  function normalizeDegrees(value) {
    return ((value % 360) + 360) % 360;
  }

  function serverNow() {
    return Date.now() + serverOffsetMs;
  }

  function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
  }

  function setConnection(online) {
    isOnline = online;
    syncPill.classList.toggle("online", online);
    syncPill.classList.toggle("offline", !online);
    syncText.textContent = online ? "Everyone is synced" : "Reconnecting…";
    updateButton();
  }

  function updateButton() {
    const now = serverNow();
    const finishAt = wheelState
      ? Number(wheelState.startAt) + Number(wheelState.durationMs)
      : 0;
    const active = wheelState && wheelState.selectedIndex !== null && now < finishAt;

    spinButton.disabled = !isOnline || isSubmitting || active || movies.length < 2;
    spinButton.classList.toggle("spinning", Boolean(active));

    if (!isOnline) {
      spinButtonText.textContent = "Connecting…";
    } else if (isSubmitting) {
      spinButtonText.textContent = "Starting…";
    } else if (active) {
      spinButtonText.textContent = "Wheel is spinning";
    } else {
      spinButtonText.textContent = "Spin the wheel";
    }
  }

  function syncClock(payload, requestStartedAt, responseReceivedAt) {
    const midpoint = requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;
    const measuredOffset = Number(payload.serverTimeMs) - midpoint;
    serverOffsetMs = hasClockSync
      ? serverOffsetMs * 0.72 + measuredOffset * 0.28
      : measuredOffset;
    hasClockSync = true;
  }

  function renderMovieList(selectedIndex = null, force = false) {
    const selectionKey = selectedIndex === null ? -1 : Number(selectedIndex);
    if (!force && selectionKey === lastListSelection) return;

    const fragment = document.createDocumentFragment();
    movies.forEach((movie, index) => {
      const item = document.createElement("li");
      item.textContent = movie;
      item.classList.toggle("selected", index === selectedIndex);
      fragment.appendChild(item);
    });
    movieList.replaceChildren(fragment);
    lastListSelection = selectionKey;
  }

  function fitLabel(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let shortened = text;
    while (shortened.length > 3 && ctx.measureText(`${shortened}…`).width > maxWidth) {
      shortened = shortened.slice(0, -1);
    }
    return `${shortened.trimEnd()}…`;
  }

  function drawWheel(rotationDegrees, selectedIndex = null) {
    const cssSize = Math.floor(Math.min(canvas.clientWidth, canvas.clientHeight));
    if (!cssSize || movies.length === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetPixels = Math.round(cssSize * dpr);
    if (canvas.width !== targetPixels || canvas.height !== targetPixels) {
      canvas.width = targetPixels;
      canvas.height = targetPixels;
      lastRenderedSize = cssSize;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);

    const center = cssSize / 2;
    const radius = center - Math.max(3, cssSize * 0.009);
    const arc = (Math.PI * 2) / movies.length;
    const rotation = (normalizeDegrees(rotationDegrees) * Math.PI) / 180;

    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(rotation);

    movies.forEach((movie, index) => {
      const start = -Math.PI / 2 + index * arc;
      const end = start + arc;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = colors[index % colors.length];
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = Math.max(0.75, cssSize / 720);
      ctx.stroke();

      if (selectedIndex === index) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius - 2, start, end);
        ctx.closePath();
        ctx.fillStyle = "rgba(255, 240, 188, 0.2)";
        ctx.fill();
        ctx.restore();
      }

      const middle = start + arc / 2;
      const fontSize = Math.max(8.5, Math.min(12.5, cssSize / 48));
      const outerInset = Math.max(14, cssSize * 0.034);
      const maxLabelWidth = radius * 0.65;

      ctx.save();
      ctx.rotate(middle);
      ctx.fillStyle = "rgba(255,255,255,0.94)";
      ctx.font = `700 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 3;

      const normalizedMiddle = normalizeDegrees((middle * 180) / Math.PI);
      const shouldFlip = normalizedMiddle > 90 && normalizedMiddle < 270;
      const label = fitLabel(movie, maxLabelWidth);

      if (shouldFlip) {
        ctx.rotate(Math.PI);
        ctx.textAlign = "left";
        ctx.fillText(label, -radius + outerInset, 0, maxLabelWidth);
      } else {
        ctx.textAlign = "right";
        ctx.fillText(label, radius - outerInset, 0, maxLabelWidth);
      }
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.985, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = Math.max(2, cssSize * 0.006);
    ctx.stroke();

    ctx.restore();
  }

  function setResult(label, title, reveal = false) {
    resultLabel.textContent = label;
    resultTitle.textContent = title;

    if (reveal) {
      resultCard.classList.remove("reveal");
      void resultCard.offsetWidth;
      resultCard.classList.add("reveal");
    }
  }

  function renderFrame() {
    cancelAnimationFrame(frameId);
    frameId = 0;

    if (!wheelState || movies.length === 0) {
      drawWheel(currentRotation);
      updateButton();
      return;
    }

    const now = serverNow();
    const startsAt = Number(wheelState.startAt);
    const duration = Number(wheelState.durationMs);
    const finishesAt = startsAt + duration;
    const hasSelection = wheelState.selectedIndex !== null;

    if (!hasSelection) {
      currentRotation = Number(wheelState.endRotation || 0);
      drawWheel(currentRotation);
      setResult("Ready when you are", "Spin for movie night");
      helperText.innerHTML = "The movie list is loaded from <code>movies.csv</code>.";
      renderMovieList();
      updateButton();
      return;
    }

    if (now < startsAt) {
      const seconds = Math.max(1, Math.ceil((startsAt - now) / 1000));
      currentRotation = Number(wheelState.startRotation);
      drawWheel(currentRotation);
      setResult("A shared spin is starting", `Get ready… ${seconds}`);
      helperText.textContent = "Someone started the wheel. Every open screen will spin together.";
      renderMovieList();
      updateButton();
      frameId = requestAnimationFrame(renderFrame);
      return;
    }

    if (now < finishesAt) {
      const progress = Math.max(0, Math.min(1, (now - startsAt) / duration));
      const eased = reduceMotion ? 0 : easeOutQuint(progress);
      currentRotation = Number(wheelState.startRotation)
        + (Number(wheelState.endRotation) - Number(wheelState.startRotation)) * eased;
      drawWheel(currentRotation);
      setResult("Choosing tonight's movie", "The wheel is spinning…");
      helperText.textContent = "Stay on this page—the result is synchronized for everyone.";
      renderMovieList();
      updateButton();
      frameId = requestAnimationFrame(renderFrame);
      return;
    }

    currentRotation = Number(wheelState.endRotation);
    drawWheel(currentRotation, Number(wheelState.selectedIndex));
    const shouldReveal = lastFinishedSpin !== Number(wheelState.spinId);
    setResult("Tonight we're watching", wheelState.selectedTitle, shouldReveal);
    renderMovieList(Number(wheelState.selectedIndex));
    helperText.textContent = "Not feeling it? Anyone can start the next synchronized spin.";
    lastFinishedSpin = Number(wheelState.spinId);
    updateButton();
  }

  function applyPayload(payload, requestStartedAt, responseReceivedAt) {
    syncClock(payload, requestStartedAt, responseReceivedAt);

    if (!Array.isArray(payload.movies) || !payload.state) {
      throw new Error("The server returned an incomplete response.");
    }

    const nextHash = String(payload.movieHash || "");
    if (nextHash !== movieHash) {
      movieHash = nextHash;
      movies = payload.movies.map(String);
      renderMovieList(null, true);
    }

    wheelState = payload.state;
    setConnection(true);
    renderFrame();
  }

  async function requestState(options = {}) {
    const requestStartedAt = Date.now();
    const response = await fetch(`api.php?t=${requestStartedAt}`, {
      cache: "no-store",
      credentials: "same-origin",
      ...options
    });
    const responseReceivedAt = Date.now();
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload) {
      throw new Error(payload && payload.error ? payload.error : "Unable to reach the movie wheel.");
    }

    applyPayload(payload, requestStartedAt, responseReceivedAt);
  }

  async function poll() {
    try {
      await requestState();
    } catch (error) {
      console.error(error);
      setConnection(false);
      helperText.textContent = "Connection lost. The page will keep trying to reconnect.";
    } finally {
      window.setTimeout(poll, 1000);
    }
  }

  async function spin() {
    if (spinButton.disabled) return;
    isSubmitting = true;
    updateButton();

    try {
      await requestState({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "spin" })
      });
    } catch (error) {
      console.error(error);
      setConnection(false);
      setResult("Couldn't start the wheel", "Please try again in a moment");
    } finally {
      isSubmitting = false;
      updateButton();
    }
  }

  spinButton.addEventListener("click", spin);

  const resizeObserver = new ResizeObserver(() => {
    const nextSize = Math.floor(Math.min(canvas.clientWidth, canvas.clientHeight));
    if (Math.abs(nextSize - lastRenderedSize) > 1) renderFrame();
  });
  resizeObserver.observe(canvas);

  poll();
})();
