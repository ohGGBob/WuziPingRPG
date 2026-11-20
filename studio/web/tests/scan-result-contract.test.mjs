import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read=path=>fs.readFile(new URL('../../../'+path,import.meta.url),'utf8');

test('scan result keys match the Studio native bridge contract',async()=>{
  const main=await read('scan/src/main/java/com/scan/camera/MainActivity.kt');
  const preview=await read('scan/src/main/java/com/scan/camera/PreviewActivity.kt');
  const editor=await read('studio/src/main/java/cn/wuziping/studio/EditorActivity.java');
  for(const key of ['modulePath','moduleTitle','moduleSize','modulePages']){
    assert.match(main,new RegExp(key));
    assert.match(preview,new RegExp(key));
    assert.match(editor,new RegExp(key));
  }
  assert.match(editor,/"path"/);
  assert.match(editor,/"crop_path"/);
});
