'use strict';
const I=require('../desktop/lib/update-install');
process.on('message',async(value)=>{
  if(value==='quit')process.exit(0);
  try{await I.launch(value);process.send('ready');}catch(error){process.send({error:error.message});process.exitCode=1;process.disconnect();}
});
