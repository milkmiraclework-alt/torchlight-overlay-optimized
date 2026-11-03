'use strict';
// Owned stand-ins only: no game window, capture, focus or input.
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {create}=require('../desktop/lib/arcana-marks');
const windows=[];
class FakeWindow{
 constructor(options){this.options=options;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.webContents=new EventEmitter();this.messages=[];this.webContents.send=(...a)=>this.messages.push(a);this.webContents.setWindowOpenHandler=fn=>this.openHandler=fn;this.destroyed=false;this.visible=false;windows.push(this);}
 setIgnoreMouseEvents(...v){this.ignore=v;}
 setContentProtection(v){this.protected=v;}
 setAlwaysOnTop(...v){this.onTop=v;}
 loadFile(v){this.file=v;}
 isDestroyed(){return this.destroyed;}
 destroy(){this.destroyed=true;this.visible=false;}
 hide(){this.visible=false;}
 isVisible(){return this.visible;}
 showInactive(){this.visible=true;}
 getBounds(){return this.bounds;}
 setBounds(v){this.bounds={...v};}
}
let active=false,visible=true,bounds={x:100,y:150,width:1280,height:720};
const overlay=create({BrowserWindow:FakeWindow,bounds:()=>bounds,active:()=>active,visible:()=>visible});
const state={phase:'advice',target:5,marks:[{index:4,x:.5,y:.5,label:'YOU',current:true},{index:5,x:.6,y:.4,label:'+1'},{index:6,x:NaN,y:.4,label:'bad'},{index:7,x:1.1,y:.4,label:'outside'}]};
overlay.update(state);assert.equal(windows.length,0,'Inactive mode opened a renderer');
active=true;overlay.update(state);const first=windows[0];assert(first);assert.equal(first.options.focusable,false);assert.equal(first.options.transparent,true);assert.equal(first.options.webPreferences.sandbox,true);assert.deepEqual(first.ignore,[true,{forward:true}]);assert.equal(first.protected,true);assert.deepEqual(first.openHandler(),{action:'deny'});
assert.equal(first.visible,false,'Renderer displayed before load');first.webContents.emit('did-finish-load');assert.equal(first.visible,true);assert.equal(first.messages.length,1);assert.equal(first.messages[0][0],'arcana:state');assert.equal(first.messages[0][1].marks.length,2);assert.equal(first.messages[0][1].target,5);
overlay.sync();overlay.update(state);assert.equal(first.messages.length,1,'Unchanged status repainted the labels');
bounds={x:230,y:270,width:1920,height:1080};overlay.sync();assert.deepEqual(first.getBounds(),bounds);
visible=false;overlay.sync();assert.equal(first.visible,false,'Labels stayed visible over another app');visible=true;overlay.sync();assert(first.visible);
overlay.update({phase:'reading',marks:[]});assert.equal(first.visible,false,'Stale labels stayed visible while reading');
overlay.update(state);assert.equal(first.visible,true);active=false;overlay.sync();assert.equal(first.destroyed,true,'Inactive mode kept its renderer');assert.deepEqual(overlay.info(),{window:false,marks:0});
active=true;overlay.sync();assert.equal(windows.length,1,'Mode restart showed stale labels before a reading');overlay.update(state);const second=windows[1];assert(second);second.webContents.emit('did-finish-load');overlay.close();overlay.close();overlay.sync();overlay.update(state);assert.equal(second.destroyed,true);assert.equal(windows.length,2,'Closed application recreated its annotation window');
console.log('PASS: Arcana marks are click-through, protected, sandboxed and unfocused; follow client bounds, hide on capture/foreground changes, deduplicate updates and destroy on stop/exit.');
