import {
  createRootSettingsClient,
  formatSettingsError,
  legacyDataImportPlanHasWork,
  normalizeCharacterSettingsSnapshot,
} from "./root-settings-runtime.js";
import { findProviderModelSelectionIssue } from "./provider-model-runtime.js";
import {
  applyCharacterCatalogChange,
  applyCharacterSwitch,
  commitCharacterSelection,
  hasCharacterScopedDrafts,
  pendingCharacterSelection,
  syncCharacterEditorControl,
  setCharacterSwitchLock,
} from "./character-switch-runtime.js";
import {
  drawHueSurface,
  drawSaturationValueSurface,
} from "./theme-color-picker.js";
import {
  applyThemeTokens,
  isHexColor,
  normalizeColorText,
} from "../core/theme-runtime.js";
import { installDevtoolsShortcutGuard } from "../core/devtools-guard.js";

installDevtoolsShortcutGuard();

const nativeInvoke = window.__TAURI__.core.invoke;
let runtimeDiagnostics = null;
const runtimeDiagnosticsReady = import("../core/runtime-diagnostics.js")
  .then(({ createRuntimeDiagnostics }) => {
    runtimeDiagnostics = createRuntimeDiagnostics({ invoke: nativeInvoke });
    return runtimeDiagnostics;
  })
  .catch(() => null);
function invoke(command, args) {
  if (runtimeDiagnostics) return runtimeDiagnostics.invoke(command, args);
  return runtimeDiagnosticsReady.then((diagnostics) => (
    diagnostics ? diagnostics.invoke(command, args) : nativeInvoke(command, args)
  ));
}
const rootSettingsClient = createRootSettingsClient({ invoke });
const settingsCloseFlowPromise = import("./close-flow.js");
const runtimeFontsReadyPromise = import("../core/font-loader.js")
  .then(({ waitForRuntimeFonts }) => waitForRuntimeFonts({ families: ["sc"] }))
  .catch(() => {
    document.documentElement.dataset.runtimeFonts = "fallback";
    return "fallback";
  });

document.addEventListener("contextmenu", (event) => event.preventDefault());

const fields = {
  characterSelect: document.getElementById("characterSelect"),
  characterImportButton: document.getElementById("characterImportButton"),
  ttsVoiceImportButton: document.getElementById("ttsVoiceImportButton"),
  characterExportButton: document.getElementById("characterExportButton"),
  characterEditorButton: document.getElementById("characterEditorButton"),
  characterArchiveHint: document.getElementById("characterArchiveHint"),
  portraitScale: document.getElementById("portraitScale"),
  controlPanelWidth: document.getElementById("controlPanelWidth"),
  bubbleHeight: document.getElementById("bubbleHeight"),
  bubbleAutoExpand: document.getElementById("bubbleAutoExpand"),
  controlPanelOffset: document.getElementById("controlPanelOffset"),
  inputBarOffset: document.getElementById("inputBarOffset"),
  enabled: document.getElementById("enabled"),
  checkInterval: document.getElementById("checkInterval"),
  cooldown: document.getElementById("cooldown"),
  batchLimit: document.getElementById("batchLimit"),
  screenResolution: document.getElementById("screenResolution"),
  providerStatusStrip: document.getElementById("providerStatusStrip"),
  providerSearch: document.getElementById("providerSearch"),
  addProviderButton: document.getElementById("addProviderButton"),
  providerList: document.getElementById("providerList"),
  providerDetail: document.getElementById("providerDetail"),
  modelSlots: document.getElementById("modelSlots"),
  contextWindowTokens: document.getElementById("contextWindowTokens"),
  apiTimeout: document.getElementById("apiTimeout"),
  apiTemperature: document.getElementById("apiTemperature"),
  apiTopPEnabled: document.getElementById("apiTopPEnabled"),
  apiTopP: document.getElementById("apiTopP"),
  apiMaxTokensEnabled: document.getElementById("apiMaxTokensEnabled"),
  apiMaxTokens: document.getElementById("apiMaxTokens"),
  themeColors: document.getElementById("themeColors"),
  visualEffectMode: document.getElementById("visualEffectMode"),
  themeAiButton: document.getElementById("themeAiButton"),
  resetThemeButton: document.getElementById("resetThemeButton"),
  bubbleAutoHide: document.getElementById("bubbleAutoHide"),
  bubbleAutoHideDelay: document.getElementById("bubbleAutoHideDelay"),
  speechFontSize: document.getElementById("speechFontSize"),
  nameFontSize: document.getElementById("nameFontSize"),
  inputFontSize: document.getElementById("inputFontSize"),
  storageUserRoot: document.getElementById("storageUserRoot"),
  storageTtsRoot: document.getElementById("storageTtsRoot"),
  storageTtsStatus: document.getElementById("storageTtsStatus"),
  storageOpenUserRoot: document.getElementById("storageOpenUserRoot"),
  storageChooseTtsRoot: document.getElementById("storageChooseTtsRoot"),
  storageResetTtsRoot: document.getElementById("storageResetTtsRoot"),
  legacyRoleDataImportButton: document.getElementById("legacyRoleDataImportButton"),
  legacyRoleDataImportStatus: document.getElementById("legacyRoleDataImportStatus"),
  systemFirstRunGuideButton: document.getElementById("systemFirstRunGuideButton"),
  updateStatus: document.getElementById("updateStatus"),
  updateNotes: document.getElementById("updateNotes"),
  updateFeedback: document.getElementById("updateFeedback"),
  updateCheckButton: document.getElementById("updateCheckButton"),
  updateCheckLabel: document.getElementById("updateCheckLabel"),
  updateAutoCheck: document.getElementById("updateAutoCheck"),
  updateActionButton: document.getElementById("updateActionButton"),
  updateActionLabel: document.getElementById("updateActionLabel"),
  telemetryEnabled: document.getElementById("telemetryEnabled"),
  telemetryHelpButton: document.getElementById("telemetryHelpButton"),
  telemetryInstallationId: document.getElementById("telemetryInstallationId"),
  telemetryCopyButton: document.getElementById("telemetryCopyButton"),
  telemetryRegenerateButton: document.getElementById("telemetryRegenerateButton"),
  aboutVersion: document.getElementById("aboutVersion"),
  aboutWebsiteButton: document.getElementById("aboutWebsiteButton"),
  aboutRepositoryButton: document.getElementById("aboutRepositoryButton"),
  aboutChangelogButton: document.getElementById("aboutChangelogButton"),
  aboutSponsorButton: document.getElementById("aboutSponsorButton"),
  errorText: document.getElementById("errorText"),
  saveButton: document.getElementById("saveButton"),
  applyButton: document.getElementById("applyButton"),
  cancelButton: document.getElementById("cancelButton"),
  pageHead: document.querySelector(".page-head"),
  pageTitle: document.getElementById("pageTitle"),
  pageSubtitle: document.getElementById("pageSubtitle"),
  navItems: Array.from(document.querySelectorAll(".nav-item[data-page]")),
  pages: {
    character: document.getElementById("page-character"),
    appearance: document.getElementById("page-appearance"),
    providers: document.getElementById("page-providers"),
    model: document.getElementById("page-model"),
    voice: document.getElementById("page-voice"),
    interaction: document.getElementById("page-interaction"),
    tools: document.getElementById("page-tools"),
    plugins: document.getElementById("page-plugins"),
    system: document.getElementById("page-system"),
    about: document.getElementById("page-about"),
    memory: document.getElementById("page-memory"),
  },
};

let request = null;
let runtimeAppearanceController = null;
let runtimeProviderModelController = null;
let runtimeChatTimingController = null;
let runtimeBubbleAutoHideController = null;
let runtimeToolsController = null;
let runtimePluginController = null;
let latestUpdateSnapshot = null;
let updateActionBusy = false;
let runtimeVoiceController = null;
let runtimeScreenAwarenessController = null;
let runtimeAutostartController = null;
let firstRunGuideController = null;
let runtimeCharacterSnapshot = null;
let runtimeCharacterDraftId = "";
let runtimeCharacterVisualPreviewRevision = 0;
let runtimeCharacterVisualPreviewPromise = Promise.resolve();
let runtimeAppearanceInitialized = false;
let runtimeCapabilityManifest = null;
let runtimeVisualEffectModes = Object.freeze([
  Object.freeze({ id: "solid", label: "纯色块", disabled: false, reason: "" }),
  Object.freeze({ id: "gaussian_blur", label: "高斯模糊", disabled: false, reason: "" }),
  Object.freeze({ id: "liquid_glass", label: "液态玻璃", disabled: false, reason: "" }),
]);
let themeChanged = false;
// 程序化关窗（保存/取消）前置真，避免关窗拦截器把正常关闭误判成「放弃改动」。
let bypassCloseGuard = false;
let settingsWindowClosing = false;
let characterArchiveBusy = false;
let characterSwitching = false;
let characterCatalogRefreshRevision = 0;
const characterExportOptions = [
  {
    kind: "full",
    label: "完整包 (.char)",
    description: "导出角色配置和可携带语音模型，适合完整迁移。",
    requiresVoice: true,
  },
  {
    kind: "card",
    label: "单角色包 (.char)",
    description: "只导出角色配置，不包含语音模型。",
    requiresVoice: false,
  },
  {
    kind: "voice",
    label: "语音包 (.voice)",
    description: "只导出当前角色的可携带 TTS 模型。",
    requiresVoice: true,
  },
];
const memoryState = { rebinding: false };
const runtimeThemeLegacyFields = Object.freeze({
  primary: "primary_color",
  primaryHover: "primary_hover_color",
  accent: "accent_color",
  text: "text_color",
  secondaryText: "secondary_text_color",
  mutedText: "muted_text_color",
  pageBackground: "page_background_color",
  panelBackground: "panel_background_color",
  inputBackground: "input_background_color",
  bubbleBackground: "bubble_background_color",
  border: "border_color",
});

const reduceMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)") || null;

let activeThemeField = "";
let themeEditor = {};
const RUNTIME_UNAVAILABLE_REASON = "该设置能力尚未迁移到 Runtime v2";
const RUNTIME_LAYOUT_DEFAULTS = Object.freeze({
  controlPanelWidth: [[420, 860], 640],
  bubbleHeight: [[96, 400], 128],
  controlPanelOffset: [[-400, 400], 0],
  inputBarOffset: [[0, 400], 0],
});

function disableRuntimeControl(control, { markRow = true } = {}) {
  if (!control) return;
  control.disabled = true;
  control.title = RUNTIME_UNAVAILABLE_REASON;
  control.setAttribute("aria-disabled", "true");
  if (!markRow) return;
  const row = control.closest(".setting-row");
  row?.classList.add("is-disabled");
  if (row) row.title = RUNTIME_UNAVAILABLE_REASON;
}

function prepareRuntimeAppearance(snapshot, themeFields) {
  const theme = Object.fromEntries(
    themeFields.map(([field, legacyField]) => [legacyField, snapshot.appearance.values.themeTokens[field]]),
  );
  const themeDefaults = Object.fromEntries(
    themeFields.map(([field, legacyField]) => [legacyField, snapshot.presentation.themeTokens[field]]),
  );
  const knownCharacters = request?.character?.characters || [];
  const currentCharacter = {
    ...(knownCharacters.find((item) => item.id === snapshot.presentation.characterId) || {}),
    id: snapshot.presentation.characterId,
    display_name: snapshot.presentation.displayName,
    theme,
    default_theme: themeDefaults,
  };
  request = {
    ...(request || {}),
    character: {
      current_character_id: snapshot.presentation.characterId,
      characters: knownCharacters.length
        ? knownCharacters.map((item) => item.id === currentCharacter.id ? currentCharacter : item)
        : [currentCharacter],
    },
    theme: { ...theme, visual_effect_mode: snapshot.appearance.values.visualEffectMode },
    theme_defaults: themeDefaults,
    theme_fields: themeFields.map(([, id, label]) => ({ id, label })),
    visual_effect_modes: runtimeVisualEffectModes.map((mode) => ({ ...mode })),
  };

  renderCharacters();

  renderThemeControls();
  setThemeValues(theme);
  for (const [fieldKey, [bounds, value]] of Object.entries(RUNTIME_LAYOUT_DEFAULTS)) {
    setNumericBounds(fields[fieldKey], bounds);
    fields[fieldKey].value = String(value);
    updateSliderOutput(fieldKey);
  }

  for (const control of [
    fields.ttsVoiceImportButton,
    fields.characterExportButton,
    fields.themeAiButton,
    themeEditor.pick,
  ]) {
    // Each of these shares a row with a migrated control. Disable only the
    // unavailable button so the active character/import/theme controls do not
    // inherit the legacy grey unavailable treatment.
    disableRuntimeControl(control, { markRow: false });
  }
  enhanceSelect(fields.characterSelect);
  enhanceSelect(fields.visualEffectMode);
  refreshSelect(fields.characterSelect);
  refreshSelect(fields.visualEffectMode);
  upgradeSliderControls();
  syncCharacterArchiveState();
}

function setError(message) {
  fields.errorText.textContent = formatSettingsError(message);
}

// 反馈分流：错误常驻 footer 红字（role=alert）走 setError；成功/信息走右上角 toast，自动消失。
const toastStack = document.getElementById("toastStack");

