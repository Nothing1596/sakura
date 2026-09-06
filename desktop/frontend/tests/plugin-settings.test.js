import assert from "node:assert/strict";
import test from "node:test";

import { createPluginSettingsFeature } from "../settings/plugin-settings.js";
import { executeSettingsClose } from "../settings/close-flow.js";

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Only the browser boundary is replaced. The feature renders its real controls,
// handles their events, and calls the real plugin protocol controller.
function browserFixture() {
  const dataKey = (name) => name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.dataset = {};
      this.listeners = new Map();
      this.className = "";
      this.value = "";
      this.disabled = false;
      this.hidden = false;
      this.style = { setProperty() {}, removeProperty() {} };
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/), ...names])].filter(Boolean).join(" "); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
        toggle: (name, force = !this.classList.contains(name)) => {
          this.classList[force ? "add" : "remove"](name);
          return force;
        },
      };
    }
    get childNodes() { return this.children; }
    get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) { this.children.slice().forEach((child) => child.remove()); this.text = String(value); }
    append(...children) {
      for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); }
    }
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
    insertBefore(child, reference) {
      child.remove();
      child.parentElement = this;
      const index = this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
    }
    setAttribute(name, value) {
      if (name.startsWith("data-")) this.dataset[dataKey(name)] = String(value);
      else this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      return name.startsWith("data-") ? this.dataset[dataKey(name)] ?? null : this.attributes.get(name) ?? null;
    }
    hasAttribute(name) { return this.getAttribute(name) !== null; }
    removeAttribute(name) {
      if (name.startsWith("data-")) delete this.dataset[dataKey(name)];
      else this.attributes.delete(name);
    }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    async fire(type, detail = {}) {
      const event = { target: this, preventDefault() {}, stopPropagation() {}, ...detail };
      await Promise.all([...this.listeners.get(type) || []].map((listener) => listener(event)));
      await settle();
    }
    contains(element) { return element === this || this.children.some((child) => child.contains(element)); }
    focus() { document.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    matches(selector) {
      const tokens = selector.match(/\[[^\]]+\]|[.#]?[\w-]+/g) || [];
      return tokens.every((token) => {
        if (token[0] === ".") return this.classList.contains(token.slice(1));
        if (token[0] === "#") return this.id === token.slice(1);
        if (token[0] === "[") {
          const [, name, value] = token.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
          return value === undefined ? this.hasAttribute(name) : this.getAttribute(name) === value;
        }
        return this.tagName === token;
      });
    }
    querySelectorAll(selector) {
      const selectors = selector.split(",").map((part) => part.trim().split(/\s+/));
      const matches = (element, parts) => {
        if (!element.matches(parts.at(-1))) return false;
        let ancestor = element.parentElement;
        for (let index = parts.length - 2; index >= 0; index -= 1) {
          while (ancestor && !ancestor.matches(parts[index])) ancestor = ancestor.parentElement;
          if (!ancestor) return false;
          ancestor = ancestor.parentElement;
        }
        return true;
      };
      const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
      return selector === "*" ? descendants : descendants.filter((element) => selectors.some((parts) => matches(element, parts)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const document = new Element("document");
  document.createElement = (tagName) => new Element(tagName);
  document.getElementById = (id) => document.querySelector(`#${id}`);
  document.body = new Element("body");
  document.append(document.body);
  const shell = new Element("main");
  shell.className = "settings-shell";
  document.body.append(shell);
  for (const id of [
    "pluginSearch", "pluginInstallMenuRoot", "pluginInstallMenuButton", "pluginInstallMenu",
    "pluginInstallZipButton", "pluginInstallFolderButton", "pluginList", "pluginDetail",
    "aboutComponentsSummary", "aboutComponentsRefresh", "aboutComponentsState", "aboutComponentsList",
    "memorySurface", "page-memory", "page-plugins", "page-about",
  ]) {
    const element = new Element("div");
    element.id = id;
    shell.append(element);
  }
  document.getElementById("pluginInstallMenu").hidden = true;
  const timers = new Map();
  let nextTimer = 0;
  const window = {
    matchMedia: () => ({ matches: true }),
    setTimeout(callback, milliseconds) { const id = ++nextTimer; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return {
    document, window, timers,
    async runTimers(milliseconds) {
      for (const [id, timer] of [...timers]) {
        if (timer.milliseconds !== milliseconds || !timers.has(id)) continue;
        timers.delete(id);
        timer.callback();
        await settle();
      }
    },
  };
}

function field(key, overrides = {}) {
  return {
    key, label: key, type: "string", default: "", description: "", options: [],
    minimum: null, maximum: null, step: null, maxLength: 1000, placement: "row",
    actionIds: [], enabledWhen: null, required: false, readonly: false, copyable: false,
    restartRequired: false, ...overrides,
  };
}

function snapshot(coreGenerationId = "generation-a", label = "fixture") {
  return {
    schemaVersion: 1, revision: "0123456789abcdef", state: "ready", reasonCode: "READY",
    windowGeneration: 7, coreGenerationId,
    plugins: [{
      installId: "pi_0123456789abcdef01234567", pluginId: "fixture_plugin", name: "Fixture Plugin",
      version: "1.0.0", author: "Sakura Tests", description: "Fixture", enabled: true, required: false,
      supported: true, source: "bundled", canUninstall: false, provides: ["fixture.service"],
      requires: ["sakura.host.settings"], missingServices: [], state: "active", reasonCode: "ACTIVE",
      sections: [{
        sectionId: "general", title: "General", surface: null, reasonCode: "READY",
        fields: [field("label", { value: label })], values: { label }, actions: [], collections: [],
      }, {
        sectionId: "archive", title: "Memory", surface: "memory", reasonCode: "READY",
        fields: [], values: {}, actions: [], collections: [{
          collectionId: "entries", title: "Memory", description: "",
          columns: [{ key: "content", label: "内容", type: "string", maxLength: 1000 }],
          fields: [field("content", { required: true })], filters: [], searchable: true,
          pageSize: 20, canCreate: true, canUpdate: true, canDelete: true, deleteConfirmation: "删除？",
        }],
      }],
    }],
  };
}

function featureFixture(invoke, options = {}) {
  const browser = browserFixture();
  let dirtyNotifications = 0;
  const errors = [];
  const feature = createPluginSettingsFeature({
    ...browser, invoke,
    onDirty: () => { dirtyNotifications += 1; }, onError: (error) => { if (error) errors.push(error); },
    notify() {}, confirmAction: async () => true, enhanceSelect() {},
    removeOverlayAfterExit: async (overlay) => overlay.remove(), showPage() {},
    isMemoryTransitioning: () => false, hasPendingCharacterSelection: () => false,
    hasModelSettings: () => false,
    ...options,
  });
  return { ...browser, feature, errors, dirtyNotifications: () => dirtyNotifications };
}

function queryResult(itemId, content = itemId) {
  return { items: [{ itemId, values: { content } }], total: 1, nextCursor: null };
}

for (const surface of ["memory", null]) {
  test(`an open ${surface || "plugin"} collection draft prevents silent Settings close`, async () => {
    const data = snapshot();
    data.plugins[0].sections[1].surface = surface;
    const { feature, document, dirtyNotifications } = featureFixture(async () => {
      assert.fail("a Settings save must not submit or discard an open collection editor");
    });
    feature.initialize(data);
    const beforeEdit = dirtyNotifications();
    const add = document.querySelector(surface === "memory" ? ".memory-add-button" : ".plugin-collection-head button");
    await add.fire("click");
    let choices = 0;
    let closed = false;
    const decision = await executeSettingsClose({
      dirty: feature.isDirty(),
      choose: async () => { choices += 1; return "stay"; },
      save: feature.save,
      discard: feature.discard,
      close: async () => { closed = true; },
    });
    assert.equal(decision, "stay");
    assert.equal(choices, 1);
    assert.equal(closed, false);
    assert.ok(dirtyNotifications() > beforeEdit);
    await assert.rejects(() => feature.save(), /集合/);
    assert.equal(feature.isDirty(), true);
    feature.discard();
    assert.equal(feature.isDirty(), false);
    feature.dispose();
  });
}

test("plugin feature retains Memory editors and detaches old-generation queries and callbacks", async () => {
  let nextSnapshot = snapshot();
  let resolveOldQuery;
  const queries = [];
  const fixture = featureFixture(async (command, args) => {
    if (command === "settings_plugins_get") return nextSnapshot;
    assert.equal(command, "settings_plugins_collection");
    queries.push(args);
    if (queries.length === 2) return new Promise((resolve) => { resolveOldQuery = resolve; });
    return queryResult(queries.length === 1 ? "note" : "fresh");
  });
  const { feature, document, timers, runTimers } = fixture;
  feature.initialize(nextSnapshot);
  await runTimers(0);
  const search = document.querySelector(".memory-search-input");
  search.value = "旅行";
  await search.fire("input");
  const staleCallback = [...timers.values()].find((timer) => timer.milliseconds === 220).callback;
  await document.querySelector(".memory-record-card").fire("dblclick");
  const editor = document.querySelector(".memory-editor-overlay textarea");
  editor.value = "未保存的记忆";
  await editor.fire("input");
  await runTimers(220);
  assert.equal(queries.length, 2);

  nextSnapshot = snapshot("generation-b");
  await feature.refreshCurrent();
  assert.equal(feature.characterDraftCount(), 1);
  assert.equal(document.querySelector(".memory-search-input").value, "旅行");
  assert.equal(document.querySelector(".memory-editor-overlay textarea").value, "未保存的记忆");
  resolveOldQuery(queryResult("stale"));
  await settle();
  assert.equal(document.querySelectorAll(".memory-record-card").length, 0);
  staleCallback();
  await settle();
  assert.equal(queries.length, 2, "an old scheduled callback cannot query the new generation");

  await runTimers(0);
  assert.equal(queries.length, 3);
  assert.equal(queries.at(-1).coreGenerationId, "generation-b");
  assert.equal(queries.at(-1).payload.search, "旅行");
  assert.equal(document.querySelector(".memory-record-card").dataset.itemId, "fresh");
  assert.equal(document.querySelector(".memory-editor-overlay textarea").value, "未保存的记忆");

  await document.querySelector(".memory-dialog-close").fire("click");
  nextSnapshot = snapshot("generation-c");
  await feature.refreshCurrent();
  assert.equal(feature.characterDraftCount(), 0, "refreshing a closed editor must not create a phantom draft");
  assert.equal(document.querySelector(".memory-editor-overlay"), null);
  await document.querySelector(".memory-add-button").fire("click");
  assert.equal(feature.characterDraftCount(), 1);
  feature.discard();
  assert.equal(feature.characterDraftCount(), 0);
  assert.equal(document.querySelector(".memory-editor-overlay"), null);
  feature.dispose();
  assert.equal(timers.size, 0);
  assert.deepEqual(fixture.errors, []);
});

for (const outcome of ["success", "failure"]) {
  test(`a late collection ${outcome} cannot change a rebound Memory editor`, async () => {
    let nextSnapshot = snapshot();
    let completeMutation;
    const fixture = featureFixture(async (command, args) => {
      if (command === "settings_plugins_get") return nextSnapshot;
      if (args.operation === "query") return queryResult("note");
      return new Promise((resolve, reject) => {
        completeMutation = () => outcome === "success"
          ? resolve({ itemId: "note", values: args.payload.values })
          : reject(new Error("STALE_WRITE_FAILURE"));
      });
    });
    const { feature, document, runTimers } = fixture;
    feature.initialize(nextSnapshot);
    await runTimers(0);
    await document.querySelector(".memory-record-card").fire("dblclick");
    const input = document.querySelector(".memory-editor-overlay textarea");
    input.value = "draft during restart";
    await input.fire("input");
    const saving = document.querySelector('[data-memory-action="save"]').fire("click");
    await settle();
    assert.equal(typeof completeMutation, "function");

    nextSnapshot = snapshot("generation-b");
    await feature.refreshCurrent();
    completeMutation();
    await saving;

    assert.equal(document.querySelector(".memory-editor-overlay textarea")?.value, "draft during restart");
    assert.equal(document.querySelector(".memory-dialog-error"), null);
    assert.equal(feature.isDirty(), true);
    feature.dispose();
  });
}

test("a detached collection save callback cannot submit into the next generation", async () => {
  const writes = [];
  const fixture = featureFixture(async (command, args) => {
    if (command === "settings_plugins_get") return snapshot("generation-b");
    if (args.operation === "query") return queryResult("note");
    writes.push(args);
    return { itemId: "note", values: args.payload.values };
  });
  const { feature, document, runTimers } = fixture;
  feature.initialize(snapshot());
  await runTimers(0);
  await document.querySelector(".memory-record-card").fire("dblclick");
  const oldSave = document.querySelector('[data-memory-action="save"]');
  await feature.refreshCurrent();
  await oldSave.fire("click");
  assert.deepEqual(writes, []);
  assert.equal(feature.characterDraftCount(), 1);
  feature.dispose();
});

test("plugin feature owns ordinary field drafts, saves with the current generation, and discards locally", async () => {
  let nextSnapshot = snapshot();
  const saves = [];
  const pages = [];
  const fixture = featureFixture(async (command, args) => {
    if (command === "settings_plugins_get") return nextSnapshot;
    assert.equal(command, "settings_plugins_save");
    saves.push(args);
    nextSnapshot = snapshot("generation-b", args.values.label);
    return { saved: true, pluginId: "fixture_plugin", sectionId: "general", changePlan: "applied",
      applicationState: "applied", applicationReasonCode: "READY" };
  }, {
    hasModelSettings: (pluginId) => pluginId === "fixture_plugin",
    showPage: (page) => pages.push(page),
  });
  const { feature, document } = fixture;
  feature.initialize(nextSnapshot);
  await document.querySelectorAll(".plugin-surface-link").at(-1).fire("click");
  assert.deepEqual(pages, ["model"]);
  assert.equal(feature.isDirty(), false);
  const input = document.querySelector("#pluginDetail .form-row input");
  input.value = "draft";
  await input.fire("input");
  assert.equal(feature.isDirty(), true);
  nextSnapshot = snapshot("generation-b");
  await feature.refreshCurrent();
  assert.equal(document.querySelector("#pluginDetail .form-row input").value, "draft");
  await feature.save();
  assert.deepEqual(saves, [{
    windowGeneration: 7, coreGenerationId: "generation-b", pluginId: "fixture_plugin",
    sectionId: "general", values: { label: "draft" },
  }]);
  assert.equal(feature.isDirty(), false);
  const savedInput = document.querySelector("#pluginDetail .form-row input");
  savedInput.value = "discard me";
  await savedInput.fire("input");
  feature.discard();
  assert.equal(document.querySelector("#pluginDetail .form-row input").value, "draft");
  assert.equal(feature.isDirty(), false);
  assert.ok(fixture.dirtyNotifications() >= 3);
  feature.dispose();
});

test("plugin feature owns page polling and removes mounted listeners and pending work on disposal", async () => {
  const calls = [];
  const fixture = featureFixture(async (command) => { calls.push(command); return snapshot(); });
  const { feature, document, timers, runTimers } = fixture;
  const starting = snapshot();
  starting.state = "starting";
  document.getElementById("page-plugins").classList.add("is-active");
  feature.initialize(starting);
  assert.ok([...timers.values()].some((timer) => timer.milliseconds === 1200));
  document.getElementById("page-plugins").classList.remove("is-active");
  feature.onPageChanged("general");
  assert.equal([...timers.values()].some((timer) => timer.milliseconds === 1200), false);
  document.getElementById("page-about").classList.add("is-active");
  feature.onPageChanged("about");
  await runTimers(1200);
  assert.deepEqual(calls, ["settings_plugins_get"]);
  assert.equal([...timers.values()].some((timer) => timer.milliseconds === 1200), false);

  const menu = document.getElementById("pluginInstallMenu");
  const menuButton = document.getElementById("pluginInstallMenuButton");
  await menuButton.fire("click");
  assert.equal(menu.hidden, false);
  await document.fire("pointerdown", { target: document.body });
  assert.equal(menu.hidden, true);
  feature.dispose();
  await menuButton.fire("click");
  await runTimers(0);
  assert.equal(menu.hidden, true, "disposed mount listeners no longer handle input");
  assert.equal(timers.size, 0);
  assert.equal([...document.listeners.values()].flatMap((listeners) => [...listeners]).length, 0);
  assert.deepEqual(calls, ["settings_plugins_get"], "disposal cancels queued collection queries");
});

test("character transitions clear the Memory editor and invalidate outstanding collection reads", async () => {
  let transitioning = false;
  let pendingSelection = true;
  let resolveOldQuery;
  const queries = [];
  const fixture = featureFixture(async (command, args) => {
    if (command === "settings_plugins_get") return snapshot("generation-b");
    assert.equal(command, "settings_plugins_collection");
    queries.push(args);
    if (queries.length === 1) return new Promise((resolve) => { resolveOldQuery = resolve; });
    return queryResult("new-character");
  }, {
    isMemoryTransitioning: () => transitioning,
    hasPendingCharacterSelection: () => pendingSelection,
  });
  const { feature, document, runTimers } = fixture;
  feature.initialize(snapshot());
  await runTimers(0);
  assert.equal(queries.length, 0, "a pending character choice blocks reads for the old character");
  pendingSelection = false;
  feature.renderMemorySurface();
  await document.querySelector(".memory-add-button").fire("click");
  await runTimers(0);
  assert.equal(queries.length, 1);
  assert.equal(feature.characterDraftCount(), 1);
  transitioning = true;
  feature.clearCharacterState();
  assert.equal(feature.characterDraftCount(), 0);
  assert.equal(document.querySelector(".memory-editor-overlay"), null);
  assert.equal(document.querySelector(".settings-shell").hasAttribute("inert"), false);
  resolveOldQuery(queryResult("old-character"));
  await settle();
  await runTimers(0);
  assert.equal(queries.length, 1);
  assert.equal(document.querySelector(".memory-record-card"), null);
  transitioning = false;
  await feature.refreshCurrent();
  await runTimers(0);
  assert.equal(queries.at(-1).coreGenerationId, "generation-b");
  assert.equal(document.querySelector(".memory-record-card").dataset.itemId, "new-character");
  assert.equal(feature.characterDraftCount(), 0);
  feature.dispose();
});

test("About component actions use the owning plugin section and refresh its rendered resource", async () => {
  const resourceValue = (ready) => ({
    applicability: "required", subtitle: "Local model", ready, taskState: ready ? "succeeded" : "idle",
    message: "", detail: "", progress: null, availableActionIds: ready ? [] : ["download"],
  });
  const resourceSnapshot = (ready) => {
    const next = snapshot();
    const value = resourceValue(ready);
    next.plugins[0].sections.push({
      sectionId: "components", title: "Components", surface: "about", reasonCode: "READY",
      fields: [field("model", { type: "resource", readonly: true, maxLength: null,
        default: value, value, actionIds: ["download"] })],
      values: { model: value }, collections: [],
      actions: [{ actionId: "download", label: "下载", description: "", danger: false }],
    });
    return next;
  };
  const actions = [];
  const fixture = featureFixture(async (command, args) => {
    if (command === "settings_plugins_get") return resourceSnapshot(true);
    assert.equal(command, "settings_plugins_action");
    actions.push(args);
    return { message: "已完成" };
  });
  const { feature, document } = fixture;
  feature.initialize(resourceSnapshot(false));
  assert.equal(document.querySelectorAll("#aboutComponentsList .resource-card").length, 1);
  await document.querySelector("#aboutComponentsList button").fire("click");
  assert.deepEqual(actions, [{
    windowGeneration: 7, coreGenerationId: "generation-a", pluginId: "fixture_plugin",
    sectionId: "components", actionId: "download", values: {},
  }]);
  assert.equal(document.querySelector("#aboutComponentsList button"), null);
  assert.match(document.getElementById("aboutComponentsSummary").textContent, /^1\/1/);
  assert.deepEqual(fixture.errors, []);
  feature.dispose();
});
