import { app } from "../../scripts/app.js";
import { $el, ComfyDialog } from "../../scripts/ui.js";
import { api } from "../../scripts/api.js";
import { renderMarkdown } from "./markdown.js";
import { playBrowserSound } from "./sounds.js";

const browserUrl = "./browser/web/index.html";

const localStorageKey = 'comfyui-browser';

function getLocalConfig() {
  let localConfig = localStorage.getItem(localStorageKey);
  if (localConfig) {
    localConfig = JSON.parse(localConfig);
  } else {
    localConfig = {};
  }

  return localConfig;
}

function setLocalConfig(key, value) {
  let localConfig = getLocalConfig();
  localConfig[key] = value;
  localStorage.setItem(localStorageKey, JSON.stringify(localConfig));
}

class BrowserDialog extends ComfyDialog {
  constructor() {
    super();

    const localConfig = getLocalConfig();
    let modalStyle = {
      width: "70%",
      height: "80%",
      maxWidth: "100%",
      maxHeight: "100%",
      minWidth: "24%",
      minHeight: "24%",
      padding: "6px",
      zIndex: 1000,
      resize: 'none',
    };
    const cs = localConfig.modalStyles;
    this.viewMode = localConfig.viewMode || (cs && cs.left === "0px" ? "side" : "full");
    if (cs) {
      modalStyle.left = cs.left;
      modalStyle.top = cs.top;
      modalStyle.transform = cs.transform;
      modalStyle.height = cs.height;
      modalStyle.width = cs.width;
    }

    this.browserIframe = $el("iframe", {
      src: browserUrl + "?timestamp=" + Date.now(),
      style: {
        width: "100%",
        height: "100%",
      },
    });
    this.browserIframe.addEventListener("load", () => this.postViewMode());

    this.element = $el("div.comfy-modal", {
      id: "comfy-browser-dialog",
      parent: document.body,
      style: modalStyle,
    }, [
      $el("div.comfy-modal-content", {
        style: {
          width: "100%",
          height: "100%",
        },
      }, [
        this.browserIframe,
      ]),
		]);

    this.element.appendChild($el("div", {
      role: "separator",
      "aria-label": "Resize browser window",
      title: "Drag the right edge to resize the browser",
      tabIndex: 0,
      style: {
        position: "absolute",
        right: "0",
        top: "0",
        bottom: "0",
        width: "8px",
        cursor: "ew-resize",
        zIndex: 1001,
        background: "transparent",
      },
      onpointerenter: (event) => { event.currentTarget.style.background = "rgba(120, 170, 255, 0.25)"; },
      onpointerleave: (event) => { event.currentTarget.style.background = "transparent"; },
      onpointerdown: (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = this.element.getBoundingClientRect();
        this.element.style.left = `${rect.left}px`;
        this.element.style.top = `${rect.top}px`;
        this.element.style.transform = "none";
        const startX = event.clientX;
        const startWidth = rect.width;
        const onMove = (moveEvent) => {
          const nextWidth = Math.max(320, Math.min(window.innerWidth * 0.96, startWidth + moveEvent.clientX - startX));
          this.element.style.width = `${nextWidth}px`;
        };
        const onUp = () => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onUp);
          window.removeEventListener("blur", onUp);
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
        window.addEventListener("blur", onUp, { once: true });
      },
      onkeydown: (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const rect = this.element.getBoundingClientRect();
        const step = event.key === "ArrowRight" ? 24 : -24;
        const nextWidth = Math.max(320, Math.min(window.innerWidth * 0.96, rect.width + step));
        this.element.style.width = `${nextWidth}px`;
      },
    }));

