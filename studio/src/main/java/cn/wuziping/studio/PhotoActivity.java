package cn.wuziping.studio;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.TextView;
import java.io.*;
import java.util.*;

/**
 * 浮生图梦修图模块。页面是 photo/index.html（由 studio/web/build-photo.mjs 从 photo/ 打包），
 * 与编辑器一样经 appassets 同源拦截提供，完全离线。
 *
 * 选图走 WebView 的 &lt;input type=file&gt;；导出由页面把字节分块 base64 交给 PhotoBridge，
 * 这里拼回临时文件后写进相册（Pictures/浮生图梦）或下载目录（Download/浮生图梦）。
 * 返回键先交给页面（关面板、退出裁剪），页面不处理时结束本页，回到天工首页。
 */
public final class PhotoActivity extends Activity {
    private static final int CHOOSE=51;
    private static final long MAX_EXPORT=512L*1024*1024;
    private static final String FOLDER="浮生图梦";
    private WebView web;private AssetServer assets;private PackedAssets packed;
    private ValueCallback<Uri[]> pendingChooser;
    private final Map<String,Pending> exports=Collections.synchronizedMap(new HashMap<String,Pending>());
    private String lastExportPath="",lastExportName="",lastExportMime="";
    private long lastExportSize=0;

    private static final class Pending {final File file;final String name,mime;final OutputStream out;long size;
        Pending(File file,String name,String mime)throws IOException{this.file=file;this.name=name;this.mime=mime;this.out=new BufferedOutputStream(new FileOutputStream(file));}}

