import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import "./styles.css";

const appWindow = getCurrentWindow();
let player = null;
let hudTimer = null;

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
    this.player_.src({ src: this.src, type: "application/x-mpegURL" });
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

async function init() {
  const list = await invoke("get_catalog");
  const container = document.getElementById("anime-list");
  container.innerHTML = list
    .map(
      (a) => `
    <div class="card" data-id="${a.id}">
        <img src="https://anilibria.top${a.poster.src}">
        <div class="card-info"><h3>${a.name.main}</h3></div>
    </div>
  `,
    )
    .join("");

  container.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) showDetails(card.dataset.id);
  });
}

async function showDetails(id) {
  const catalog = document.getElementById("catalog");
  const details = document.getElementById("anime-details");
  catalog.style.display = "none";
  details.style.display = "block";

  const release = await invoke("get_full_release", { id: String(id) });
  const content = document.getElementById("details-content");

  content.innerHTML = `
    <button id="back-to-catalog" class="back-btn">← Назад</button>
    <div class="details-layout">
        <div class="details-sidebar"><img src="https://anilibria.top${release.poster.src}"></div>
        <div class="details-main">
            <h1>${release.name.main}</h1>
            <p class="description">${release.description}</p>
            <div class="ep-list">
                ${release.episodes.map((e) => `<button class="ep-btn" data-uuid="${e.id}" data-ord="${e.ordinal}">Серия ${e.ordinal}</button>`).join("")}
            </div>
        </div>
    </div>
  `;

  content.querySelectorAll(".ep-btn").forEach((btn) => {
    btn.onclick = () =>
      openPlayer(
        btn.dataset.uuid,
        `Серия ${btn.dataset.ord} — ${release.name.main}`,
      );
  });
  content.querySelector("#back-to-catalog").onclick = () => {
    details.style.display = "none";
    catalog.style.display = "block";
  };
}

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
      playbackRates: [0.5, 1, 1.25, 1.5, 2],
      userActions: { hotkeys: true },
    });

    const fsToggle = player.controlBar.getChild("fullscreenToggle");
    if (fsToggle) {
      fsToggle.on("click", async (e) => {
        e.preventDefault();
        const isFs = await appWindow.isFullscreen();
        await appWindow.setFullscreen(!isFs);
      });
    }

    const showHud = () => {
      hud.classList.remove("hud-hidden");
      overlay.style.cursor = "default";
      clearTimeout(hudTimer);
      hudTimer = setTimeout(() => {
        if (!player.paused()) {
          hud.classList.add("hud-hidden");
          overlay.style.cursor = "none";
        }
      }, 3000);
    };

    overlay.onmousemove = showHud;
    player.on("play", showHud);

    player.on("ended", () => {
      const currentBtn = document.querySelector(`.ep-btn[data-uuid="${uuid}"]`);
      const nextBtn = currentBtn?.nextElementSibling;
      if (nextBtn && nextBtn.classList.contains("ep-btn")) {
        nextBtn.click();
      } else {
        appWindow.setFullscreen(false);
      }
    });
  }

  const oldMenu = player.controlBar.getChild("QualityMenu");
  if (oldMenu) player.controlBar.removeChild(oldMenu);
  player.controlBar.addChild(
    "QualityMenu",
    { sources },
    player.controlBar.children().length - 1,
  );

  player.src({ src: sources[0].src, type: "application/x-mpegURL" });
}

document.getElementById("close-player").onclick = async () => {
  if (player) {
    player.pause();
    await appWindow.setFullscreen(false);
  }
  document.getElementById("video-overlay").style.display = "none";
  document.getElementById("app-shell").style.display = "block";
};

init();