function notify(message, type = "info") {
  const text = String(message ?? "").trim();
  if (!text) {
    return;
  }
  if (type === "error") {
    setError(text);
    return;
  }
  setError("");
  if (!toastStack) {
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast is-${type}`;
  toast.setAttribute("role", "status");
  toast.textContent = text;
  toastStack.append(toast);
  const remove = () => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 220);
  };
  window.setTimeout(remove, 2600);
  toast.addEventListener("click", remove);
}

// ---------- 未保存改动追踪 ----------
function computeDirty() {
  return Boolean(
    runtimeAppearanceController?.isDirty()
    || runtimeProviderModelController?.isDirty()
    || runtimeChatTimingController?.isDirty()
    || runtimeBubbleAutoHideController?.isDirty()
    || runtimeToolsController?.isDirty()
    || runtimePluginController?.isDirty()
    || runtimeVoiceController?.isDirty()
    || runtimeScreenAwarenessController?.isDirty()
    || runtimeAutostartController?.isDirty()
    || pendingRuntimeCharacterId()
  );
}

function refreshDirty() {
  const dirty = computeDirty();
  document.body.classList.toggle("is-dirty", dirty);
  fields.saveButton.classList.toggle("has-changes", dirty);
  syncCharacterArchiveState();
}

let submissionBusy = false;
const submissionDisabledStates = new Map();

function setSubmissionBusy(busy) {
  submissionBusy = Boolean(busy);
  document.body.classList.toggle("is-submitting", submissionBusy);
  document.querySelector(".settings-shell")
    ?.setAttribute("aria-busy", String(submissionBusy));
  document.querySelectorAll("[data-submission-lock]").forEach((surface) => {
    surface.inert = submissionBusy;
  });
  [
    fields.cancelButton,
    fields.applyButton,
    fields.saveButton,
  ].filter(Boolean).forEach((control) => {
    if (submissionBusy) {
      if (!submissionDisabledStates.has(control)) {
        submissionDisabledStates.set(control, control.disabled);
      }
      control.disabled = true;
      return;
    }
    if (submissionDisabledStates.has(control)) {
      control.disabled = submissionDisabledStates.get(control);
      submissionDisabledStates.delete(control);
    }
  });
}

async function closeSettingsWindow() {
  bypassCloseGuard = true;
  beginSettingsWindowClose();
  try {
    await runtimeCharacterVisualPreviewPromise;
    await runtimeProviderModelController?.cancelOperations();
    await invoke("resolve_settings_close", { discard: true });
  } catch (error) {
    settingsWindowClosing = false;
    throw error;
  }
}

let closeRequestInFlight = false;
async function requestCancelClose() {
  if (closeRequestInFlight) {
    return;
  }
  closeRequestInFlight = true;
  try {
    const { executeSettingsClose } = await settingsCloseFlowPromise;
    setError("");
    await executeSettingsClose({
      dirty: computeDirty(),
      choose: chooseUnsavedClose,
      save: async () => {
        setSubmissionBusy(true);
        await saveRuntimeSettings();
        notify("已保存。", "success");
      },
      discard: async () => {
        setSubmissionBusy(true);
        await runtimeAppearanceController?.cancelPreview();
        await runtimeProviderModelController?.cancelOperations();
        runtimeChatTimingController?.discard();
        runtimeBubbleAutoHideController?.discard();
        runtimeAutostartController?.discard();
        runtimeToolsController?.discard();
        await discardRuntimeCharacterSelection();
      },
      close: closeSettingsWindow,
      stay: async () => {
        await invoke("resolve_settings_close", { discard: false });
      },
    });
  } catch (error) {
    bypassCloseGuard = false;
    setError(String(error));
  } finally {
    setSubmissionBusy(false);
    closeRequestInFlight = false;
  }
}

function beginSettingsWindowClose() {
  settingsWindowClosing = true;
}

let exitRequestInFlight = false;
async function requestAppExitClose() {
  if (exitRequestInFlight) {
    return;
  }
  exitRequestInFlight = true;
  try {
    const { executeSettingsClose } = await settingsCloseFlowPromise;
    setError("");
    await executeSettingsClose({
      dirty: computeDirty(),
      choose: chooseUnsavedClose,
      save: async () => {
        setSubmissionBusy(true);
        await saveRuntimeSettings();
        notify("已保存。", "success");
      },
      discard: async () => {
        setSubmissionBusy(true);
        await runtimeAppearanceController?.cancelPreview();
        await runtimeProviderModelController?.cancelOperations();
        runtimeChatTimingController?.discard();
        runtimeBubbleAutoHideController?.discard();
        runtimeAutostartController?.discard();
        runtimeToolsController?.discard();
        await discardRuntimeCharacterSelection();
      },
      close: async () => {
        beginSettingsWindowClose();
        try {
          await runtimeCharacterVisualPreviewPromise;
          await runtimeProviderModelController?.cancelOperations();
          bypassCloseGuard = true;
          await invoke("resolve_settings_exit", { discard: true });
        } catch (error) {
          settingsWindowClosing = false;
          throw error;
        }
      },
      stay: async () => {
        await invoke("resolve_settings_exit", { discard: false });
      },
    });
  } catch (error) {
    bypassCloseGuard = false;
    setError(String(error));
  } finally {
    setSubmissionBusy(false);
    exitRequestInFlight = false;
  }
}

function markInvalid(input, invalid) {
  if (input) {
    input.classList.toggle("is-invalid", Boolean(invalid));
  }
}

function setControlDisabled(control, disabled, { row = true } = {}) {
  if (!control) {
    return;
  }
  control.disabled = Boolean(disabled);
  if (row) {
    control.closest(".setting-row")?.classList.toggle("is-disabled", Boolean(disabled));
  }
  refreshSelect(control);
}

function removeOverlayAfterExit(overlay) {
  if (!overlay?.isConnected) return Promise.resolve();
  if (reduceMotionQuery?.matches) {
    overlay.remove();
    return Promise.resolve();
  }
  overlay.classList.add("is-closing");
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      overlay.removeEventListener("animationend", onAnimationEnd);
      overlay.remove();
      resolve();
    };
    const onAnimationEnd = (event) => {
      if (event.target === overlay) finish();
    };
    const fallbackTimer = window.setTimeout(finish, 260);
    overlay.addEventListener("animationend", onAnimationEnd);
  });
}

function confirmAction(
  message,
  {
    title = "确认操作", confirmText = "确认", cancelText = "取消", danger = false, details = [],
  } = {},
) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    const dialog = document.createElement("section");
    dialog.className = "confirm-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const heading = document.createElement("h2");
    heading.textContent = title;
    const body = document.createElement("p");
    body.textContent = message;
    const detailList = document.createElement("ul");
    detailList.className = "confirm-dialog-list";
    details.forEach((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      detailList.append(item);
    });
    const actions = document.createElement("div");
    actions.className = "confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = cancelText;
    const confirm = document.createElement("button");
    confirm.type = "button";
    if (danger) {
      confirm.className = "danger-button";
    }
    confirm.textContent = confirmText;
    actions.append(cancel, confirm);
    dialog.append(heading, body);
    if (detailList.childElementCount) dialog.append(detailList);
    dialog.append(actions);
    overlay.append(dialog);

    let closing = false;
    function close(value) {
      if (closing) return;
      closing = true;
      document.removeEventListener("keydown", onKey, true);
      cancel.disabled = true;
      confirm.disabled = true;
      void removeOverlayAfterExit(overlay).then(() => resolve(value));
    }
    function onKey(event) {
      if (event.key === "Escape") {
        close(false);
      }
    }
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close(false);
      }
    });
    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", () => close(true));
    document.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    confirm.focus();
  });
}

async function chooseUnsavedClose() {
  const { CloseDecision } = await settingsCloseFlowPromise;
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    const dialog = document.createElement("section");
    dialog.className = "confirm-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const heading = document.createElement("h2");
    heading.textContent = "保存改动";
    const body = document.createElement("p");
    body.textContent = "设置有未保存的改动，是否保存后关闭？";
    const actions = document.createElement("div");
    actions.className = "confirm-actions";
    const stay = document.createElement("button");
    stay.type = "button";
    stay.className = "secondary-button";
    stay.textContent = "返回";
    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "danger-button";
    discard.textContent = "不保存";
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "保存";
    actions.append(stay, discard, save);
    dialog.append(heading, body, actions);
    overlay.append(dialog);

    function close(decision) {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(decision);
    }
    function onKey(event) {
      if (event.key === "Escape") {
        close(CloseDecision.STAY);
      }
    }
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close(CloseDecision.STAY);
      }
    });
    stay.addEventListener("click", () => close(CloseDecision.STAY));
    discard.addEventListener("click", () => close(CloseDecision.DISCARD));
    save.addEventListener("click", () => close(CloseDecision.SAVE));
    document.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    save.focus();
  });
}

function runThemeTransition(update) {
  if (reduceMotionQuery?.matches || typeof document.startViewTransition !== "function") {
    update();
    return;
  }
  document.documentElement.classList.add("is-theme-view-transition");
  const transition = document.startViewTransition(update);
  transition.finished.finally(() => {
    document.documentElement.classList.remove("is-theme-view-transition");
  });
}

function replayMotion(element, className) {
  if (!element || reduceMotionQuery?.matches) {
    return;
  }
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function markThemeChanged() {
  themeChanged = true;
  applyThemeTokens(collectThemeSettings());
}

// 自定义下拉框：WebView2 在 Windows 上的原生 <select> 弹层无法被 CSS 主题化，
// 这里保留原生 <select>（隐藏）承载取值与 change 事件，只把视觉换成可控弹层。
// 弹层用 position:fixed + getBoundingClientRect 定位，避开 .page-scroll 的 overflow 裁剪。
function enhanceSelect(select) {
  if (!select || select.__customSelect) {
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "custom-select";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "custom-select__trigger";
  const label = document.createElement("span");
  label.className = "custom-select__label";
  const caret = document.createElement("span");
  caret.className = "custom-select__caret";
  caret.setAttribute("aria-hidden", "true");
  trigger.append(label, caret);
  const menu = document.createElement("div");
  menu.className = "custom-select__menu";
  menu.setAttribute("role", "listbox");

  select.parentNode.insertBefore(wrapper, select);
  // menu 不挂在 wrapper 内：打开时才挂到 <body>（见 openMenu），避免被祖先的
  // transform 包含块推偏定位。
  wrapper.append(trigger, select);

  function syncTrigger() {
    const option = select.options[select.selectedIndex];
    label.textContent = option ? option.textContent : "";
    trigger.disabled = select.disabled;
  }

  function buildMenu() {
    menu.textContent = "";
    Array.from(select.options).forEach((option) => {
      const item = document.createElement("div");
      item.className = "custom-select__option";
      item.setAttribute("role", "option");
      item.textContent = option.textContent;
      if (option.value === select.value) {
        item.classList.add("is-selected");
        item.setAttribute("aria-selected", "true");
      }
      if (option.disabled) {
        item.classList.add("is-disabled");
        item.setAttribute("aria-disabled", "true");
      }
      item.addEventListener("click", () => {
        if (option.disabled) {
          return;
        }
        if (select.value !== option.value) {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        syncTrigger();
        closeMenu();
      });
      menu.append(item);
    });
  }

  // 弹层挂在 <body> 上，按视口坐标定位；下方空间不足且上方更宽裕时向上弹出。
  function positionMenu() {
    const rect = trigger.getBoundingClientRect();
    const maxWidth = Math.max(120, window.innerWidth - 16);
    menu.style.minWidth = `${rect.width}px`;
    menu.style.width = "max-content";
    menu.style.maxWidth = `${maxWidth}px`;
    const menuWidth = Math.min(menu.offsetWidth, maxWidth);
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8))}px`;
    const menuHeight = menu.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < menuHeight + 12 && rect.top > spaceBelow) {
      menu.style.top = `${Math.max(8, rect.top - 6 - menuHeight)}px`;
    } else {
      menu.style.top = `${rect.bottom + 6}px`;
    }
  }

  function onDocPointer(event) {
    if (!wrapper.contains(event.target) && !menu.contains(event.target)) {
      closeMenu();
    }
  }
  function onKey(event) {
    if (event.key === "Escape") {
      closeMenu();
    }
  }
  function openMenu() {
    if (select.disabled) {
      return;
    }
    buildMenu();
    document.body.appendChild(menu);
    menu.classList.add("is-open");
    positionMenu();
    wrapper.classList.add("is-open");
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu, true);
  }
  function closeMenu() {
    wrapper.classList.remove("is-open");
    menu.classList.remove("is-open");
    menu.remove();
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", closeMenu, true);
    window.removeEventListener("resize", closeMenu, true);
  }

  trigger.addEventListener("click", () => {
    wrapper.classList.contains("is-open") ? closeMenu() : openMenu();
  });
  select.addEventListener("change", syncTrigger);

  select.__customSelect = { refresh: syncTrigger };
  syncTrigger();
}

function refreshSelect(select) {
  if (select && select.__customSelect) {
    select.__customSelect.refresh();
  }
}

function setNumericBounds(input, bounds) {
  input.min = String(bounds[0]);
  input.max = String(bounds[1]);
}

function clampInt(value, bounds) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return bounds[0];
  }
  return Math.min(bounds[1], Math.max(bounds[0], number));
}

function clampFloat(value, bounds) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) {
    return bounds[0];
  }
  return Math.min(bounds[1], Math.max(bounds[0], number));
}

function themeFieldInput(id) {
  return fields.themeColors.querySelector(`[data-theme-field="${id}"]`);
}

function themeFieldLabel(id) {
  return request.theme_fields.find((field) => field.id === id)?.label || id;
}

function themeFieldValue(id) {
  const input = themeFieldInput(id);
  return normalizeColorText(input?.value, request.theme_defaults[id]);
}