    this.createPreviewWindow();
    this.onPreviewMessage = (event) => {
      if (event.source !== this.browserIframe.contentWindow) return;
      const message = event.data;
      if (message?.source !== "comfyui-browser") return;
      if (message.type === "invalid-operation") {
        this.flashCaptureGlow();
        return;
      }
      if (message.type === "toggle-view-mode") {
        this.toggleSidePanel();
        return;
      }
      if (message.type === "preview-state") {
        this.updatePreviewNavigationState(message.position);
        return;
      }
      if (message.type !== "preview") return;
      this.previewInteractionCounter = (this.previewInteractionCounter || 0) + 1;
      if (message.file) {
        this.openPreview(message.file, message.mode);
        this.updatePreviewNavigationState(message.position);
      }
      else this.closePreview();
    };
    window.addEventListener("message", this.onPreviewMessage);
    this.onBrowserOutsidePointerDown = (event) => {
      if (this.element.contains(event.target)) return;
      this.browserIframe.contentWindow?.postMessage({ source: "comfyui-browser-host", type: "dismiss-root-settings" }, "*");
    };
    window.addEventListener("pointerdown", this.onBrowserOutsidePointerDown);
    this.onPreviewKeyDown = (event) => {
      if (!this.previewOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.closePreview();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, button, video, audio, [contenteditable='true']")) return;
      event.preventDefault();
      this.browserIframe.contentWindow?.postMessage({
        source: "comfyui-browser-host",
        type: "preview-navigate",
        direction: event.key === "ArrowLeft" ? -1 : 1,
      }, "*");
    };
    window.addEventListener("keydown", this.onPreviewKeyDown);
    this.onMouseNavigation = (event) => {
      if (event.button !== 3 && event.button !== 4) return;
      const browserVisible = this.element.isConnected && getComputedStyle(this.element).display !== "none";
      if (!this.previewOpen && !browserVisible) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.previewOpen) {
        const direction = event.button === 3 ? 1 : -1;
        this.navigatePreview(direction, event.ctrlKey);
      } else {
        const direction = event.button === 3 ? -1 : 1;
        this.browserIframe.contentWindow?.postMessage({
          source: "comfyui-browser-host",
          type: "browser-mouse-navigate",
          direction,
          jumpToEdge: event.ctrlKey,
        }, "*");
      }
    };
    window.addEventListener("auxclick", this.onMouseNavigation, true);

