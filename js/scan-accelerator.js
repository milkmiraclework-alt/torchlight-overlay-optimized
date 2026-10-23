/* Exact Rust/WebAssembly pixel kernels. Optional: every reader operation
 * remains available in JavaScript when loading is blocked or fails. */
(function (root) {
  'use strict';
  function create(instance) {
    const E = instance.exports;
    if (E.revision() !== 1) throw new Error('Reader kernel revision mismatch');
    let cursor;
    function begin() { cursor = Number(E.__heap_base.value); }
    function reserve(bytes) {
      cursor = Math.ceil(cursor / 8) * 8;
      const at = cursor; cursor += bytes;
      if (cursor > E.memory.buffer.byteLength) E.memory.grow(Math.ceil((cursor - E.memory.buffer.byteLength) / 65536));
      return at;
    }
    function copy(array) {
      const at = reserve(array.byteLength);
      new Uint8Array(E.memory.buffer, at, array.byteLength).set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      return at;
    }
    return {
      blur(g, w, h, r) {
        begin();
        const input = copy(g), tmp = reserve(g.byteLength), out = reserve(g.byteLength), sums = reserve(w * 8);
        E.box_blur(input, tmp, out, sums, w, h, r);
        // Own the output: the next kernel reuses the same scratch memory.
        return new Float32Array(E.memory.buffer, out, w * h).slice();
      },
      search(pixels, xs, ys, offsets, interiorX, interiorY, weights, w, ox0, oy0) {
        begin();
        const args = [pixels, xs, ys, offsets, interiorX, interiorY, weights].map(copy);
        const out = reserve(24);
        E.search(...args, weights.length, w, interiorX.length, interiorY.length, ox0, oy0, out);
        const result = new Float64Array(E.memory.buffer, out, 3);
        return { ox: result[0], oy: result[1], score: result[2] };
      },
    };
  }
  let pending = null;
  function load(url) {
    if (!pending) pending = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return false;
        const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
        root.TartarusScan.setKernels(create(instance));
        return true;
      } catch { return false; }
      finally { clearTimeout(timer); }
    })();
    return pending;
  }
  const api = { create, load };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusScanAccelerator = api;
})(typeof self !== 'undefined' ? self : globalThis);
