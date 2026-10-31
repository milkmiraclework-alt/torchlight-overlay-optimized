'use strict';
// Page and button names verified against the installed game's S9 UI module.
// Do not match generic S9 assets: those also load during unrelated mapping.
function parse(lines){
 const out=[];
 for(const line of lines){
  if(/LogDataTable|AssetLoad@|LoadObject|PageStack@|CardMotion|CardPose/.test(line))continue;
  const animation=/\bS9Taro HandleOrderAni Start Step=(\d+) Type=(\w+)/.exec(line);
  if(animation)out.push({kind:'animation',step:Number(animation[1]),type:animation[2]});
  else if(/\bS9Taro HandleOrderAni All done\b/.test(line))out.push({kind:'settled'});
  else if(/\bS9ChooseCard Run\b/.test(line))out.push({kind:'choice'});
  else if(/\bS9ChooseCard Hide\b/.test(line))out.push({kind:'choice-close'});
  else if(/\bS9CardPlayStart\b|ProtoId = 5551\b/.test(line))out.push({kind:'new'});
  else if(/\bS9Taro Run\b/.test(line))out.push({kind:'open'});
  else if(/\bS9Taro Hide\b|S9Taro_C_BtnClose\b|\bS9FinalPlayStart\b|\bS9AbandonPlay\b|ProtoId = 555[56]\b/.test(line))out.push({kind:'close'});
  else if(/S9Taro_C_BtnLocation\b|S9Taro_C_BtnLook\b/.test(line))out.push({kind:'open'});
  else if(/\bS9DrawCard\b|\bS9ThrowCard\b|\bS9Action\b|ProtoId = 555[234]\b/.test(line))out.push({kind:'move'});
 }
 return out;
}
module.exports={parse};