function hexToRgb(hex) {
  const value = normalizeColorText(hex, "#000000").slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function componentToHex(value) {
  return Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
}

function rgbToHex({ r, g, b }) {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function rgbToHsv({ r, g, b }) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === red) {
      h = ((green - blue) / delta) % 6;
    } else if (max === green) {
      h = (blue - red) / delta + 2;
    } else {
      h = (red - green) / delta + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function hsvToRgb({ h, s, v }) {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (h < 60) {
    red = chroma; green = x;
  } else if (h < 120) {
    red = x; green = chroma;
  } else if (h < 180) {
    green = chroma; blue = x;
  } else if (h < 240) {
    green = x; blue = chroma;
  } else if (h < 300) {
    red = x; blue = chroma;
  } else {
    red = chroma; blue = x;
  }
  return {
    r: (red + m) * 255,
    g: (green + m) * 255,
    b: (blue + m) * 255,
  };
}

const pageMeta = {
  character: { title: "角色与布局", subtitle: "选择陪伴角色与桌宠布局" },
  appearance: { title: "外观", subtitle: "配色与输入栏视觉效果" },
  providers: { title: "供应商", subtitle: "管理 API 供应商、密钥与模型" },
  model: { title: "模型", subtitle: "功能模型分配与高级参数" },
  voice: { title: "语音", subtitle: "选择语音引擎和服务来源" },
  interaction: { title: "交互", subtitle: "字幕、气泡与主动屏幕感知" },
  tools: { title: "工具", subtitle: "工具调用与循环上限" },
  plugins: { title: "插件", subtitle: "安装、启用和设置插件" },
  system: { title: "系统", subtitle: "管理启动、更新与本地数据" },
  about: { title: "关于", subtitle: "查看版本、更新与本地组件" },
  memory: { title: "记忆", subtitle: "查看、编辑、删除长期记忆与常驻档案" },
};

function showPage(page) {
  Object.entries(fields.pages).forEach(([key, element]) => {
    element.hidden = key !== page;
    element.classList.toggle("is-active", key === page);
  });
  fields.navItems.forEach((item) => {
    const active = item.dataset.page === page;
    item.classList.toggle("is-active", active);
    if (active) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });
  document.querySelector(".page-scroll")?.classList.toggle(
    "is-admin-active",
    page === "memory" || page === "plugins" || page === "providers",
  );
  const meta = pageMeta[page];
  if (meta) {
    fields.pageTitle.textContent = meta.title;
    fields.pageSubtitle.textContent = meta.subtitle;
    replayMotion(fields.pageHead, "is-switching");
  }
  // 进入「模型」页时按当前供应商重建槽位选项（供应商可能在另一页被改过）。
  if (page === "model" && request) {
    refreshModelSlots();
  }
  runtimePluginController?.onPageChanged(page);
}

function syncEnabledState() {
  const enabled = fields.enabled.checked;
  setControlDisabled(fields.checkInterval, !enabled);
  setControlDisabled(fields.cooldown, !enabled);
  setControlDisabled(fields.batchLimit, !enabled);
  setControlDisabled(fields.screenResolution, !enabled);
}

function syncBubbleState() {
  setControlDisabled(fields.bubbleAutoHideDelay, !fields.bubbleAutoHide.checked);
}

function selectedCharacter() {
  const id = fields.characterSelect.value;
  return request.character.characters.find((item) => item.id === id) || null;
}

function selectedCharacterHasExportableVoice() {
  return Boolean(selectedCharacter()?.has_exportable_voice);
}

function selectedCharacterThemeDefaults() {
  return selectedCharacter()?.default_theme || request.theme_defaults;
}

function syncApiAdvancedState() {
  setControlDisabled(fields.apiTopP, !fields.apiTopPEnabled.checked, { row: false });
  setControlDisabled(fields.apiMaxTokens, !fields.apiMaxTokensEnabled.checked, { row: false });
}

function renderCharacters() {
  fields.characterSelect.textContent = "";
  request.character.characters.forEach((character) => {
    const option = document.createElement("option");
    option.value = character.id;
    option.textContent = character.display_name || character.id;
    fields.characterSelect.append(option);
  });
  const pendingCharacterId = pendingCharacterSelection({
    committedCharacterId: request.character.current_character_id,
    selectedCharacterId: runtimeCharacterDraftId,
  });
  fields.characterSelect.value = pendingCharacterId
    || request.character.current_character_id;
  syncCharacterArchiveState();
}

function applyRuntimeCharacterSnapshot(snapshot, { preserveSelection = false } = {}) {
  const normalized = snapshot?.snapshot && snapshot?.character
    ? snapshot
    : normalizeCharacterSettingsSnapshot(snapshot);
  const pendingSelection = preserveSelection ? pendingRuntimeCharacterId() : null;
  runtimeCharacterSnapshot = normalized.snapshot;
  runtimeCharacterDraftId = normalized.character.characters.some((item) => item.id === pendingSelection)
    ? pendingSelection : normalized.character.current_character_id;
  request = request || {};
  request.character = normalized.character;
  renderCharacters();
  refreshSelect(fields.characterSelect);
}

function prepareRuntimeCharacterOnly() {
  for (const control of [
    fields.portraitScale,
    fields.controlPanelWidth,
    fields.bubbleHeight,
    fields.bubbleAutoExpand,
    fields.controlPanelOffset,
    fields.inputBarOffset,
    fields.speechFontSize,
    fields.nameFontSize,
    fields.inputFontSize,
    fields.themeAiButton,
    fields.resetThemeButton,
    fields.visualEffectMode,
  ]) disableRuntimeControl(control);
  for (const control of [
    fields.ttsVoiceImportButton,
    fields.characterExportButton,
  ]) disableRuntimeControl(control, { markRow: false });
  enhanceSelect(fields.characterSelect);
  refreshSelect(fields.characterSelect);
  syncCharacterArchiveState();
}

function applyStorageSnapshot(snapshot) {
  const normalized = snapshot;
  fields.storageUserRoot.textContent = snapshot.userRoot;
  fields.storageTtsRoot.textContent = snapshot.ttsRoot;
  fields.storageTtsStatus.textContent = normalized.statusText;
  fields.storageTtsStatus.dataset.state = normalized.statusState;
  fields.storageResetTtsRoot.disabled = !normalized.canReset;
}

async function refreshStorageSettings() {
  applyStorageSnapshot(await rootSettingsClient.storageGet());
}

async function chooseTtsStorageRoot() {
  try {
    const snapshot = await rootSettingsClient.storageChooseTtsRoot();
    if (snapshot) {
      applyStorageSnapshot(snapshot);
      notify("TTS 位置已切换；已有文件不会自动搬运。", "success");
    }
  } catch (error) {
    setError(String(error));
  }
}

async function resetTtsStorageRoot() {
  try {
    applyStorageSnapshot(await rootSettingsClient.storageResetTtsRoot());
    notify("TTS 位置已恢复为默认目录。", "success");
  } catch (error) {
    setError(String(error));
  }
}

async function importLegacyRoleData() {
  fields.legacyRoleDataImportButton.disabled = true;
  fields.legacyRoleDataImportStatus.textContent = "正在检查旧目录，Sakura Core 会短暂重启…";
  try {
    const plan = await rootSettingsClient.legacyRoleDataImportChoose();
    if (!plan) {
      fields.legacyRoleDataImportStatus.textContent = "";
      return;
    }
    if (plan.blocked) {
      throw new Error("检测到跨角色身份冲突；为避免记忆串角色，本次导入已阻止。");
    }
    const totals = plan.totals;
    const additions = totals.historyNew + totals.memoryNew;
    const conflicts = totals.historyConflicts + totals.memoryConflicts;
    if (!legacyDataImportPlanHasWork(plan)) {
      fields.legacyRoleDataImportStatus.textContent = `没有新数据；已跳过 ${totals.historyIdentical + totals.memoryIdentical} 条相同记录。`;
      return;
    }
    let overwriteConflicts = false;
    if (plan.requiresConflictConfirmation) {
      const details = plan.characters
        .filter((character) => character.history.conflicts || character.memory.conflicts)
        .map((character) => (
          `${character.characterId}：历史 ${character.history.conflicts} 条，记忆 ${character.memory.conflicts} 条`
        ));
      overwriteConflicts = await confirmAction(
        `发现 ${conflicts} 条同一身份但内容不同的记录。只会覆盖这些冲突项；其他现有数据保持不变。`,
        {
          title: "确认覆盖冲突记录",
          confirmText: "覆盖并导入",
          cancelText: "取消",
          danger: true,
          details,
        },
      );
      if (!overwriteConflicts) {
        fields.legacyRoleDataImportStatus.textContent = "已取消，当前数据没有改变。";
        return;
      }
    }
    fields.legacyRoleDataImportStatus.textContent = "正在合并聊天历史和长期记忆…";
    await rootSettingsClient.legacyRoleDataImportApply(
      plan.selectionId,
      plan.planToken,
      overwriteConflicts,
    );
    fields.legacyRoleDataImportStatus.textContent = `导入完成：新增 ${additions} 条，跳过 ${totals.historyIdentical + totals.memoryIdentical} 条相同记录，隔离 ${totals.recoverableErrors} 条坏数据。`;
  } catch (error) {
    const code = String(error);
    const message = code.includes("LEGACY_SOURCE_ACTIVE")
      ? "检测到 Sakura 0.9.x 仍在运行，请先完全退出旧版本。"
      : code.includes("LEGACY_IMPORT_CORE_STOP_FAILED")
        ? "无法确认旧版本迁移进程和 Sakura Core 已停止。请立即退出 Sakura，保留迁移记录并重启系统后再试。"
        : code.includes("LEGACY_IMPORT_PROCESS_TERMINATION_FAILED")
          ? "无法确认旧版本迁移进程已停止。Sakura Core 将保持关闭，请保留迁移记录并重启系统后重试。"
          : code.includes("LEGACY_IMPORT_OPERATION_TIMEOUT")
            ? "旧版本数据导入等待超时，已安全停止并恢复现有数据。"
            : code.includes("LEGACY_DATA_SOURCE_UNRECOGNIZED")
              ? "所选目录不是可识别的 Sakura 0.9.x 数据目录。"
              : code.includes("LEGACY_DATA_IMPORT_PLAN_STALE")
                ? "源数据或当前数据已变化，请重新选择目录并检查。"
                : `导入失败：${code}`;
    fields.legacyRoleDataImportStatus.textContent = message;
  } finally {
    fields.legacyRoleDataImportButton.disabled = false;
  }
}

function applyUpdateSnapshot(snapshot) {
  latestUpdateSnapshot = snapshot;
  fields.updateFeedback.hidden = !snapshot.available;
  fields.updateFeedback.dataset.state = snapshot.available ? "available" : "current";
  fields.updateStatus.textContent = snapshot.available
    ? `检测到新版本：v${snapshot.version}`
    : `当前已是最新版本 v${snapshot.currentVersion}`;
  fields.updateNotes.textContent = snapshot.notes?.trim() || "";
  fields.updateNotes.hidden = !fields.updateNotes.textContent;
  fields.updateActionButton.hidden = !snapshot.available;
  fields.updateActionButton.disabled = updateActionBusy;
  fields.updateActionLabel.textContent = snapshot.mode === "portable"
    ? `下载 v${snapshot.version} ZIP`
    : `更新到 v${snapshot.version}`;
  fields.updateCheckButton.classList.toggle("primary-button", !snapshot.available);
  fields.updateCheckButton.classList.toggle("secondary-button", snapshot.available);
  fields.updateCheckLabel.textContent = snapshot.available ? "重新检查" : "检查更新";
}

function applyAboutSnapshot(snapshot) {
  fields.aboutVersion.textContent = `版本 v${snapshot.version}`;
}

async function refreshAboutSettings() {
  const [about, preferences, cachedUpdate] = await Promise.all([
    rootSettingsClient.aboutGet(),
    rootSettingsClient.updatePreferencesGet(),
    rootSettingsClient.updateCachedGet(),
  ]);
  applyAboutSnapshot(about);
  fields.updateAutoCheck.checked = preferences.autoCheckEnabled;
  if (cachedUpdate) applyUpdateSnapshot(cachedUpdate);
}

function applyTelemetrySnapshot(snapshot) {
  fields.telemetryEnabled.checked = snapshot.enabled;
  fields.telemetryInstallationId.textContent = snapshot.installationId || "开启后生成";
  fields.telemetryCopyButton.disabled = snapshot.installationId === null;
  fields.telemetryRegenerateButton.disabled = snapshot.installationId === null;
}

async function refreshTelemetrySettings() {
  applyTelemetrySnapshot(await rootSettingsClient.telemetryGet());
}

async function setTelemetryEnabled() {
  const requested = fields.telemetryEnabled.checked;
  fields.telemetryEnabled.disabled = true;
  try {
    applyTelemetrySnapshot(await rootSettingsClient.telemetrySetEnabled(requested));
    notify(requested ? "已开启匿名统计。" : "已关闭匿名统计。", "success");
  } catch (error) {
    try {
      applyTelemetrySnapshot(await rootSettingsClient.telemetryGet());
    } catch {
      fields.telemetryEnabled.checked = false;
    }
    setError(String(error));
  } finally {
    fields.telemetryEnabled.disabled = false;
  }
}

async function regenerateTelemetryInstallationId() {
  fields.telemetryRegenerateButton.disabled = true;
  try {
    const snapshot = await rootSettingsClient.telemetryRegenerateInstallationId();
    applyTelemetrySnapshot(snapshot);
    notify("诊断 ID 已重新生成。", "success");
  } catch (error) {
    setError(String(error));
  } finally {
    fields.telemetryRegenerateButton.disabled = false;
  }
}

async function checkForUpdates() {
  if (updateActionBusy) return;
  fields.updateCheckButton.disabled = true;
  fields.updateActionButton.disabled = true;
  fields.updateFeedback.hidden = false;
  fields.updateFeedback.dataset.state = "checking";
  fields.updateStatus.textContent = "正在检查更新…";
  fields.updateCheckLabel.textContent = "正在检查…";
  fields.updateNotes.hidden = true;
  try {
    applyUpdateSnapshot(await rootSettingsClient.updateGet());
  } catch (error) {
    latestUpdateSnapshot = null;
    fields.updateActionButton.hidden = true;
    fields.updateFeedback.dataset.state = "failed";
    fields.updateStatus.textContent = "检查更新失败。";
    fields.updateCheckButton.classList.add("primary-button");
    fields.updateCheckButton.classList.remove("secondary-button");
    fields.updateCheckLabel.textContent = "重新检查";
    setError(String(error));
  } finally {
    fields.updateCheckButton.disabled = updateActionBusy;
    fields.updateActionButton.disabled = updateActionBusy;
  }
}

async function saveUpdatePreferences() {
  fields.updateAutoCheck.disabled = true;
  try {
    const snapshot = await rootSettingsClient.updatePreferencesSet(fields.updateAutoCheck.checked);
    fields.updateAutoCheck.checked = snapshot.autoCheckEnabled;
    notify(snapshot.autoCheckEnabled ? "已开启自动检测更新。" : "已关闭自动检测更新。", "success");
  } catch (error) {
    fields.updateAutoCheck.checked = !fields.updateAutoCheck.checked;
    setError(String(error));
  } finally {
    fields.updateAutoCheck.disabled = false;
  }
}

async function runUpdateAction() {
  const snapshot = latestUpdateSnapshot;
  if (!snapshot?.available || updateActionBusy) return;
  updateActionBusy = true;
  fields.updateActionButton.disabled = true;
  fields.updateCheckButton.disabled = true;
  try {
    if (snapshot.mode === "portable") {
      await rootSettingsClient.updateOpenPortableDownload(snapshot.downloadUrl);
      fields.updateStatus.textContent = "已打开新版 Portable ZIP 下载地址。";
      updateActionBusy = false;
      fields.updateActionButton.disabled = false;
      fields.updateCheckButton.disabled = false;
      return;
    }
    fields.updateActionLabel.textContent = "正在下载并安装…";
    await rootSettingsClient.updateInstall();
    fields.updateStatus.textContent = "更新已安装，请重启 Sakura 后使用新版本。";
    fields.updateActionLabel.textContent = "安装完成";
  } catch (error) {
    updateActionBusy = false;
    fields.updateFeedback.dataset.state = "failed";
    fields.updateStatus.textContent = "更新操作失败。";
    fields.updateActionLabel.textContent = snapshot.mode === "portable"
      ? `下载 v${snapshot.version} ZIP`
      : "重新尝试安装";
    fields.updateActionButton.disabled = false;
    fields.updateCheckButton.disabled = false;
    setError(String(error));
  }
}

function syncCharacterArchiveState() {
  if (!request) {
    return;
  }
  const pendingCharacterId = pendingRuntimeCharacterId();
  setCharacterSwitchLock({
    pages: [fields.pages.character],
    // Global drafts remain editable on their own pages, but the aggregate
    // submit actions must not cross the generation hand-off.
    submitControls: [fields.saveButton, fields.applyButton],
  }, characterSwitching);
  for (const page of [fields.pages.appearance, fields.pages.voice, fields.pages.memory]) {
    if (!page) continue;
    page.inert = characterSwitching || Boolean(pendingCharacterId);
    page.setAttribute("aria-busy", String(characterSwitching));
    page.setAttribute("aria-disabled", String(Boolean(pendingCharacterId)));
  }
  if (submissionBusy) {
    fields.saveButton.disabled = true;
    fields.applyButton.disabled = true;
  }
  const character = selectedCharacter();
  const hasCharacter = Boolean(character);
  fields.characterSelect.disabled = characterArchiveBusy || characterSwitching
    || !request.character.characters.length;
  fields.characterImportButton.disabled = characterArchiveBusy || characterSwitching
    || Boolean(pendingCharacterId);
  fields.ttsVoiceImportButton.disabled = characterArchiveBusy || characterSwitching
    || !hasCharacter || Boolean(pendingCharacterId) || currentCharacterHasDrafts();
  fields.characterExportButton.disabled = characterArchiveBusy || characterSwitching
    || !hasCharacter || Boolean(pendingCharacterId);
  syncCharacterEditorControl(
    fields.characterEditorButton,
    characterArchiveBusy || characterSwitching || !hasCharacter,
  );
  fields.characterArchiveHint.textContent = pendingCharacterId
    ? `已选择 ${character?.display_name || pendingCharacterId}；角色级设置已锁定，点击“应用”或“保存并关闭”后正式切换。`
    : currentCharacterHasDrafts()
      ? "当前角色有未保存的改动。保存或放弃后可以导入语音；导出仍使用已保存的角色包。"
      : hasCharacter
      ? "可以导入或导出角色包，也可以在角色工坊中编辑当前角色。"
    : "当前没有角色。请导入一个 Sakura .char 角色包。";
  refreshSelect(fields.characterSelect);
}

function setCharacterArchiveBusy(busy) {
  characterArchiveBusy = Boolean(busy);
  syncCharacterArchiveState();
}

function currentCharacterHasDrafts() {
  return hasCharacterScopedDrafts({
    appearanceDirty: runtimeAppearanceController?.isDirty(),
    voiceDirty: runtimeVoiceController?.isDirty(),
    memoryEditorDraftCount: (runtimePluginController?.characterDraftCount() || 0),
  });
}

function pendingRuntimeCharacterId() {
  return pendingCharacterSelection({
    committedCharacterId: runtimeCharacterSnapshot?.currentCharacterId,
    selectedCharacterId: runtimeCharacterDraftId,
  });
}

function runtimeVisualPreviewTheme(publication) {
  const presentation = publication?.presentation;
  const appearance = publication?.appearance;
  if (
    publication?.schemaVersion !== 1
    || !Number.isSafeInteger(publication.windowGeneration)
    || !Number.isSafeInteger(publication.revision)
    || appearance?.coreGenerationId !== presentation?.generationId
    || appearance?.characterId !== presentation?.characterId
  ) throw new Error("CHARACTER_VISUAL_PREVIEW_INVALID");
  return Object.fromEntries(Object.entries(runtimeThemeLegacyFields).map(([source, target]) => {
    const value = appearance.values?.themeTokens?.[source];
    if (!isHexColor(value)) throw new Error("CHARACTER_VISUAL_PREVIEW_INVALID");
    return [target, value];
  }));
}

function previewRuntimeCharacterVisual(characterId) {
  if (!characterId) return;
  const pending = (async () => {
    const revision = ++runtimeCharacterVisualPreviewRevision;
    const publication = await invoke("settings_character_visual_preview", {
      characterId,
      revision,
    });
    if (
      revision !== runtimeCharacterVisualPreviewRevision
      || characterId !== runtimeCharacterDraftId
      || publication?.revision !== revision
      || publication?.presentation?.characterId !== characterId
    ) return;
    runThemeTransition(() => applyThemeTokens(runtimeVisualPreviewTheme(publication)));
  })();
  runtimeCharacterVisualPreviewPromise = pending;
  return pending;
}

async function discardRuntimeCharacterSelection() {
  runtimeCharacterDraftId = runtimeCharacterSnapshot?.currentCharacterId || "";
  fields.characterSelect.value = runtimeCharacterDraftId;
  refreshSelect(fields.characterSelect);
  syncCharacterArchiveState();
  refreshDirty();
  if (runtimeCharacterDraftId) await previewRuntimeCharacterVisual(runtimeCharacterDraftId);
}

function clearCharacterScopedRuntimeState() {
  runtimePluginController?.clearCharacterState();
}

async function rebindSettingsAfterCharacterSwitch(lifecycle) {
  const generationId = lifecycle?.supervisor?.generationId;
  if (typeof generationId !== "string" || !generationId) {
    throw new Error("CHARACTER_SWITCH_IDENTITY_INVALID");
  }
  runtimeProviderModelController?.rebindIdentity(generationId);
  runtimeScreenAwarenessController?.rebindIdentity(generationId);
  await runtimeAppearanceController?.rebindGeneration(generationId);
  await runtimeToolsController?.refreshCurrent();
  await runtimePluginController?.refreshCurrent();
  await runtimeVoiceController?.refreshCurrent({ preserveDraft: true });
  applyRuntimeCharacterSnapshot(await rootSettingsClient.charactersGet(), { preserveSelection: true });
  memoryState.rebinding = false;
  refreshDirty();
}

async function refreshRuntimeCharacterCatalog(payload) {
  const revision = ++characterCatalogRefreshRevision;
  const generationId = typeof payload?.generationId === "string"
    ? payload.generationId
    : "";
  const rebinding = Boolean(generationId);
  if (rebinding) {
    characterSwitching = true;
    memoryState.rebinding = true;
    syncCharacterArchiveState();
  }
  try {
    const applied = await applyCharacterCatalogChange({
      generationId,
      readLifecycle: () => invoke("runtime_lifecycle_snapshot"),
      readCatalog: () => rootSettingsClient.charactersGet(),
      applyCatalog: (snapshot) => applyRuntimeCharacterSnapshot(snapshot, { preserveSelection: true }),
      rebindSettings: rebindSettingsAfterCharacterSwitch,
    });
    if (applied && revision === characterCatalogRefreshRevision) setError("");
  } catch (error) {
    if (revision === characterCatalogRefreshRevision) {
      setError(`角色列表刷新失败：${String(error)}`);
    }
  } finally {
    if (rebinding && revision === characterCatalogRefreshRevision) {
      characterSwitching = false;
      memoryState.rebinding = false;
      runtimePluginController?.renderMemorySurface();
      syncCharacterArchiveState();
    }
  }
}

async function applyRuntimeCharacterChange(receipt, previousLifecycle) {
  await applyCharacterSwitch({
    receipt,
    previousLifecycle,
    applyCommittedSnapshot: applyRuntimeCharacterSnapshot,
    clearCharacterState() {
      memoryState.rebinding = true;
      clearCharacterScopedRuntimeState();
    },
    rebindSettings: rebindSettingsAfterCharacterSwitch,
    setSwitching(value) {
      characterSwitching = value;
      if (!value) memoryState.rebinding = false;
      syncCharacterArchiveState();
    },
    readLifecycle: () => invoke("runtime_lifecycle_snapshot"),
    delay: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
  });
}

function renderThemeControls() {
  fields.themeColors.textContent = "";
  activeThemeField = activeThemeField || request.theme_fields[0]?.id || "";

  request.theme_fields.forEach(({ id, label }) => {
    const row = document.createElement("div");
    row.className = "form-row theme-color-row";
    row.dataset.themeRole = id;
    const rowLabel = document.createElement("label");
    rowLabel.htmlFor = `theme-${id}`;
    rowLabel.textContent = label;
    const controls = document.createElement("div");
    controls.className = "theme-color-control";

    const swatchButton = document.createElement("button");
    swatchButton.type = "button";
    swatchButton.className = "theme-color-swatch";
    swatchButton.dataset.themeSwatch = id;
    swatchButton.title = "调整颜色";
    swatchButton.addEventListener("click", () => openThemeColorPopover(id, swatchButton));

    const textInput = document.createElement("input");
    textInput.id = `theme-${id}`;
    textInput.type = "text";
    textInput.maxLength = 7;
    textInput.placeholder = "#RRGGBB";
    textInput.dataset.themeField = id;
    textInput.addEventListener("input", () => {
      syncThemeRole(id);
      if (id === activeThemeField) {
        syncThemeEditor();
      }
      markThemeChanged();
    });

    controls.append(swatchButton, textInput);
    row.append(rowLabel, controls);
    fields.themeColors.append(row);
  });

  fields.themeColors.append(buildThemeEditor());
  request.theme_fields.forEach(({ id }) => syncThemeRole(id));
  selectThemeField(activeThemeField, { open: false });

  fields.visualEffectMode.textContent = "";
  const currentMode = request.theme.visual_effect_mode;
  const modes = [...request.visual_effect_modes];
  if (!modes.some((mode) => mode.id === currentMode)) {
    modes.push({ id: currentMode, label: currentMode });
  }
  modes.forEach((mode) => {
    const option = document.createElement("option");
    option.value = mode.id;
    option.disabled = Boolean(mode.disabled);
    option.textContent = mode.disabled && mode.reason
      ? `${mode.label}（${mode.reason}）`
      : mode.label;
    if (mode.reason) option.title = mode.reason;
    fields.visualEffectMode.append(option);
  });
}

function buildThemeEditor() {
  const editor = document.createElement("dialog");
  editor.className = "theme-color-popover";
  editor.hidden = true;

  const head = document.createElement("div");
  head.className = "theme-editor-head";
  const swatch = document.createElement("div");
  swatch.className = "theme-editor-swatch";
  const title = document.createElement("div");
  title.className = "theme-editor-title";
  const label = document.createElement("strong");
  const key = document.createElement("span");
  title.append(label, key);
  head.append(swatch, title);

  const hexRow = document.createElement("label");
  hexRow.className = "theme-editor-field";
  hexRow.textContent = "HEX";
  const hex = document.createElement("input");
  hex.type = "text";
  hex.maxLength = 7;
  hex.placeholder = "#RRGGBB";
  hex.addEventListener("input", () => {
    const color = normalizeColorText(hex.value, "");
    markInvalid(hex, !color);
    if (color) {
      updateActiveThemeColor(color);
    }
  });
  hexRow.append(hex);

  const rgb = document.createElement("div");
  rgb.className = "theme-rgb-row";
  const rgbInputs = ["R", "G", "B"].map((name) => {
    const field = document.createElement("label");
    field.textContent = name;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "255";
    input.step = "1";
    input.addEventListener("input", updateThemeFromRgbInputs);
    field.append(input);
    rgb.append(field);
    return input;
  });

  const svPad = document.createElement("div");
  svPad.className = "theme-sv-pad";
  const svCanvas = document.createElement("canvas");
  svCanvas.className = "theme-picker-canvas";
  svCanvas.setAttribute("aria-hidden", "true");
  const svPointer = document.createElement("span");
  svPointer.className = "theme-picker-pointer";
  svPad.append(svCanvas, svPointer);
  svPad.addEventListener("pointerdown", updateThemeFromSvPointer);
  svPad.addEventListener("pointermove", (event) => {
    if (event.buttons & 1) {
      updateThemeFromSvPointer(event);
    }
  });

  const hue = document.createElement("div");
  hue.className = "theme-hue-strip";
  const hueCanvas = document.createElement("canvas");
  hueCanvas.className = "theme-picker-canvas";
  hueCanvas.setAttribute("aria-hidden", "true");
  const huePointer = document.createElement("span");
  huePointer.className = "theme-hue-pointer";
  hue.append(hueCanvas, huePointer);
  hue.addEventListener("pointerdown", updateThemeFromHuePointer);
  hue.addEventListener("pointermove", (event) => {
    if (event.buttons & 1) {
      updateThemeFromHuePointer(event);
    }
  });

  const actions = document.createElement("div");
  actions.className = "theme-editor-actions";
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "secondary-button theme-editor-pick";
  pick.textContent = "取色";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary-button";
  cancel.textContent = "取消";
  cancel.addEventListener("click", cancelThemeColorPopover);
  const done = document.createElement("button");
  done.type = "button";
  done.className = "primary-button";
  done.textContent = "完成";
  done.addEventListener("click", completeThemeColorPopover);
  actions.append(pick, cancel, done);

  editor.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancelThemeColorPopover();
  });

  editor.append(head, svPad, hue, hexRow, rgb, actions);
  themeEditor = {
    root: editor,
    swatch,
    label,
    key,
    hex,
    rgbInputs,
    svPad,
    svCanvas,
    svPointer,
    hue,
    hueCanvas,
    huePointer,
    pick,
    initialValue: "",
    initialThemeChanged: false,
    editing: false,
  };
  return editor;
}

