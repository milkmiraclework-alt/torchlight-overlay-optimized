'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{create}=require('../desktop/lib/window-capture');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let child;
 const service=create('owned-test.exe',{timeout:25,spawnChild(_exe,args){assert.deepEqual(args,['--capture-window','123']);child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{setImmediate(()=>child.emit('close',1));};return child;}});
 const packet=Buffer.alloc(12+64*64*4);packet.write('TLRG');packet.writeUInt32LE(64,4);packet.writeUInt32LE(64,8);packet[12]=77;
 let result=service.grab(123);child.stdout.emit('data',packet.subarray(0,7));child.stdout.emit('data',packet.subarray(7));child.emit('close',0);const image=await result;assert.equal(image.data[0],77);assert.equal(image.captureSource,'windows-graphics-capture');assert.equal(service.info().children,0);
 result=service.grab(123);child.stdout.emit('data',Buffer.alloc(12));child.emit('close',0);await assert.rejects(result,/header/);
 result=service.grab(123);const wrong=Buffer.from(packet);wrong.writeUInt32LE(5000,4);child.stdout.emit('data',wrong);child.emit('close',0);await assert.rejects(result,/dimensions/);
 result=service.grab(123);service.cancel();await assert.rejects(result,/stopped/);await pause(1);assert.equal(service.info().children,0);
 result=service.grab(123);await assert.rejects(result,/timed out/);await pause(1);assert.equal(service.info().children,0);
 await assert.rejects(service.grab(0),/Invalid/);service.close();await assert.rejects(service.grab(123),/Invalid/);
 console.log('PASS: GPU capture framing across chunks, RGBA ownership, malformed/truncated dimensions, cancellation, timeout and zero retired children.');
})().catch(e=>{console.error(e);process.exitCode=1;});
