'use strict';
// Captures only this test's own small window, without activating it.
const assert=require('node:assert/strict'),path=require('node:path');
const koffi=require('../desktop/node_modules/koffi');
const user=koffi.load('user32.dll'),gdi=koffi.load('gdi32.dll'),kernel=koffi.load('kernel32.dll');
const RECT=koffi.struct({left:'int32',top:'int32',right:'int32',bottom:'int32'});
const create=user.func('intptr __stdcall CreateWindowExW(uint32, str16, str16, uint32, int, int, int, int, intptr, intptr, intptr, void *)');
const destroy=user.func('bool __stdcall DestroyWindow(intptr)');
const getdc=user.func('intptr __stdcall GetDC(intptr)'),releasedc=user.func('int __stdcall ReleaseDC(intptr,intptr)');
const fill=user.func('int __stdcall FillRect(intptr, const void *, intptr)');
const brush=gdi.func('intptr __stdcall CreateSolidBrush(uint32)'),deleteObject=gdi.func('bool __stdcall DeleteObject(intptr)');
const flush=gdi.func('bool __stdcall GdiFlush()');
const processHandle=kernel.func('intptr __stdcall GetCurrentProcess()');
const resources=user.func('uint32 __stdcall GetGuiResources(intptr,uint32)');
const {capture}=require('../desktop/lib/native-reader-kernels').create(path.resolve(__dirname,'../desktop/native/tartarus-reader.dll'),koffi);
// USER/GDI lazily create shared stock fonts/brushes on first window use.
const warm=Number(create(0x08000088,'STATIC','Torchlight capture warmup',0x90000000,0,0,64,64,0,0,0,null));
assert(warm);
const warmDc=Number(getdc(warm)),warmBrush=Number(brush(0xdf953d)),warmRect=Buffer.alloc(16);
koffi.encode(warmRect,RECT,{left:0,top:0,right:64,bottom:64});
assert(fill(warmDc,warmRect,warmBrush));flush();assert(releasedc(warm,warmDc));assert(deleteObject(warmBrush));
const warmHandle=capture.create(warm);assert(warmHandle);
assert.equal(Number(capture.grab(warmHandle,new Uint8Array(64*64*4),64*64*4)),64*64*4);
capture.destroy(warmHandle);assert(destroy(warm));
const before=resources(processHandle(),0);
let hwnd=0,dc=0,color=0,handle=null;
let report;
try{
  hwnd=Number(create(0x08000088,'STATIC','Torchlight native capture check',0x90000000,0,0,128,96,0,0,0,null));
  assert(hwnd,'Could not create owned fake window');
  dc=Number(getdc(hwnd));assert(dc);
  color=Number(brush(0xdf953d));assert(color);
  const rect=Buffer.alloc(16);koffi.encode(rect,RECT,{left:0,top:0,right:128,bottom:96});
  assert(fill(dc,rect,color));flush();releasedc(hwnd,dc);dc=0;
  handle=capture.create(hwnd);assert(handle);
  const dims=new Int32Array(2);assert(capture.size(handle,dims));assert.deepEqual([...dims],[128,96]);
  const baseline=resources(processHandle(),0),times=[];
  for(let i=0;i<100;i++){
    const data=new Uint8Array(128*96*4),start=performance.now();
    assert.equal(Number(capture.grab(handle,data,data.length)),data.length);
    times.push(performance.now()-start);
    const p=(48*128+64)*4;
    assert.deepEqual([...data.subarray(p,p+4)],[61,149,223,255],'RGB order, top-down DIB or client capture changed');
    assert.equal(resources(processHandle(),0),baseline,'A grab leaked a GDI bitmap/DC');
  }
  assert.equal(Number(capture.grab(handle,new Uint8Array(4),4)),0,'An undersized output buffer was accepted');
  times.sort((a,b)=>a-b);
  report={medianMs:times[50],gameCapture:false,gameInput:false};
}finally{
  if(handle)capture.destroy(handle);if(dc)assert(releasedc(hwnd,dc));if(color)assert(deleteObject(color));if(hwnd)assert(destroy(hwnd));
}
assert.equal(resources(processHandle(),0),before,'Test retained GDI resources');
console.log('PASS: 100 direct Win32 captures of an owned fake window, exact RGBA/client geometry, bounded output and zero GDI handle growth. '+JSON.stringify(report));
