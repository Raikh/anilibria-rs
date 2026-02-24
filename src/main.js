import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Hls from "hls.js";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import "./styles.css";

const appWindow = getCurrentWindow();
let player = null;
let hudTimer = null;
let lastActiveScreen = "catalog";
let searchTimeout;
let currentPage = 0;
let isFetching = false;
let volumeDisplay = null;

// Элементы DOM
const viewport = document.getElementById("main-viewport");
const searchInput = document.getElementById("catalog-search-input");
const searchResults = document.getElementById("search-results-container");
const infiniteWrapper = document.getElementById("infinite-scroll-wrapper");

// --- 1. Video.js Quality Menu Components ---
const MenuItem = videojs.getComponent("MenuItem");
const MenuButton = videojs.getComponent("MenuButton");

class QualityMenuItem extends MenuItem {
  constructor(player, options) {
    const label = options.isAuto ? `Авто (${options.label})` : options.label;
    super(player, { ...options, label });
    this.src = options.src;
  }

  handleClick() {
    const currentTime = this.player_.currentTime();
    const isPaused = this.player_.paused();

    if (window.hls) {
      // Windows / Linux
      window.hls.loadSource(this.src);
    } else {
      // macOS (Native HLS)
      this.player_.src({ src: this.src, type: "application/x-mpegURL" });
    }

    this.player_.one("loadedmetadata", () => {
      this.player_.currentTime(currentTime);
      if (!isPaused) this.player_.play();
    });
    this.selected(true);
  }
}

class QualityMenu extends MenuButton {
  constructor(player, options) {
    super(player, options);
    this.addClass("vjs-quality-menu-button");
    this.controlText("Качество");
  }
  createItems() {
    const sources = this.options_.sources || [];
    return sources.map((s, index) => {
      return new QualityMenuItem(this.player_, {
        label: s.label,
        src: s.src,
        isAuto: index === 0,
        selectable: true,
        selected: index === 0,
      });
    });
  }
}

if (!videojs.getComponent("QualityMenu")) {
  videojs.registerComponent("QualityMenu", QualityMenu);
}

// --- 2. Поиск ---
searchInput.addEventListener("input", (e) => {
  const query = e.target.value.trim();
  clearTimeout(searchTimeout);

  if (query.length === 0) {
    searchResults.style.display = "none";
    infiniteWrapper.style.display = "block";
    return;
  }

  if (query.length < 4) return;

  searchTimeout = setTimeout(async () => {
    infiniteWrapper.style.display = "none";
    searchResults.style.display = "flex";
    searchResults.innerHTML =
      '<div class="loading-spinner">Ищем в базе...</div>';

    try {
      const results = await invoke("search_releases", { query });
      if (!results || results.length === 0) {
        searchResults.innerHTML =
          '<div class="count-badge">Ничего не найдено</div>';
        return;
      }

      searchResults.innerHTML = results
        .map((a) => {
          const posterUrl =
            a.poster.preview || a.poster.thumbnail || a.poster.src;
          return `
          <div class="catalog-row" data-id="${a.id}">
            <img src="https://anilibria.top${posterUrl}" class="catalog-img">
            <div class="catalog-info">
              <h3>${a.name.main}</h3>
              <div class="tags">${a.genres?.map((g) => `<span>${g.name}</span>`).join("") || ""}</div>
              <p class="desc-short">${a.description || ""}</p>
            </div>
          </div>
        `;
        })
        .join("");
    } catch (err) {
      searchResults.innerHTML = '<div class="error">Ошибка при поиске</div>';
    }
  }, 500);
});

searchResults.addEventListener("click", (e) => {
  const row = e.target.closest(".catalog-row");
  if (row) showDetails(row.dataset.id);
});

// --- 3. Настройки ---
async function openSettings() {
  try {
    const currentSettings = await invoke("get_settings");
    document.getElementById("api-url-input").value = currentSettings.api_url;
    document.getElementById("settings-modal").style.display = "flex";
  } catch (err) {
    console.error("Не удалось загрузить настройки:", err);
  }
}

async function saveNewSettings() {
  const newUrl = document.getElementById("api-url-input").value;
  try {
    await invoke("save_settings", { newSettings: { api_url: newUrl } });
    alert("Настройки сохранены!");
    document.getElementById("settings-modal").style.display = "none";
    location.reload();
  } catch (err) {
    alert("Ошибка: " + err);
  }
}

