import assert from "node:assert/strict";
import test from "node:test";
import { createAsrSettingsController } from "../settings/asr-runtime.js";

function element() {
  const events = new Map();
  return { value: "", children: [], hidden: false, textContent: "",
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, handler) { events.set(name, handler); },
    async fire(name) { await events.get(name)?.(); },
  };
}
function fixture(snapshot, { devices = [], defaultDeviceId = null } = {}) {
  const controls = Object.fromEntries(["asrProvider", "asrLanguage", "asrStatus", "asrLocation",
    "asrResources", "asrRefresh", "asrOpenPlugins", "asrInputDevice", "asrRefreshDevices",
    "asrInputControls", "asrInputControlsHome"].map((key) => [key, element()]));
  const calls = [];
  const controller = createAsrSettingsController({
    document: { getElementById: (key) => controls[key], createElement: element },
    invoke: async (name, args) => {
      calls.push([name, args]);
      if (name === "settings_asr_devices") return typeof devices === "function" ? devices() : { devices, defaultDeviceId };
      if (name === "settings_asr_save") Object.assign(snapshot, args.payload);
      return structuredClone(snapshot);
    },
  });
  return { controls, calls, controller };
}

test("ASR choices are Hub supplied, unavailable explicit choice survives refresh, selection does not auto-save", async () => {
  const f = fixture({ providers: [{ providerId: "example.local", label: "Local", processingLocation: "local", available: true },
    { providerId: "example.remote", label: "Remote", processingLocation: "remote", available: true }],
  selectedProviderId: "example.missing", language: "auto", sections: [] });
  await f.controller.refresh();
  assert.equal(f.controls.asrProvider.value, "example.missing");
  assert.equal(f.controller.isDirty(), false);
  f.controls.asrProvider.value = "example.remote";
  await f.controls.asrProvider.fire("change");
  assert.equal(f.controller.isDirty(), true);
  assert.match(f.controls.asrLocation.textContent, /远端/);
  await f.controller.refresh({ preserveDraft: true });
  assert.equal(f.controls.asrProvider.value, "example.remote");
  assert.equal(f.calls.every(([name]) => name === "settings_asr_get"), true);
  await f.controller.save();
  assert.deepEqual(f.calls.find(([name]) => name === "settings_asr_save")[1].payload,
    { selectedProviderId: "example.remote" });
  assert.equal(f.controller.isDirty(), false);
  f.controller.dispose();
});

test("microphone changes save independently while Hub is disabled and retain its saved choices", async () => {
  const controls = Object.fromEntries(["asrProvider", "asrLanguage", "asrStatus", "asrLocation",
    "asrResources", "asrRefresh", "asrOpenPlugins", "asrInputDevice"].map((key) => [key, element()]));
  const saved = { selectedProviderId: "engine.saved", language: "ja", inputDeviceId: "old-mic" };
  let enabled = false;
  const controller = createAsrSettingsController({
    document: { getElementById: (key) => controls[key], createElement: element },
    invoke: async (name, args) => {
      if (name === "settings_asr_save") {
        if (!enabled && Object.keys(args.payload).some((key) => key !== "inputDeviceId")) {
          throw new Error("SERVICE_MISSING");
        }
        Object.assign(saved, args.payload);
      }
      return { providers: [], sections: [], available: enabled, inputDeviceId: saved.inputDeviceId,
        ...(enabled ? saved : { selectedProviderId: null }) };
    },
  });
  try {
    await controller.refresh();
    controls.asrInputDevice.value = "new-mic";
    await controller.save();
    assert.equal(controller.isDirty(), false);
    enabled = true; // The settings save may now continue to the staged plugin enable.
    await controller.refresh();
    assert.deepEqual(saved, { selectedProviderId: "engine.saved", language: "ja", inputDeviceId: "new-mic" });
    assert.equal(controls.asrProvider.value, "engine.saved");
    assert.equal(controls.asrLanguage.value, "ja");
  } finally { controller.dispose(); }
});