function syncThemeRole(id) {
  const input = themeFieldInput(id);
  const color = normalizeColorText(input?.value, "");
  const fallback = themeFieldValue(id);
  const row = fields.themeColors.querySelector(`[data-theme-role="${id}"]`);
  const swatch = fields.themeColors.querySelector(`[data-theme-swatch="${id}"]`);
  if (row) {
    row.classList.toggle("is-active", id === activeThemeField);
    row.classList.toggle("is-invalid", Boolean(input?.value) && !color);
  }
  if (swatch) {
    swatch.style.backgroundColor = color || fallback;
  }
}

function selectThemeField(id, options = {}) {
  if (!request.theme_fields.some((field) => field.id === id)) {
    activeThemeField = request.theme_fields[0]?.id || "";
  } else {
    activeThemeField = id;
  }
  request.theme_fields.forEach(({ id: fieldId }) => syncThemeRole(fieldId));
  syncThemeEditor();
  if (options.open !== false) {
    openThemeColorPopover(activeThemeField, fields.themeColors.querySelector(`[data-theme-swatch="${activeThemeField}"]`));
  }
}

function syncThemeEditor() {
  if (!themeEditor.root || !activeThemeField) {
    return;
  }
  const color = themeFieldValue(activeThemeField);
  const rgb = hexToRgb(color);
  const hsv = rgbToHsv(rgb);
  themeEditor.root.style.setProperty("--theme-editor-color", color);
  themeEditor.root.style.setProperty("--theme-editor-hue", `${hsv.h}deg`);
  themeEditor.swatch.style.background = color;
  themeEditor.label.textContent = themeFieldLabel(activeThemeField);
  themeEditor.key.textContent = activeThemeField;
  themeEditor.hex.value = color;
  markInvalid(themeEditor.hex, false);
  [rgb.r, rgb.g, rgb.b].forEach((value, index) => {
    themeEditor.rgbInputs[index].value = String(value);
  });
  themeEditor.svPointer.style.left = `${hsv.s * 100}%`;
  themeEditor.svPointer.style.top = `${(1 - hsv.v) * 100}%`;
  themeEditor.huePointer.style.left = `${(hsv.h / 360) * 100}%`;
  drawThemeColorSurfaces(hsv.h);
}

function openThemeColorPopover(id) {
  selectThemeField(id, { open: false });
  const popover = themeEditor.root;
  if (!popover) {
    return;
  }
  themeEditor.initialValue = themeFieldInput(activeThemeField)?.value || "";
  themeEditor.initialThemeChanged = themeChanged;
  themeEditor.editing = true;
  popover.hidden = false;
  if (!popover.open) {
    popover.showModal();
  }
  drawThemeColorSurfaces(rgbToHsv(hexToRgb(themeFieldValue(activeThemeField))).h);
  themeEditor.hex.focus();
}

function hideThemeColorPopover() {
  if (themeEditor.root) {
    if (themeEditor.root.open) {
      themeEditor.root.close();
    }
    themeEditor.root.hidden = true;
  }
}

function completeThemeColorPopover() {
  hideThemeColorPopover();
  themeEditor.initialValue = "";
  themeEditor.editing = false;
}