// --- 4. Каталог и Бесконечный скролл ---
async function loadNextPage() {
  if (isFetching) return;
  isFetching = true;

  try {
    const list = await invoke("get_catalog_paginated", { page: currentPage });
    if (!list || list.length === 0) {
      isFetching = false;
      observer.disconnect();
      document.getElementById("loading-trigger").innerText =
        "Все релизы загружены";
      return;
    }

    const container = document.getElementById("infinite-list");
    const html = list
      .map((a) => {
        const posterUrl = a.poster.preview || a.poster.thumbnail;
        return `
            <div class="catalog-row" data-id="${a.id}">
                <img src="https://anilibria.top${posterUrl}" class="catalog-img">
                <div class="catalog-info">
                    <div class="tags">${a.genres?.map((g) => `<span>${g.name}</span>`).join("") || ""}</div>
                    <h3>${a.name.main}</h3>
                    <p class="desc-short">${a.description || "..."}</p>
                </div>
            </div>
        `;
      })
      .join("");

    container.insertAdjacentHTML("beforeend", html);
    currentPage++;
  } catch (e) {
    console.error(e);
  } finally {
    isFetching = false;
  }
}

const observer = new IntersectionObserver(
  (entries) => {
    if (entries[0].isIntersecting) loadNextPage();
  },
  { threshold: 0.1, root: viewport },
);

// --- 5. Инициализация главной ---
async function init() {
  const list = await invoke("get_catalog");
  if (!Array.isArray(list) || list.length === 0) return;

  const heroItems = list.slice(0, 5);
  const heroContent = document.getElementById("hero-content");
  heroContent.innerHTML = heroItems
    .map(
      (a) => `
          <div class="hero-item">
              <div class="hero-bg" style="background-image: url('https://anilibria.top${a.poster.src}')"></div>
              <div class="hero-info">
                  <h2>${a.name.main}</h2>
                  <p>${a.description?.replace(/<[^>]*>/g, "") || "..."}</p>
                  <button class="ep-btn hero-watch-btn" data-id="${a.id}">Смотреть</button>
              </div>
          </div>
  `,
    )
    .join("");

  heroContent
    .querySelectorAll(".hero-watch-btn")
    .forEach((btn) => (btn.onclick = () => showDetails(btn.dataset.id)));

  const container = document.getElementById("anime-list");
  container.innerHTML = list
    .slice(5)
    .map(
      (a) => `
    <div class="card" data-id="${a.id}">
        <img src="https://anilibria.top${a.poster.src}">
        <div class="card-info"><h3>${a.name.main}</h3></div>
    </div>
  `,
    )
    .join("");

  container
    .querySelectorAll(".card")
    .forEach((card) => (card.onclick = () => showDetails(card.dataset.id)));

  let currentSlide = 0;
  document.querySelector(".slider-btn.next").onclick = () => {
    currentSlide = (currentSlide + 1) % heroItems.length;
    heroContent.style.transform = `translateX(-${currentSlide * 100}%)`;
  };
  document.querySelector(".slider-btn.prev").onclick = () => {
    currentSlide = (currentSlide - 1 + heroItems.length) % heroItems.length;
    heroContent.style.transform = `translateX(-${currentSlide * 100}%)`;
  };
}

// --- 6. Экран деталей ---
async function showDetails(id) {
  const details = document.getElementById("anime-details");
  const content = document.getElementById("details-content");

  document.getElementById("catalog").style.display = "none";
  document.getElementById("catalog-screen").style.display = "none";
  details.style.display = "block";

  viewport.scrollTo(0, 0);
  content.innerHTML = `<div class="loading-spinner">Загрузка релиза...</div>`;

  try {
    const release = await invoke("get_full_release", { id: String(id) });
    content.innerHTML = `
      <button id="back-to-prev" class="back-btn">← Назад</button>
      <div class="details-layout">
          <div class="details-sidebar">
              <img src="https://anilibria.top${release.poster.src}">
          </div>
          <div class="details-main">
              <h1>${release.name.main}</h1>
              <p class="description">${release.description}</p>
              <div class="ep-list">
                  ${release.episodes
                    .map(
                      (e) => `
                      <button class="ep-btn" data-uuid="${e.id}" data-ord="${e.ordinal}">
                          Серия ${e.ordinal}
                      </button>
                  `,
                    )
                    .join("")}
              </div>
          </div>
      </div>
    `;

    document.getElementById("back-to-prev").onclick = () => {
      details.style.display = "none";
      document.getElementById(lastActiveScreen).style.display = "block";
    };

    content.querySelectorAll(".ep-btn").forEach((btn) => {
      btn.onclick = () =>
        openPlayer(
          btn.dataset.uuid,
          `Серия ${btn.dataset.ord} — ${release.name.main}`,
        );
    });
  } catch (err) {
    content.innerHTML = `<div class="error">${err}</div>`;
  }
}

