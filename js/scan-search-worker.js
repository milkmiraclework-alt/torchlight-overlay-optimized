/* Screenshot helper: exact board-search shards and independent panels.
 * Search jobs receive small pyramid levels; panel jobs keep the original
 * RGBA pixels so their readings and confidence do not change. */
'use strict';
importScripts(`scan.js${self.location.search}`, `scan-data.js${self.location.search}`, `pick-data.js${self.location.search}`);
importScripts(`scan-accelerator.js${self.location.search}`);
const accelerationReady = self.TartarusScanAccelerator.load(`scan-kernels.wasm${self.location.search}`);
const panelReference = self.TartarusScan.withPanelIcons(self.TARTARUS_SCAN, self.TARTARUS_PICK);
self.onmessage = async ({ data }) => {
  const { id, prepared, part, parts } = data;
  try {
    await accelerationReady;
    if (data.panel !== undefined) {
      const S = self.TartarusScan, { img, sharp, loc, panel } = data;
      const result = panel === 0 ? { doors: S.readDoors(img, sharp, loc, panelReference, data.lang && data.lang !== 'en', data.cells), days: S.readDays(img, sharp, loc, panelReference) }
        : panel === 1 ? { tools: S.readTools(img, loc, panelReference) } : { chromatic: S.readChromatic(img, loc) };
      self.postMessage({ id, result });
      return;
    }
    self.postMessage({ id, top: self.TartarusScan.coarseBoardSearch(prepared, part, parts) });
  } catch (error) {
    self.postMessage({ id, error: String(error.message || error) });
  }
};