function cancelThemeColorPopover() {
  const originalValue = themeEditor.initialValue;
  const originalThemeChanged = themeEditor.initialThemeChanged;
  const input = themeFieldInput(activeThemeField);
  hideThemeColorPopover();
  if (themeEditor.editing && input) {
    input.value = originalValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    themeChanged = originalThemeChanged;
    refreshDirty();
  }
  themeEditor.initialValue = "";
  themeEditor.editing = false;
}

function drawThemeColorSurfaces(hue) {
  if (!themeEditor.svCanvas || !themeEditor.hueCanvas) return;
  drawSaturationValueSurface(themeEditor.svCanvas, hue);
  drawHueSurface(themeEditor.hueCanvas);
}

function updateActiveThemeColor(color) {
  const normalized = normalizeColorText(color, "");
  const input = themeFieldInput(activeThemeField);
  if (!normalized || !input) {
    return;
  }
  input.value = normalized;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateThemeFromRgbInputs() {
  if (!themeEditor.rgbInputs?.length) {
    return;
  }
  if (themeEditor.rgbInputs.some((input) => input.value === "")) {
    return;
  }
  const [r, g, b] = themeEditor.rgbInputs.map((input) => (
    Math.min(255, Math.max(0, Number.parseInt(input.value, 10) || 0))
  ));
  updateActiveThemeColor(rgbToHex({ r, g, b }));
}

function updateThemeFromSvPointer(event) {
  const rect = themeEditor.svPad.getBoundingClientRect();
  const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
  const y = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
  const hsv = rgbToHsv(hexToRgb(themeFieldValue(activeThemeField)));
  updateActiveThemeColor(rgbToHex(hsvToRgb({
    h: hsv.h,
    s: rect.width ? x / rect.width : 0,
    v: rect.height ? 1 - (y / rect.height) : 0,
  })));
}

function updateThemeFromHuePointer(event) {
  const rect = themeEditor.hue.getBoundingClientRect();
  const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
  const hsv = rgbToHsv(hexToRgb(themeFieldValue(activeThemeField)));
  updateActiveThemeColor(rgbToHex(hsvToRgb({
    h: rect.width ? (x / rect.width) * 360 : 0,
    s: hsv.s,
    v: hsv.v,
  })));
}

function setThemeValues(theme, options = {}) {
  const updateVisualEffect = options.updateVisualEffect !== false;
  const animateTheme = options.animateTheme === true;
  const update = () => {
    request.theme_fields.forEach(({ id }) => {
      const textInput = themeFieldInput(id);
      const color = normalizeColorText(theme[id], request.theme_defaults[id]);
      if (textInput) {
        textInput.value = color;
      }
      syncThemeRole(id);
    });
    if (updateVisualEffect && theme.visual_effect_mode) {
      fields.visualEffectMode.value = theme.visual_effect_mode;
      refreshSelect(fields.visualEffectMode);
    }
    applyThemeTokens({
      ...theme,
      visual_effect_mode: fields.visualEffectMode.value || request.theme.visual_effect_mode,
    });
    syncThemeEditor();
  };
  if (animateTheme) {
    runThemeTransition(update);
    return;
  }
  update();
}

function makeProfileId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `profile-${Date.now()}`;
}

// 供应商页改为状态驱动的主从结构：providerState.profiles 是唯一数据源，
// 「供应商」页与「模型」页的槽位都从它派生。
const providerState = { profiles: [], selectedId: "", search: "" };
const inheritedSlotManualSelections = {};
const PROVIDER_FIELD_PLACEHOLDERS = {
  base_url: "通常以 /v1 结尾",
  api_key: "通常以 sk- 开头",
};

// 内置预设：选中即预填 Base URL 与图标，其余走「自定义」。
const PROVIDER_PRESETS = [
  {
    key: "deepseek",
    label: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    host: "api.deepseek.com",
    iconUrl: "./assets/providers/deepseek.svg",
  },
];

function initializeProviderState() {
  providerState.profiles = (request.api.profiles || []).map((profile) => ({
    id: profile.id || makeProfileId(),
    alias: profile.alias || profile.id || "供应商",
    base_url: profile.base_url || "",
    api_key: profile.api_key || "",
    configured: Boolean(profile.configured),
    credential_action: profile.credential_action || (profile.configured ? "keep" : "keep"),
    models: Array.isArray(profile.models) ? profile.models.map(String) : [],
  }));
  providerState.selectedId = providerState.profiles[0]?.id || "";
}