test("model installation only invokes the selected provider's contributed resource action on click", async () => {
  const f = fixture({ providers: [{ providerId: "thirdparty.asr", label: "Third party", processingLocation: "local", available: false }],
    selectedProviderId: "thirdparty.asr", language: "auto", sections: [{
      pluginId: "thirdparty.asr", sectionId: "weights",
      fields: [{ type: "resource", label: "Weights", actionIds: ["installWeights"], value: {
        taskState: "idle", message: "Missing", availableActionIds: ["installWeights"],
      } }], actions: [{ actionId: "installWeights", label: "Install" }],
    }] });
  await f.controller.refresh();
  assert.equal(f.calls.length, 1);
  const card = f.controls.asrResources.children[0];
  const button = card.children.at(-1).children[0];
  await button.fire("click");
  assert.deepEqual(f.calls.find(([name]) => name === "settings_asr_action")[1].payload, {
    pluginId: "thirdparty.asr", sectionId: "weights", actionId: "installWeights", values: {},
  });
  f.controller.dispose();
});

test("provider readiness codes remain readiness, not a generic failure message", async () => {
  for (const [state, errorCode, expected] of [
    ["ready", "READY", /已就绪/], ["loading", "ASR_PREPARING", /正在准备/],
    ["unloaded", "ASR_PREPARING", /已安装/], ["missing_resources", "ASR_MODEL_MISSING", /尚未安装/],
  ]) {
    const f = fixture({ providers: [{ providerId: "test.asr", state, errorCode, ready: state === "ready" }],
      selectedProviderId: "test.asr", language: "auto", sections: [] });
    await f.controller.refresh();
    assert.match(f.controls.asrStatus.textContent, expected);
    f.controller.dispose();
  }
});

test("microphone enumeration preserves missing selection, plugin dialog draft rolls back without saving", async () => {
  const f = fixture({ providers: [{ providerId: "asr.engine", state: "ready", available: true }],
    selectedProviderId: "asr.engine", inputDeviceId: "disconnected", language: "auto", sections: [] }, {
    devices: [{ id: "mic-a", label: "USB microphone" }], defaultDeviceId: "mic-a",
  });
  await f.controller.refresh(); await f.controller.refreshDevices();
  assert.equal(f.controls.asrInputDevice.value, "disconnected");
  assert.equal(f.controller.isDirty(), false);
  const initial = f.controller.pluginDraft();
  const dialog = element();
  f.controller.mountPluginControls("asr.engine", dialog);
  assert.equal(dialog.children[0], f.controls.asrInputControls);
  f.controls.asrInputDevice.value = "mic-a";
  await f.controls.asrInputDevice.fire("change");
  assert.equal(f.controller.isDirty(), true);
  f.controller.restorePluginDraft(initial);
  assert.equal(f.controls.asrInputDevice.value, "disconnected");
  f.controller.unmountPluginControls();
  assert.equal(f.controls.asrInputControlsHome.children.at(-1), f.controls.asrInputControls);
  assert.equal(f.calls.some(([name]) => name === "settings_asr_save"), false);
  f.controls.asrInputDevice.value = "";
  await f.controller.save();
  assert.equal(f.calls.find(([name]) => name === "settings_asr_save")[1].payload.inputDeviceId, "");
  f.controller.dispose();
});

test("device enumeration preserves edits made while waiting and rejects out-of-order lists", async () => {
  const requests = [];
  const f = fixture({ providers: [], selectedProviderId: null, inputDeviceId: "original", language: "auto", sections: [] }, {
    devices: () => new Promise((resolve) => requests.push(resolve)),
  });
  await f.controller.refresh();
  const first = f.controller.refreshDevices();
  const second = f.controller.refreshDevices();
  f.controls.asrInputDevice.value = "chosen-while-waiting";
  requests[1]({ devices: [{ id: "new", label: "New" }], defaultDeviceId: "new" });
  await second;
  assert.equal(f.controls.asrInputDevice.value, "chosen-while-waiting");
  requests[0]({ devices: [{ id: "obsolete", label: "Old" }], defaultDeviceId: "obsolete" });
  await first;
  assert.equal(f.controls.asrInputDevice.children.some((item) => item.value === "obsolete"), false);
  assert.equal(f.controls.asrInputDevice.value, "chosen-while-waiting");
  f.controller.dispose();
});
