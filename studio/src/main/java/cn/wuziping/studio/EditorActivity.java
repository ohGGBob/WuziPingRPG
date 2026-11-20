package cn.wuziping.studio;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.AtomicFile;
import android.webkit.*;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import cn.wuziping.ember.Game;

public final class EditorActivity extends Activity {
    private WebView web;private AssetServer assets;private PackedAssets packed;private AtomicFile workspace,gameSave;
    private TextToSpeech tts;private boolean ttsReady=false,ttsInitializing=false,ttsRangeSeen=false;private String ttsError="",ttsCurrentId="";private int ttsCharIndex=0,ttsCurrentLength=0;
    private final ExecutorService io=Executors.newSingleThreadExecutor();private JSONObject pendingExport;private boolean pickerOpen=false,workspaceReadOnly=false,keyboardVisible=false;private AlertDialog exitDialog;
    private static final int OPEN=30,FOLDER=31,EXPORT=32,GAME_OUT=33,GAME_IN=34,MIC=35,SLIDE=36,SLIDES=37,PPTX=38,TREE=39,MIC_WARM=40,MODULE=41;
    private static final String SLIDE_PREFIX="slide-cache/";
    /* 课堂模式的录音与 PPT 页面图存在这里，工作区 JSON 只留引用：
       否则 2 小时录音 + 几十页 PPT 会撞上快照上限，整份草稿被丢弃。 */
    private static final String MEDIA_PREFIX="lecture-media/";
    private static final long WORKSPACE_LIMIT=30L*1024*1024;
    /* 退出：最多等录音落盘 20 秒（2 小时录音关流+刷新草稿足够），超时才强退。 */
    private static final long EXIT_SAVE_TIMEOUT=20000L;
    private static final int EXIT_POLL_LIMIT=120;
    /* 录音分片流式落盘：页面每秒把 MediaRecorder 的分片追加进来，宿主边收边写。
       2 小时录音不再需要整段转 19 MB base64 过桥，也不会每 45 秒全量重写一次。 */
    private static final class AudioSink{FileOutputStream out;File file;long bytes;}
    private final java.util.Map<String,AudioSink> audioSinks=new java.util.concurrent.ConcurrentHashMap<>();
    private final ExecutorService audioIo=Executors.newSingleThreadExecutor();
    private File slideCache,mediaDir;
    private boolean exitRequested=false;
    private final Runnable exitWatchdog=new Runnable(){@Override public void run(){if(exitRequested){exitRequested=false;finish();}}};
    private android.webkit.PermissionRequest pendingMicRequest;
    private int pendingMicWarmId=-1;
    private android.webkit.ValueCallback<Uri[]> pendingSlideChooser;
    private static final int SOURCE_ASSETS=0,SOURCE_LOOPBACK=1,SOURCE_PACKAGED=2;
    private final android.os.Handler ui=new android.os.Handler(android.os.Looper.getMainLooper());
    private int source=SOURCE_ASSETS,probeCount=0,restoreResends=0;private boolean bootOk=false,bootFailureShown=false,rendererRecovery=false;
    private long bootStart=0,lastRestoreAt=0;private String lastPageError="",lastResourceError="",lastJsError="";private JSONObject openedModuleMeta;
    private static int rendererRecoveries=0;
    private final Runnable bootWatchdog=new Runnable(){@Override public void run(){if(!bootOk&&web!=null){lastPageError="启动超时（"+sourceName()+"）";escalateTransport();}}};
    private final Set<String> trustedUris=Collections.synchronizedSet(new HashSet<String>());
    private AssistantTools assistant;
    @Override public void onCreate(Bundle state){super.onCreate(state);try{getWindow().setStatusBarColor(0xffffffff);getWindow().setNavigationBarColor(android.os.Build.VERSION.SDK_INT>=26?0xffffffff:0xff1f2937);getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        int light=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;if(android.os.Build.VERSION.SDK_INT>=26)light|=View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;getWindow().getDecorView().setSystemUiVisibility(light);
        workspace=new AtomicFile(new File(getFilesDir(),"studio-workspace-v1.json"));gameSave=new AtomicFile(new File(getFilesDir(),"journey-v1.bin"));trustedUris.addAll(getPreferences(0).getStringSet("trustedUris",new HashSet<String>()));
        packed=new PackedAssets(this);slideCache=new File(getCacheDir(),"slide-cache");clearSlideCache();
        assistant=new AssistantTools(this,io,new AssistantTools.Emit(){@Override public void emit(JSONObject o){event(o);}});
        assistant.restoreAlarms();
        mediaDir=new File(getFilesDir(),"lecture-media");if(!mediaDir.isDirectory()&&!mediaDir.mkdirs())android.util.Log.w("EmberStudio","lecture-media dir unavailable, media will stay inline");
        try{assets=new AssetServer(this::openAsset,false);}catch(IOException e){fatal("离线资源未能启动："+e.getMessage());return;}
        try{web=new WebView(this);}catch(RuntimeException e){fatal("系统 WebView 不可用，编辑器无法打开。请在系统设置中启用或更新 Android System WebView 后重试。");return;}
        web.setBackgroundColor(0xffffffff);web.setFocusable(true);web.setFocusableInTouchMode(true);web.setOverScrollMode(View.OVER_SCROLL_NEVER);WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);settings.setUseWideViewPort(true);settings.setLoadWithOverviewMode(false);settings.setSupportZoom(false);settings.setTextZoom(100);settings.setDefaultTextEncodingName("UTF-8");settings.setMediaPlaybackRequiresUserGesture(true);settings.setSupportMultipleWindows(false);if(android.os.Build.VERSION.SDK_INT>=33)settings.setAlgorithmicDarkeningAllowed(false);else if(android.os.Build.VERSION.SDK_INT>=29)settings.setForceDark(WebSettings.FORCE_DARK_OFF);if(android.os.Build.VERSION.SDK_INT>=26)settings.setSafeBrowsingEnabled(false);
        web.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage message){
            if(message==null)return false;
            String line=message.messageLevel()+": "+message.message()+" @"+message.sourceId()+":"+message.lineNumber();
            if(message.messageLevel()==ConsoleMessage.MessageLevel.ERROR){lastJsError=line;android.util.Log.e("EmberStudio",line);}else android.util.Log.i("EmberStudio",line);
            return true;
        }
        /* 上课模式录音：WebView 的 getUserMedia 需要宿主授予音频采集资源，
           并在系统层持有 RECORD_AUDIO 运行时权限。 */
        @Override public void onPermissionRequest(final android.webkit.PermissionRequest request){
            if(web==null||isFinishing()||isDestroyed()){try{request.deny();}catch(Exception ignored){}return;}
            boolean wantsAudio=false;
            for(String resource:request.getResources()){
                if(android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)){wantsAudio=true;break;}
            }
            if(!wantsAudio){try{request.deny();}catch(Exception ignored){}return;}
            android.util.Log.i("EmberStudio","onPermissionRequest: audio capture, self="+checkSelfPermission(android.Manifest.permission.RECORD_AUDIO));
            if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED){
                try{grantAudio(request);android.util.Log.i("EmberStudio","granted audio immediately");}catch(Exception e){try{request.deny();}catch(Exception ignored){}}
            }else{
                pendingMicRequest=request;
                try{requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO},MIC);android.util.Log.i("EmberStudio","requesting RECORD_AUDIO runtime permission");}
                catch(Exception e){pendingMicRequest=null;try{request.deny();}catch(Exception ignored){}}
            }
        }
        /* 上课模式 PPT 照片：正常走 pickSlides 的原生相册选择；这里只作为兜底，
           任何情况下都必须回调 onReceiveValue，否则 <input type="file"> 会一直挂住。 */
        @Override public boolean onShowFileChooser(WebView webView,android.webkit.ValueCallback<Uri[]> callback,FileChooserParams params){
            if(pendingSlideChooser!=null||pickerOpen){try{callback.onReceiveValue(null);}catch(Exception ignored){}return true;}
            pendingSlideChooser=callback;
            Intent intent=params==null?null:params.createIntent();
            if(intent==null)intent=new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
            startPicker(SLIDE,intent);
            return true;
        }});
        web.setWebViewClient(StudioClient.create(assets,new StudioClient.Hooks(){
            public void pageFinished(){pageReady();}
            public void pageFailed(String url,String description){onPageFailed(url,description);}
            public void resourceFailed(String url,String description){onResourceFailed(url,description);}
            public void rendererGone(boolean crashed){onRendererGone();}
        }));
        web.addJavascriptInterface(new Bridge(),"StudioBridge");setContentView(web);watchKeyboard();web.requestFocus();startTransport();
    }catch(Throwable e){fatal("天工没能打开："+e.getClass().getSimpleName()+" "+e.getMessage());}}
    /* 上课模式的 PPT 照片：原生只把相册原图复制进缓存目录，页面用同源 URL 读取。
       这样既不依赖 WebView 的 content:// 访问，也不用把几 MB 的 base64 塞进
       evaluateJavascript（旧实现会直接超出 IPC 上限，导入静默失败）。 */
    private InputStream openAsset(String path)throws IOException{
        if(path.startsWith(SLIDE_PREFIX)){
            String name=path.substring(SLIDE_PREFIX.length());
            if(name.indexOf('/')>=0)throw new FileNotFoundException(path);
            File file=new File(slideCache,name);
            if(!file.isFile())throw new FileNotFoundException(path);
            return new FileInputStream(file);
        }
        /* 课堂模式的录音/PPT 页面图：页面用同源 URL fetch，音频因此可以拖动进度。 */
        if(path.startsWith(MEDIA_PREFIX)){
            String name=path.substring(MEDIA_PREFIX.length());
            if(name.indexOf('/')>=0||!safeMediaName(name))throw new FileNotFoundException(path);
            File file=new File(mediaDir,name);
            if(!file.isFile())throw new FileNotFoundException(path);
            return new FileInputStream(file);
        }
        return packed.open(path);
    }
    private static boolean safeMediaName(String name){
        if(name==null||name.isEmpty()||name.length()>80)return false;
        for(int i=0;i<name.length();i++){
            char c=name.charAt(i);
            boolean ok=(c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='.'||c=='-'||c=='_';
            if(!ok)return false;
        }
        return name.indexOf("..")<0&&!name.startsWith(".");
    }
    private void clearSlideCache(){
        try{
            if(slideCache==null)return;
            File[] files=slideCache.listFiles();
            if(files!=null)for(File file:files)if(!file.delete())file.deleteOnExit();
        }catch(Exception ignored){/* 缓存清理失败不影响导入 */}
    }
    private static String slideExtension(String mime,String name){
        String type=mime==null?"":mime.toLowerCase(Locale.ROOT);
        if(type.equals("image/jpeg")||type.equals("image/jpg"))return ".jpg";
        if(type.equals("image/png"))return ".png";
        if(type.equals("image/webp"))return ".webp";
        if(type.equals("image/gif"))return ".gif";
        if(type.length()==0){
            String lower=name==null?"":name.toLowerCase(Locale.ROOT);
            if(lower.endsWith(".jpg")||lower.endsWith(".jpeg"))return ".jpg";
            if(lower.endsWith(".png"))return ".png";
            if(lower.endsWith(".webp"))return ".webp";
            if(lower.endsWith(".gif"))return ".gif";
        }
        return null;   // HEIC 等 WebView 无法解码的格式直接跳过并提示
    }
    private String copySlide(Uri uri,int index)throws Exception{
        String extension=slideExtension(getContentResolver().getType(uri),fileName(uri));
        if(extension==null)return null;
        String name="slide-"+index+"-"+System.currentTimeMillis()+extension;
        File target=new File(slideCache,name);
        try(InputStream in=getContentResolver().openInputStream(uri)){
            if(in==null)return null;
            try(OutputStream out=new FileOutputStream(target)){
                byte[] buffer=new byte[65536];int read,total=0;
                while((read=in.read(buffer))!=-1){
                    total+=read;
                    if(total>12*1024*1024)throw new IOException("单张照片超过 12 MB");
                    out.write(buffer,0,read);
                }
            }
        }
        if(!target.isFile()||target.length()==0){target.delete();return null;}
        return name;
    }
    /** 把选中的照片复制进缓存，再把同源相对路径交给页面压缩并入库。 */
    private void stageSlideFiles(List<Uri> uris){
        clearSlideCache();
        if(!slideCache.isDirectory()&&!slideCache.mkdirs()){notice("无法创建照片缓存目录，导入未完成。");return;}
        JSONArray list=new JSONArray();
        int index=0,failed=0;
        for(Uri uri:uris){
            index++;
            try{
                String name=copySlide(uri,index);
                if(name==null){failed++;continue;}
                JSONObject item=new JSONObject();
                put(item,"url",SLIDE_PREFIX+name);
                put(item,"name","PPT 照片 "+index);
                list.put(item);
            }catch(Exception e){failed++;android.util.Log.w("EmberStudio","slide copy failed "+uri+" "+e.getMessage());}
        }
        if(list.length()==0){
            notice(failed>0?"PPT 照片导入失败：无法读取所选照片（可能是不支持的照片格式或文件过大）。":"没有选择可用的照片。");
            return;
        }
        if(failed>0)notice("有 "+failed+" 张照片无法读取，已跳过。");
        final String js="(function(){var list="+list.toString()+";if(window.Studio&&window.Studio.lecture&&window.Studio.lecture.importSlideUrls)window.Studio.lecture.importSlideUrls(list);})()";
        runOnUiThread(()->{if(web!=null)web.evaluateJavascript(js,null);});
    }
    /* 整个 PPT 文件（.pptx）：复制进缓存后回传同源相对路径，由页面 pptx.js 逐页渲染。 */
    private void stagePptxFile(Uri uri){
        String displayName=fileName(uri);
        try(InputStream in=getContentResolver().openInputStream(uri)){
            if(in==null)throw new IOException("无法打开所选文件");
            byte[] magic=new byte[4];
            int got=in.read(magic);
            if(got<4)throw new IOException("文件为空");
            if(magic[0]==(byte)0xD0&&magic[1]==(byte)0xCF&&magic[2]==(byte)0x11&&magic[3]==(byte)0xE0){
                notice("《"+displayName+"》是旧版 .ppt 格式，请先在 WPS/PowerPoint 里另存为 .pptx 再导入。");
                return;
            }
            if(!(magic[0]==(byte)0x50&&magic[1]==(byte)0x4B))throw new IOException("这不是 .pptx 文件");
            if(!slideCache.isDirectory()&&!slideCache.mkdirs())throw new IOException("无法创建缓存目录");
            String name="pptx-"+System.currentTimeMillis()+".pptx";
            File target=new File(slideCache,name);
            try(OutputStream out=new FileOutputStream(target)){
                out.write(magic);
                byte[] buffer=new byte[65536];int read;long total=0;
                while((read=in.read(buffer))!=-1){
                    total+=read;
                    if(total>120*1024*1024){out.close();target.delete();throw new IOException("PPT 超过 120 MB，请先压缩或分拆");}
                    out.write(buffer,0,read);
                }
            }
            if(!target.isFile()||target.length()==0){target.delete();throw new IOException("复制失败");}
            JSONArray list=new JSONArray();
            JSONObject item=new JSONObject();
            put(item,"url",SLIDE_PREFIX+name);
            put(item,"name",displayName);
            list.put(item);
            final String js="(function(){var list="+list.toString()+";if(window.Studio&&window.Studio.lecture&&window.Studio.lecture.importPptxUrls)window.Studio.lecture.importPptxUrls(list);})()";
            runOnUiThread(()->{if(web!=null)web.evaluateJavascript(js,null);});
        }catch(Exception e){
            notice("PPT 导入失败："+e.getMessage());
            android.util.Log.w("EmberStudio","pptx copy failed "+uri+" "+e.getMessage());
        }
    }
    /* ---- 录音流式落盘 ----
       页面在 MediaRecorder 每秒的 ondataavailable 里把这一片（约 2–6 KB）用 base64
       推过来，这里按序追加到同一个文件。分片按序拼接就是合法的 webm，跟以前把
       整个 Blob 一次转 base64 的结果完全一致，但省掉了「2 小时 → 19 MB 字符串 →
       JS JSON.stringify → Java new JSONObject」这一整条主线程上的大对象搬运。
       好处是顺带把检查点变成零成本：文件一直在写，页面只要记下时长与波形。 */
    private void audioBegin(JSONObject m){
        final String id=m.optString("id"),name=m.optString("name");
        audioIo.execute(()->{
            JSONObject o=message("audioStarted");put(o,"id",id);
            try{
                if(!safeMediaName(name))throw new IOException("录音文件名不合法");
                if(!mediaDir.isDirectory()&&!mediaDir.mkdirs())throw new IOException("无法创建媒体目录");
                closeAudioSink(id);
                AudioSink sink=new AudioSink();
                sink.file=new File(mediaDir,name);
                sink.out=new FileOutputStream(sink.file,false);
                audioSinks.put(id,sink);
                put(o,"ok",true);put(o,"ref",MEDIA_PREFIX+name);
            }catch(Exception e){put(o,"ok",false);put(o,"message",e.getMessage()==null?"录音文件创建失败":e.getMessage());}
            event(o);
        });
    }
    private void audioChunk(JSONObject m){
        final String id=m.optString("id"),data=m.optString("data");
        audioIo.execute(()->{
            AudioSink sink=audioSinks.get(id);
            if(sink==null||data.length()==0||data.length()>8*1024*1024)return;
            try{
                byte[] bytes=android.util.Base64.decode(data,android.util.Base64.DEFAULT);
                if(bytes.length==0)return;
                sink.out.write(bytes);
                /* 每片都 flush：进程被系统杀掉时，磁盘上已经是最新的一片，
                   而不是缓冲区里的几秒。 */
                sink.out.flush();
                sink.bytes+=bytes.length;
            }catch(Exception e){android.util.Log.w("EmberStudio","audio chunk failed: "+e.getMessage());}
        });
    }
    private void audioEnd(JSONObject m){
        final String id=m.optString("id"),sinkId=m.optString("sinkId");
        audioIo.execute(()->{
            JSONObject o=message("audioSaved");put(o,"id",id);
            /* 新页面用 endId 做回执、sinkId 关流；旧页面只发 id=...-end，
               去掉后缀回退到 audioBegin 存的 id。 */
            AudioSink sink=audioSinks.remove(sinkId.length()==0?id:sinkId);
            if(sink==null&&id.endsWith("-end"))sink=audioSinks.remove(id.substring(0,id.length()-4));
            try{
                if(sink==null)throw new IOException("录音文件已关闭");
                sink.out.flush();sink.out.close();
                if(sink.bytes<=0){
                    if(!sink.file.delete())android.util.Log.w("EmberStudio","empty audio delete failed");
                    throw new IOException("录音没有产生数据");
                }
                put(o,"ok",true);put(o,"ref",MEDIA_PREFIX+sink.file.getName());put(o,"bytes",sink.bytes);
            }catch(Exception e){put(o,"ok",false);put(o,"message",e.getMessage()==null?"录音写入失败":e.getMessage());}
            event(o);
        });
    }
    /* 录音没开始/被用户中途放弃：关流，空的就删掉，不留孤儿文件。 */
    private void audioAbort(JSONObject m){
        final String id=m.optString("id");
        audioIo.execute(()->{
            AudioSink sink=audioSinks.remove(id);
            if(sink==null)return;
            try{sink.out.close();}catch(Exception ignored){/* 已关闭 */}
            if(sink.bytes<=0&&sink.file!=null&&!sink.file.delete())android.util.Log.w("EmberStudio","empty audio delete failed");
        });
    }
    private void closeAudioSink(String id){
        AudioSink sink=audioSinks.remove(id);
        if(sink==null)return;
        try{sink.out.close();}catch(Exception ignored){/* 已关闭 */}
    }
    /* 课堂模式媒体：录音与 PPT 页面图写进应用私有目录 lecture-media/，
       页面用同源 URL 读回。base64 只是过桥手段，不再进工作区 JSON。 */
    private void mediaPut(final JSONObject m){
        final String id=m.optString("id"),name=m.optString("name"),data=m.optString("data");
        io.execute(()->{
            JSONObject o=message("mediaSaved");put(o,"id",id);
            try{
                if(!safeMediaName(name))throw new IOException("媒体文件名不合法");
                if(data.length()==0)throw new IOException("媒体数据为空");
                if(data.length()>64*1024*1024)throw new IOException("媒体数据超过 64 MB");
                byte[] bytes=android.util.Base64.decode(data,android.util.Base64.DEFAULT);
                if(bytes.length==0)throw new IOException("媒体数据为空");
                if(!mediaDir.isDirectory()&&!mediaDir.mkdirs())throw new IOException("无法创建媒体目录");
                atomic(new AtomicFile(new File(mediaDir,name)),bytes);
                put(o,"ok",true);put(o,"ref",MEDIA_PREFIX+name);put(o,"bytes",bytes.length);
            }catch(Exception e){put(o,"ok",false);put(o,"message",e.getMessage()==null?"媒体写入失败":e.getMessage());}
            event(o);
        });
    }
    private void mediaDelete(JSONObject m){
        final String ref=m.optString("ref");
        io.execute(()->{try{
            if(ref!=null&&ref.startsWith(MEDIA_PREFIX)){
                String name=ref.substring(MEDIA_PREFIX.length());
                if(safeMediaName(name)){File file=new File(mediaDir,name);if(file.isFile()&&!file.delete())android.util.Log.w("EmberStudio","media delete failed "+name);}
            }
        }catch(Exception ignored){/* 删不掉不影响主流程 */}});
    }
    /* 只保留页面还在引用的媒体文件：换课、重录、删页面留下的孤儿文件一并清掉。 */
    private void mediaGc(JSONObject m){
        JSONArray keep=m.optJSONArray("keep");
        final Set<String> names=Collections.synchronizedSet(new HashSet<String>());
        if(keep!=null)for(int i=0;i<keep.length();i++){String name=keep.optString(i);if(safeMediaName(name))names.add(name);}
        io.execute(()->{
            try{
                File[] files=mediaDir.listFiles();
                if(files==null)return;
                for(File file:files)if(!file.isDirectory()&&!names.contains(file.getName()))file.delete();
            }catch(Exception ignored){/* 清理失败不提示，不影响使用 */}
        });
    }
    /* 页面在真正调用 getUserMedia 之前先要这次授权。
       原因：如果等 WebView 的 onPermissionRequest 回调里才弹系统权限框，
       用户点完"允许"再回来 grant，音频源往往已经初始化失败，页面只会收到
       NotReadableError（看起来就像"麦克风被别的应用占用"）。提前把运行时权限
       拿到手，之后 getUserMedia 就只是一次 WebView 内部授权，稳定得多。 */
    private void micPermission(JSONObject m){
        final int id=m.optInt("id");
        if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED){replyMic(id,true);return;}
        if(pendingMicWarmId>=0){replyMic(id,false);return;}
        pendingMicWarmId=id;
        try{requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO},MIC_WARM);android.util.Log.i("EmberStudio","warming up RECORD_AUDIO before getUserMedia");}
        catch(Exception e){pendingMicWarmId=-1;replyMic(id,true);}
    }
    private void replyMic(int id,boolean granted){
        JSONObject o=message("micPermission");put(o,"id",id);put(o,"granted",granted);event(o);
    }
    private static String megabytes(long bytes){return String.valueOf(Math.round(bytes/1048576.0*10)/10.0);}
    private void resolveSlideChooser(Uri[] uris){
        android.webkit.ValueCallback<Uri[]> callback=pendingSlideChooser;
        pendingSlideChooser=null;
        if(callback!=null)try{callback.onReceiveValue(uris);}catch(Exception ignored){/* 页面已切换 */}
    }
    private void startPicker(int request,Intent intent){
        if(pickerOpen){notice("请先完成当前文件选择。");resolveSlideChooser(null);return;}
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try{pickerOpen=true;startActivityForResult(intent,request);}
        catch(Exception e){pickerOpen=false;resolveSlideChooser(null);notice("没有可用的相册或文件选择器："+e.getMessage());}
    }
    private ArrayList<Uri> pickedUris(Intent data){
        ArrayList<Uri> uris=new ArrayList<>();
        if(data==null)return uris;
        try{
            if(data.getClipData()!=null){
                ClipData clips=data.getClipData();
                for(int i=0;i<Math.min(50,clips.getItemCount());i++)uris.add(clips.getItemAt(i).getUri());
            }else if(data.getData()!=null)uris.add(data.getData());
        }catch(Exception ignored){/* 选择器返回异常数据 */}
        return uris;
    }
    private void startTransport(){
        if(web==null||isFinishing()||isDestroyed())return;
        bootOk=false;probeCount=0;restoreResends=0;bootStart=android.os.SystemClock.uptimeMillis();lastPageError="";lastResourceError="";lastJsError="";
        ui.removeCallbacks(bootWatchdog);ui.postDelayed(bootWatchdog,8000);
        if(source==SOURCE_PACKAGED)loadPackagedPage();else web.loadUrl(source==SOURCE_LOOPBACK?assets.base()+"studio/index.html":StudioClient.PAGE);
    }
    private void loadPackagedPage(){
        try{
            String html=packed.readText("studio/index.html"),css=packed.readText("studio/style.css"),boot=packed.readText("studio/boot.js");
            String lectureCss="";
            try{lectureCss=packed.readText("studio/lecture.css");}catch(Throwable ignored){/* 旧包允许缺失 */}
            String ttsCss="";
            try{ttsCss=packed.readText("studio/tts.css");}catch(Throwable ignored){android.util.Log.w("EmberStudio","Bundled studio/tts.css is missing; TTS controls will render without dedicated styles.");}
            String aiCss="";
            try{aiCss=packed.readText("studio/ai.css");}catch(Throwable ignored){android.util.Log.w("EmberStudio","Bundled studio/ai.css is missing; AI assistant will render without dedicated styles.");}
            String fxCss="";
            try{fxCss=packed.readText("studio/fx.css");}catch(Throwable ignored){/* 旧包允许缺失 */}
            String app=packed.readText("studio/app.js").replace("</script","<\\/script");
            String policy="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'";
            html=html.replaceAll("(?is)<meta[^>]*Content-Security-Policy[^>]*>","<meta http-equiv=\"Content-Security-Policy\" content=\""+policy+"\">");
            html=html.contains("<link rel=\"stylesheet\" href=\"style.css\">")?html.replace("<link rel=\"stylesheet\" href=\"style.css\">","<style>"+css+"</style>"):html.replace("</head>","<style>"+css+"</style></head>");
            if(lectureCss.length()>0)html=html.contains("<link rel=\"stylesheet\" href=\"lecture.css\">")?html.replace("<link rel=\"stylesheet\" href=\"lecture.css\">","<style>"+lectureCss+"</style>"):html.replace("</head>","<style>"+lectureCss+"</style></head>");
            if(ttsCss.length()>0)html=html.contains("<link rel=\"stylesheet\" href=\"tts.css\">")?html.replace("<link rel=\"stylesheet\" href=\"tts.css\">","<style>"+ttsCss+"</style>"):html.replace("</head>","<style>"+ttsCss+"</style></head>");
            if(aiCss.length()>0)html=html.contains("<link rel=\"stylesheet\" href=\"ai.css\">")?html.replace("<link rel=\"stylesheet\" href=\"ai.css\">","<style>"+aiCss+"</style>"):html.replace("</head>","<style>"+aiCss+"</style></head>");
            if(fxCss.length()>0)html=html.contains("<link rel=\"stylesheet\" href=\"fx.css\">")?html.replace("<link rel=\"stylesheet\" href=\"fx.css\">","<style>"+fxCss+"</style>"):html.replace("</head>","<style>"+fxCss+"</style></head>");
            html=html.contains("<script src=\"boot.js\"></script>")?html.replace("<script src=\"boot.js\"></script>","<script>"+boot+"</script>"):html.replace("</body>","<script>"+boot+"</script></body>");
            html=html.contains("<script src=\"app.js\"></script>")?html.replace("<script src=\"app.js\"></script>","<script>"+app+"</script>"):html.replace("</body>","<script>"+app+"</script></body>");
            web.loadDataWithBaseURL(assets.base()+"studio/index.html",html,"text/html","UTF-8",null);
        }catch(Throwable e){lastPageError="内置页面读取失败："+e.getMessage();ui.removeCallbacks(bootWatchdog);showBootFailure();}
    }
    private void escalateTransport(){
        if(bootOk||web==null||isFinishing()||isDestroyed())return;
        ui.removeCallbacks(bootWatchdog);
        if(source==SOURCE_ASSETS)source=SOURCE_LOOPBACK;else if(source==SOURCE_LOOPBACK)source=SOURCE_PACKAGED;else{showBootFailure();return;}
        startTransport();
    }
    private void pageReady(){if(bootOk)return;ui.removeCallbacks(bootWatchdog);ui.postDelayed(bootWatchdog,8000);ui.postDelayed(this::probeBoot,900);}
    private void onPageFailed(String url,String description){
        if(bootOk)return;
        if(!currentPage(url)){onResourceFailed(url,description);return;}
        lastPageError=description;
        escalateTransport();
    }
    private boolean currentPage(String url){
        if(url==null)return true;
        if(source==SOURCE_ASSETS)return url.startsWith(StudioClient.PAGE);
        if(source==SOURCE_LOOPBACK)return url.startsWith(assets.base()+"studio/index.html");
        return true;
    }
    private void onResourceFailed(String url,String description){
        String at=url==null?"":url;
        if(at.endsWith("studio-game.png")||at.endsWith("favicon.ico"))return;
        lastResourceError=description+" "+at;
        android.util.Log.w("EmberStudio","resource "+at+" "+description);
    }
    private void probeBoot(){
        if(bootOk||web==null||isFinishing()||isDestroyed())return;
        final int at=source;
        web.evaluateJavascript("(function(){var e=window.__studioErrors||[];return {boot:window.__studioBootOk===true,studio:!!window.Studio,view:!!(window.Studio&&window.Studio.view),landing:window.__studioLandingReady===true,err:e.join(' | ').slice(0,600)};})()",raw->{
            if(bootOk||web==null||at!=source)return;
            boolean studio=false,view=false,landing=false;String err="";
            try{if(raw!=null){JSONObject o=new JSONObject(raw);studio=o.optBoolean("studio");view=o.optBoolean("view");landing=o.optBoolean("landing");err=o.optString("err");}}catch(Exception ignored){}
            if(err.length()>0)lastJsError=err;
            if(view||(studio&&landing)){bootOk=true;ui.removeCallbacks(bootWatchdog);return;}
            if(studio&&restoreResends<2&&android.os.SystemClock.uptimeMillis()-bootStart>3000&&android.os.SystemClock.uptimeMillis()-lastRestoreAt>3000){restoreResends++;deliverRestore();}
            probeCount++;
            if(probeCount<7&&android.os.SystemClock.uptimeMillis()-bootStart<9000)ui.postDelayed(this::probeBoot,1400);
            else escalateTransport();
        });
    }
    /* 首页的功能卡片：网页模块在页面内切换，原生模块（扫描、修图）由这里拉起独立 Activity。
       用户在模块里按返回键或点「‹ 天工」结束该 Activity，onResume 再通知页面回到首页并刷新「继续」卡片。 */
    private String openedModule;
    private static final String SCAN_ACTIVITY="com.scan.camera.MainActivity";
    private boolean scanAvailable(){
        if(android.os.Build.VERSION.SDK_INT<29)return false;
        if(!getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY))return false;
        try{return new Intent().setClassName(this,SCAN_ACTIVITY).resolveActivity(getPackageManager())!=null;}catch(Exception e){return false;}
    }
    private void sendCapabilities(){
        JSONObject o=message("capabilities");
        put(o,"scan",scanAvailable());put(o,"photo",true);put(o,"game",true);put(o,"sdk",android.os.Build.VERSION.SDK_INT);
        event(o);
    }
    private void openModule(JSONObject message){
        String id=message.optString("id");
        Intent intent;
        if("photo".equals(id))intent=new Intent(this,PhotoActivity.class);
        else if("scan".equals(id)){
            if(android.os.Build.VERSION.SDK_INT<29){notice("扫描需要 Android 10 或更高版本。");return;}
            if(!scanAvailable()){notice("这台设备没有可用的相机，或安装包没有包含扫描模块。");return;}
            intent=new Intent().setClassName(this,SCAN_ACTIVITY);
        }else{notice("未知模块："+id);return;}
        JSONObject payload=message.optJSONObject("payload");
        if(payload!=null){String recentUri=payload.optString("uri","");if(!recentUri.isEmpty())intent.putExtra("recentUri",recentUri);String recentTitle=payload.optString("title","");if(!recentTitle.isEmpty())intent.putExtra("recentTitle",recentTitle);}
        if(web!=null)web.evaluateJavascript("window.Studio&&window.Studio.flush()",null);
        try{openedModuleMeta=null;startActivityForResult(intent,MODULE);openedModule=id;}catch(Exception e){openedModule=null;notice("模块没能打开："+e.getMessage());}
    }
    private void deliverRestore(){
        lastRestoreAt=android.os.SystemClock.uptimeMillis();
        io.execute(()->{JSONObject o=message("restore");try{if(workspace.getBaseFile().exists()||new File(workspace.getBaseFile().getPath()+".bak").exists()){try(InputStream in=workspace.openRead()){JSONObject data=new JSONObject(new String(TextFiles.read(in,32*1024*1024),"UTF-8"));if(data.optInt("version")!=1||data.optJSONArray("files")==null)throw new IOException("工作区格式错误");put(o,"data",data);}}else put(o,"data",JSONObject.NULL);}catch(Exception e){try{backup(workspace.getBaseFile(),"workspace-recovery-",".json");put(o,"error","旧工作区读取失败，已保留恢复副本。");}catch(IOException failed){workspaceReadOnly=true;put(o,"error","旧工作区读取失败，未覆盖原文件。请先另存重要内容。");}}event(o);});
    }
    private void onRendererGone(){
        bootOk=true;ui.removeCallbacks(bootWatchdog);
        if(rendererRecovery)return;rendererRecovery=true;
        if(web!=null){try{web.loadUrl("about:blank");}catch(Throwable ignored){}ViewParent parent=web.getParent();if(parent instanceof ViewGroup)((ViewGroup)parent).removeView(web);web.removeJavascriptInterface("StudioBridge");web.destroy();web=null;}
        if(rendererRecoveries++<1)recreate();else showBootFailure();
    }
    private String sourceName(){return source==SOURCE_LOOPBACK?"本地资源服务":source==SOURCE_PACKAGED?"内置内联页面":"appassets 拦截";}
    private void showBootFailure(){
        if(bootFailureShown||isFinishing()||isDestroyed())return;bootFailureShown=true;
        String agent="未知";try{agent=WebSettings.getDefaultUserAgent(this);}catch(Throwable ignored){}
        StringBuilder text=new StringBuilder("编辑器界面没有完成加载。常见原因是系统 WebView 版本过旧或被系统限制。\n\nWebView：").append(agent).append("\n\n加载方式：").append(sourceName());
        if(lastPageError.length()>0)text.append("\n页面错误：").append(lastPageError);
        if(lastResourceError.length()>0)text.append("\n资源错误：").append(lastResourceError);
        if(lastJsError.length()>0)text.append("\n脚本错误：").append(lastJsError);
        text.append("\n\n请到应用商店或系统设置更新 Android System WebView / Chrome 后重试。");
        String report=text.toString();
        new AlertDialog.Builder(this).setTitle("天工无法启动编辑器").setMessage(report)
            .setPositiveButton("重试",(d,w)->{bootFailureShown=false;if(web==null){rendererRecovery=false;recreate();return;}source=SOURCE_ASSETS;startTransport();})
            .setNeutralButton("复制诊断",(d,w)->{ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(clipboard!=null)clipboard.setPrimaryClip(ClipData.newPlainText("天工诊断",report));Toast.makeText(this,"诊断信息已复制。",Toast.LENGTH_SHORT).show();})
            .setNegativeButton("退出",(d,w)->finish()).show();
    }
    private void fatal(String text){TextView view=new TextView(this);view.setText(text);view.setPadding(30,60,30,30);setContentView(view);}
    private JSONObject message(String type){JSONObject o=new JSONObject();put(o,"type",type);return o;}
    private static void put(JSONObject o,String k,Object v){try{o.put(k,v);}catch(JSONException e){throw new IllegalArgumentException(e);}}
    private void event(JSONObject data){runOnUiThread(()->{if(web!=null&&!isFinishing()&&!isDestroyed()){String payload=data.toString().replace("\u2028","\\u2028").replace("\u2029","\\u2029");web.evaluateJavascript("window.StudioNative&&window.StudioNative.receive("+payload+")",null);}});}
    private void notice(String text){JSONObject o=message("notice");put(o,"message",text);event(o);}
    private void trust(Uri uri){synchronized(trustedUris){trustedUris.add(uri.toString());getPreferences(0).edit().putStringSet("trustedUris",new HashSet<>(trustedUris)).apply();}}
    private void persistGrant(Uri uri,int flags){try{getContentResolver().takePersistableUriPermission(uri,flags&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));}catch(SecurityException ignored){/* Some providers grant access only for this session. */}}
    public final class Bridge {
        @JavascriptInterface public void postMessage(String raw){
            if(raw==null)return;
            /* 以前超限直接 return，页面拿不到任何回执，用户只看到“保存中”卡住。 */
            if(raw.length()>32*1024*1024){notice("这次保存的数据超过 32 MB，没有提交。请删掉一些 PPT 页面，或先导出草稿再清理。");return;}
            runOnUiThread(()->{if(web==null)return;try{JSONObject m=new JSONObject(raw);handle(m);}catch(Exception e){notice("操作未完成："+e.getMessage());}});
        }
    }
    private void handle(JSONObject m)throws Exception{
        String type=m.optString("type");
        if(type.equals("ready")){deliverRestore();sendCapabilities();return;}
        if(type.equals("openModule")){openModule(m);return;}
        if(type.equals("aiRequest")){assistant.aiRequest(m);return;}
        if(type.equals("aiCancel")){assistant.aiCancel(m.optString("id",""));return;}
        if(type.equals("aiTool")){assistant.tool(m);return;}
        if(type.equals("aiTree")){pick(TREE,new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION));return;}
        if(type.equals("jsError")){lastJsError=m.optString("kind")+": "+m.optString("detail");android.util.Log.e("EmberStudio",lastJsError);return;}
        if(type.equals("ttsStatus")){requestTtsStatus();return;}
        if(type.equals("ttsSpeak")){speakTts(m);return;}
        if(type.equals("ttsPause")){pauseTts(m.optString("id",ttsCurrentId));return;}
        if(type.equals("ttsStop")){stopTts();return;}
        if(type.equals("snapshot")){
            final JSONObject data=m.getJSONObject("data");final int id=m.optInt("id");
            if(data.optInt("version")!=1||data.getJSONArray("files").length()>160)throw new IOException("工作区过大");
            io.execute(()->{
                JSONObject o=message("snapshotSaved");put(o,"id",id);
                try{
                    if(workspaceReadOnly)throw new IOException("请先恢复旧工作区");
                    byte[] bytes=data.toString().getBytes("UTF-8");
                    /* 以前这里超 32 MB 直接 return，草稿被整份丢掉还没有任何提示。
                       现在明确算好体积并回执，页面会把原因告诉用户。 */
                    if(bytes.length>WORKSPACE_LIMIT)throw new IOException("草稿体积 "+megabytes(bytes.length)+" MB，超过 "+megabytes(WORKSPACE_LIMIT)+" MB 上限，这次改动没有保存。请删掉一些 PPT 页面，或把重要内容另存后再清理。");
                    atomic(workspace,bytes);put(o,"ok",true);
                }catch(Exception e){put(o,"ok",false);put(o,"message",e.getMessage()==null?"草稿写入失败":e.getMessage());}
                event(o);
                if(exitRequested){exitRequested=false;ui.removeCallbacks(exitWatchdog);runOnUiThread(EditorActivity.this::finish);}
            });
            return;
        }
        if(type.equals("audioBegin")){audioBegin(m);return;}
        if(type.equals("audioChunk")){audioChunk(m);return;}
        if(type.equals("audioEnd")){audioEnd(m);return;}
        if(type.equals("audioAbort")){audioAbort(m);return;}
        if(type.equals("mediaPut")){mediaPut(m);return;}
        if(type.equals("mediaDelete")){mediaDelete(m);return;}
        if(type.equals("mediaGc")){mediaGc(m);return;}
        if(type.equals("micPermission")){micPermission(m);return;}
        if(type.equals("open")){pick(OPEN,new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true));return;}
        /* 上课模式：让原生相册直接选照片，不经过 WebView 的文件选择器。 */
        if(type.equals("pickSlides")){
            Intent intent=null;
            if(android.os.Build.VERSION.SDK_INT>=33){
                intent=new Intent(android.provider.MediaStore.ACTION_PICK_IMAGES);
                intent.setType("image/*");
                intent.putExtra(android.provider.MediaStore.EXTRA_PICK_IMAGES_MAX,50);
                if(intent.resolveActivity(getPackageManager())==null)intent=null;
            }
            if(intent==null)intent=new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
            startPicker(SLIDES,intent);
            return;
        }
        /* 上课模式：导入整个 PPT 文件（.pptx）。原生只负责把文件复制进缓存，
           解析与逐页渲染由页面里的 pptx.js 完成（同源 URL 读取，不走 base64）。 */
        if(type.equals("pickPptx")){
            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                .putExtra(Intent.EXTRA_MIME_TYPES,new String[]{
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    "application/vnd.ms-powerpoint",
                    "application/octet-stream"});
            startPicker(PPTX,intent);
            return;
        }
        if(type.equals("folder")){pick(FOLDER,new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE));return;}
        if(type.equals("export")){pendingExport=m;pick(EXPORT,new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/plain").putExtra(Intent.EXTRA_TITLE,new File(m.getString("path")).getName()));return;}
        /* 3D 模型等二进制导出：页面传 base64，这里按声明的 MIME 建文件。 */
        if(type.equals("exportBinary")){pendingExport=m;String mime=m.optString("mime","application/octet-stream");if(!mime.contains("/"))mime="application/octet-stream";pick(EXPORT,new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE,new File(m.getString("path")).getName()));return;}
        if(type.equals("save")){writeDocument(m,Uri.parse(m.getString("uri")),false);return;}
        if(type.equals("play")){try{startActivity(new Intent(this,cn.wuziping.ember.MainActivity.class).putExtra("editorHost",true));}catch(Exception e){notice("游戏未能打开："+e.getMessage());}return;}
        if(type.equals("gameState")){JSONObject o=message("gameState");put(o,"exists",(gameSave.getBaseFile().exists()||new File(gameSave.getBaseFile().getPath()+".bak").exists()));event(o);return;}
        if(type.equals("exportGame")){if(!(gameSave.getBaseFile().exists()||new File(gameSave.getBaseFile().getPath()+".bak").exists())){notice("先进入游戏创建一次存档。");return;}pick(GAME_OUT,new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE,"星火远征-存档.wzpsave"));return;}
        if(type.equals("importGame")){pick(GAME_IN,new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"));return;}
        if(type.equals("preview")){final JSONObject preview=m;io.execute(()->{try{File file=new File(getCacheDir(),"studio-preview.json");atomic(new AtomicFile(file),preview.toString().getBytes("UTF-8"));runOnUiThread(()->startActivity(new Intent(this,PreviewActivity.class)));}catch(Exception e){notice("预览失败："+e.getMessage());}});}
    }
    private void requestTtsStatus(){
        if(ttsReady||ttsInitializing){emitTtsStatus();return;}
        releaseTts();
        initTts();
    }
    private void initTts(){
        if(ttsInitializing)return;
        ttsInitializing=true;ttsError="";
        emitTtsStatus();
        final TextToSpeech[] holder=new TextToSpeech[1];
        try{
            holder[0]=new TextToSpeech(getApplicationContext(),status->ui.post(()->finishTtsInit(holder[0],status)));
            tts=holder[0];
        }catch(Throwable e){
            ttsInitializing=false;ttsReady=false;
            ttsError="系统英语语音引擎未能启动："+e.getMessage();
            emitTtsStatus();
        }
    }
    private void finishTtsInit(TextToSpeech engine,int status){
        ttsInitializing=false;
        if(status!=TextToSpeech.SUCCESS||engine==null||engine!=tts){
            ttsReady=false;
            ttsError="系统英语语音引擎未能启动。请重新进入英文朗读模式重试。";
            emitTtsStatus();
            return;
        }
        /* 进度回调在语音引擎的后台线程上。ttsCurrentId、ttsCharIndex、ttsCurrentLength、ttsRangeSeen 也由界面线程读写，先送回主线程再改。 */
        engine.setOnUtteranceProgressListener(new UtteranceProgressListener(){
            private void onUi(Runnable work){ui.post(work);}
            @Override public void onStart(String utteranceId){onUi(()->{if(utteranceId==null||!utteranceId.equals(ttsCurrentId))return;ttsCharIndex=0;JSONObject o=message("ttsStarted");put(o,"id",utteranceId);event(o);});}
            @Override public void onRangeStart(String utteranceId,int start,int end,int frame){onUi(()->{if(utteranceId==null||!utteranceId.equals(ttsCurrentId))return;ttsCharIndex=Math.max(0,start);ttsRangeSeen=true;JSONObject o=message("ttsRange");put(o,"id",utteranceId);put(o,"start",start);put(o,"end",end);put(o,"frame",frame);event(o);});}
            @Override public void onDone(String utteranceId){onUi(()->{if(utteranceId==null||!utteranceId.equals(ttsCurrentId))return;ttsCharIndex=ttsCurrentLength;ttsCurrentId="";JSONObject o=message("ttsDone");put(o,"id",utteranceId);event(o);});}
            @Override public void onError(String utteranceId){onUi(()->failTtsUtterance("英语语音播放失败。",utteranceId));}
            @Override public void onError(String utteranceId,int errorCode){onUi(()->failTtsUtterance("英语语音播放失败（"+errorCode+"）。",utteranceId));}
        });
        int languageStatus=engine.setLanguage(Locale.US);
        ttsReady=languageStatus!=TextToSpeech.LANG_MISSING_DATA&&languageStatus!=TextToSpeech.LANG_NOT_SUPPORTED;
        if(!ttsReady){
            Voice fallback=findEnglishVoice("",Locale.US);
            if(fallback!=null)ttsReady=engine.setVoice(fallback)==TextToSpeech.SUCCESS;
        }
        ttsError=ttsReady?"":"系统没有可用的英语语音，请安装英语语音数据后重新进入英文朗读模式。";
        emitTtsStatus();
    }
    private void releaseTts(){
        if(tts!=null){try{tts.stop();}catch(Throwable ignored){}try{tts.shutdown();}catch(Throwable ignored){}tts=null;}
        ttsReady=false;ttsInitializing=false;ttsCurrentId="";ttsCharIndex=0;ttsCurrentLength=0;ttsRangeSeen=false;
    }
    private void emitTtsStatus(){
        JSONObject o=message("ttsStatus");
        put(o,"ready",ttsReady);
        put(o,"initializing",ttsInitializing);
        if(tts!=null){
            String engine=tts.getDefaultEngine();
            put(o,"engine",engine==null?"Android 英语语音":"Android 英语语音 · "+engine);
        }else put(o,"engine","Android 英语语音");
        if(ttsError!=null&&ttsError.length()>0)put(o,"error",ttsError);
        JSONArray list=new JSONArray();
        if(tts!=null&&ttsReady){
            try{
                Set<Voice> available=tts.getVoices();
                if(available!=null)for(Voice voice:available){
                    Locale locale=voice.getLocale();
                    if(locale==null||!"en".equalsIgnoreCase(locale.getLanguage()))continue;
                    JSONObject item=new JSONObject();
                    put(item,"name",voice.getName());
                    put(item,"locale",locale.toLanguageTag());
                    put(item,"quality",voice.getQuality());
                    list.put(item);
                }
            }catch(Throwable ignored){/* Some engines expose fewer voice APIs than the platform contract. */}
        }
        put(o,"voices",list);
        event(o);
    }
    private Voice findEnglishVoice(String requested,Locale preferred){
        if(tts==null)return null;
        Voice first=null,preferredVoice=null;
        try{
            Set<Voice> voices=tts.getVoices();
            if(voices==null)return null;
            for(Voice voice:voices){
                Locale locale=voice.getLocale();
                if(locale==null||!"en".equalsIgnoreCase(locale.getLanguage()))continue;
                if(first==null)first=voice;
                if(requested!=null&&requested.length()>0&&requested.equalsIgnoreCase(voice.getName()))return voice;
                if(preferredVoice==null&&preferred!=null&&preferred.getCountry().equalsIgnoreCase(locale.getCountry()))preferredVoice=voice;
            }
        }catch(Throwable ignored){return null;}
        return preferredVoice!=null?preferredVoice:first;
    }
    private Locale englishLocale(String value){
        String locale=value==null?"en-US":value.replace('_','-');
        String[] parts=locale.split("-");
        if(parts.length<1||!"en".equalsIgnoreCase(parts[0]))return Locale.US;
        return new Locale("en",parts.length>1?parts[1].toUpperCase(Locale.US):"US");
    }
    private void speakTts(JSONObject m)throws Exception{
        String id=m.optString("id");
        String text=m.optString("text");
        if(id.length()==0||text.length()==0){ttsError("没有可朗读的文本。",id);return;}
        if(text.length()>TextToSpeech.getMaxSpeechInputLength()){ttsError("当前文本小节过长，请重新开始朗读。",id);return;}
        if(!ttsReady){
            requestTtsStatus();
            ttsError("英语语音仍在准备，请稍后重试。",id);
            return;
        }
        Locale locale=englishLocale(m.optString("locale","en-US"));
        Voice voice=findEnglishVoice(m.optString("voice",""),locale);
        int voiceResult=voice==null?TextToSpeech.ERROR:tts.setVoice(voice);
        if(voiceResult!=TextToSpeech.SUCCESS)tts.setLanguage(locale);
        float rate=Math.max(0.75f,Math.min(1.5f,(float)m.optDouble("rate",1)));
        tts.setSpeechRate(rate);
        Bundle params=new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME,1f);
        ttsCurrentId=id;ttsCharIndex=0;ttsCurrentLength=text.length();ttsRangeSeen=false;
        int result=tts.speak(text,TextToSpeech.QUEUE_FLUSH,params,id);
        if(result!=TextToSpeech.SUCCESS){ttsCurrentId="";ttsError("英语语音引擎未能开始朗读。",id);}
    }
    private void pauseTts(String id){
        int charIndex=ttsCharIndex;
        if(tts!=null)tts.stop();
        ttsCurrentId="";ttsCharIndex=0;ttsCurrentLength=0;
        JSONObject o=message("ttsPaused");put(o,"id",id);put(o,"charIndex",charIndex);put(o,"supported",android.os.Build.VERSION.SDK_INT>=26&&ttsRangeSeen);ttsRangeSeen=false;event(o);
    }
    private void stopTts(){
        if(tts!=null)tts.stop();
        ttsCurrentId="";ttsCharIndex=0;ttsCurrentLength=0;ttsRangeSeen=false;
        event(message("ttsStopped"));
    }
    private void failTtsUtterance(String message,String id){
        if(id==null||!id.equals(ttsCurrentId))return;
        ttsCurrentId="";ttsCharIndex=0;ttsCurrentLength=0;
        ttsError(message,id);
    }
    private void ttsError(String message,String id){
        JSONObject o=message("ttsError");
        put(o,"message",message);
        if(id!=null&&id.length()>0)put(o,"id",id);
        event(o);
    }
    private void pick(int request,Intent intent){if(pickerOpen){notice("请先完成当前文件选择。");return;}intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);try{pickerOpen=true;startActivityForResult(intent,request);}catch(ActivityNotFoundException e){pickerOpen=false;notice("未找到系统文件选择器。");}}
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){
        super.onRequestPermissionsResult(requestCode,permissions,grantResults);
        if(requestCode==MIC_WARM){
            boolean warm=grantResults!=null&&grantResults.length>0;
            if(warm)for(int result:grantResults)if(result!=android.content.pm.PackageManager.PERMISSION_GRANTED)warm=false;
            int id=pendingMicWarmId;pendingMicWarmId=-1;
            android.util.Log.i("EmberStudio","RECORD_AUDIO warmup granted="+warm);
            if(id>=0)replyMic(id,warm);
            return;
        }
        if(requestCode!=MIC||pendingMicRequest==null)return;
        /* grantResults 为 null 或空数组时是“用户取消/系统直接拒绝”，
           原来的写法会把这种情形当成已授权去 grant()，用户看到的是误导性失败。 */
        boolean granted=grantResults!=null&&grantResults.length>0;
        if(granted)for(int result:grantResults)if(result!=android.content.pm.PackageManager.PERMISSION_GRANTED)granted=false;
        android.util.Log.i("EmberStudio","RECORD_AUDIO result: granted="+granted+" ("+(grantResults==null?"null":grantResults.length+" items")+")");
        android.webkit.PermissionRequest request=pendingMicRequest;pendingMicRequest=null;
        try{
            if(granted)grantAudio(request);
            else{request.deny();notice("麦克风权限被拒绝，上课模式无法录音。可在系统设置 → 应用 → 天工 → 权限中开启。");}
        }catch(Exception ignored){/* 页面已切走 */}
    }
    /* 只授予页面真正需要、宿主也确实有权限的音频采集资源：
       把摄像头之类的资源一起 grant() 出去，会让 Chromium 在采集初始化阶段
       去开根本不存在的设备，整条采集链路直接报 NotReadableError。 */
    private static void grantAudio(android.webkit.PermissionRequest request){
        java.util.List<String> allow=new java.util.ArrayList<>();
        for(String resource:request.getResources())if(android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource))allow.add(resource);
        request.grant(allow.toArray(new String[0]));
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);pickerOpen=false;
        if(request==MODULE){
            openedModuleMeta=message("moduleMeta");
            if(result==RESULT_OK&&data!=null){
                String modulePath=data.getStringExtra("modulePath");
                if(modulePath==null||modulePath.isEmpty())modulePath=data.getStringExtra("path");
                if(modulePath==null||modulePath.isEmpty())modulePath=data.getStringExtra("crop_path");
                String moduleUri=data.getStringExtra("moduleUri");
                put(openedModuleMeta,"uri",moduleUri==null||moduleUri.isEmpty()?modulePath:moduleUri);
                put(openedModuleMeta,"path",modulePath);
                put(openedModuleMeta,"title",data.getStringExtra("moduleTitle"));
                put(openedModuleMeta,"size",data.getLongExtra("moduleSize",0));
                put(openedModuleMeta,"pages",data.getIntExtra("modulePages",0));
            }
            return;
        }
        if(result!=RESULT_OK||data==null){if(request==EXPORT&&pendingExport!=null){JSONObject o=message("saved");put(o,"id",pendingExport.optString("id"));put(o,"ok",false);put(o,"message","已取消导出，草稿仍保留。");event(o);pendingExport=null;}if(request==SLIDE&&pendingSlideChooser!=null){resolveSlideChooser(null);}return;}
        if(request==OPEN){final ArrayList<Uri> uris=new ArrayList<>();if(data.getClipData()!=null){ClipData clips=data.getClipData();for(int i=0;i<Math.min(160,clips.getItemCount());i++)uris.add(clips.getItemAt(i).getUri());}else if(data.getData()!=null)uris.add(data.getData());for(Uri uri:uris){persistGrant(uri,data.getFlags());trust(uri);}io.execute(()->importUris(uris));}
        else if(request==FOLDER&&data.getData()!=null){Uri uri=data.getData();persistGrant(uri,data.getFlags());io.execute(()->importTree(uri));}
        else if(request==TREE&&data.getData()!=null){assistant.saveTree(data.getData(),data.getFlags());notice("目录已授权。AI 可以先做只读扫描，再由你逐项确认整理或清理。");}
        else if(request==EXPORT&&pendingExport!=null&&data.getData()!=null){Uri uri=data.getData();persistGrant(uri,data.getFlags());trust(uri);JSONObject payload=pendingExport;pendingExport=null;writeDocument(payload,uri,true);}
        else if(request==GAME_OUT&&data.getData()!=null){Uri uri=data.getData();io.execute(()->{try(InputStream in=gameSave.openRead();OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException("文件无法写入");byte[] b=TextFiles.read(in,8*1024*1024);out.write(b);notice("游戏存档已导出，请妥善保留。");}catch(Exception e){notice("备份失败："+e.getMessage());}});}
        else if(request==GAME_IN&&data.getData()!=null){Uri uri=data.getData();io.execute(()->{try(InputStream in=getContentResolver().openInputStream(uri)){byte[] bytes=TextFiles.read(in,8*1024*1024);Game g=Game.load(new ByteArrayInputStream(bytes));runOnUiThread(()->new AlertDialog.Builder(this).setTitle("导入游戏存档？").setMessage("存档角色："+g.heroName+"\n等级："+g.level+"\n会替换当前游戏进度，替换前保留一份本地备份。").setNegativeButton("取消",null).setPositiveButton("导入",(d,w)->io.execute(()->{try{backupGame();atomic(gameSave,bytes);notice("游戏存档已导入。");}catch(Exception e){notice("导入失败："+e.getMessage());}})).show());}catch(Exception e){notice("这不是可用的游戏存档："+e.getMessage());}});}
        else if(request==SLIDE){final ArrayList<Uri> uris=pickedUris(data);resolveSlideChooser(uris.toArray(new Uri[0]));}
        else if(request==SLIDES){final ArrayList<Uri> uris=pickedUris(data);if(uris.isEmpty()){notice("没有选择照片。");return;}io.execute(()->stageSlideFiles(uris));}
        /* PPTX 只在导入时读一次、复制进 slide-cache，不需要持久化授权，
           更不能要写权限（用户原文件不该被这个应用拿到写权限）。 */
        else if(request==PPTX&&data.getData()!=null){final Uri uri=data.getData();io.execute(()->stagePptxFile(uri));}
    }
    private String fileName(Uri uri){try(Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())return c.getString(0);}catch(Exception ignored){}return "untitled.txt";}
    private JSONObject readDocument(Uri uri,String path)throws Exception{if(!TextFiles.validPath(path))throw new IOException("文件名不受支持");try(InputStream in=getContentResolver().openInputStream(uri)){if(in==null)throw new IOException("无法打开文件");TextFiles.Decoded file=TextFiles.decode(TextFiles.read(in,TextFiles.LIMIT));JSONObject o=new JSONObject();put(o,"path",path);put(o,"text",file.text);put(o,"encoding",file.encoding);put(o,"uri",uri.toString());trust(uri);return o;}}
    private void importUris(List<Uri> uris){JSONArray files=new JSONArray();int skipped=0,total=0;for(Uri uri:uris)try{JSONObject file=readDocument(uri,fileName(uri));total+=file.getString("text").getBytes("UTF-8").length;if(total>12*1024*1024){skipped++;break;}files.put(file);}catch(Exception e){skipped++;}importResult(files,skipped,false);}
    private void importTree(Uri root){JSONArray files=new JSONArray();int[] budget={0,0,0};try{String id=DocumentsContract.getTreeDocumentId(root);String directory=fileName(DocumentsContract.buildDocumentUriUsingTree(root,id));if(!TextFiles.validPath(directory))directory="project";walkTree(root,id,directory+"/",files,budget,0);importResult(files,budget[1],budget[2]!=0);}catch(Exception e){notice("文件夹读取失败："+e.getMessage());}}
    private void walkTree(Uri root,String id,String prefix,JSONArray files,int[] budget,int depth)throws Exception{if(depth>10||files.length()>=160||budget[0]>12*1024*1024){budget[2]=1;return;}Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(root,id);try(Cursor c=getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)){if(c==null)return;while(c.moveToNext()){if(files.length()>=160||budget[0]>12*1024*1024){budget[2]=1;break;}String childId=c.getString(0),name=c.getString(1),mime=c.getString(2),path=prefix+name;if(name.equals(".git")||name.equals("node_modules")||name.equals("__pycache__")){budget[1]++;continue;}if(DocumentsContract.Document.MIME_TYPE_DIR.equals(mime))walkTree(root,childId,path+"/",files,budget,depth+1);else try{JSONObject f=readDocument(DocumentsContract.buildDocumentUriUsingTree(root,childId),path);budget[0]+=f.getString("text").getBytes("UTF-8").length;if(budget[0]<=12*1024*1024)files.put(f);else budget[2]=1;}catch(Exception e){budget[1]++;}}}}
    private void importResult(JSONArray files,int skipped,boolean limited){JSONObject o=message("imported");put(o,"files",files);put(o,"message","已导入 "+files.length()+" 个文本文件"+(skipped>0?"，跳过 "+skipped+" 项非文本、缓存或过大文件":"")+(limited?"；已达到 160 文件 / 12 MB 导入上限":""));event(o);}
    private void writeDocument(JSONObject m,Uri uri,boolean as){if(!trustedUris.contains(uri.toString())||!"content".equals(uri.getScheme())){notice("文件授权已失效，请重新打开文件或另存为。");return;}io.execute(()->{JSONObject o=message("saved");put(o,"id",m.optString("id"));put(o,"uri",uri.toString());String encoding=as?"UTF-8":m.optString("encoding","UTF-8");put(o,"encoding",encoding);try{byte[] bytes=m.has("data")?android.util.Base64.decode(m.getString("data"),android.util.Base64.DEFAULT):TextFiles.encode(m.getString("text"),encoding);if(bytes.length>32*1024*1024)throw new IOException("导出内容超过 32 MB");try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException("文件无法写入");out.write(bytes);}put(o,"ok",true);}catch(Exception e){put(o,"ok",false);put(o,"message","写入失败："+e.getMessage()+"。草稿仍保留。");}event(o);});}
    private void backupGame()throws IOException{if(!gameSave.getBaseFile().exists()&&!new File(gameSave.getBaseFile().getPath()+".bak").exists())return;try(InputStream in=gameSave.openRead()){atomic(new AtomicFile(new File(getFilesDir(),"journey-backup-"+System.currentTimeMillis()+".wzpsave")),TextFiles.read(in,8*1024*1024));}}
    private static void atomic(AtomicFile file,byte[] bytes)throws IOException{FileOutputStream out=null;try{out=file.startWrite();out.write(bytes);file.finishWrite(out);}catch(IOException e){if(out!=null)file.failWrite(out);throw e;}}
    private void backup(File source,String prefix,String suffix)throws IOException{if(!source.exists())return;try(InputStream in=new FileInputStream(source)){atomic(new AtomicFile(new File(getFilesDir(),prefix+System.currentTimeMillis()+suffix)),TextFiles.read(in,32*1024*1024));}}
    @Override protected void onResume(){super.onResume();exitRequested=false;ui.removeCallbacks(exitWatchdog);if(web!=null){JSONObject o=message("gameState");put(o,"exists",gameSave.getBaseFile().exists()||new File(gameSave.getBaseFile().getPath()+".bak").exists());event(o);if(openedModule!=null){JSONObject back=message("moduleReturned");put(back,"id",openedModule);if(openedModuleMeta!=null){put(back,"uri",openedModuleMeta.optString("uri",""));put(back,"path",openedModuleMeta.optString("path",""));put(back,"title",openedModuleMeta.optString("title",""));put(back,"size",openedModuleMeta.optLong("size",0));put(back,"pages",openedModuleMeta.optInt("pages",0));}openedModule=null;openedModuleMeta=null;event(back);}}}
    @Override protected void onPause(){
        if(tts!=null&&ttsCurrentId.length()>0)pauseTts(ttsCurrentId);
        if(web!=null){
            /* A photo or file picker also pauses the activity. That must not stop a lecture. */
            if(!pickerOpen)web.evaluateJavascript("(function(){try{window.Studio&&window.Studio.lecture&&window.Studio.lecture.suspend({background:true});}catch(e){}})()",null);
            web.evaluateJavascript("window.Studio&&window.Studio.flush()",null);
        }
        super.onPause();
    }
    /** The editor is one page. WebView history would drop the workspace, so back never calls goBack(). */
    private void watchKeyboard(){
        final View decor=getWindow().getDecorView();
        decor.getViewTreeObserver().addOnGlobalLayoutListener(new ViewTreeObserver.OnGlobalLayoutListener(){
            @Override public void onGlobalLayout(){
                android.graphics.Rect rect=new android.graphics.Rect();
                decor.getWindowVisibleDisplayFrame(rect);
                int root=decor.getRootView().getHeight();
                keyboardVisible=root>0&&root-rect.height()>root/6;
            }
        });
    }
    private static String decodeJsString(String raw){
        if(raw==null||raw.equals("null")||raw.equals("undefined"))return "";
        if(raw.length()>=2&&raw.charAt(0)=='"'){
            try{return new JSONArray("["+raw+"]").getString(0);}catch(Exception ignored){return "";}
        }
        return raw;
    }
    private void showExitDialog(String title,String message,String positive,Runnable action){
        if(web==null||isFinishing()||isDestroyed())return;
        if(exitDialog!=null&&exitDialog.isShowing())return;
        exitDialog=new AlertDialog.Builder(this).setTitle(title).setMessage(message).setNegativeButton("留在天工",null).setPositiveButton(positive,(d,w)->action.run()).create();
        exitDialog.setOnDismissListener(d->exitDialog=null);
        exitDialog.show();
    }
    private void confirmRecordingExit(){
        showExitDialog("正在录音","退出会结束本次录音，并把已经录到的部分保存进课堂笔记。要继续吗？","停止并保存后退出",this::saveAndExit);
    }
    private void confirmExit(){
        if(web==null||isFinishing()||isDestroyed())return;
        if(exitDialog!=null&&exitDialog.isShowing())return;
        web.evaluateJavascript("window.Studio&&window.Studio.exitMessage?window.Studio.exitMessage():''",raw->{
            if(web==null||isFinishing()||isDestroyed())return;
            String message=decodeJsString(raw);
            if(message.isEmpty())message="草稿会留在本机。还没点「保存」的内容不会写回手机上的原文件。游戏存档另外保存。";
            showExitDialog("退出天工？",message,"退出",this::saveAndExit);
        });
    }
    /* Leave only after the lecture file is closed and the draft is flushed.
       finish() in the flush callback; the watchdog covers a hung WebView. */
    private void saveAndExit(){
        if(isFinishing()||isDestroyed())return;
        if(web==null){exitRequested=false;finish();return;}
        if(exitRequested)return;
        exitRequested=true;
        ui.postDelayed(exitWatchdog,EXIT_SAVE_TIMEOUT);
        web.evaluateJavascript("(function(){try{return !!(window.Studio&&window.Studio.lecture&&window.Studio.lecture.suspend({exit:true}));}catch(e){return false;}})()",value->pollExitSave(0));
    }
    private void pollExitSave(int attempt){
        if(!exitRequested)return;
        if(web==null||isFinishing()||isDestroyed()){exitRequested=false;ui.removeCallbacks(exitWatchdog);finish();return;}
        if(attempt>EXIT_POLL_LIMIT){flushAndExit();return;}
        web.evaluateJavascript("(function(){try{return !!(window.Studio&&window.Studio.lecture&&window.Studio.lecture.busy());}catch(e){return false;}})()",value->{
            if(!exitRequested)return;
            if("true".equals(value)){ui.postDelayed(()->pollExitSave(attempt+1),150);return;}
            flushAndExit();
        });
    }
    private void flushAndExit(){
        if(!exitRequested)return;
        if(web==null){exitRequested=false;ui.removeCallbacks(exitWatchdog);finish();return;}
        web.evaluateJavascript("(function(){try{window.Studio&&window.Studio.flush();}catch(e){}})()",value->{
            if(!exitRequested)return;
            exitRequested=false;
            ui.removeCallbacks(exitWatchdog);
            finish();
        });
    }
    @Override public void onBackPressed(){
        if(web==null){saveAndExit();return;}
        if(keyboardVisible){
            android.view.inputmethod.InputMethodManager imm=(android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
            if(imm!=null)imm.hideSoftInputFromWindow(web.getWindowToken(),0);
            return;
        }
        web.evaluateJavascript("window.Studio&&window.Studio.back?window.Studio.back():false",result->{
            if("true".equals(result))return;
            if(web==null||isFinishing()||isDestroyed())return;
            web.evaluateJavascript("(function(){try{return !!(window.Studio&&window.Studio.lecture&&window.Studio.lecture.busy());}catch(e){return false;}})()",busy->{
                if("true".equals(busy))confirmRecordingExit();
                else confirmExit();
            });
        });
    }
    @Override protected void onDestroy(){ui.removeCallbacksAndMessages(null);releaseTts();clearSlideCache();for(String id:new ArrayList<>(audioSinks.keySet()))closeAudioSink(id);audioIo.shutdown();if(web!=null){web.removeJavascriptInterface("StudioBridge");web.destroy();web=null;}if(assets!=null)try{assets.close();}catch(IOException ignored){}if(packed!=null)packed.close();io.shutdown();super.onDestroy();}
}