function providerHost(url) {
  const text = String(url || "").trim();
  if (!text) {
    return "";
  }
  try {
    return new URL(text).host;
  } catch {
    return text.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function presetForProfile(profile) {
  const host = providerHost(profile.base_url);
  const alias = String(profile.alias || "").toLowerCase();
  return (
    PROVIDER_PRESETS.find((preset) => preset.host === host || preset.label.toLowerCase() === alias)
    || null
  );
}

function filteredProviders() {
  const query = providerState.search.trim().toLowerCase();
  if (!query) {
    return providerState.profiles;
  }
  return providerState.profiles.filter((profile) =>
    [profile.alias, profile.base_url, ...(profile.models || [])]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function renderProviderPage() {
  renderProviderStatus();
  renderProviderList();
  renderProviderDetail();
}

function renderProviderStatus() {
  const items = providerState.profiles;
  const configured = items.filter(
    (profile) => (profile.base_url || "").trim()
      && ((profile.api_key || "").trim() || (profile.configured && profile.credential_action !== "clear")),
  ).length;
  const totalModels = items.reduce((sum, profile) => sum + (profile.models || []).length, 0);
  renderStrip(fields.providerStatusStrip, [
    { label: "供应商", value: items.length },
    { label: "已配置", value: configured },
    { label: "模型", value: totalModels },
  ]);
}

// 填充头像：优先用图标资源（如 DeepSeek SVG），其次 emoji，最后名称首字母。
function applyAvatar(avatar, { iconUrl, icon, initial } = {}) {
  avatar.textContent = "";
  avatar.classList.remove("is-initial");
  if (iconUrl) {
    const img = document.createElement("img");
    img.className = "provider-avatar-img";
    img.src = iconUrl;
    img.alt = "";
    avatar.append(img);
  } else if (icon) {
    avatar.textContent = icon;
  } else {
    avatar.classList.add("is-initial");
    avatar.textContent = (initial || "?").trim().charAt(0).toUpperCase() || "?";
  }
}

function providerAvatar(profile) {
  const avatar = document.createElement("span");
  avatar.className = "provider-avatar";
  const preset = presetForProfile(profile);
  applyAvatar(avatar, {
    iconUrl: preset?.iconUrl,
    icon: preset?.icon,
    initial: profile.alias || "?",
  });
  return avatar;
}

function renderProviderList() {
  fields.providerList.textContent = "";
  const profiles = filteredProviders();
  if (!profiles.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    if (providerState.profiles.length) {
      empty.textContent = "没有匹配的供应商。";
    } else {
      const text = document.createElement("p");
      text.className = "empty-state-text";
      text.textContent = "还没有供应商，先添加一个开始配置 API。";
      const cta = document.createElement("button");
      cta.type = "button";
      cta.className = "primary-button";
      cta.textContent = "添加供应商";
      cta.addEventListener("click", openAddProviderChooser);
      empty.append(text, cta);
    }
    fields.providerList.append(empty);
    return;
  }
  profiles.forEach((profile) => {
    const card = document.createElement("div");
    card.className = "provider-card";
    card.classList.toggle("is-selected", profile.id === providerState.selectedId);
    card.addEventListener("click", () => {
      providerState.selectedId = profile.id;
      renderProviderPage();
    });
    const body = document.createElement("div");
    body.className = "provider-card-body";
    const title = document.createElement("strong");
    title.textContent = profile.alias || profile.id;
    const meta = document.createElement("span");
    meta.className = "card-meta";
    meta.textContent = providerHost(profile.base_url) || "未设置 Base URL";
    body.append(title, meta);
    const count = document.createElement("span");
    count.className = "provider-count";
    count.textContent = `${(profile.models || []).length} 个模型`;
    card.append(providerAvatar(profile), body, count);
    fields.providerList.append(card);
  });
}

function renderProviderDetail() {
  const detail = fields.providerDetail;
  detail.textContent = "";
  const profile = providerState.profiles.find((item) => item.id === providerState.selectedId);
  if (!profile) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "选择左侧供应商查看与编辑配置。";
    detail.append(empty);
    return;
  }
  const title = document.createElement("h2");
  title.textContent = profile.alias || profile.id;
  detail.append(
    title,
    providerField(profile, "alias", "名称", "text"),
    providerField(profile, "base_url", "Base URL", "text"),
    providerField(profile, "api_key", "API Key", "password"),
    renderProviderModels(profile),
  );
  const actions = document.createElement("div");
  actions.className = "detail-actions";
  const testButton = document.createElement("button");
  testButton.type = "button";
  testButton.className = "secondary-button";
  testButton.textContent = "测试连接";
  testButton.addEventListener("click", () => testProvider(profile, testButton));
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "danger-button";
  removeButton.textContent = "删除供应商";
  removeButton.addEventListener("click", () => removeProvider(profile));
  if (profile.configured) {
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "secondary-button";
    clearButton.textContent = profile.credential_action === "clear" ? "已标记清除" : "清除凭据";
    clearButton.addEventListener("click", () => {
      profile.api_key = "";
      profile.credential_action = "clear";
      profile.configured = false;
      renderProviderPage();
      refreshDirty();
    });
    actions.append(testButton, clearButton, removeButton);
  } else {
    actions.append(testButton, removeButton);
  }
  detail.append(actions);
}

function providerField(profile, key, label, type) {
  const row = document.createElement("div");
  row.className = "form-row";
  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  const input = document.createElement("input");
  input.type = type === "password" ? "password" : "text";
  input.className = "wide-input";
  input.dataset.providerField = key;
  input.value = profile[key] || "";
  input.placeholder = PROVIDER_FIELD_PLACEHOLDERS[key] || "";
  if (key === "api_key" && profile.configured) {
    input.placeholder = "已保存；留空保持原值";
  }
  input.addEventListener("input", () => {
    profile[key] = input.value;
    if (key === "api_key") {
      profile.credential_action = input.value.trim() ? "replace" : (profile.configured ? "keep" : "clear");
    }
    if (input.value.trim()) {
      markInvalid(input, false);
    }
    if (key === "alias" || key === "base_url") {
      // 仅刷新左侧卡片与标题，避免重渲详情导致输入框失焦。
      renderProviderStatus();
      renderProviderList();
      if (key === "alias") {
        const heading = fields.providerDetail.querySelector("h2");
        if (heading) {
          heading.textContent = input.value.trim() || profile.id;
        }
      }
    } else if (key === "api_key") {
      renderProviderStatus();
    }
  });
  row.append(labelEl, input);
  return row;
}

function renderProviderModels(profile) {
  const section = document.createElement("div");
  section.className = "provider-models";
  const head = document.createElement("div");
  head.className = "provider-models-head";
  const heading = document.createElement("h3");
  heading.textContent = "模型";
  const detectButton = document.createElement("button");
  detectButton.type = "button";
  detectButton.className = "secondary-button compact-button";
  detectButton.textContent = "自动检测";
  detectButton.addEventListener("click", () => autoDetectModels(profile, detectButton));
  head.append(heading, detectButton);
  section.append(head);

  const list = document.createElement("div");
  list.className = "model-chip-list";
  if (!(profile.models || []).length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "还没有模型，点「自动检测」或在下方手动添加。";
    list.append(empty);
  } else {
    profile.models.forEach((model) => {
      const chip = document.createElement("span");
      chip.className = "model-chip";
      const name = document.createElement("span");
      name.textContent = model;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "model-chip-remove";
      remove.setAttribute("aria-label", `删除 ${model}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        profile.models = profile.models.filter((item) => item !== model);
        renderProviderPage();
        refreshModelSlots();
      });
      chip.append(name, remove);
      list.append(chip);
    });
  }
  section.append(list);

  const addRow = document.createElement("div");
  addRow.className = "model-add-row";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "wide-input";
  input.placeholder = "手动添加模型 ID";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "secondary-button compact-button";
  addButton.textContent = "添加";
  const commit = () => {
    const value = input.value.trim();
    if (!value) {
      return;
    }
    const added = addModelsToProfile(profile, [value]);
    input.value = "";
    setError(added ? "" : "该模型已存在。");
  };
  addButton.addEventListener("click", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  });
  addRow.append(input, addButton);
  section.append(addRow);
  return section;
}

function addModelsToProfile(profile, models) {
  if (!Array.isArray(profile.models)) {
    profile.models = [];
  }
  const existing = new Set(profile.models);
  let added = 0;
  models.forEach((model) => {
    const name = String(model || "").trim();
    if (name && !existing.has(name)) {
      existing.add(name);
      profile.models.push(name);
      added += 1;
    }
  });
  if (added) {
    renderProviderPage();
    refreshModelSlots();
  }
  return added;
}

function providerDetailInput(key) {
  return fields.providerDetail.querySelector(`[data-provider-field="${key}"]`);
}

async function autoDetectModels(profile, button) {
  const baseUrl = (profile.base_url || "").trim();
  const apiKey = (profile.api_key || "").trim();
  if (!baseUrl) {
    markInvalid(providerDetailInput("base_url"), true);
    setError("请先填写 Base URL。");
    return;
  }
  if (!apiKey && !(profile.configured && profile.credential_action === "keep")) {
    markInvalid(providerDetailInput("api_key"), true);
    setError("请先填写 API Key。");
    return;
  }
  setError("");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "检测中…";
  try {
    const result = await runtimeProviderModelController.listModels(runtimeProbeProfile(profile, ""));
    const models = Array.isArray(result?.models) ? result.models : [];
    if (!models.length) {
      notify("未检测到任何模型。", "info");
      return;
    }
    openModelPicker(profile, models);
  } catch (error) {
    setError(`自动检测失败：${error}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function testProvider(profile, button) {
  const baseUrl = (profile.base_url || "").trim();
  const apiKey = (profile.api_key || "").trim();
  const model = (profile.models || [])[0];
  if (!baseUrl || (!apiKey && !(profile.configured && profile.credential_action === "keep"))) {
    markInvalid(providerDetailInput("base_url"), !baseUrl);
    markInvalid(providerDetailInput("api_key"), !apiKey);
    setError("请先填写 Base URL 与 API Key。");
    return;
  }
  if (!model) {
    setError("请先添加至少一个模型再测试。");
    return;
  }
  setError("");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "测试中…";
  try {
    const result = await runtimeProviderModelController.testConnection(runtimeProbeProfile(profile, model));
    notify(`连接成功：${result?.message || "OK"}`, "success");
  } catch (error) {
    setError(`连接失败：${error}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function removeProvider(profile) {
  providerState.profiles = providerState.profiles.filter((item) => item.id !== profile.id);
  if (providerState.selectedId === profile.id) {
    providerState.selectedId = providerState.profiles[0]?.id || "";
  }
  renderProviderPage();
  refreshModelSlots();
}

function addProvider(preset) {
  const profile = {
    id: makeProfileId(),
    alias: preset?.label || "新供应商",
    base_url: preset?.base_url || "",
    api_key: "",
    configured: false,
    credential_action: "keep",
    models: [],
  };
  providerState.profiles.push(profile);
  providerState.selectedId = profile.id;
  providerState.search = "";
  if (fields.providerSearch) {
    fields.providerSearch.value = "";
  }
  renderProviderPage();
  refreshModelSlots();
}

function makeModalButton(text, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

function openAddProviderChooser() {
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  const dialog = document.createElement("div");
  dialog.className = "confirm-dialog provider-add-dialog";
  const heading = document.createElement("h2");
  heading.textContent = "添加供应商";
  const grid = document.createElement("div");
  grid.className = "provider-preset-grid";
  const close = () => overlay.remove();
  PROVIDER_PRESETS.forEach((preset) => {
    const option = makeModalButton("", "provider-preset-option", () => {
      addProvider(preset);
      close();
    });
    const icon = document.createElement("span");
    icon.className = "provider-avatar";
    applyAvatar(icon, { iconUrl: preset.iconUrl, icon: preset.icon, initial: preset.label });
    const label = document.createElement("span");
    label.textContent = preset.label;
    option.append(icon, label);
    grid.append(option);
  });
  const custom = makeModalButton("", "provider-preset-option", () => {
    addProvider(null);
    close();
  });
  const customIcon = document.createElement("span");
  customIcon.className = "provider-avatar is-initial";
  customIcon.textContent = "＋";
  const customLabel = document.createElement("span");
  customLabel.textContent = "自定义";
  custom.append(customIcon, customLabel);
  grid.append(custom);
  const actions = document.createElement("div");
  actions.className = "confirm-actions";
  actions.append(makeModalButton("取消", "secondary-button", close));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  dialog.append(heading, grid, actions);
  overlay.append(dialog);
  document.body.append(overlay);
}

function openModelPicker(profile, models) {
  const existing = new Set(profile.models || []);
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  const dialog = document.createElement("div");
  dialog.className = "confirm-dialog model-picker-dialog";
  const heading = document.createElement("h2");
  heading.textContent = `检测到 ${models.length} 个模型`;
  const toolbar = document.createElement("div");
  toolbar.className = "model-picker-toolbar";
  const body = document.createElement("div");
  body.className = "model-picker-list";
  const checks = models.map((model) => {
    const item = document.createElement("label");
    item.className = "check-control model-picker-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = model;
    checkbox.checked = !existing.has(model);
    const text = document.createElement("span");
    text.textContent = existing.has(model) ? `${model}（已添加）` : model;
    item.append(checkbox, text);
    body.append(item);
    return checkbox;
  });
  const setAll = (predicate) => checks.forEach((checkbox) => {
    checkbox.checked = predicate(checkbox);
  });
  toolbar.append(
    makeModalButton("全选", "secondary-button compact-button", () => setAll(() => true)),
    makeModalButton("只选新增", "secondary-button compact-button", () =>
      setAll((checkbox) => !existing.has(checkbox.value)),
    ),
    makeModalButton("全不选", "secondary-button compact-button", () => setAll(() => false)),
  );
  const actions = document.createElement("div");
  actions.className = "confirm-actions";
  const close = () => overlay.remove();
  actions.append(
    makeModalButton("取消", "secondary-button", close),
    makeModalButton("添加", "primary-button", () => {
      const chosen = checks.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
      const added = addModelsToProfile(profile, chosen);
      close();
      notify(added ? `已添加 ${added} 个模型。` : "没有新增模型。", added ? "success" : "info");
    }),
  );
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  dialog.append(heading, toolbar, body, actions);
  overlay.append(dialog);
  document.body.append(overlay);
}

function modelSlotElements(slot) {
  return {
    inheritInput: fields.modelSlots.querySelector(`[data-slot-inherit="${slot}"]`),
    profileSelect: fields.modelSlots.querySelector(`[data-slot-profile="${slot}"]`),
    modelSelect: fields.modelSlots.querySelector(`[data-slot-model="${slot}"]`),
    contextWindowInput: slot === "core:chat" ? fields.contextWindowTokens : null,
  };
}

function readSlotSelection(slot) {
  const { profileSelect, modelSelect, contextWindowInput } = modelSlotElements(slot);
  const selection = {
    profile_id: profileSelect?.value || "",
    model: modelSelect?.value || "",
  };
  if (contextWindowInput) {
    const value = contextWindowInput.value.trim();
    selection.context_window_tokens = value ? Number.parseInt(value, 10) : null;
  }
  return selection;
}

function setSlotSelection(slot, selection, { preserveMissing = true } = {}) {
  const { profileSelect, modelSelect, contextWindowInput } = modelSlotElements(slot);
  if (!profileSelect || !modelSelect) {
    return;
  }
  const profileId = selection?.profile_id || "";
  if (profileId && Array.from(profileSelect.options).some((option) => option.value === profileId)) {
    profileSelect.value = profileId;
    refreshSelect(profileSelect);
  }
  syncModelOptions(slot, selection?.model || "", { preserveMissing });
  if (contextWindowInput) {
    contextWindowInput.value = selection?.context_window_tokens ?? "";
  }
}

function inheritedSlotSourceSelection(slot) {
  if (slot === "core:chat") {
    return null;
  }
  const chat = readSlotSelection("core:chat");
  return chat.profile_id && chat.model ? chat : null;
}

function syncInheritedSlotDisplays() {
  request.api.slot_fields.forEach((slot) => {
    const inheritInput = fields.modelSlots.querySelector(`[data-slot-inherit="${slot.id}"]`);
    if (inheritInput?.checked) {
      syncSlotInheritState(slot.id);
    }
  });
}

function handleSlotInheritChange(slot) {
  const { inheritInput } = modelSlotElements(slot);
  if (inheritInput?.checked) {
    const current = readSlotSelection(slot);
    if (current.profile_id && current.model) {
      inheritedSlotManualSelections[slot] = current;
    }
  } else if (inheritedSlotManualSelections[slot]) {
    setSlotSelection(slot, inheritedSlotManualSelections[slot], { preserveMissing: true });
    delete inheritedSlotManualSelections[slot];
  }
  syncSlotInheritState(slot);
}

function renderModelSlots(selection, { preserveMissing = true } = {}) {
  fields.modelSlots.textContent = "";
  request.api.slot_fields.forEach((slot) => {
    const row = document.createElement("div");
    row.className = "form-row model-slot-row";
    row.dataset.slot = slot.id;
    const label = document.createElement("label");
    label.textContent = slot.label;
    const controls = document.createElement("div");
    controls.className = "slot-controls";
    const profileSelect = document.createElement("select");
    profileSelect.dataset.slotProfile = slot.id;
    const modelSelect = document.createElement("select");
    modelSelect.dataset.slotModel = slot.id;
    const contextWindowInput = slot.id === "core:chat" ? fields.contextWindowTokens : null;
    if (slot.allow_inherit) {
      row.classList.add("has-inherit");
      const inheritLabel = document.createElement("label");
      inheritLabel.className = "check-control slot-inherit";
      const inheritInput = document.createElement("input");
      inheritInput.type = "checkbox";
      inheritInput.dataset.slotInherit = slot.id;
      const inheritText = document.createElement("span");
      inheritText.textContent = "继承";
      inheritLabel.append(inheritInput, inheritText);
      controls.append(inheritLabel);
      inheritInput.addEventListener("change", () => handleSlotInheritChange(slot.id));
    }
    controls.append(profileSelect, modelSelect);
    const text = document.createElement("span");
    text.className = "setting-row-text";
    const title = document.createElement("span");
    title.className = "setting-title";
    title.textContent = slot.label;
    const description = document.createElement("span");
    description.className = "setting-desc";
    description.textContent = slot.description || "";
    text.append(title, description);
    row.append(text, controls);
    fields.modelSlots.append(row);
    enhanceSelect(profileSelect);
    enhanceSelect(modelSelect);
    profileSelect.addEventListener("change", () => {
      syncModelOptions(slot.id, "", { preserveMissing: false });
      if (slot.id === "core:chat") {
        syncInheritedSlotDisplays();
      }
    });
    modelSelect.addEventListener("change", () => {
      if (slot.id === "core:chat") {
        syncInheritedSlotDisplays();
      }
    });
    const selected = selection?.slots?.[slot.id] || { profile_id: "", model: "" };
    const inheritInput = fields.modelSlots.querySelector(`[data-slot-inherit="${slot.id}"]`);
    if (inheritInput) {
      inheritInput.checked = !selected.profile_id || !selected.model;
    }
    fillProfileOptions(profileSelect, selected.profile_id, slot.required);
    syncModelOptions(slot.id, selected.model, { preserveMissing });
    if (contextWindowInput) {
      contextWindowInput.value = selected.context_window_tokens ?? "";
    }
    syncSlotInheritState(slot.id);
  });
}

function fillProfileOptions(select, selectedId, required) {
  const profiles = providerState.profiles;
  select.textContent = "";
  if (!required) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "不启用";
    select.append(empty);
  }
  profiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.alias || profile.id;
    select.append(option);
  });
  const ids = profiles.map((profile) => profile.id);
  if (selectedId && !ids.includes(selectedId)) {
    const missing = document.createElement("option");
    missing.value = selectedId;
    missing.textContent = `${selectedId}（原选择不可用）`;
    select.append(missing);
  }
  let value = ids.includes(selectedId) ? selectedId : "";
  if (selectedId && !ids.includes(selectedId)) value = selectedId;
  if (!value && required && profiles[0]) {
    value = profiles[0].id;
  }
  select.value = value;
  refreshSelect(select);
}

function syncModelOptions(slot, selectedModel, { preserveMissing = selectedModel !== undefined } = {}) {
  const profileSelect = fields.modelSlots.querySelector(`[data-slot-profile="${slot}"]`);
  const modelSelect = fields.modelSlots.querySelector(`[data-slot-model="${slot}"]`);
  const profile = providerState.profiles.find((item) => item.id === profileSelect.value);
  const models = profile?.models || [];
  const current = selectedModel ?? "";
  modelSelect.textContent = "";
  if (!profileSelect.value) {
    refreshSelect(modelSelect);
    return;
  }
  const resolved = resolveModelOptions(models, current, preserveMissing);
  resolved.options.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = models.includes(model) ? model : `${model}（原选择不可用）`;
    modelSelect.append(option);
  });
  modelSelect.value = resolved.value;
  refreshSelect(modelSelect);
}

function resolveModelOptions(models, selectedModel, preserveMissing) {
  const options = [...models];
  const current = String(selectedModel || "");
  if (preserveMissing && current && !options.includes(current)) {
    options.push(current);
  }
  const value = options.includes(current) ? current : options[0] || "";
  return { options, value };
}

function syncSlotInheritState(slot) {
  const inheritInput = fields.modelSlots.querySelector(`[data-slot-inherit="${slot}"]`);
  const inherited = Boolean(inheritInput?.checked);
  const profileSelect = fields.modelSlots.querySelector(`[data-slot-profile="${slot}"]`);
  const modelSelect = fields.modelSlots.querySelector(`[data-slot-model="${slot}"]`);
  if (inherited) {
    const inheritedSelection = inheritedSlotSourceSelection(slot);
    if (inheritedSelection) {
      setSlotSelection(slot, inheritedSelection, { preserveMissing: true });
    }
  }
  if (profileSelect) {
    setControlDisabled(profileSelect, inherited, { row: false });
  }
  if (modelSelect) {
    setControlDisabled(modelSelect, inherited, { row: false });
  }
  fields.modelSlots
    .querySelector(`[data-slot="${slot}"]`)
    ?.classList.toggle("is-inherited", inherited);
}

function refreshModelSlots() {
  renderModelSlots(collectModelSelection(), { preserveMissing: false });
}

function collectModelSelection() {
  const slots = {};
  request.api.slot_fields.forEach((slot) => {
    const inherited = fields.modelSlots.querySelector(`[data-slot-inherit="${slot.id}"]`)?.checked;
    const selection = readSlotSelection(slot.id);
    slots[slot.id] = inherited
      ? { profile_id: "", model: "" }
      : selection;
  });
  return { slots };
}

function characterExportDefaultName(kind) {
  const id = selectedCharacter()?.id || "character";
  if (kind === "voice") {
    return `${id}.voice`;
  }
  if (kind === "card") {
    return `${id}.card.char`;
  }
  return `${id}.char`;
}

async function chooseArchivePath(kind) {
  return invoke("settings_character_choose_import", { kind });
}

async function chooseExportPath(kind) {
  return invoke("settings_character_choose_export", {
    kind,
    defaultName: characterExportDefaultName(kind),
  });
}

function chooseExportKind() {
  return new Promise((resolve) => {
    const hasVoice = selectedCharacterHasExportableVoice();
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    const dialog = document.createElement("section");
    dialog.className = "confirm-dialog export-kind-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const heading = document.createElement("h2");
    heading.textContent = "选择导出内容";
    const body = document.createElement("div");
    body.className = "export-kind-list";

    characterExportOptions.forEach((option) => {
      const disabled = option.requiresVoice && !hasVoice;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "export-kind-option";
      button.disabled = disabled;
      const title = document.createElement("span");
      title.className = "export-kind-title";
      title.textContent = option.label;
      const desc = document.createElement("span");
      desc.className = "export-kind-desc";
      desc.textContent = disabled
        ? `${option.description} 当前角色没有可导出的语音模型。`
        : option.description;
      button.append(title, desc);
      button.addEventListener("click", () => close(option.kind));
      body.append(button);
    });

    const actions = document.createElement("div");
    actions.className = "confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = "取消";
    actions.append(cancel);
    dialog.append(heading, body, actions);
    overlay.append(dialog);

    function close(kind) {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(kind || "");
    }
    function onKey(event) {
      if (event.key === "Escape") {
        close("");
      }
    }
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close("");
      }
    });
    cancel.addEventListener("click", () => close(""));
    document.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    dialog.querySelector("button:not(:disabled)")?.focus();
  });
}

async function runCharacterArchiveAction(action) {
  if (!request || characterArchiveBusy) {
    return;
  }
  setError("");
  setCharacterArchiveBusy(true);
  try {
    await action();
  } catch (error) {
    setError(String(error));
  } finally {
    setCharacterArchiveBusy(false);
  }
}

async function importCharacterArchive() {
  await runCharacterArchiveAction(async () => {
    const path = String(await chooseArchivePath("character") || "").trim();
    if (!path) {
      return;
    }
    const previousLifecycle = await invoke("runtime_lifecycle_snapshot");
    const result = await rootSettingsClient.characterImport(path);
    await applyRuntimeCharacterChange(result, previousLifecycle);
    notify("角色包已导入。", "success");
  });
}

async function stageRuntimeCharacterSelection() {
  if (characterArchiveBusy) return;
  const characterId = fields.characterSelect.value;
  if (!characterId || characterId === runtimeCharacterDraftId) return;
  const previousCharacterId = runtimeCharacterDraftId
    || runtimeCharacterSnapshot?.currentCharacterId
    || "";
  const committedCharacterId = runtimeCharacterSnapshot?.currentCharacterId || "";
  if (characterId !== committedCharacterId && currentCharacterHasDrafts()) {
    fields.characterSelect.value = previousCharacterId;
    refreshSelect(fields.characterSelect);
    setError("当前角色还有未保存的外观、语音或记忆改动，请先保存或放弃后再切换。");
    return;
  }
  runtimeCharacterDraftId = characterId;
  setError("");
  refreshSelect(fields.characterSelect);
  syncCharacterArchiveState();
  refreshDirty();
  if (pendingRuntimeCharacterId()) {
    notify("角色选择已暂存，点击“应用”或“保存并关闭”后生效。", "info");
  }
  try {
    await previewRuntimeCharacterVisual(characterId);
  } catch (error) {
    if (characterId === runtimeCharacterDraftId) {
      setError(`角色视觉预览失败：${String(error)}`);
    }
  }
}

async function importCharacterVoiceArchive() {
  await runCharacterArchiveAction(async () => {
    const character = selectedCharacter();
    if (!character) {
      setError("请先选择一个角色。");
      return;
    }
    if (pendingRuntimeCharacterId() || currentCharacterHasDrafts()) {
      setError("请先保存或放弃角色相关改动，再导入语音包。");
      return;
    }
    const path = String(await chooseArchivePath("voice") || "").trim();
    if (!path) {
      return;
    }
    const previousLifecycle = await invoke("runtime_lifecycle_snapshot");
    const result = await rootSettingsClient.characterVoiceImport(path, character.id);
    await applyRuntimeCharacterChange(result, previousLifecycle);
    notify(`已为角色「${character.display_name}」导入 TTS 模型包。`, "success");
  });
}

async function exportCharacterArchive() {
  await runCharacterArchiveAction(async () => {
    const character = selectedCharacter();
    if (!character) {
      setError("当前没有可导出的角色。");
      return;
    }
    if (pendingRuntimeCharacterId()) {
      setError("请先应用或放弃待切换的角色，再导出角色包。");
      return;
    }
    const kind = await chooseExportKind();
    if (!kind) {
      return;
    }
    const path = String(await chooseExportPath(kind) || "").trim();
    if (!path) {
      return;
    }
    const result = await rootSettingsClient.characterExport(path, character.id, kind);
    notify(result.message, "success");
  });
}

async function launchCharacterStudio() {
  await runCharacterArchiveAction(async () => {
    const character = selectedCharacter();
    if (!character) {
      setError("请先选择一个角色。");
      return;
    }
    await invoke("open_character_studio", { characterId: character.id });
  });
}

function runtimeFeatureAvailable(feature) {
  return Object.values(runtimeCapabilityManifest?.sections || {})
    .some((section) => section?.features?.[feature] === "available");
}

function renderStrip(container, items) {
  container.textContent = "";
  items.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "status-chip";
    chip.textContent = `${item.label} ${item.value}`;
    container.append(chip);
  });
}

// 布局滑块的输出显示；预览和保存由 Appearance controller 处理。
const layoutSliders = [
  "portraitScale",
  "controlPanelWidth",
  "bubbleHeight",
  "controlPanelOffset",
  "inputBarOffset",
];

function updateSliderOutput(fieldKey) {
  const input = fields[fieldKey];
  const output = input?.parentElement?.querySelector(".slider-value");
  if (output) {
    output.textContent = input.value;
  }
  if (input) {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value);
    const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty("--slider-progress", `${Math.max(0, Math.min(100, progress))}%`);
  }
}

function normalizedProviderProfiles() {
  return providerState.profiles.map((profile) => ({
    id: profile.id,
    alias: (profile.alias || "").trim() || profile.id,
    base_url: (profile.base_url || "").trim(),
    api_key: (profile.api_key || "").trim(),
    models: (profile.models || []).map((model) => String(model).trim()).filter(Boolean),
  }));
}

function providerDisplayName(profile) {
  return profile.alias || profile.id || "未命名供应商";
}

function focusProviderValidation(profile, field) {
  providerState.selectedId = profile.id;
  providerState.search = "";
  if (fields.providerSearch) {
    fields.providerSearch.value = "";
  }
  showPage("providers");
  renderProviderPage();
  markInvalid(providerDetailInput(field), true);
}

function validateApiSettingsBeforeSubmit() {
  const profiles = normalizedProviderProfiles();
  if (!profiles.length) {
    showPage("providers");
    setError("请至少添加一个 API 供应商。");
    return false;
  }
  const missingBaseUrl = profiles.find((profile) => !profile.base_url);
  if (missingBaseUrl) {
    focusProviderValidation(missingBaseUrl, "base_url");
    setError(`供应商「${providerDisplayName(missingBaseUrl)}」缺少 Base URL。`);
    return false;
  }
  const selection = collectModelSelection();
  const issue = findProviderModelSelectionIssue({
    providers: profiles,
    modelSlots: selection.slots,
    slotFields: request.api.slot_fields,
  });
  if (!issue) {
    return true;
  }
  showPage("model");
  refreshModelSlots();
  if (issue.type === "incomplete") {
    setError(`${issue.label}必须同时选择供应商和模型。`);
  } else if (issue.type === "required") {
    setError(`请选择可用的${issue.label}。`);
  } else {
    setError(`${issue.label}引用的供应商或模型已不可用，请重新选择。`);
  }
  return false;
}

function collectApiSettings() {
  const limits = request.limits;
  const temperature = clampFloat(fields.apiTemperature.value, limits.api_temperature);
  const initialTemperature = request.api.settings.temperature;
  return {
    settings: {
      timeout_seconds: clampInt(fields.apiTimeout.value, limits.api_timeout_seconds),
      temperature:
        initialTemperature === null && Math.abs(temperature - 0.8) < 0.005
          ? null
          : temperature,
      top_p: fields.apiTopPEnabled.checked
        ? clampFloat(fields.apiTopP.value, limits.api_top_p)
        : null,
      max_tokens: fields.apiMaxTokensEnabled.checked
        ? clampInt(fields.apiMaxTokens.value, limits.api_max_tokens)
        : null,
    },
    profiles: normalizedProviderProfiles(),
    model_selection: collectModelSelection(),
  };
}

function runtimeCredential(profile) {
  const value = (profile.api_key || "").trim();
  let action = profile.credential_action || (profile.configured ? "keep" : "clear");
  if (value) action = "replace";
  if (action === "keep" && !profile.configured) action = "clear";
  return { action, value: action === "replace" ? value : "" };
}

function runtimeProbeProfile(profile, model) {
  return {
    profile_id: profile.id,
    base_url: (profile.base_url || "").trim(),
    model: String(model || "").trim(),
    timeout_seconds: clampInt(fields.apiTimeout.value || 15, [1, 60]),
    credential: runtimeCredential(profile),
  };
}

function collectRuntimeProviderModelDraft() {
  const api = collectApiSettings();
  const selection = collectModelSelection().slots;
  return {
    providers: providerState.profiles.map((profile) => ({
      id: profile.id,
      alias: (profile.alias || "").trim() || profile.id,
      base_url: (profile.base_url || "").trim(),
      models: (profile.models || []).map((model) => String(model).trim()).filter(Boolean),
      credential: runtimeCredential(profile),
    })),
    model_slots: selection,
    settings: api.settings,
  };
}

function applyRuntimeProviderModelSnapshot(snapshot) {
  request = request || {};
  request.limits = {
    ...(request.limits || {}),
    api_timeout_seconds: [1, 300],
    api_temperature: [0, 2],
    api_top_p: [0, 1],
    api_max_tokens: [1, 1000000],
  };
  request.api = {
    profiles: snapshot.providers.map((profile) => ({
      ...profile,
      api_key: "",
      credential_action: profile.configured ? "keep" : "clear",
    })),
    settings: snapshot.settings,
    slot_fields: snapshot.model_slots.map((slot) => ({
      id: slot.identity,
      label: slot.label,
      description: slot.description,
      required: slot.required,
      allow_inherit: slot.identity !== "core:chat" && !slot.required,
      owner_type: slot.ownerType,
      owner_id: slot.ownerId,
      reason_code: slot.reasonCode,
    })),
    model_selection: {
      slots: Object.fromEntries(snapshot.model_slots.map((slot) => [slot.identity, slot.selection])),
    },
  };
  initializeProviderState();
  renderProviderPage();
  renderModelSlots(request.api.model_selection);
  setNumericBounds(fields.contextWindowTokens, [4_096, 2_000_000]);
  setNumericBounds(fields.apiTimeout, request.limits.api_timeout_seconds);
  setNumericBounds(fields.apiMaxTokens, request.limits.api_max_tokens);
  fields.apiTimeout.value = snapshot.settings.timeout_seconds;
  fields.apiTemperature.value = snapshot.settings.temperature ?? 0.8;
  fields.apiTopPEnabled.checked = snapshot.settings.top_p !== null;
  fields.apiTopP.value = snapshot.settings.top_p ?? 1;
  fields.apiMaxTokensEnabled.checked = snapshot.settings.max_tokens !== null;
  fields.apiMaxTokens.value = snapshot.settings.max_tokens ?? 2048;
  syncApiAdvancedState();
}

async function refreshRuntimeVoiceCurrent() {
  if (!runtimeVoiceController) return;
  await runtimeVoiceController.refreshCurrent({ preserveDraft: true });
}

async function saveRuntimeSettings() {
  if ((runtimePluginController?.characterDraftCount() || 0) > 0) {
    throw new Error("请先使用“保存记忆”提交当前记忆草稿，或还原草稿后再关闭设置。");
  }
  if (runtimeAppearanceController?.isDirty()) await runtimeAppearanceController.save();
  let result = null;
  if (runtimeScreenAwarenessController?.isDirty()) {
    result = await runtimeScreenAwarenessController.save();
  }
  if (runtimeProviderModelController?.isDirty()) {
    if (!validateApiSettingsBeforeSubmit()) throw new Error("供应商或模型设置未通过校验。");
    result = await runtimeProviderModelController.save();
    providerState.profiles.forEach((profile) => {
      profile.configured = runtimeCredential(profile).action !== "clear";
      profile.api_key = "";
      profile.credential_action = profile.configured ? "keep" : "clear";
    });
    renderProviderPage();
    runtimeProviderModelController.rebase();
    await runtimeToolsController?.refreshCurrent();
    await runtimePluginController?.refreshCurrent();
    await refreshRuntimeVoiceCurrent();
  }
  if (runtimeChatTimingController?.isDirty()) {
    result = await runtimeChatTimingController.save();
  }
  if (runtimeBubbleAutoHideController?.isDirty()) {
    result = await runtimeBubbleAutoHideController.save();
  }
  if (runtimeAutostartController?.isDirty()) {
    result = await runtimeAutostartController.save();
  }
  if (runtimeToolsController?.isDirty()) {
    result = await runtimeToolsController.save();
    await runtimePluginController?.refreshCurrent();
    await runtimeProviderModelController?.refreshCurrent();
    await refreshRuntimeVoiceCurrent();
  }
  if (runtimePluginController?.isDirty()) {
    result = await runtimePluginController.save();
    await runtimeToolsController?.refreshCurrent();
    await runtimeProviderModelController?.refreshCurrent();
    await refreshRuntimeVoiceCurrent();
  }
  if (runtimeVoiceController?.isDirty()) {
    result = await runtimeVoiceController.save();
    await runtimeToolsController?.refreshCurrent();
    await runtimePluginController?.refreshCurrent();
    await runtimeProviderModelController?.refreshCurrent();
  }
  const characterResult = await commitCharacterSelection({
    committedCharacterId: runtimeCharacterSnapshot?.currentCharacterId,
    selectedCharacterId: runtimeCharacterDraftId,
    readLifecycle: () => invoke("runtime_lifecycle_snapshot"),
    selectCharacter: (characterId) => rootSettingsClient.characterSelect(characterId),
    applyChange: applyRuntimeCharacterChange,
  });
  if (characterResult !== null) result = characterResult;
  return result;
}

function collectThemeSettings() {
  const theme = {};
  request.theme_fields.forEach(({ id }) => {
    const input = fields.themeColors.querySelector(`[data-theme-field="${id}"]`);
    theme[id] = input.value;
  });
  theme.ai_enabled = Boolean(request.theme.ai_enabled && !themeChanged);
  theme.visual_effect_mode = fields.visualEffectMode.value || request.theme.visual_effect_mode;
  return theme;
}

function upgradeSliderControls() {
  // 点击 .slider-value 可进入编辑模式，回车/失焦后切回显示并同步滑块。
  document.querySelectorAll(".slider-control").forEach((control) => {
    const output = control.querySelector(".slider-value");
    const slider = control.querySelector("input[type='range']");
    if (!output || !slider || output.dataset.upgraded) return;
    output.dataset.upgraded = "true";

    output.addEventListener("click", () => {
      if (slider.disabled) return;
      const min = Number(slider.min || 0);
      const max = Number(slider.max || 100);
      const editor = document.createElement("input");
      editor.type = "number";
      editor.className = "slider-value-editor";
      editor.min = String(min);
      editor.max = String(max);
      editor.step = slider.step || "1";
      editor.value = slider.value;
      editor.style.width = `${Math.max(40, output.offsetWidth)}px`;
      output.replaceWith(editor);
      editor.focus();
      editor.select();

      function commit() {
        const clamped = clampInt(editor.value, [Number(editor.min), Number(editor.max)]);
        const changed = String(clamped) !== slider.value;
        slider.value = String(clamped);
        if (changed) {
          slider.dispatchEvent(new Event("input", { bubbles: true }));
        }
        output.textContent = slider.value;
        editor.replaceWith(output);
      }

      editor.addEventListener("blur", commit);
      editor.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); output.textContent = slider.value; editor.replaceWith(output); }
      });
    });
  });
}

fields.navItems.forEach((item) => {
  item.addEventListener("click", () => showPage(item.dataset.page));
});
layoutSliders.forEach((fieldKey) => {
  const preview = () => {
    updateSliderOutput(fieldKey);
  };
  fields[fieldKey].addEventListener("input", preview);
  fields[fieldKey].addEventListener("change", preview);
});
["speechFontSize", "nameFontSize", "inputFontSize"].forEach((fieldKey) => {
  const preview = () => {
    updateSliderOutput(fieldKey);
  };
  fields[fieldKey].addEventListener("input", preview);
  fields[fieldKey].addEventListener("change", preview);
});
fields.characterSelect.addEventListener("change", () => {
  void stageRuntimeCharacterSelection();
});
fields.characterSelect.addEventListener("change", syncCharacterArchiveState);
fields.characterImportButton.addEventListener("click", importCharacterArchive);
fields.ttsVoiceImportButton.addEventListener("click", importCharacterVoiceArchive);
fields.characterExportButton.addEventListener("click", exportCharacterArchive);
fields.characterEditorButton.addEventListener("click", launchCharacterStudio);
fields.storageOpenUserRoot.addEventListener("click", () => {
  rootSettingsClient.storageOpenUserRoot().catch((error) => setError(String(error)));
});
fields.storageChooseTtsRoot.addEventListener("click", chooseTtsStorageRoot);
fields.storageResetTtsRoot.addEventListener("click", resetTtsStorageRoot);
fields.legacyRoleDataImportButton.addEventListener("click", importLegacyRoleData);
fields.aboutWebsiteButton.addEventListener("click", () => {
  rootSettingsClient.aboutOpenWebsite().catch((error) => setError(String(error)));
});
fields.aboutRepositoryButton.addEventListener("click", () => {
  rootSettingsClient.aboutOpenRepository().catch((error) => setError(String(error)));
});
fields.aboutChangelogButton.addEventListener("click", () => {
  rootSettingsClient.aboutOpenChangelog().catch((error) => setError(String(error)));
});
fields.aboutSponsorButton.addEventListener("click", () => {
  rootSettingsClient.aboutOpenSponsor().catch((error) => setError(String(error)));
});
fields.systemFirstRunGuideButton.addEventListener("click", () => {
  firstRunGuideController?.start({ persist: false });
});
fields.updateCheckButton.addEventListener("click", checkForUpdates);
fields.updateAutoCheck.addEventListener("change", saveUpdatePreferences);
fields.telemetryEnabled.addEventListener("change", setTelemetryEnabled);
fields.telemetryHelpButton.addEventListener("click", () => {
  rootSettingsClient.telemetryOpenDocumentation().catch((error) => setError(String(error)));
});
fields.telemetryCopyButton.addEventListener("click", async () => {
  const value = fields.telemetryInstallationId.textContent?.trim() || "";
  if (!/^[0-9a-f-]{36}$/.test(value)) return;
  try {
    await navigator.clipboard.writeText(value);
    notify("诊断 ID 已复制。", "success");
  } catch {
    setError("TELEMETRY_INSTALLATION_ID_COPY_FAILED");
  }
});
fields.telemetryRegenerateButton.addEventListener("click", regenerateTelemetryInstallationId);
fields.updateActionButton.addEventListener("click", runUpdateAction);
fields.enabled.addEventListener("change", syncEnabledState);
fields.addProviderButton.addEventListener("click", openAddProviderChooser);
fields.providerSearch.addEventListener("input", () => {
  providerState.search = fields.providerSearch.value;
  renderProviderList();
});
fields.apiTopPEnabled.addEventListener("change", syncApiAdvancedState);
fields.apiMaxTokensEnabled.addEventListener("change", syncApiAdvancedState);
fields.visualEffectMode.addEventListener("change", markThemeChanged);
fields.visualEffectMode.addEventListener("runtime-value-applied", () => refreshSelect(fields.visualEffectMode));
fields.resetThemeButton.addEventListener("click", () => {
  setThemeValues(selectedCharacterThemeDefaults(), { updateVisualEffect: false, animateTheme: true });
  themeChanged = true;
});
fields.bubbleAutoHide.addEventListener("change", syncBubbleState);
fields.saveButton.addEventListener("click", async () => {
  if (characterSwitching) {
    setError("角色切换完成前不能保存设置。");
    return;
  }
  const original = fields.saveButton.textContent;
  setError("");
  setSubmissionBusy(true);
  fields.saveButton.textContent = "保存中…";
  try {
    await saveRuntimeSettings();
    notify("已保存。", "success");
    await closeSettingsWindow();
  } catch (error) {
    bypassCloseGuard = false;
    setError(String(error));
  } finally {
    setSubmissionBusy(false);
    fields.saveButton.textContent = original;
  }
});

fields.applyButton.addEventListener("click", async () => {
  if (characterSwitching) {
    setError("角色切换完成前不能应用设置。");
    return;
  }
  setError("");
  setSubmissionBusy(true);
  try {
    await saveRuntimeSettings();
    notify("已应用。", "success");
  } catch (error) {
    setError(String(error));
  } finally {
    setSubmissionBusy(false);
  }
});

fields.cancelButton.addEventListener("click", async () => {
  await requestCancelClose();
});

// 数字输入失焦时越界标红，改回合法即清除。
const detailCard = document.querySelector(".detail-card");
function numberOutOfBounds(el) {
  if (el.value === "") {
    return false;
  }
  const value = Number.parseFloat(el.value);
  const min = el.min !== "" ? Number.parseFloat(el.min) : -Infinity;
  const max = el.max !== "" ? Number.parseFloat(el.max) : Infinity;
  return Number.isNaN(value) || value < min || value > max;
}
detailCard?.addEventListener("focusout", (event) => {
  const el = event.target;
  if (el instanceof HTMLInputElement && el.type === "number") {
    markInvalid(el, numberOutOfBounds(el));
  }
});
detailCard?.addEventListener("input", (event) => {
  const el = event.target;
  if (el instanceof HTMLInputElement && el.type === "number" && el.classList.contains("is-invalid")) {
    markInvalid(el, numberOutOfBounds(el));
  }
});

// 关窗（X / OS）拦截：统一走「取消」路径；有未保存改动时二次确认。
(function guardWindowClose() {
  try {
    window.__TAURI__?.event?.listen?.("sakura://settings-close-requested", requestCancelClose);
    window.__TAURI__?.event?.listen?.("sakura://settings-exit-requested", requestAppExitClose);
    window.__TAURI__?.event?.listen?.("sakura://settings-exit-timeout", () => {
      notify("退出请求已取消：设置窗口未在 5 秒内响应。", "info");
    });
    const current = window.__TAURI__?.window?.getCurrentWindow?.();
    if (!current?.onCloseRequested) {
      return;
    }
    current.onCloseRequested(async (event) => {
      if (bypassCloseGuard) {
        return;
      }
      event.preventDefault();
      await requestCancelClose();
    });
  } catch {
    // 监听不可用时不阻断窗口正常关闭。
  }
})();

window.addEventListener("beforeunload", () => {
  beginSettingsWindowClose();
  runtimeAppearanceController?.dispose();
  runtimeProviderModelController?.dispose();
  runtimeChatTimingController?.dispose();
  runtimeBubbleAutoHideController?.dispose();
  runtimeToolsController?.dispose();
  runtimePluginController?.dispose();
  runtimeVoiceController?.dispose();
  runtimeScreenAwarenessController?.dispose();
  runtimeAutostartController?.dispose();
  firstRunGuideController?.dispose();
  runtimeDiagnostics?.dispose({ settings: true });
}, { once: true });

async function initializeRuntimeSettingsSection(initialize) {
  try {
    await initialize();
  } catch (error) {
    if (!settingsWindowClosing) setError(String(error));
  }
}

async function startSettingsFrontend() {
  await runtimeDiagnosticsReady;
  let manifest = await invoke("settings_capability_manifest");
  window.__TAURI__?.event?.listen?.("sakura://character-catalog-changed", ({ payload } = {}) => {
    if (settingsWindowClosing) return;
    void refreshRuntimeCharacterCatalog(payload);
  });
  const {
    applyCapabilityManifest,
    featureStatus,
    inputVisualEffectModes,
  } = await import("./capability-shell.js");
  manifest = applyCapabilityManifest(document, manifest);
  runtimeCapabilityManifest = manifest;
  runtimeVisualEffectModes = inputVisualEffectModes(manifest);
  if (featureStatus(manifest, "character.manage") === "available") {
    try {
      applyRuntimeCharacterSnapshot(await rootSettingsClient.charactersGet());
    } catch (error) {
      applyRuntimeCharacterSnapshot({
        schemaVersion: 1,
        revision: 0,
        currentCharacterId: null,
        characters: [],
      });
      setError(String(error));
    }
  }
  if (manifest.availableSections.includes("character") || manifest.availableSections.includes("appearance")) {
    const [{ createRuntimeAppearanceController }, { createInteractionLatencyTracer }] = await Promise.all([
      import("./appearance-runtime.js"),
      import("../core/interaction-latency.js"),
    ]);
    const interactionLatencyEnabled = await invoke("interaction_latency_diagnostics_enabled")
      .catch(() => false);
    const interactionLatencyTrace = createInteractionLatencyTracer({
      source: "settings",
      invoke,
      enabled: interactionLatencyEnabled,
    });
    runtimeAppearanceController = createRuntimeAppearanceController({
      document,
      invoke,
      onDirty: refreshDirty,
      onError: setError,
      prepare: prepareRuntimeAppearance,
      fillTheme: (theme) => setThemeValues(theme, { updateVisualEffect: false }),
      trace: interactionLatencyTrace,
    });
    if (runtimeCharacterSnapshot?.currentCharacterId) {
      try {
        const snapshot = await invoke("settings_character_appearance_get");
        await runtimeAppearanceController.initialize(snapshot);
        runtimeAppearanceInitialized = true;
      } catch {
        prepareRuntimeCharacterOnly();
      }
    } else {
      prepareRuntimeCharacterOnly();
    }
    await runtimeFontsReadyPromise;
    // 无角色时页面使用主程序默认浅蓝主题；有角色时由外观快照覆盖。
    await invoke("reveal_settings_window");
    if (!runtimeCharacterSnapshot?.currentCharacterId) showPage("character");
  }
  if (
    featureStatus(manifest, "providers.manage") === "available"
    || featureStatus(manifest, "model.chat_slot") === "available"
  ) {
    await initializeRuntimeSettingsSection(async () => {
      const { createProviderModelController } = await import("./provider-model-runtime.js");
      runtimeProviderModelController = createProviderModelController({
        invoke,
        readDraft: collectRuntimeProviderModelDraft,
        applySnapshot: applyRuntimeProviderModelSnapshot,
        onDirty: refreshDirty,
        onError: setError,
      });
      const snapshot = await invoke("settings_provider_model_get");
      await runtimeProviderModelController.initialize(snapshot);
    });
  }
  if (featureStatus(manifest, "chat.presentation_timing") === "available") {
    await initializeRuntimeSettingsSection(async () => {
      const { createChatTimingController } = await import("./chat-timing-runtime.js");
      runtimeChatTimingController = createChatTimingController({
        document,
        invoke,
        onDirty: refreshDirty,
      });
      const snapshot = await invoke("settings_chat_presentation_timing_get");
      runtimeChatTimingController.initialize(snapshot);
    });
  }
  if (featureStatus(manifest, "chat.bubble_auto_hide") === "available") {
    await initializeRuntimeSettingsSection(async () => {
      const { createBubbleAutoHideSettingsController } = await import("./bubble-auto-hide-runtime.js");
      runtimeBubbleAutoHideController = createBubbleAutoHideSettingsController({
        document,
        invoke,
        onDirty: refreshDirty,
      });
      runtimeBubbleAutoHideController.initialize(await invoke("settings_bubble_auto_hide_get"));
    });
  }
  if (featureStatus(manifest, "privacy.screen_awareness") === "available") {
    await initializeRuntimeSettingsSection(async () => {
      const { createScreenAwarenessSettingsController } = await import("./screen-awareness-runtime.js");
      runtimeScreenAwarenessController = createScreenAwarenessSettingsController({
        document,
        invoke,
        enhanceSelect,
        refreshSelect,
        onDirty: refreshDirty,
      });
      runtimeScreenAwarenessController.initialize(await invoke("settings_screen_awareness_get"));
    });
  }
  if (featureStatus(manifest, "plugins.manage") === "available") {
    await initializeRuntimeSettingsSection(async () => {
      const { createPluginSettingsFeature } = await import("./plugin-settings.js");
      runtimePluginController = createPluginSettingsFeature({
        document,
        window,
        invoke,
        onDirty: refreshDirty,
        onError: setError,
        notify,
        confirmAction,
        enhanceSelect,
        removeOverlayAfterExit,
        showPage,
        isMemoryTransitioning: () => memoryState.rebinding || characterSwitching,
        hasPendingCharacterSelection: () => Boolean(pendingRuntimeCharacterId()),
        hasModelSettings: (pluginId) => (request?.api?.slot_fields || [])
          .some((slot) => slot.owner_id === pluginId),
      });
      runtimePluginController.initialize(await invoke("settings_plugins_get"));
    });
  }
  if (featureStatus(manifest, "voice.tts") === "available") {
    await initializeRuntimeSettingsSection(async () => {
      const { createVoiceController } = await import("./voice-runtime.js");
      runtimeVoiceController = createVoiceController({
        document,
        invoke,
        enhanceSelect,
        refreshSelect,
        refreshAvailability: async () => { await runtimePluginController?.refreshCurrent(); },
        openPlugins: () => showPage("plugins"),
        onDirty: refreshDirty,
        onStatus: notify,
      });
      await runtimeVoiceController.refreshCurrent();
    });
  }
  if (
    featureStatus(manifest, "tools.runtime_limits") === "available"
  ) {
    await initializeRuntimeSettingsSection(async () => {
      const { createToolsController } = await import("./tools-runtime.js");
      runtimeToolsController = createToolsController({
        document,
        invoke,
        onDirty: refreshDirty,
      });
      runtimeToolsController.initialize(await invoke("settings_tools_get"));
    });
  }
  if (featureStatus(manifest, "storage.tts_root") === "available") {
    await initializeRuntimeSettingsSection(refreshStorageSettings);
  }
  if (featureStatus(manifest, "system.launch_at_login") === "available") {
    await initializeRuntimeSettingsSection(async () => {
      const {
        autostartErrorMessage,
        createAutostartSettingsController,
      } = await import("./autostart-runtime.js");
      runtimeAutostartController = createAutostartSettingsController({
        document,
        invoke,
        onDirty: refreshDirty,
      });
      let snapshot;
      try {
        snapshot = await invoke("settings_autostart_get");
      } catch (error) {
        throw new Error(autostartErrorMessage(error));
      }
      runtimeAutostartController.initialize(snapshot);
    });
  }
  if (featureStatus(manifest, "telemetry.anonymous_statistics") === "available") {
    await initializeRuntimeSettingsSection(refreshTelemetrySettings);
  }
  if (featureStatus(manifest, "storage.legacy_role_data_import") !== "available") {
    fields.legacyRoleDataImportButton.disabled = true;
    fields.legacyRoleDataImportStatus.textContent = "当前运行环境不支持旧数据导入。";
  }
  if (manifest.availableSections.includes("about")) {
    await initializeRuntimeSettingsSection(refreshAboutSettings);
  }
  refreshDirty();
  runtimeDiagnostics?.markReady({ settings: true });
}

startSettingsFrontend()
  .then(async () => {
    const { createFirstRunGuide, firstRunGuideRequested } = await import("./first-run-guide.js");
    firstRunGuideController = createFirstRunGuide({
      document,
      window,
      showPage,
      invoke,
      notify,
    });
    if (firstRunGuideRequested()) firstRunGuideController.start({ persist: true });
  })
  .catch((error) => {
    if (!settingsWindowClosing && error?.code !== "MEMORY_INITIALIZATION_CANCELLED") {
      setError(String(error));
    }
  });
