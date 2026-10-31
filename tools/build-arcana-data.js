'use strict';
// Read only the game's extracted S9 configuration tables, never another
// helper's code/models. The extractor is a development tool, not a dependency
// of the overlay. Usage: node tools/build-arcana-data.js --input <DataCfg> --lang <S9.tsv>
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const at=n=>process.argv.indexOf(n),value=n=>at(n)<0?null:process.argv[at(n)+1];
const input=value('--input'),lang=value('--lang');
if(!input||!lang)throw Error('Supply --input <extracted DataCfg> --lang <S9 localization TSV>');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sources={};
function table(type){const name=`config_s9_gameplay_${type}.json`,bytes=fs.readFileSync(path.join(input,name));sources[name]=sha(bytes);return JSON.parse(bytes).rows;}
const cards=table('card'),events=table('event'),interactions=table('interaction'),tiles=table('tile');
const bytes=fs.readFileSync(lang);sources['S9-localization.tsv']=sha(bytes);
const strings=new Map(bytes.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/).map(l=>{const i=l.indexOf('\t');return [l.slice(0,i),l.slice(i+1)];}));
const arr=v=>Array.isArray(v)?v:[];
const text=v=>(strings.get(v)||'').replace(/<[^>]*>/g,'').replace(/\\n/g,' ').trim();
const eventDefs=Object.fromEntries(Object.values(events).map(e=>[e.Id,{fn:e.Function,p:[e.P1,e.P2,e.P3],a:arr(e.Sp1),b:arr(e.Sp2),c:arr(e.Sp3),text:text(e._Desc)}]));
const cardDefs=Object.values(cards).map(c=>({id:c.Id,icon:c.Icon,rarity:c.Rarity,tag:c.Tag,sort:c.Sort,weight:c.RandomWeight,selection:c.SelectionWeight,
 events:arr(c.EventDraw),choices:arr(c.InteractionDraw).flatMap(i=>arr(interactions[i]?.Sp3)),name:arr(c.EventDraw).map(i=>eventDefs[i]?.text).filter(Boolean).join('; ')||arr(c.InteractionDraw).map(i=>text(interactions[i]?._Desc)).filter(Boolean).join('; ')||`Note ${c.Id}`}));
const tileDefs=Object.fromEntries(Object.values(tiles).map(t=>[t.Id,{icon:t.Icon,type:t.Type,events:arr(t.EventSettle),interaction:arr(t.InteractionSettle),rarities:t.RarityWeight}]));
const data={revision:1,source:'Torchlight: Infinite local S9 game configuration; independently implemented adviser.',sources,cards:cardDefs,events:eventDefs,tiles:tileDefs};
const out=path.resolve(__dirname,'../desktop/lib/arcana/game-data.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(data)+'\n');
console.log(`Arcana: ${cardDefs.length} cards, ${Object.keys(eventDefs).length} effects and ${Object.keys(tileDefs).length} tile definitions from local game tables.`);