    this.resizeObserver = new ResizeObserver(this.onResize.bind(this));
    this.resizeObserver.observe(this.element);
  }

  createPreviewWindow() {
    this.previewDialog = document.createElement("div");
    this.previewDialog.id = "comfy-browser-preview-dialog";
    Object.assign(this.previewDialog.style, {
      position: "fixed",
      display: "none",
      flexDirection: "column",
      boxSizing: "border-box",
      zIndex: "1002",
      minWidth: "280px",
      minHeight: "240px",
      maxWidth: "92vw",
      maxHeight: "92vh",
      padding: "8px",
      resize: "none",
      overflow: "hidden",
      border: "1px solid var(--border-color, #555)",
      borderRadius: "8px",
      background: "rgba(30, 32, 38, 0.9)",
      backdropFilter: "blur(4px)",
      color: "var(--input-text, #eee)",
      boxShadow: "0 8px 30px rgba(0,0,0,.55)",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flex: "0 0 auto",
      minHeight: "34px",
      cursor: "grab",
      userSelect: "none",
      padding: "0 4px 6px 4px",
    });
    header.title = "Drag to move the preview window";
    this.previewTitle = document.createElement("div");
    Object.assign(this.previewTitle.style, {
      flex: "1",
      minWidth: "0",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontWeight: "600",
    });
    this.previewSize = document.createElement("span");
    Object.assign(this.previewSize.style, { fontSize: "12px", opacity: ".7", whiteSpace: "nowrap" });
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "×";
    closeButton.title = "Close preview";
    Object.assign(closeButton.style, { width: "30px", height: "28px", cursor: "pointer", fontSize: "22px", color: "inherit", background: "transparent", border: "0" });
    closeButton.addEventListener("click", () => this.closePreview());
    header.append(this.previewTitle, this.previewSize, closeButton);
    header.addEventListener("pointerdown", (event) => this.startPreviewMove(event, header));

    this.previewStage = document.createElement("div");
    Object.assign(this.previewStage.style, {
      position: "relative",
      flex: "1 1 auto",
      minHeight: "0",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      borderRadius: "4px",
      background: "rgba(0,0,0,.25)",
    });
    this.previewContent = document.createElement("div");
    Object.assign(this.previewContent.style, { position: "relative", flex: "1 1 auto", minHeight: "0", width: "100%", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" });
    this.previewFooter = document.createElement("div");
    Object.assign(this.previewFooter.style, { flex: "0 0 56px", display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", color: "rgba(255,255,255,.8)", fontSize: "13px" });
    this.previewPositionLabel = document.createElement("span");
    this.previewPositionLabel.setAttribute("aria-live", "polite");
    Object.assign(this.previewPositionLabel.style, { minWidth: "56px", textAlign: "center", fontVariantNumeric: "tabular-nums" });
    this.previewFooter.append(this.previewPositionLabel);
    this.previewStage.append(this.previewContent, this.previewFooter);
    this.previewStage.title = "← / → previous or next · scroll to zoom · drag to move · double-click to reset";
    this.previewStage.addEventListener("wheel", (event) => {
      if (!this.previewImage) return;
      event.preventDefault();
      this.setPreviewZoom(this.previewZoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
    }, { passive: false });
    this.previewStage.addEventListener("dblclick", () => this.resetPreviewZoom());
    this.previewStage.addEventListener("pointerdown", (event) => this.startImagePan(event));
    this.previewStage.addEventListener("pointermove", (event) => this.moveImagePan(event));
    this.previewStage.addEventListener("pointerup", () => this.stopImagePan());
    this.previewStage.addEventListener("pointercancel", () => this.stopImagePan());
    window.addEventListener("blur", () => this.stopImagePan());
    this.previewNavigationButtons = [
      this.createPreviewNavigationButton(-1, "Previous preview (←)"),
      this.createPreviewNavigationButton(1, "Next preview (→)"),
    ];

    this.previewDialog.append(header, this.previewStage);
    const edge = document.createElement("div");
    edge.setAttribute("role", "separator");
    edge.setAttribute("aria-label", "Resize preview window");
    edge.title = "Drag the right edge to resize preview";
    Object.assign(edge.style, { position: "absolute", right: "0", top: "0", bottom: "0", width: "8px", cursor: "ew-resize", zIndex: "2", background: "transparent" });
    edge.addEventListener("pointerenter", () => edge.style.background = "rgba(120,170,255,.25)");
    edge.addEventListener("pointerleave", () => edge.style.background = "transparent");
    edge.addEventListener("pointerdown", (event) => this.startPreviewResize(event, edge));
    this.previewDialog.appendChild(edge);
    document.body.appendChild(this.previewDialog);
    this.previewZoom = 1;
    this.previewPanX = 0;
    this.previewPanY = 0;
    this.previewToken = 0;
    this.previewOpen = false;
    this.previewDetached = false;
    this.onPreviewOutsidePointerDown = (event) => {
      if (!this.previewOpen || this.previewDialog.contains(event.target)) return;
      if (event.button === 3 || event.button === 4) return;
      if (event.target === this.browserIframe) {
        const interaction = this.previewInteractionCounter = (this.previewInteractionCounter || 0) + 1;
        this.closePreview(false);
        window.setTimeout(() => {
          if (interaction === this.previewInteractionCounter && !this.previewOpen) {
            this.browserIframe.contentWindow?.postMessage({ source: "comfyui-browser-host", type: "preview-closed" }, "*");
          }
        }, 180);
        return;
      }
      this.closePreview();
    };
  }

  openPreview(file, mode = this.viewMode) {
    const nextMode = mode === "side" ? "side" : "full";
    if (nextMode === "full") this.applyPreviewSplit();
    else this.restorePreviewSplit();
    if (!this.previewWidth || this.previewWidthMode !== nextMode) {
      this.previewWidth = nextMode === "full"
        ? Math.max(280, (window.innerWidth - 24) / 2)
        : Math.min(window.innerWidth * 0.38, 640);
      this.previewWidthMode = nextMode;
    }
    this.previewMode = nextMode;
    this.positionPreviewNavigationButtons();
    this.previewDetached = false;
    this.previewOpen = true;
    this.previewFile = file;
    this.previewDialog.style.display = "flex";
    this.positionPreviewDialog();
    this.renderPreview(file);
    document.addEventListener("pointerdown", this.onPreviewOutsidePointerDown, true);
  }

  closePreview(notifyFrame = true) {
    if (!this.previewOpen) return;
    this.previewOpen = false;
    this.previewDetached = false;
    this.previewFile = null;
    this.previewToken += 1;
    this.previewDialog.style.display = "none";
    this.restorePreviewSplit();
    this.previewImage = null;
    document.removeEventListener("pointerdown", this.onPreviewOutsidePointerDown, true);
    if (notifyFrame) this.browserIframe.contentWindow?.postMessage({ source: "comfyui-browser-host", type: "preview-closed" }, "*");
  }

  navigatePreview(direction, jumpToEdge = false) {
    if (!this.previewOpen || !direction) return;
    const button = this.previewNavigationButtons.find((item) => item.dataset.direction === String(direction));
    if (!jumpToEdge && button?.getAttribute("aria-disabled") === "true") {
      playBrowserSound("invalid");
      this.flashCaptureGlow();
      return;
    }
    this.browserIframe.contentWindow?.postMessage({
      source: "comfyui-browser-host",
      type: "preview-navigate",
      direction,
      jumpToEdge,
    }, "*");
  }

  flashCaptureGlow() {
    const target = this.previewOpen ? this.previewDialog : this.element;
    if (!target?.isConnected) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const glow = document.createElement("div");
    Object.assign(glow.style, {
      position: "fixed",
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
      boxSizing: "border-box", zIndex: "1003", pointerEvents: "none",
      border: "2px solid rgba(255, 32, 32, .95)", borderRadius: "8px",
      boxShadow: "inset 0 0 38px 8px rgba(255, 20, 20, .65), 0 0 24px 5px rgba(255, 20, 20, .8)",
    });
    document.body.appendChild(glow);
    glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 0 }], { duration: 720, easing: "ease-out" })
      .onfinish = () => glow.remove();
  }

  createPreviewNavigationButton(direction, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.dataset.direction = String(direction);
    button.innerHTML = direction < 0
      ? '<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    Object.assign(button.style, {
      zIndex: "1",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxSizing: "border-box",
      flex: "0 0 48px",
      width: "48px",
      height: "48px",
      padding: "0",
      border: "1px solid rgba(255,255,255,.5)",
      borderRadius: "50%",
      background: "rgba(0,0,0,.68)",
      color: "#fff",
      lineHeight: "0",
      cursor: "pointer",
      boxShadow: "0 2px 10px rgba(0,0,0,.45)",
      scale: "1",
      transition: "scale 120ms ease, background-color 120ms ease, opacity 120ms ease",
    });
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (button.getAttribute("aria-disabled") !== "true") button.style.scale = ".9";
    });
    const releasePress = () => { button.style.scale = "1"; };
    button.addEventListener("pointerup", releasePress);
    button.addEventListener("pointercancel", releasePress);
    button.addEventListener("pointerleave", releasePress);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.navigatePreview(direction);
    });
    return button;
  }

  positionPreviewNavigationButtons() {
    for (const button of this.previewNavigationButtons || []) {
      if (this.previewMode === "side") {
        Object.assign(button.style, { position: "static", top: "auto", bottom: "auto", left: "auto", right: "auto", transform: "none" });
        this.previewFooter.insertBefore(button, this.previewPositionLabel);
      } else {
        const previous = button.dataset.direction === "-1";
        Object.assign(button.style, { position: "absolute", top: "50%", bottom: "auto", left: previous ? "12px" : "auto", right: previous ? "auto" : "12px", transform: "translateY(-50%)" });
        this.previewContent.appendChild(button);
      }
    }
  }

  updatePreviewNavigationState(position) {
    if (!position || !Number.isFinite(position.index) || !Number.isFinite(position.total)) return;
    this.previewPositionLabel.textContent = `${position.index}/${position.total}`;
    const atStart = position.index <= 1;
    const atEnd = position.index >= position.total;
    for (const button of this.previewNavigationButtons) {
      const disabled = button.dataset.direction === "-1" ? atStart : atEnd;
      button.style.opacity = disabled ? ".38" : "1";
      button.style.cursor = disabled ? "not-allowed" : "pointer";
      button.style.background = disabled ? "rgba(100,100,100,.55)" : "rgba(0,0,0,.68)";
      button.setAttribute("aria-disabled", String(disabled));
    }
  }

  positionPreviewDialog() {
    if (!this.previewOpen || !this.previewDialog || this.previewDetached) return;
    const rect = this.element.getBoundingClientRect();
    if (this.previewMode === "full") {
      const gap = 8;
      const minWidth = Math.min(280, window.innerWidth - 16);
      const rightSpace = window.innerWidth - rect.right - gap - 8;
      const width = Math.max(minWidth, Math.min(this.previewWidth || rightSpace, rightSpace));
      const height = Math.min(rect.height, window.innerHeight - 16);
      this.previewDialog.style.width = `${width}px`;
      this.previewDialog.style.height = `${height}px`;
      this.previewDialog.style.left = `${Math.max(8, rect.right + gap)}px`;
      this.previewDialog.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, rect.top))}px`;
      return;
    }

    const gap = 12;
    const desiredWidth = Math.min(this.previewWidth || Math.min(640, window.innerWidth * 0.36), window.innerWidth * 0.45);
    const rightX = rect.right + gap;
    const rightSpace = window.innerWidth - rightX - 8;
    const width = Math.min(desiredWidth, rightSpace);
    const left = width >= 280
      ? rightX
      : Math.max(8, Math.min(window.innerWidth - desiredWidth - 8, rect.left + (rect.width - desiredWidth) / 2));
    const finalWidth = width >= 280 ? width : Math.min(desiredWidth, window.innerWidth - 16);
    this.previewDialog.style.width = `${finalWidth}px`;
    this.previewDialog.style.height = `${Math.min(rect.height, window.innerHeight - 16)}px`;
    this.previewDialog.style.left = `${left}px`;
    this.previewDialog.style.top = `${Math.max(8, rect.top)}px`;
  }

  applyPreviewSplit() {
    const enteringSplit = !this.previewSplitLayout;
    if (enteringSplit) {
      const element = this.element;
      const rect = element.getBoundingClientRect();
      this.previewSplitLayout = {
        left: element.style.left,
        top: element.style.top,
        transform: element.style.transform,
        width: element.style.width,
        config: getLocalConfig().modalStyles,
        rectTop: rect.top,
      };
    }
    const browserWidth = Math.max(280, (window.innerWidth - 24) / 2);
    Object.assign(this.element.style, {
      left: "8px",
      top: `${Math.max(8, Math.min(window.innerHeight - 300, this.previewSplitLayout.rectTop))}px`,
      transform: "none",
      width: `${browserWidth}px`,
    });
    if (enteringSplit || this.previewWidthMode !== "full") {
      this.previewWidth = Math.max(280, window.innerWidth - browserWidth - 24);
    }
    this.previewWidthMode = "full";
  }

  restorePreviewSplit() {
    if (!this.previewSplitLayout) return;
    const saved = this.previewSplitLayout;
    Object.assign(this.element.style, {
      left: saved.left,
      top: saved.top,
      transform: saved.transform,
      width: saved.width,
    });
    setLocalConfig("modalStyles", saved.config);
    this.previewSplitLayout = null;
  }

  renderPreview(file) {
    const token = ++this.previewToken;
    this.previewTitle.textContent = file.name || "Preview";
    this.previewSize.textContent = file.formattedSize || "";
    this.previewContent.replaceChildren();
    this.previewImage = null;
    this.resetPreviewZoom();
    const url = file.previewUrl || file.url;
    if (file.fileType === "image") {
      const image = document.createElement("img");
      image.src = url;
      image.alt = file.name || "";
      image.draggable = false;
      Object.assign(image.style, { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", userSelect: "none", transformOrigin: "center", cursor: "grab" });
      this.previewImage = image;
      this.previewContent.appendChild(image);
    } else if (file.fileType === "video") {
      const video = document.createElement("video");
      video.src = url;
      video.controls = true;
      video.playsInline = true;
      Object.assign(video.style, { maxWidth: "100%", maxHeight: "100%", background: "#000" });
      this.previewContent.appendChild(video);
    } else if (file.fileType === "audio") {
      const audio = document.createElement("audio");
      audio.src = file.url;
      audio.controls = true;
      audio.style.width = "min(90%, 600px)";
      this.previewContent.appendChild(audio);
    } else {
      const textPreview = document.createElement(file.fileType === "markdown" ? "div" : "pre");
      if (file.fileType === "markdown") {
        Object.assign(textPreview.style, { width: "100%", height: "100%", overflow: "auto", margin: "0", padding: "12px", background: "rgba(0,0,0,.2)" });
      } else {
        Object.assign(textPreview.style, { width: "100%", height: "100%", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "0", padding: "12px", fontSize: "12px", background: "rgba(0,0,0,.2)" });
      }
      textPreview.textContent = "Loading preview…";
      this.previewContent.appendChild(textPreview);
      fetch(file.url).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      }).then((text) => {
        if (token === this.previewToken) {
          if (file.fileType === "markdown") textPreview.innerHTML = renderMarkdown(text, file.url);
          else textPreview.textContent = text;
        }
      }).catch((error) => {
        if (token === this.previewToken) textPreview.textContent = `Could not load preview: ${error}`;
      });
    }
    this.positionPreviewNavigationButtons();
  }

  setPreviewZoom(value) {
    this.previewZoom = Math.max(0.2, Math.min(6, value));
    this.updatePreviewImageTransform();
  }

  resetPreviewZoom() {
    this.previewZoom = 1;
    this.previewPanX = 0;
    this.previewPanY = 0;
    this.updatePreviewImageTransform();
  }

  updatePreviewImageTransform() {
    if (!this.previewImage) return;
    this.previewImage.style.transform = `translate(${this.previewPanX}px, ${this.previewPanY}px) scale(${this.previewZoom})`;
  }

  startImagePan(event) {
    if (!this.previewImage || event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
    this.imagePanOrigin = { x: event.clientX, y: event.clientY, panX: this.previewPanX, panY: this.previewPanY };
    this.previewStage.setPointerCapture(event.pointerId);
  }

  moveImagePan(event) {
    if (!this.imagePanOrigin) return;
    this.previewPanX = this.imagePanOrigin.panX + event.clientX - this.imagePanOrigin.x;
    this.previewPanY = this.imagePanOrigin.panY + event.clientY - this.imagePanOrigin.y;
    this.updatePreviewImageTransform();
  }

  stopImagePan() {
    this.imagePanOrigin = null;
  }

  startPreviewMove(event, header) {
    if (event.button !== 0 || event.target.closest("button")) return;
    this.previewDetached = true;
    header.style.cursor = "grabbing";
    const rect = this.previewDialog.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    header.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      this.previewDialog.style.left = `${Math.max(0, Math.min(window.innerWidth - rect.width, start.left + moveEvent.clientX - start.x))}px`;
      this.previewDialog.style.top = `${Math.max(0, Math.min(window.innerHeight - rect.height, start.top + moveEvent.clientY - start.y))}px`;
    };
    const up = () => {
      header.style.cursor = "grab";
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    window.addEventListener("blur", up, { once: true });
  }

  startPreviewResize(event, edge) {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = this.previewDialog.getBoundingClientRect();
    const startX = event.clientX;
    edge.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      const maxWidth = window.innerWidth - rect.left - 8;
      this.previewWidth = Math.max(280, Math.min(maxWidth, rect.width + moveEvent.clientX - startX));
      this.previewDialog.style.width = `${this.previewWidth}px`;
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    window.addEventListener("blur", up, { once: true });
  }

  postViewMode() {
    window.__comfyuiBrowserViewMode = this.viewMode;
    this.browserIframe.contentWindow?.postMessage({ source: "comfyui-browser-host", type: "view-mode", mode: this.viewMode }, "*");
  }

  onResize() {
    if (this.previewOpen) {
      this.positionPreviewDialog();
      return;
    }
    const e = this.element;
    setLocalConfig('modalStyles', {
      left: e.style.left,
      top: e.style.top,
      transform: e.style.transform,
      height: e.style.height,
      width: e.style.width,
    });
  }

  toggleSidePanel() {
    const e = this.element;
    this.restorePreviewSplit();
    // Geometry can be customized independently (including a full view at x=0),
    // so it cannot reliably identify the current mode.
    if (this.viewMode === 'side') {
      e.style.left = '';
      e.style.top = '';
      e.style.transform = '';
      e.style.height = '85%';
      e.style.width = '80%';
      this.viewMode = 'full';
    } else {
      e.style.left = '0px';
      e.style.top = '0px';
      e.style.transform = 'translate(-10px, -10px)';
      e.style.height = '100%';
      e.style.width = '32%';
      this.viewMode = 'side';
    }
    setLocalConfig('viewMode', this.viewMode);
    this.postViewMode();
    setLocalConfig('modalStyles', {
      left: e.style.left,
      top: e.style.top,
      transform: e.style.transform,
      height: e.style.height,
      width: e.style.width,
    });
    if (this.previewOpen) {
      this.previewMode = this.viewMode;
      if (this.previewMode === "full") this.applyPreviewSplit();
      this.previewDetached = false;
      this.positionPreviewNavigationButtons();
      this.positionPreviewDialog();
    }
  }

  close() {
    this.closePreview();
    this.element.style.display = "none";
  }

  show() {
    this.element.style.display = "flex";
    this.postViewMode();
    dispatchEvent(new Event('comfyuiBrowserShow'));
  }

  toggle() {
    const e = this.element;
    if (e.style.display === "none") {
      this.show();
    } else {
      this.close();
    }
  }
}

function showToast(text, onClick) {
  const toastId = 'comfy-browser-toast';
  let toast = document.getElementById(toastId);
  if (! toast) {
    toast = $el("p", {
      id: toastId,
      textContent: '',
      onclick: onClick,
      style: {
        position: 'fixed',
        top: '70%',
        left: '34%',
        zIndex: 999,
        backgroundColor: 'var(--comfy-menu-bg)',
        fontSize: '42px',
        color: 'green',
        padding: '8px',
        border: 'green',
        borderStyle: 'solid',
        borderRadius: '0.5rem',
        display: 'none',
      }
    });
    document.body.appendChild(toast);
  }

  toast.textContent = text;
  toast.style.display = 'block';

  setTimeout(() => {
    toast.style.display = 'none';
  }, 2000);
}

app.registerExtension({
  name: "ComfyUI.Browser",
  init() {
  },
  async setup() {
    const browserDialog = new BrowserDialog();

    document.addEventListener('keydown', (event) => {
      if (event.key === 'b') {
        if (event.target.matches('input, textarea')) {
          return;
        }

        browserDialog.toggle();
        event.preventDefault();
      }
    });
 //  add event listener for ctrl+i
    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.key === 'i') {
        browserDialog.toggle();
        event.preventDefault();
      }
    })
    app.ui.menuContainer.appendChild(
      $el("div.comfy-list", {
        style: {
          width: "100%",
          "border-style": "none",
          "margin-bottom": "none",
        }
      }, [
        $el("button", {
          id: "comfyui-browser-button",
          textContent: "Browser",
          title: "Browse and manage your outputs and collections",
          style: {
            "font-size": "20px",
            color: "red !important",
            //color: "var(--descrip-text) !important",
            width: "80%",
          },
          onclick: () => { browserDialog.show() },
        }),
        $el("button", {
          id: "comfyui-browser-collect-button",
          textContent: "💾",
          title: "Save workflow to collections",
          style: {
            width: "20%",
            "font-size": "17px",
          },
          onclick: (e) => {
            const saveBtn = e.target;
            const originBtnStyle = saveBtn.style.cssText;

            let filename = "workflow.json";
            const promptFilename = app.ui.settings.getSettingValue(
              "Comfy.PromptFilename",
              true,
            );
            if (promptFilename) {
              filename = prompt("Collect workflow as:", filename);
              if (!filename) return;
              if (!filename.toLowerCase().endsWith(".json")) {
                filename += ".json";
              }
            }
            app.graphToPrompt().then(async p => {
              const json = JSON.stringify(p.workflow, null, 2); // convert the data to a JSON string
              const res = await api.fetchApi("/browser/collections/workflows", {
                method: "POST",
                body: JSON.stringify({
                  filename: filename,
                  content: json,
                }),
              });
              if (res.ok) {
                saveBtn.style = originBtnStyle + "border-color: green;";
                showToast(
                  'Saved. Click me to open.',
                  () => { browserDialog.show() },
                );
              } else {
                saveBtn.style = originBtnStyle + "border-color: red;";
              }
              setTimeout(() => {
                saveBtn.style = originBtnStyle;
              }, 1000);
            });
          },
        }),
      ])
    );

    try{
      // new menu based features
      // browser and save to collection button into new style menu
      let cbGroup = new (await import("../../scripts/ui/components/buttonGroup.js")).ComfyButtonGroup(
        new(await import("../../scripts/ui/components/button.js")).ComfyButton({
          action: () => {
            if(browserDialog)
              browserDialog.show();
          },
          tooltip: "Browse and manage your outputs and collections",
          content: "📚",
          // content: "🪟",
          // content: "Browser",
          // icon: "table",// cloud, folder, folder-open, table, database, server
					// classList: "comfyui-button comfyui-menu-mobile-collapse primary"
					classList: "comfyui-button comfyui-menu-mobile-collapse "
        }).element,
        new(await import("../../scripts/ui/components/button.js")).ComfyButton({
          action: (e) => {
            const saveBtn = e.target;
            const originBtnStyle = saveBtn.style.cssText;

            let filename = "workflow.json";
            const promptFilename = app.ui.settings.getSettingValue(
              "Comfy.PromptFilename",
              true,
            );
            if (promptFilename) {
              filename = prompt("Collect workflow as:", filename);
              if (!filename) return;
              if (!filename.toLowerCase().endsWith(".json")) {
                filename += ".json";
              }
            }
            app.graphToPrompt().then(async p => {
              const json = JSON.stringify(p.workflow, null, 2); // convert the data to a JSON string
              const res = await api.fetchApi("/browser/collections/workflows", {
                method: "POST",
                body: JSON.stringify({
                  filename: filename,
                  content: json,
                }),
              });
              if (res.ok) {
                saveBtn.style = originBtnStyle + "border-color: green;";
                showToast(
                  'Saved. Click me to open.',
                  () => { browserDialog.show() },
                );
              } else {
                saveBtn.style = originBtnStyle + "border-color: red;";
              }
              setTimeout(() => {
                saveBtn.style = originBtnStyle;
              }, 1000);
            });
          },
          tooltip: "Save workflow to collections",
          content: "💾",
          classList: "comfyui-button comfyui-menu-mobile-collapse "
        }).element
      );
      app.menu?.settingsGroup.element.before(cbGroup.element);

    }catch(exception){
      console.log('ComfyUI-Browser could not load new menu based features.');
    }
  },
});
