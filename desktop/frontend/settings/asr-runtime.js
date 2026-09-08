import { asrErrorMessage } from "../audio/asr-controller.js";
import { createAsrInputTest } from "./asr-input-test.js";

export function createAsrSettingsController({ document, invoke, enhanceSelect = () => {},
  refreshSelect = () => {}, onDirty = () => {}, onStatus = () => {}, openPlugins = () => {},
  listen = null }) {
  const provider = document.getElementById("asrProvider");
  const language = document.getElementById("asrLanguage");
  const status = document.getElementById("asrStatus");
  const location = document.getElementById("asrLocation");
  const resourcesHost = document.getElementById("asrResources");
  const refreshButton = document.getElementById("asrRefresh");
  const device = document.getElementById("asrInputDevice");
  const inputControls = document.getElementById("asrInputControls");
  const inputControlsHome = document.getElementById("asrInputControlsHome");
  let pluginProvider = null;
  const inputTest = listen ? createAsrInputTest({
    document, invoke, listen, readProvider: () => pluginProvider || provider.value,
    readDevice: () => device?.value || "",
  }) : null;
  let snapshot = null;
  let baseline = "";
  let disposed = false;
  let poll = null;
  let revision = 0;
  let deviceRevision = 0;
  const draft = () => ({ selectedProviderId: provider.value || null, language: language.value || "auto",
    inputDeviceId: device?.value || "" });
  enhanceSelect(provider);
  enhanceSelect(language);
  if (device) enhanceSelect(device);

  function selectDevice(id) {
    if (!device) return;
    if (id && !Array.from(device.children).some((item) => item.value === id)) {
      const missing = document.createElement("option");
      missing.value = id; missing.textContent = `${id}（未连接）`; device.append(missing);
    }
    device.value = id || ""; refreshSelect(device);
  }
  async function refreshDevices() {
    if (!device) return;
    const request = ++deviceRevision;
    try {
      const value = await invoke("settings_asr_devices");
      if (disposed || request !== deviceRevision || !Array.isArray(value?.devices)) return;
      const selected = device.value;
      device.replaceChildren();
      const system = document.createElement("option");
      system.value = "";
      const defaultDevice = value.devices.find((item) => item.id === value.defaultDeviceId);
      system.textContent = defaultDevice ? `系统默认（${defaultDevice.label}）` : "系统默认";
      device.append(system);
      for (const item of value.devices) {
        const option = document.createElement("option");
        option.value = item.id; option.textContent = item.label; device.append(option);
      }
      selectDevice(selected);
    } catch {
      if (!disposed && request === deviceRevision) onStatus("无法读取麦克风列表，请检查设备后重新刷新。", "error");
    }
  }

  function renderStatus() {
    const selected = snapshot?.providers.find((item) => item.providerId === provider.value);
    const detail = selected || (provider.value === snapshot?.selectedProviderId ? snapshot : null);
    location.textContent = selected?.processingLocation === "remote"
      ? "录音将发送至该引擎配置的远端服务。" : selected ? "本地识别。" : "";
    const state = detail?.state;
    status.textContent = !snapshot?.available && !selected ? "语音输入不可用，请检查插件是否启用。"
      : state === "ready" || selected?.ready ? "已就绪。"
        : ["warming", "preparing", "loading"].includes(state) ? "正在准备。"
          : state === "unloaded" ? "模型已安装。"
            : detail?.errorCode && !["READY", "ASR_PREPARING"].includes(detail.errorCode)
              ? asrErrorMessage(detail.errorCode)
              : selected?.available ? "引擎可用。"
                : "引擎未就绪，请安装资源或检查插件配置。";
    resourcesHost.replaceChildren();
    let running = false;
    for (const section of snapshot?.sections || []) {
      if (section.pluginId !== provider.value) continue;
      for (const field of section.fields || []) {
        if (field.type !== "resource") continue;
        const resource = field.value || {};
        running ||= resource.taskState === "running";
        const card = document.createElement("div");
        card.className = "resource-card plugin-resource-card";
        const heading = document.createElement("strong");
        heading.textContent = field.label;
        const message = document.createElement("p");
        message.className = "resource-message";
        message.textContent = [resource.subtitle, resource.message].filter(Boolean).join(" · ");
        const detail = document.createElement("p");
        detail.className = "resource-detail";
        detail.textContent = resource.detail || "";
        card.append(heading);
        if (message.textContent) card.append(message);
        if (detail.textContent) card.append(detail);
        if (Number.isFinite(resource.progress)) {
          const progress = document.createElement("progress");
          progress.max = 100; progress.value = resource.progress;
          progress.setAttribute("aria-label", `${field.label}下载进度`);
          card.append(progress);
        }
        const actions = document.createElement("div");
        actions.className = "resource-actions";
        for (const action of section.actions || []) {
          if (!(field.actionIds || []).includes(action.actionId)
              || !(resource.availableActionIds || []).includes(action.actionId)) continue;
          const button = document.createElement("button");
          button.type = "button"; button.className = "secondary-button";
          button.textContent = action.label; button.title = action.description || "";
          button.addEventListener("click", async () => {
            button.disabled = true;
            try {
              await invoke("settings_asr_action", { payload: {
                pluginId: section.pluginId, sectionId: section.sectionId,
                actionId: action.actionId, values: {},
              } });
              await refresh({ preserveDraft: true });
            } catch (error) { onStatus(asrErrorMessage(String(error)), "error"); }
            finally { if (!disposed) button.disabled = false; }
          });
          actions.append(button);
        }
        card.append(actions); resourcesHost.append(card);
      }
    }
    if ((running || ["warming", "preparing", "loading"].includes(state)) && poll === null) poll = setTimeout(() => {
      poll = null; void refresh({ preserveDraft: true });
    }, 1000);
  }
  async function refresh({ preserveDraft = false } = {}) {
    const request = ++revision;
    try {
      const value = await invoke("settings_asr_get");
      if (disposed || request !== revision) return;
      if (!value || !Array.isArray(value.providers)) throw new Error("ASR_SETTINGS_INVALID");
      const savedDraft = preserveDraft && baseline && JSON.stringify(draft()) !== baseline ? draft() : null;
      snapshot = value;
      provider.replaceChildren();
      const none = document.createElement("option");
      none.value = ""; none.textContent = "请选择语音输入引擎"; provider.append(none);
      for (const item of value.providers) {
        const option = document.createElement("option");
        option.value = item.providerId;
        option.textContent = `${item.label}${item.available === false ? "（未就绪）" : ""}`;
        provider.append(option);
      }
      const selectedId = savedDraft?.selectedProviderId || value.selectedProviderId;
      if (selectedId && !value.providers.some((item) => item.providerId === selectedId)) {
        const missing = document.createElement("option");
        missing.value = selectedId; missing.textContent = `${selectedId}（未加载）`; provider.append(missing);
      }
      provider.value = value.selectedProviderId || "";
      for (const code of [value.language, savedDraft?.language]) {
        if (!code || Array.from(language.children).some((item) => item.value === code)) continue;
        const option = document.createElement("option");
        option.value = code; option.textContent = code; language.append(option);
      }
      language.value = value.language || "auto";
      selectDevice(value.inputDeviceId || "");
      baseline = JSON.stringify(draft());
      if (savedDraft) {
        provider.value = savedDraft.selectedProviderId || "";
        language.value = savedDraft.language;
        selectDevice(savedDraft.inputDeviceId);
      }
      refreshSelect(provider); refreshSelect(language);
      renderStatus(); onDirty();
    } catch (error) {
      if (!disposed && request === revision) {
        status.textContent = "语音输入设置暂不可用，请检查 ASR Hub 插件后重新检查。";
        if (!snapshot) resourcesHost.replaceChildren();
      }
    }
  }
  provider.addEventListener("change", () => { void inputTest?.cancel(); renderStatus(); onDirty(); });
  device?.addEventListener("change", () => { void inputTest?.cancel(); onDirty(); });
  document.getElementById("asrRefreshDevices")?.addEventListener("click", refreshDevices);
  language.addEventListener("change", onDirty);
  refreshButton.addEventListener("click", () => { void refresh({ preserveDraft: true }); });
  document.getElementById("asrOpenPlugins").addEventListener("click", openPlugins);
  return Object.freeze({
    refresh,
    refreshDevices,
    hasPluginControls: (pluginId) => Boolean(snapshot?.providers.some((item) => item.providerId === pluginId)),
    pluginDraft: () => ({ inputDeviceId: device?.value || "" }),
    restorePluginDraft(value) { selectDevice(value?.inputDeviceId || ""); onDirty(); },
    mountPluginControls(pluginId, container) {
      if (!inputControls || !snapshot?.providers.some((item) => item.providerId === pluginId)) return;
      if (pluginProvider !== pluginId) void inputTest?.cancel();
      pluginProvider = pluginId; container.append(inputControls); void refreshDevices();
    },
    unmountPluginControls() {
      if (!pluginProvider) return;
      void inputTest?.cancel(); pluginProvider = null; inputControlsHome?.append(inputControls);
    },
    cancelTest: () => inputTest?.cancel(),
    onPageChanged(page) { if (page !== "voice" && !pluginProvider) void inputTest?.cancel(); },
    isDirty: () => Boolean(snapshot) && JSON.stringify(draft()) !== baseline,
    async save() {
      const result = await invoke("settings_asr_save", { payload: draft() });
      await refresh();
      return result;
    },
    dispose() { disposed = true; revision += 1; clearTimeout(poll); inputTest?.dispose(); },
  });
}
