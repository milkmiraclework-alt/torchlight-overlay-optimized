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
    function components(out, count, x0, y0) {
      const values = new Float64Array(E.memory.buffer, out, count * 7), result = [];
      for (let i = 0; i < count; i++) {
        const p = i * 7, n = values[p], sx = values[p+1], sy = values[p+2];
        const bx0 = values[p+3], by0 = values[p+4], bx1 = values[p+5], by1 = values[p+6];
        result.push({ n, cx: x0 + sx/n, cy: y0 + sy/n, x0: x0+bx0, y0: y0+by0,
          x1: x0+bx1, y1: y0+by1, w: bx1-bx0+1, h: by1-by0+1 });
      }
      return result;
    }
    return {
      ...(typeof E.text_mask === 'function' && typeof E.mask_blobs === 'function' && typeof E.unvisit_text_mask === 'function' ? {
        textComponents(prepared, r, saturation) {
          const { rgba, w, h, x0, y0 } = prepared, n = w*h;
          const cap = Math.min(n, 4096);
          begin();
          const input = copy(rgba), lum = reserve(n*4), tmp = reserve(n*4), around = reserve(n*4), sums = reserve(w*8);
          let out = reserve(cap*56);
          E.rgba_gray(input, lum, n);
          E.box_blur(lum, tmp, around, sums, w, h, r);
          // The blur's temporary rows become the mask, and its output
          // becomes the flood-fill stack once thresholding has finished.
          E.text_mask(input, lum, around, tmp, n, saturation);
          const count = E.mask_blobs(tmp, around, out, cap, w, h);
          if (count > cap) {
            out = reserve(count*56);
            E.unvisit_text_mask(tmp, n);
            E.mask_blobs(tmp, around, out, count, w, h);
          }
          return components(out, count, x0, y0);
        },
      } : {}),
      ...(typeof E.mask_blobs === 'function' ? {
        maskBlobs(mask, w, h, x0, y0) {
          let cap = Math.min(mask.length, 4096);
          for (;;) {
            begin();
            const input = copy(mask), stack = reserve(mask.length * 4), out = reserve(cap * 56);
            const count = E.mask_blobs(input, stack, out, cap, w, h);
            if (count > cap) { cap = count; continue; }
            const result = components(out, count, x0, y0);
            // Preserve the reference function's mask mutation only after all
            // allocations succeed; a failed native pass can safely fall back.
            mask.set(new Uint8Array(E.memory.buffer, input, mask.length));
            return result;
          }
        },
      } : {}),
      ...(typeof E.rgba_gray === 'function' ? {
        preparePixels(img) {
          begin();
          const n = img.width * img.height, input = copy(img.data);
          const gray = reserve(n * 4), out = reserve(n * 4), sums = reserve(img.width * 8);
          E.rgba_gray(input, gray, n);
          // RGBA is no longer needed after conversion; reuse its buffer for
          // the blur's temporary rows, keeping the existing memory bound.
          E.box_blur(gray, input, out, sums, img.width, img.height, 1);
          return { gray: new Float32Array(E.memory.buffer, gray, n).slice(),
            sharp: new Float32Array(E.memory.buffer, out, n).slice() };
        },
      } : {}),
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
