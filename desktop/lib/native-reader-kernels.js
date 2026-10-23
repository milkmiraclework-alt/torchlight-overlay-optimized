'use strict';
// Direct native pointers into Node-owned arrays: no WASM arena/copy in this path.
function create(file, koffi = require('koffi')) {
  const lib = koffi.load(file);
  const bind = (name, ret, args) => lib.func(name, ret, args);
  if (bind('revision', 'uint32', [])() !== 1) throw Error('Native reader revision mismatch');
  const gray = bind('rgba_gray', 'void', ['void *', 'void *', 'size_t']);
  const blur = bind('box_blur', 'void', ['void *','void *','void *','void *','size_t','size_t','size_t']);
  const mask = bind('text_mask', 'void', ['void *','void *','void *','void *','size_t','double']);
  const blobs = bind('mask_blobs', 'size_t', ['void *','void *','void *','size_t','size_t','size_t']);
  const unvisit = bind('unvisit_text_mask', 'void', ['void *','size_t']);
  const search = bind('search', 'void', ['void *','void *','void *','void *','void *','void *','void *','size_t','int32','size_t','size_t','int32','int32','void *']);
  function components(input,w,h,x0,y0) {
    const stack = new Uint32Array(w*h);
    let out = new Float64Array(Math.min(w*h,4096)*7);
    let count = Number(blobs(input,stack,out,out.length/7,w,h));
    if (count > out.length/7) { out = new Float64Array(count*7); unvisit(input,w*h); blobs(input,stack,out,count,w,h); }
    return Array.from({length:count},(_,i)=>{
      const p=i*7,n=out[p],a=out[p+3],b=out[p+4],c=out[p+5],d=out[p+6];
      return {n,cx:x0+out[p+1]/n,cy:y0+out[p+2]/n,x0:x0+a,y0:y0+b,x1:x0+c,y1:y0+d,w:c-a+1,h:d-b+1};
    });
  }
  const api = {
    preparePixels(img) { const n=img.width*img.height,g=new Float32Array(n);gray(img.data,g,n);return {gray:g,sharp:api.blur(g,img.width,img.height,1)}; },
    blur(g,w,h,r) { const tmp=new Float32Array(w*h),out=new Float32Array(w*h),sums=new Float64Array(w);blur(g,tmp,out,sums,w,h,r);return out; },
    maskBlobs(input,w,h,x0,y0) { const copy=input.slice(),result=components(copy,w,h,x0,y0);input.set(copy);return result; },
    textComponents({rgba,w,h,x0,y0},r,saturation) { const n=w*h,g=new Float32Array(n),m=new Uint8Array(n);gray(rgba,g,n);mask(rgba,g,api.blur(g,w,h,r),m,n,saturation);return components(m,w,h,x0,y0); },
    search(pixels,xs,ys,offsets,ix,iy,weights,w,ox,oy) { const out=new Float64Array(3);search(pixels,xs,ys,offsets,ix,iy,weights,weights.length,w,ix.length,iy.length,ox,oy,out);return {ox:out[0],oy:out[1],score:out[2]}; },
  };
  return {kernels:api, capture:{
    create:bind('capture_create','void *',['intptr']),
    size:bind('capture_size','int',['void *','void *']),
    grab:bind('capture_grab','size_t',['void *','void *','size_t']),
    destroy:bind('capture_destroy','void',['void *'])
  }};
}
module.exports={create};