// --- 7. Плеер ---
async function openPlayer(uuid, title) {
  const overlay = document.getElementById("video-overlay");
  const shell = document.getElementById("app-shell");
  const videoElem = document.getElementById("video-player");
  const hud = document.querySelector(".player-hud");

  shell.style.display = "none";
  overlay.style.display = "flex";
  document.getElementById("player-title").innerText = title;

  const data = await invoke("get_anime_details", { id: uuid });
  const sources = [];
  if (data.hls_1080) sources.push({ label: "1080p", src: data.hls_1080 });
  if (data.hls_720) sources.push({ label: "720p", src: data.hls_720 });
  if (data.hls_480) sources.push({ label: "480p", src: data.hls_480 });

  if (!player) {
    player = videojs(videoElem, {
      controls: true,
      autoplay: true,
      fluid: true,
      playbackRates: [0.5, 1, 1.25, 1.5, 2],
      userActions: {
        hotkeys: function (event) {
          if (event.which === 37) {
            this.currentTime(this.currentTime() - 10);
          }
          if (event.which === 39) {
            this.currentTime(this.currentTime() + 10);
          }
          if (event.which === 38) {
            this.volume(Math.min(this.volume() + 0.05, 1));
          }
          if (event.which === 40) {
            this.volume(Math.max(this.volume() - 0.05, 0));
          }
          if (event.which === 32) {
            if (this.paused()) this.play();
            else this.pause();
          }
        },
      },
    });

    volumeDisplay = document.createElement("div");
    volumeDisplay.className = "vjs-volume-level-number";

    player.ready(() => {
      const volPanel = player.controlBar.getChild("volumePanel");
      if (volPanel) {
        volPanel.el().appendChild(volumeDisplay);
        volumeDisplay.innerText = Math.round(player.volume() * 100) + "%";
      }
    });

    player.on("volumechange", () => {
      if (volumeDisplay) {
        volumeDisplay.innerText = Math.round(player.volume() * 100) + "%";
      }
    });

    document.getElementById("close-player").onclick = async () => {
      if (window.hls) {
        window.hls.destroy();
        window.hls = null;
      }
      player.pause();
      await appWindow.setFullscreen(false);
      overlay.style.display = "none";
      shell.style.display = "flex";
    };

    const showHud = () => {
      hud.classList.remove("hud-hidden");
      overlay.style.cursor = "default";
      clearTimeout(hudTimer);
      hudTimer = setTimeout(() => {
        if (player && !player.paused()) {
          hud.classList.add("hud-hidden");
          overlay.style.cursor = "none";
        }
      }, 3000);
    };

    overlay.onmousemove = showHud;
    player.on("pause", () => {
      clearTimeout(hudTimer);
      hud.classList.remove("hud-hidden");
      overlay.style.cursor = "default";
    });
    player.on("play", showHud);
  }

  // Обновление меню качества
  const oldMenu = player.controlBar.getChild("QualityMenu");
  if (oldMenu) player.controlBar.removeChild(oldMenu);
  player.controlBar.addChild(
    "QualityMenu",
    { sources },
    player.controlBar.children().length - 1,
  );

  const videoSrc = sources[0].src;

  // --- ЛОГИКА ВЫБОРА ДВИЖКА ---
  if (videoElem.canPlayType("application/vnd.apple.mpegurl")) {
    // macOS / iOS
    player.src({ src: videoSrc, type: "application/x-mpegURL" });
    player.one("loadedmetadata", () => {
      player.play().catch(() => {});
    });
  } else if (Hls.isSupported()) {
    // Windows / Linux
    if (window.hls) window.hls.destroy();

    const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
    hls.loadSource(videoSrc);
    hls.attachMedia(videoElem);
    window.hls = hls;

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      player.play().catch(() => {});
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR)
          hls.recoverMediaError();
      }
    });
  }

  player.ready(() => {
    const el = player.el();
    el.setAttribute("tabindex", "-1");
    el.focus();
    if (volumeDisplay)
      volumeDisplay.innerText = Math.round(player.volume() * 100) + "%";
  });
}

// --- 8. Инициализация и события ---
window.addEventListener("DOMContentLoaded", () => {
  window.showDetails = showDetails;

  document.querySelectorAll(".nav-item[data-screen]").forEach((btn) => {
    btn.onclick = () => {
      const target = btn.dataset.screen;
      lastActiveScreen = target === "home" ? "catalog" : "catalog-screen";
      document
        .querySelectorAll(".nav-item")
        .forEach((i) => i.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("catalog").style.display =
        target === "home" ? "block" : "none";
      document.getElementById("catalog-screen").style.display =
        target === "catalog" ? "block" : "none";
      document.getElementById("anime-details").style.display = "none";
      if (target === "catalog" && currentPage === 0) loadNextPage();
      viewport.scrollTo(0, 0);
    };
  });

  document.getElementById("open-settings-btn").onclick = openSettings;
  document.getElementById("save-settings-confirm").onclick = saveNewSettings;
  document.getElementById("close-settings-btn").onclick = () =>
    (document.getElementById("settings-modal").style.display = "none");

  document.getElementById("infinite-list").addEventListener("click", (e) => {
    const row = e.target.closest(".catalog-row");
    if (row) showDetails(row.dataset.id);
  });

  observer.observe(document.getElementById("loading-trigger"));
  init();
});
