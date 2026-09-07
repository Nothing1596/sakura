import assert from "node:assert/strict";
import test from "node:test";
import { snapshot, featureFixture } from "./fixtures/plugin-settings-fixture.js";

function catalog() {
  const data = snapshot();
  const template = data.plugins[0];
  data.plugins = ["provider", "infrastructure", "extension"].map((kind, index) => ({
    ...template, installId: `pi_${String(index + 1).repeat(24)}`, pluginId: kind,
    name: kind, presentation: { kind, category: "voice" }, sections: [],
  }));
  return data;
}

test("system components stay in the catalog and category navigation keeps selection in view", async () => {
  const ui = featureFixture(async () => assert.fail("catalog navigation must not write"));
  const { document } = ui;
  ui.feature.initialize(catalog());
  const list = document.getElementById("pluginList");
  const detail = document.getElementById("pluginDetail");
  const cards = () => list.querySelectorAll(".plugin-card");
  const tab = (kind) => document.querySelector(`[data-plugin-role="${kind}"]`);
  assert.deepEqual(cards().map((card) => card.dataset.pluginInstallId), [3, 1, 2].map((i) => `pi_${String(i).repeat(24)}`));
  for (const card of cards()) {
    for (let ancestor = card; ancestor; ancestor = ancestor.parentElement) assert.equal(ancestor.hidden, false);
  }
  list.scrollTop = 400;
  detail.scrollTop = 200;
  await tab("infrastructure").fire("click");
  assert.equal(cards().length, 1);
  assert.equal(detail.dataset.pluginId, `pi_${"2".repeat(24)}`);
  assert.equal(list.scrollTop, 0);
  assert.equal(detail.scrollTop, 0);
  await tab("all").fire("click");
  assert.equal(detail.dataset.pluginId, `pi_${"3".repeat(24)}`);
  const search = document.getElementById("pluginSearch");
  search.value = "no-such-plugin";
  await search.fire("input");
  assert.equal(cards().length, 0);
  assert.equal(detail.dataset.pluginId, "");
  ui.feature.dispose();
});

test("installation clears search and category and reveals the newly installed component", async () => {
  const data = catalog();
  const installed = {
    ...data.plugins[1], installId: `pi_${"4".repeat(24)}`, pluginId: "installed_hub", name: "Installed Hub",
    enabled: false, state: "disabled", reasonCode: "PLUGIN_DISABLED", source: "user", canUninstall: true,
  };
  const calls = [];
  const ui = featureFixture(async (command, args) => {
    calls.push([command, args]);
    assert.equal(command, "settings_plugins_install");
    return { ...data, plugins: [...data.plugins, installed], managementAction: "installed",
      installId: installed.installId, pluginId: installed.pluginId };
  });
  const { document } = ui;
  ui.feature.initialize(data);
  await document.querySelector('[data-plugin-role="extension"]').fire("click");
  const search = document.getElementById("pluginSearch");
  search.value = "extension";
  await search.fire("input");
  await document.getElementById("pluginInstallZipButton").fire("click");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].sourceKind, "zip");
  assert.equal(search.value, "");
  assert.equal(document.querySelector('[data-plugin-role="all"]').getAttribute("aria-selected"), "true");
  assert.equal(document.getElementById("pluginDetail").dataset.pluginId, installed.installId);
  const card = document.querySelector(`.plugin-card[data-plugin-install-id="${installed.installId}"]`);
  assert.equal(card.revealed, "nearest");
  assert.equal(document.activeElement, card);
  assert.deepEqual(ui.errors, []);
  ui.feature.dispose();
});
