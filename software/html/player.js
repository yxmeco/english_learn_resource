(function appBootstrap(global) {
  "use strict";

  const STORAGE_KEY = "english-ear-player-state-v1";

  const state = {
    catalogs: [],
    catalog: null,
    mode: "global",
    unitId: null,
    queue: [],
    queueIndex: -1,
    shuffle: false,
    autoAdvancing: false,
    currentItemId: null
  };

  const refs = {
    catalogSelect: document.getElementById("catalogSelect"),
    modeSelect: document.getElementById("modeSelect"),
    shuffleCheckbox: document.getElementById("shuffleCheckbox"),
    resumeBtn: document.getElementById("resumeBtn"),
    itemList: document.getElementById("itemList"),
    nowPlaying: document.getElementById("nowPlaying"),
    prevBtn: document.getElementById("prevBtn"),
    playPauseBtn: document.getElementById("playPauseBtn"),
    nextBtn: document.getElementById("nextBtn"),
    restartBtn: document.getElementById("restartBtn"),
    seekBar: document.getElementById("seekBar"),
    currentTime: document.getElementById("currentTime"),
    duration: document.getElementById("duration"),
    statusText: document.getElementById("statusText"),
    audioEl: document.getElementById("audioEl"),
    videoEl: document.getElementById("videoEl")
  };

  function init() {
    state.catalogs = normalizeCatalogs(global.__CATALOG_REGISTRY || []);
    if (!state.catalogs.length) {
      setStatus("未找到资源清单，请检查 manifests/*.js。", true);
      return;
    }

    bindEvents();
    renderCatalogOptions();
    selectCatalog(state.catalogs[0].catalogId);
    refs.modeSelect.value = state.mode;
    rebuildQueueFromCurrentMode();
    restoreState(false);
  }

  function normalizeCatalogs(rawCatalogs) {
    return rawCatalogs
      .map((catalog) => {
        const units = Array.isArray(catalog.units) ? catalog.units : [];
        return {
          catalogId: String(catalog.catalogId || ""),
          catalogName: String(catalog.catalogName || catalog.catalogId || "未命名清单"),
          units: units.map((unit) => ({
            unitId: String(unit.unitId || ""),
            unitName: String(unit.unitName || unit.unitId || "未命名单元"),
            items: [...(Array.isArray(unit.items) ? unit.items : [])]
              .map((item) => ({
                itemId: String(item.itemId || ""),
                title: String(item.title || item.itemId || "未命名条目"),
                text: String(item.text || ""),
                type: item.type === "video" ? "video" : "audio",
                url: String(item.url || ""),
                sort: Number.isFinite(item.sort) ? item.sort : 9999,
                unitId: String(unit.unitId || ""),
                unitName: String(unit.unitName || unit.unitId || "未命名单元"),
                catalogId: String(catalog.catalogId || ""),
                catalogName: String(catalog.catalogName || catalog.catalogId || "未命名清单")
              }))
              .filter((item) => item.itemId && item.url)
              .sort((a, b) => a.sort - b.sort)
          }))
            .filter((unit) => unit.unitId && unit.items.length)
        };
      })
      .filter((catalog) => catalog.catalogId && catalog.units.length);
  }

  function bindEvents() {
    refs.catalogSelect.addEventListener("change", (event) => {
      selectCatalog(event.target.value);
      saveState();
    });

    refs.modeSelect.addEventListener("change", (event) => {
      state.mode = event.target.value;
      resetQueueAndSelectionByMode();
      saveState();
      setStatus(`已切换为${modeText(state.mode)}模式。`, false);
    });

    refs.shuffleCheckbox.addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      refs.shuffleCheckbox.textContent = state.shuffle ? "开启" : "关闭";
      refs.shuffleCheckbox.setAttribute("aria-pressed", String(state.shuffle));
      if (state.mode === "global") {
        rebuildQueueFromCurrentMode();
      }
      saveState();
    });

    refs.resumeBtn.addEventListener("click", () => {
      restoreState(true);
    });

    refs.prevBtn.addEventListener("click", () => {
      playPrev();
    });

    refs.nextBtn.addEventListener("click", () => {
      playNext();
    });

    refs.restartBtn.addEventListener("click", () => {
      restartCurrent();
    });

    refs.playPauseBtn.addEventListener("click", () => {
      togglePlayPause();
    });

    refs.seekBar.addEventListener("input", () => {
      const media = currentMedia();
      if (!media || !Number.isFinite(media.duration) || media.duration <= 0) {
        return;
      }
      media.currentTime = (media.duration * Number(refs.seekBar.value)) / 1000;
    });

    refs.audioEl.addEventListener("timeupdate", onTimeUpdate);
    refs.videoEl.addEventListener("timeupdate", onTimeUpdate);
    refs.audioEl.addEventListener("loadedmetadata", onLoadedMetadata);
    refs.videoEl.addEventListener("loadedmetadata", onLoadedMetadata);
    refs.audioEl.addEventListener("ended", onEnded);
    refs.videoEl.addEventListener("ended", onEnded);
    refs.audioEl.addEventListener("play", onPlaying);
    refs.videoEl.addEventListener("play", onPlaying);
    refs.audioEl.addEventListener("pause", onPaused);
    refs.videoEl.addEventListener("pause", onPaused);
    refs.audioEl.addEventListener("error", onMediaError);
    refs.videoEl.addEventListener("error", onMediaError);
  }

  function modeText(mode) {
    if (mode === "unit") {
      return "单元播放";
    }
    return "全局播放";
  }

  function renderCatalogOptions() {
    refs.catalogSelect.innerHTML = state.catalogs
      .map((catalog) => `<option value="${escapeHtml(catalog.catalogId)}">${escapeHtml(catalog.catalogName)}</option>`)
      .join("");
  }

  function selectCatalog(catalogId) {
    const target = state.catalogs.find((item) => item.catalogId === catalogId) || state.catalogs[0];
    state.catalog = target;
    refs.catalogSelect.value = target.catalogId;
    state.unitId = target.units[0].unitId;
    state.queue = [];
    state.queueIndex = -1;
    renderItemList();
    renderNowPlaying();
    setStatus(`已加载资源清单：${target.catalogName}`, false);
  }

  function renderItemList() {
    if (!state.catalog || !state.catalog.units.length) {
      refs.itemList.innerHTML = '<div class="item-row">当前无条目</div>';
      return;
    }

    refs.itemList.innerHTML = "";
    state.catalog.units.forEach((unit) => {
      const unitHeader = document.createElement("div");
      unitHeader.className = "unit-section-title" + (unit.unitId === state.unitId ? " active" : "");
      unitHeader.textContent = `${unit.unitName}（${unit.items.length}）`;
      unitHeader.addEventListener("click", () => {
        state.unitId = unit.unitId;
        renderItemList();
        if (state.mode === "unit") {
          rebuildQueueFromCurrentMode();
        }
        saveState();
      });
      refs.itemList.appendChild(unitHeader);

      unit.items.forEach((item) => {
        const row = document.createElement("div");
        const isActive = getCurrentItem() && getCurrentItem().itemId === item.itemId;
        row.className = "item-row" + (isActive ? " active" : "");

        const thumb = createItemThumb(item);
        const text = document.createElement("div");
        text.innerHTML = `<p class="item-title">${escapeHtml(item.title)} (${item.type})</p><p class="item-text">${escapeHtml(item.text)}</p>`;

        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = "ghost";
        playBtn.textContent = "点读";
        playBtn.addEventListener("click", () => {
          playItemByClick(item);
        });

        row.appendChild(thumb);
        row.appendChild(text);
        row.appendChild(playBtn);
        refs.itemList.appendChild(row);
      });
    });
  }

  function createItemThumb(item) {
    const box = document.createElement("div");
    box.className = "item-thumb" + (item.type === "audio" ? " audio" : "");

    if (item.type === "video") {
      // 为了节省流量，列表中不预加载媒体资源，播放时才加载真实 URL。
      box.textContent = "MP4";
      return box;
    }

    box.textContent = "MP3";
    return box;
  }

  function resetQueueAndSelectionByMode() {
    rebuildQueueFromCurrentMode();
  }

  function rebuildQueueFromCurrentMode() {
    if (state.mode === "unit") {
      const unit = currentUnit();
      state.queue = unit ? [...unit.items] : [];
      state.queueIndex = state.queue.length ? 0 : -1;
      renderItemList();
      renderNowPlaying();
      return;
    }
    if (state.mode === "global") {
      const list = flattenAllCatalogItems();
      state.queue = state.shuffle ? shuffleArray(list) : list;
      state.queueIndex = state.queue.length ? 0 : -1;
      renderItemList();
      renderNowPlaying();
    }
  }

  function playItemByClick(item) {
    if (!item) {
      return;
    }
    state.unitId = item.unitId;
    if (state.mode === "unit") {
      const unit = currentUnit();
      state.queue = unit ? [...unit.items] : [];
      state.queueIndex = state.queue.findIndex((qItem) => qItem.itemId === item.itemId);
    } else {
      const allItems = flattenAllCatalogItems();
      const list = state.shuffle ? shuffleArray(allItems) : allItems;
      state.queue = list;
      state.queueIndex = state.queue.findIndex((qItem) => qItem.itemId === item.itemId);
    }
    if (state.queueIndex < 0) {
      state.queueIndex = 0;
    }
    loadCurrentItemAndPlay(0);
  }

  function getCurrentItem() {
    if (state.queueIndex < 0 || state.queueIndex >= state.queue.length) {
      return null;
    }
    return state.queue[state.queueIndex];
  }

  function currentUnit() {
    return state.catalog.units.find((unit) => unit.unitId === state.unitId) || state.catalog.units[0];
  }

  function flattenCatalogItems() {
    const all = [];
    state.catalog.units.forEach((unit) => {
      unit.items.forEach((item) => all.push(item));
    });
    return all;
  }

  function flattenAllCatalogItems() {
    const all = [];
    state.catalogs.forEach((catalog) => {
      catalog.units.forEach((unit) => {
        unit.items.forEach((item) => all.push(item));
      });
    });
    return all;
  }

  function loadCurrentItemAndPlay(startTime) {
    const item = getCurrentItem();
    if (!item) {
      setStatus("当前没有可播放条目。", true);
      return;
    }
    if (!isValidMediaUrl(item.url)) {
      setStatus(`URL 不合法，已跳过：${item.title}`, true);
      autoSkipInvalid();
      return;
    }
    swapMediaByType(item.type);
    const media = currentMedia();
    const currentSrc = media.getAttribute("src") || "";
    const shouldReuse = state.currentItemId === item.itemId && normalizeUrl(currentSrc) === normalizeUrl(item.url);

    if (!shouldReuse) {
      media.src = item.url;
    }

    if (Number.isFinite(startTime) && startTime > 0) {
      seekMediaSafely(media, startTime);
    } else if (!shouldReuse) {
      seekMediaSafely(media, 0);
    }

    state.currentItemId = item.itemId;
    media.play().catch((err) => {
      setStatus(`播放失败：${err && err.message ? err.message : "未知错误"}`, true);
    });
    renderItemList();
    renderNowPlaying();
    saveState();
  }

  function playPrev() {
    if (!state.queue.length) {
      setStatus("播放队列为空，请先点读或选择播放模式。", true);
      return;
    }
    state.queueIndex = Math.max(0, state.queueIndex - 1);
    loadCurrentItemAndPlay(0);
  }

  function playNext() {
    if (!state.queue.length) {
      setStatus("播放队列为空，请先点读或选择播放模式。", true);
      return;
    }
    if (state.queueIndex + 1 >= state.queue.length) {
      setStatus("已经播放到最后一条。", false);
      stopMedia();
      return;
    }
    state.queueIndex += 1;
    loadCurrentItemAndPlay(0);
  }

  function restartCurrent() {
    const media = currentMedia();
    if (!media || !getCurrentItem()) {
      setStatus("当前没有可重播条目。", true);
      return;
    }
    media.currentTime = 0;
    media.play().catch((err) => {
      setStatus(`重播失败：${err && err.message ? err.message : "未知错误"}`, true);
    });
  }

  function togglePlayPause() {
    const item = getCurrentItem();
    if (!item) {
      rebuildQueueFromCurrentMode();
      if (getCurrentItem()) {
        loadCurrentItemAndPlay(0);
        return;
      }
      setStatus("当前模式没有可播放条目。", true);
      return;
    }

    const media = currentMedia();
    if (!media.src) {
      loadCurrentItemAndPlay(0);
      return;
    }
    if (media.paused) {
      media.play().catch((err) => {
        setStatus(`播放失败：${err && err.message ? err.message : "未知错误"}`, true);
      });
    } else {
      media.pause();
    }
  }

  function stopMedia() {
    refs.audioEl.pause();
    refs.videoEl.pause();
    refs.audioEl.removeAttribute("src");
    refs.videoEl.removeAttribute("src");
    refs.audioEl.load();
    refs.videoEl.load();
    state.currentItemId = null;
    refs.currentTime.textContent = "00:00";
    refs.duration.textContent = "00:00";
    refs.seekBar.value = "0";
  }

  function onTimeUpdate() {
    const media = currentMedia();
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) {
      return;
    }
    refs.currentTime.textContent = formatTime(media.currentTime);
    refs.duration.textContent = formatTime(media.duration);
    refs.seekBar.value = String(Math.floor((media.currentTime / media.duration) * 1000));
    saveState();
  }

  function onLoadedMetadata() {
    const media = currentMedia();
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) {
      return;
    }
    refs.duration.textContent = formatTime(media.duration);
  }

  function onEnded() {
    state.autoAdvancing = true;
    playNext();
    state.autoAdvancing = false;
  }

  function onPlaying() {
    refs.playPauseBtn.textContent = "暂停";
    const item = getCurrentItem();
    if (item) {
      setStatus(`播放中：${item.title}`, false);
    }
  }

  function onPaused() {
    const media = currentMedia();
    if (media && media.ended) {
      refs.playPauseBtn.textContent = "播放";
      return;
    }
    refs.playPauseBtn.textContent = "继续播放";
  }

  function onMediaError() {
    const item = getCurrentItem();
    const name = item ? item.title : "当前条目";
    setStatus(`媒体加载失败，自动跳过：${name}`, true);
    autoSkipInvalid();
  }

  function autoSkipInvalid() {
    if (!state.queue.length || state.queueIndex + 1 >= state.queue.length) {
      stopMedia();
      return;
    }
    state.queueIndex += 1;
    loadCurrentItemAndPlay(0);
  }

  function renderNowPlaying() {
    const item = getCurrentItem();
    if (!item) {
      refs.nowPlaying.textContent = "未开始播放";
      refs.playPauseBtn.textContent = "播放";
      return;
    }
    const unitName = item.unitName || "未知单元";
    const catalogName = item.catalogName || "未知清单";
    refs.nowPlaying.textContent = `正在准备：${item.title} / ${catalogName} / ${unitName} / ${modeText(state.mode)}`;
  }

  function swapMediaByType(type) {
    if (type === "video") {
      refs.videoEl.style.display = "block";
      refs.audioEl.style.display = "none";
      refs.audioEl.pause();
    } else {
      refs.videoEl.style.display = "none";
      refs.audioEl.style.display = "block";
      refs.videoEl.pause();
    }
  }

  function currentMedia() {
    return refs.videoEl.style.display === "block" ? refs.videoEl : refs.audioEl;
  }

  function setStatus(text, isError) {
    refs.statusText.textContent = text;
    refs.statusText.className = "status" + (isError ? " error" : "");
  }

  function saveState() {
    const item = getCurrentItem();
    const media = currentMedia();
    const payload = {
      catalogId: state.catalog ? state.catalog.catalogId : null,
      mode: state.mode,
      unitId: state.unitId,
      shuffle: state.shuffle,
      itemId: item ? item.itemId : null,
      time: media && Number.isFinite(media.currentTime) ? media.currentTime : 0
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      setStatus("保存进度失败：浏览器存储不可用。", true);
    }
  }

  function restoreState(autoLoad) {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (err) {
      setStatus("读取历史进度失败，将使用默认状态。", true);
      return;
    }
    if (!saved || !saved.catalogId) {
      setStatus("暂无可恢复的历史进度。", false);
      return;
    }

    const catalogExists = state.catalogs.some((catalog) => catalog.catalogId === saved.catalogId);
    if (!catalogExists) {
      setStatus("历史资源清单不存在，已回到默认清单。", true);
      return;
    }

    selectCatalog(saved.catalogId);
    state.mode = ["unit", "global"].includes(saved.mode) ? saved.mode : "global";
    refs.modeSelect.value = state.mode;
    state.unitId = saved.unitId && state.catalog.units.some((unit) => unit.unitId === saved.unitId) ? saved.unitId : state.catalog.units[0].unitId;
    state.shuffle = Boolean(saved.shuffle);
    refs.shuffleCheckbox.textContent = state.shuffle ? "开启" : "关闭";
    refs.shuffleCheckbox.setAttribute("aria-pressed", String(state.shuffle));

    rebuildQueueFromCurrentMode();

    if (saved.itemId) {
      const list = state.mode === "global"
        ? flattenAllCatalogItems()
        : (state.mode === "unit" ? (currentUnit() ? currentUnit().items : []) : flattenCatalogItems());
      const idx = list.findIndex((item) => item.itemId === saved.itemId);
      if (idx >= 0) {
        state.queue = list;
        state.queueIndex = idx;
      }
    }
    renderItemList();
    renderNowPlaying();

    if (autoLoad && getCurrentItem()) {
      loadCurrentItemAndPlay(Number(saved.time) || 0);
      setStatus("已恢复上次播放进度。", false);
    } else {
      setStatus("已加载历史播放位置，点击播放即可继续。", false);
    }
  }

  function isValidMediaUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch (_err) {
      return false;
    }
  }

  function normalizeUrl(url) {
    try {
      return new URL(url, window.location.href).toString();
    } catch (_err) {
      return String(url || "");
    }
  }

  function seekMediaSafely(media, targetTime) {
    const safeTime = Math.max(0, Number(targetTime) || 0);
    if (media.readyState >= 1) {
      media.currentTime = safeTime;
      return;
    }

    const onReady = () => {
      media.currentTime = safeTime;
      media.removeEventListener("loadedmetadata", onReady);
    };
    media.addEventListener("loadedmetadata", onReady);
  }

  function formatTime(value) {
    const sec = Math.max(0, Math.floor(Number(value) || 0));
    const min = Math.floor(sec / 60);
    const rest = sec % 60;
    return `${String(min).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function shuffleArray(list) {
    const cloned = [...list];
    for (let i = cloned.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = cloned[i];
      cloned[i] = cloned[j];
      cloned[j] = temp;
    }
    return cloned;
  }

  function escapeHtml(raw) {
    return String(raw)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  init();
})(window);