    @Override public void onCreate(Bundle state){super.onCreate(state);
        String recentUri=getIntent().getStringExtra("recentUri");
        if(recentUri!=null&&!recentUri.isEmpty()){
            String recentTitle=getIntent().getStringExtra("recentTitle");
            toast("打开最近材料："+(recentTitle==null||recentTitle.isEmpty()?recentUri:recentTitle));
        }
        try{
            getWindow().setStatusBarColor(0xff14141a);getWindow().setNavigationBarColor(0xff14141a);
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            getWindow().getDecorView().setSystemUiVisibility(0);
            packed=new PackedAssets(this);
            try{assets=new AssetServer(path->packed.open(path),false);}catch(IOException e){fatal("修图资源未能启动："+e.getMessage());return;}
            try{web=new WebView(this);}catch(RuntimeException e){fatal("系统 WebView 不可用，修图页无法打开。");return;}
            web.setBackgroundColor(0xff14141a);web.setOverScrollMode(View.OVER_SCROLL_NEVER);
            WebSettings s=web.getSettings();
            s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);
            s.setCacheMode(WebSettings.LOAD_NO_CACHE);s.setUseWideViewPort(true);s.setLoadWithOverviewMode(false);s.setSupportZoom(false);
            s.setTextZoom(100);s.setDefaultTextEncodingName("UTF-8");s.setSupportMultipleWindows(false);
            if(Build.VERSION.SDK_INT>=33)s.setAlgorithmicDarkeningAllowed(false);else if(Build.VERSION.SDK_INT>=29)s.setForceDark(WebSettings.FORCE_DARK_OFF);
            if(Build.VERSION.SDK_INT>=26)s.setSafeBrowsingEnabled(false);
            web.setWebChromeClient(new WebChromeClient(){
                @Override public boolean onConsoleMessage(ConsoleMessage m){if(m!=null)android.util.Log.i("EmberPhoto",m.messageLevel()+": "+m.message()+" @"+m.sourceId()+":"+m.lineNumber());return true;}
                @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                    if(pendingChooser!=null){try{pendingChooser.onReceiveValue(null);}catch(Exception ignored){}}
                    pendingChooser=callback;
                    Intent intent=null;try{if(params!=null)intent=params.createIntent();}catch(Exception ignored){}
                    if(intent==null)intent=new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                    if(params!=null&&params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE)intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
                    try{startActivityForResult(intent,CHOOSE);}catch(ActivityNotFoundException e){deliverChoice(null);toast("未找到系统文件选择器。");}
                    return true;
                }
            });
            web.setWebViewClient(StudioClient.create(assets,null));
            web.addJavascriptInterface(new Bridge(),"PhotoBridge");
            setContentView(web);
            web.loadUrl(StudioClient.ORIGIN+"photo/index.html?from=studio");
        }catch(Throwable e){fatal("修图页没能打开："+e.getClass().getSimpleName()+" "+e.getMessage());}
    }

    private void fatal(String text){TextView v=new TextView(this);v.setText(text+"\n\n按返回键回到天工。");v.setTextColor(0xffe8e8ef);v.setBackgroundColor(0xff14141a);v.setPadding(36,72,36,36);setContentView(v);}
    private void toast(String text){runOnUiThread(()->android.widget.Toast.makeText(this,text,android.widget.Toast.LENGTH_LONG).show());}

    private void deliverChoice(Uri[] uris){ValueCallback<Uri[]> cb=pendingChooser;pendingChooser=null;if(cb!=null)try{cb.onReceiveValue(uris);}catch(Exception ignored){}}

    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request!=CHOOSE)return;
        if(result!=RESULT_OK||data==null){deliverChoice(null);return;}
        List<Uri> list=new ArrayList<>();
        if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount();i++){Uri u=data.getClipData().getItemAt(i).getUri();if(u!=null)list.add(u);}
        if(list.isEmpty()&&data.getData()!=null)list.add(data.getData());
        deliverChoice(list.isEmpty()?null:list.toArray(new Uri[0]));
    }

    public final class Bridge {
        @JavascriptInterface public String begin(String name,String mime){
            try{
                String safe=safeName(name);
                File dir=new File(getCacheDir(),"photo-export");if(!dir.isDirectory()&&!dir.mkdirs())return "";
                String token=UUID.randomUUID().toString();
                exports.put(token,new Pending(new File(dir,token+".part"),safe,mime==null||mime.isEmpty()?guessMime(safe):mime));
                return token;
            }catch(Exception e){return "";}
        }
        @JavascriptInterface public boolean append(String token,String b64){
            Pending p=exports.get(token);if(p==null||b64==null)return false;
            try{byte[] bytes=Base64.decode(b64,Base64.DEFAULT);p.size+=bytes.length;if(p.size>MAX_EXPORT){abort(token);return false;}p.out.write(bytes);return true;}
            catch(Exception e){abort(token);return false;}
        }
        @JavascriptInterface public void abort(String token){Pending p=exports.remove(token);if(p==null)return;try{p.out.close();}catch(IOException ignored){}if(!p.file.delete())p.file.deleteOnExit();}
        @JavascriptInterface public String finish(String token){
            Pending p=exports.remove(token);if(p==null)return "";
            try{p.out.close();String result=publish(p);lastExportPath=result;lastExportName=p.name;lastExportMime=p.mime;lastExportSize=p.size;return result;}
            catch(Exception e){toast("导出失败："+e.getMessage());return "";}
            finally{if(!p.file.delete())p.file.deleteOnExit();}
        }
        @JavascriptInterface public void close(){runOnUiThread(PhotoActivity.this::finish);}
    }

    private static String safeName(String name){
        String n=name==null?"":name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_").trim();
        if(n.isEmpty())n="photo-"+System.currentTimeMillis();
        return n.length()>120?n.substring(n.length()-120):n;
    }
    private static String guessMime(String name){
        String n=name.toLowerCase(Locale.ROOT);
        if(n.endsWith(".png"))return "image/png";if(n.endsWith(".jpg")||n.endsWith(".jpeg"))return "image/jpeg";
        if(n.endsWith(".zip"))return "application/zip";if(n.endsWith(".json"))return "application/json";
        return "application/octet-stream";
    }

    /** 图片进相册，ZIP / 工程 JSON 进下载目录。返回给页面展示的位置。 */
    private String publish(Pending p)throws IOException{
        boolean image=p.mime.startsWith("image/");
        if(Build.VERSION.SDK_INT>=29){
            ContentResolver resolver=getContentResolver();
            Uri collection=image?MediaStore.Images.Media.EXTERNAL_CONTENT_URI:MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            String relative=(image?Environment.DIRECTORY_PICTURES:Environment.DIRECTORY_DOWNLOADS)+"/"+FOLDER;
            ContentValues values=new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME,p.name);values.put(MediaStore.MediaColumns.MIME_TYPE,p.mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH,relative);values.put(MediaStore.MediaColumns.IS_PENDING,1);
            Uri uri=resolver.insert(collection,values);
            if(uri==null)throw new IOException("系统拒绝创建文件");
            try(InputStream in=new FileInputStream(p.file);OutputStream out=resolver.openOutputStream(uri)){
                if(out==null)throw new IOException("无法写入");copy(in,out);
            }catch(IOException e){resolver.delete(uri,null,null);throw e;}
            ContentValues done=new ContentValues();done.put(MediaStore.MediaColumns.IS_PENDING,0);resolver.update(uri,done,null,null);
            return (image?"相册 · ":"下载 · ")+relative+"/"+p.name;
        }
        File dir=new File(getExternalFilesDir(image?Environment.DIRECTORY_PICTURES:Environment.DIRECTORY_DOWNLOADS),FOLDER);
        if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("无法创建目录");
        File target=new File(dir,p.name);
        for(int i=2;target.exists();i++){int dot=p.name.lastIndexOf('.');target=new File(dir,(dot>0?p.name.substring(0,dot):p.name)+"-"+i+(dot>0?p.name.substring(dot):""));}
        try(InputStream in=new FileInputStream(p.file);OutputStream out=new FileOutputStream(target)){copy(in,out);}
        android.media.MediaScannerConnection.scanFile(this,new String[]{target.getAbsolutePath()},new String[]{p.mime},null);
        return target.getAbsolutePath();
    }
    private static void copy(InputStream in,OutputStream out)throws IOException{byte[] b=new byte[64*1024];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}

    @Override public void onBackPressed(){
        if(web==null){finish();return;}
        web.evaluateJavascript("window.PhotoMobile&&window.PhotoMobile.back?window.PhotoMobile.back():false",r->{if(!"true".equals(r))finish();});
    }
    @Override public void finish(){
        if(!lastExportPath.isEmpty()){
            Intent data=new Intent();
            data.putExtra("modulePath",lastExportPath);
            data.putExtra("moduleTitle",lastExportName);
            data.putExtra("moduleSize",lastExportSize);
            data.putExtra("moduleMime",lastExportMime);
            setResult(RESULT_OK,data);
        }
        super.finish();
    }
    @Override protected void onDestroy(){
        deliverChoice(null);
        synchronized(exports){for(String t:new ArrayList<>(exports.keySet())){Pending p=exports.remove(t);try{p.out.close();}catch(IOException ignored){}p.file.delete();}}
        if(web!=null){web.removeJavascriptInterface("PhotoBridge");web.destroy();web=null;}
        if(assets!=null)try{assets.close();}catch(IOException ignored){}
        if(packed!=null)packed.close();
        super.onDestroy();
    }
}
