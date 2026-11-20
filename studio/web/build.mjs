import {build} from 'esbuild';
import {mkdir,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const out='../src/main/assets/studio';
await mkdir(out,{recursive:true});
/* 单文件 IIFE 打包：原生壳把 app.js 内联成普通 <script>，不能用 ESM/动态 import。
   three 静态包含；初始化不依赖 WebGL，仅 enter() 建渲染器，WebGL 不可用降级。 */
await build({entryPoints:['src/app.js'],bundle:true,outfile:out+'/app.js',format:'iife',target:['chrome64'],minify:true,legalComments:'eof'});
for(const file of ['index.html','meteor-sky.webp','boot.js','theme-boot.js','style.css','lecture.css','tts.css','ai.css','model.css','shell.css','theme.css','fx.css','cockpit.css','workspace.css','workspace-wheel.css','python-lab-panel.css','tabs.css','python-worker.js','cpp-worker.js','javascript-worker.js','worker-output.js'])await copyFile('src/'+file,out+'/'+file);
/* editor.page 是 index.html 的壳降级副本（PackedAssets 回退用），必须随构建同步，
   否则壳副本会停在旧版本，缺新增的面板元素。两处副本保持一致。 */
await copyFile(out+'/index.html',out+'/editor.page');
await copyFile(out+'/index.html','../src/main/assets/editor.page');

/* 内联安全转义（关键）：原生壳把 app.js/boot.js 直接塞进 <script>…</script>。
   HTML 分词器在脚本里遇到 "<!--" 会进入 escaped 态，再遇到 "<script" 进入
   double-escaped 态，此后真正的 </script> 不再结束脚本 —— 整页结构被吞掉，
   表现为「脚本未加载」。CodeMirror 的 HTML 语法包里就有 "<!--" 字面量与
   /^\s*<!--/ 正则，所以必须转义。
   注意：不能用 "\-" —— 它在字符串里合法，但在 u 标志正则里是非法恒等转义，
   会让整包 SyntaxError。这里统一用十六进制转义：
     "-" → \x2D   "<" → \x3C   "/" → \x2F
   它们在字符串字面量与正则字面量中都合法且等价，语义完全不变。 */
function inlineSafe(js){
  return js
    .replace(/<!--/g,'<\\x2D-')
    .replace(/<script/gi,m=>'\\x3C'+m.slice(1))
    .replace(/<\/script/gi,m=>'\\x3C\\x2F'+m.slice(2));
}
for(const file of ['app.js','boot.js','theme-boot.js']){
  const raw=await readFile(out+'/'+file,'utf8');
  const safe=inlineSafe(raw);
  if(safe!==raw)await writeFile(out+'/'+file,safe);
}
/* 内联进 <style> 的表同样不能出现 "</style"。 */
for(const file of ['style.css','lecture.css','tts.css','ai.css','model.css','shell.css','theme.css','fx.css','python-lab-panel.css','tabs.css']){
  const raw=await readFile(out+'/'+file,'utf8');
  const safe=raw.replace(/<\/style/gi,m=>'<\\/'+m.slice(2));
  if(safe!==raw)await writeFile(out+'/'+file,safe);
}
/* C/C++ 离线编译工具链（Clang 22 WASM）：IIFE 入口 + 运行时资源。
   资源发布为 .bin：一是躲开 AGP 对 .gz 的自动解压，二是躲开 noCompress 'wasm'
   规则让 88 MB 工具链参与 APK deflate 压缩。加载器按清单取 URL、按字节读取，
   扩展名不影响功能；SHA-256 校验仍对内容生效。objective-c/ 不需要，不复制。 */
await mkdir(out+'/clang/bin',{recursive:true});
await copyFile('node_modules/@live-codes/clang-wasm/dist/clang-wasm-toolchain.global.js',out+'/clang/clang-wasm-toolchain.global.js');
const manifest=JSON.parse(await readFile('node_modules/@live-codes/clang-wasm/assets/runtime-manifest.v1.json','utf8'));
for(const key of ['memfs','clang','lld','sysroot'])manifest.compiler[key].asset='bin/'+key+'.bin';
await writeFile(out+'/clang/runtime-manifest.v1.json',JSON.stringify(manifest,null,2));
for(const [src,name] of [['memfs.wasm','memfs.bin'],['clang.wasm','clang.bin'],['lld.wasm','lld.bin'],['sysroot.tar','sysroot.bin']]){
  const bytes=gunzipSync(await readFile('node_modules/@live-codes/clang-wasm/assets/bin/'+src+'.gz'));
  await writeFile(out+'/clang/bin/'+name,bytes);
}
await copyFile('node_modules/@live-codes/clang-wasm/THIRD-PARTY-NOTICES.md',out+'/clang/THIRD-PARTY-NOTICES.md');
await mkdir(out+'/licenses',{recursive:true});
const packages=[];
for(const name of await readdir('node_modules')){if(name.startsWith('@'))for(const child of await readdir('node_modules/'+name))packages.push(name+'/'+child);else if(!name.startsWith('.'))packages.push(name);}
for(const name of packages){try{const base='node_modules/'+name,pkg=JSON.parse(await readFile(base+'/package.json','utf8'));const files=(await readdir(base)).filter(f=>/^licen[sc]e(?:[.-]|$)/i.test(f));for(const file of files){const text=await readFile(base+'/'+file,'utf8');await writeFile(out+'/licenses/'+name.replace(/[^a-z0-9-]/gi,'_')+'-LICENSE.txt',`${pkg.name} ${pkg.version}\n\n${text}`);}}catch(e){/* Platform-specific optional build helpers need not be present. */}}
console.log('Bundled offline editor to '+out);
