import {build} from 'esbuild';
import {mkdir,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
const out='../src/main/assets/studio';
await mkdir(out,{recursive:true});
await build({entryPoints:['src/app.js'],bundle:true,outfile:out+'/app.js',format:'iife',target:['chrome64'],minify:true,legalComments:'eof'});
for(const file of ['index.html','boot.js','style.css','lecture.css','tts.css','ai.css','shell.css','python-worker.js','javascript-worker.js','worker-output.js'])await copyFile('src/'+file,out+'/'+file);
await mkdir(out+'/licenses',{recursive:true});
const packages=[];
for(const name of await readdir('node_modules')){if(name.startsWith('@'))for(const child of await readdir('node_modules/'+name))packages.push(name+'/'+child);else if(!name.startsWith('.'))packages.push(name);}
for(const name of packages){try{const base='node_modules/'+name,pkg=JSON.parse(await readFile(base+'/package.json','utf8'));const files=(await readdir(base)).filter(f=>/^licen[sc]e(?:[.-]|$)/i.test(f));for(const file of files){const text=await readFile(base+'/'+file,'utf8');await writeFile(out+'/licenses/'+name.replace(/[^a-z0-9-]/gi,'_')+'-LICENSE.txt',`${pkg.name} ${pkg.version}\n\n${text}`);}}catch(e){/* Platform-specific optional build helpers need not be present. */}}
console.log('Bundled offline editor to '+out);
