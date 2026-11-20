package com.scan.camera

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.hardware.camera2.CaptureRequest
import android.media.MediaActionSound
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.MediaStore
import android.provider.Settings
import android.text.InputType
import android.util.Size
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.TorchState
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.chip.ChipGroup
import com.google.android.material.slider.Slider
import com.google.android.material.snackbar.Snackbar
import com.scan.camera.databinding.ActivityMainBinding
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var camera: androidx.camera.core.Camera? = null
    private var imageCapture: ImageCapture? = null
    @Volatile private var torchOn = false
    private var mode = EnhanceMode.GRAY
    private var frameEnabled = true
    private var cropEnabled = true
    private var ocrEnabled = true
    private var sharpen = 50
    private var contrast = 50
    private var resOverride = 0
    private var clearAfterPdf = false
    @Volatile private var autoEnabled = false
    private var burstEnabled = true
    @Volatile private var autoTorchEnabled = false
    @Volatile private var autoTorchUsed = false
    private var splitEnabled = false
    private var fitAuto = false
    @Volatile private var generating = false
    @Volatile private var processing = false
    @Volatile private var captureBusy = false
    @Volatile private var previewOpen = false
    private lateinit var pageStore: PageStore
    @Volatile private var pendingEditFile: File? = null
    private val autoGate = AutoCaptureGate()
    private val quadMotion = QuadMotion()
    private val busy get() = generating || processing || captureBusy || previewOpen || pendingCaptureFile != null || pendingEditFile != null
    private var aeafLocked = false
    private var pdfJob: kotlinx.coroutines.Job? = null
    private var restoreJob: kotlinx.coroutines.Job? = null
    private val pages = mutableListOf<Page>()
    private lateinit var pageAdapter: PageAdapter
    private lateinit var cameraExecutor: ExecutorService
    private lateinit var analysisExecutor: ExecutorService
    private lateinit var gestureDetector: GestureDetector
    private lateinit var scaleDetector: ScaleGestureDetector
    private var shutterSound: MediaActionSound? = null
    @Volatile private var pendingCaptureFile: File? = null
    private var lastOcrText: String? = null
    private var lastOutputPath = ""
    private var lastOutputTitle = ""
    private var lastOutputSize = 0L
    private var lastOutputPages = 0

    @Volatile private var analysisEnabled = true
    @Volatile private var windowFocused = false
    private var lastOverlayPost = 0L
    private var lastDarkPost = 0L

    private val importLauncher =
        registerForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(100)) { uris ->
            previewOpen = false
            lifecycleScope.launch { restoreJob?.join(); importPhotos(uris) }
        }

    private fun importPhotos(uris: List<Uri>) {

        if (uris.isEmpty() || busy) { updateUi(); return }
        processing = true; updateUi()
        binding.progress.visibility = View.VISIBLE
        binding.cancelBtn.visibility = View.VISIBLE
        val split = splitEnabled
        val maxDim = Quality.maxDim
        pdfJob = lifecycleScope.launch {
            var imported = 0
            var failed = 0
            try {
                for ((i, uri) in uris.withIndex()) {
                    kotlinx.coroutines.currentCoroutineContext().ensureActive()
                    binding.progressText.text = getString(R.string.importing, i+1, uris.size, imported)
                    val input = pageStore.newCapture()
                    try {
                        withContext(kotlinx.coroutines.NonCancellable) {
                            val result = withContext(Dispatchers.IO) {
                                contentResolver.openInputStream(uri)?.use { stream ->
                                    FileOutputStream(input).use { stream.copyTo(it) }
                                } ?: error("无法读取图片")
                                require(input.length() > 0) { "图片为空" }
                                ImagePipeline.prepare(input, pageStore, split = split, maxDim = maxDim)
                            }
                            for (f in result) { onCaptureReady(f, null); imported++ }
                        }
                    } catch (e: CancellationException) { throw e }
                    catch (_: OutOfMemoryError) { failed++ }
                    catch (_: Exception) { failed++ }
                    finally { input.delete() }
                }
                kotlinx.coroutines.currentCoroutineContext().ensureActive()
                Toast.makeText(this@MainActivity, "已导入 $imported 页" + if (failed > 0) "，$failed 张失败" else "", Toast.LENGTH_LONG).show()
            } catch (e: CancellationException) {
                Toast.makeText(this@MainActivity, "已停止导入，已添加 $imported 页", Toast.LENGTH_SHORT).show()
                throw e
            } finally { finishOperation() }
        }
    }


    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startCamera() else showPermissionDenied()
        }

    private val previewLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            lifecycleScope.launch { restoreJob?.join(); handlePreviewResult(result) }
        }

    private fun handlePreviewResult(result: androidx.activity.result.ActivityResult) {

        previewOpen = false
        if (result.resultCode != RESULT_OK) { updateUi(); return }
        val path = result.data?.getStringExtra(PreviewActivity.EXTRA_PATH)
        val index = pages.indexOfFirst { it.file.absolutePath == path }
        if (index < 0) { updateUi(); return }
        val action = result.data?.getStringExtra(PreviewActivity.EXTRA_ACTION)
        if (action != "delete" && path != null) {
            val file = File(path)
            lastOutputPath = path
            lastOutputTitle = file.name
            lastOutputSize = file.length()
            lastOutputPages = pages.size
        }
        val previewMode = result.data?.getStringExtra(PreviewActivity.EXTRA_PREVIEW_MODE)
            ?.let { runCatching { EnhanceMode.valueOf(it) }.getOrNull() }
        // 预览只是比较效果；若用原色预览后直接返回，提示导出仍按主界面模式，并指向彩色版入口。
        if (action == "close" && previewMode == EnhanceMode.COLOR && mode != EnhanceMode.COLOR) {
            toast(getString(R.string.preview_export_hint, modeLabel(mode)))
        }
        when (action) {
            "delete" -> deletePage(index)
            "crop" -> {
                pendingEditFile = pages[index].file
                cropLauncher.launch(Intent(this, CropActivity::class.java)
                    .putExtra(CropActivity.EXTRA_PATH, pageStore.original(pages[index].file).absolutePath)
                    .putExtra(CropActivity.EXTRA_EDIT, true))
            }
            "rotate" -> editPage(index, rotation = 90)
            "restore" -> editPage(index, restore = true)
        }
        updateUi()
    }


    private val cropLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            lifecycleScope.launch { restoreJob?.join(); handleCropResult(result) }
        }

    private fun handleCropResult(result: androidx.activity.result.ActivityResult) {

        val editing = pendingEditFile
        val file = pendingCaptureFile
            ?: result.data?.getStringExtra(CropActivity.EXTRA_PATH)?.let(::File)
        pendingCaptureFile = null
        pendingEditFile = null
        if (result.resultCode != CropActivity.RESULT_CONFIRM || file == null) {
            if (editing == null && file?.parentFile == pageStore.stagingDir) file.delete()
            updateUi(); return
        }
        val quad = result.data?.getFloatArrayExtra(CropActivity.EXTRA_QUAD)
        val rotation = result.data?.getIntExtra(CropActivity.EXTRA_ROTATION, 0) ?: 0
        processing = true; updateUi()
        binding.progress.visibility = View.VISIBLE
        binding.progressText.text = getString(R.string.correcting)
        lifecycleScope.launch {
            try {
                require(quad != null && ScanRules.validQuad(quad)) { "无效选框，请重试" }
                if (editing != null) {
                    withContext(Dispatchers.IO) { renderEdit(editing, file, quad, rotation) }
                    val at = pages.indexOfFirst { it.file == editing }
                    if (at >= 0) refreshPage(at)
                } else {
                    withContext(kotlinx.coroutines.NonCancellable) {
                        val resultFiles = withContext(Dispatchers.IO) {
                            ImagePipeline.prepare(file, pageStore, quad, rotation, splitEnabled)
                        }
                        for (f in resultFiles) onCaptureReady(f, null)
                        file.delete()
                    }
                }
            } catch (e: CancellationException) { throw e }
            catch (_: OutOfMemoryError) { toast("内存不足，原照片已保留，可在回收站找回") }
            catch (e: Exception) { toast("处理失败：${e.message}，原照片已保留") }
            finally {
                processing = false; binding.progress.visibility = View.GONE; updateUi()
                if (editing == null && file.exists()) {
                    withContext(kotlinx.coroutines.NonCancellable + Dispatchers.IO) {
                        pageStore.recoverCapture(file)
                    }
                }
            }
        }
    }


    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        pageStore = PageStore(filesDir)
        pendingCaptureFile = savedInstanceState?.getString("pendingCapture")?.let(::File)
        pendingEditFile = savedInstanceState?.getString("pendingEdit")?.let(::File)
        previewOpen = savedInstanceState?.getBoolean("previewOpen") ?: false
        val recentUri = intent.getStringExtra("recentUri").orEmpty()
        if (recentUri.isNotEmpty()) toast("打开最近材料：${intent.getStringExtra("recentTitle").orEmpty().ifBlank { recentUri }}")

        val saved = SettingsStore.load(this)
        frameEnabled = saved.frame
        cropEnabled = saved.crop
        ocrEnabled = saved.ocr
        autoEnabled = saved.auto
        burstEnabled = saved.burst
        autoTorchEnabled = saved.autoTorch
        splitEnabled = saved.split
        fitAuto = saved.fitAuto
        sharpen = saved.sharpen
        contrast = saved.contrast
        resOverride = saved.resOverride
        clearAfterPdf = saved.clearAfterPdf
        mode = try {
            EnhanceMode.valueOf(saved.mode)
        } catch (e: Exception) {
            EnhanceMode.GRAY
        }
        Quality.init(applicationContext)
        Quality.applyOverride(resOverride)
        purgeTrash()
        binding.pageFrame.attachPreview(binding.previewView)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            binding.topBar.updatePadding(top = bars.top)
            binding.bottomBar.updatePadding(bottom = bars.bottom)
            insets
        }

        cameraExecutor = Executors.newSingleThreadExecutor()
        analysisExecutor = Executors.newSingleThreadExecutor()
        shutterSound = MediaActionSound().also { it.load(MediaActionSound.SHUTTER_CLICK) }

        pageAdapter = PageAdapter(pages) { index -> openPreview(index) }
        binding.thumbStrip.layoutManager =
            LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        binding.thumbStrip.adapter = pageAdapter
        // 长按缩略图拖动排序（补拍的页可拖回正确位置）
        ItemTouchHelper(object : ItemTouchHelper.SimpleCallback(
            ItemTouchHelper.UP or ItemTouchHelper.DOWN or
                ItemTouchHelper.START or ItemTouchHelper.END, 0
        ) {
            override fun onMove(
                recyclerView: androidx.recyclerview.widget.RecyclerView,
                viewHolder: androidx.recyclerview.widget.RecyclerView.ViewHolder,
                target: androidx.recyclerview.widget.RecyclerView.ViewHolder
            ): Boolean {
                if (busy) return false
                val from = viewHolder.bindingAdapterPosition
                val to = target.bindingAdapterPosition
                if (from == to || from == androidx.recyclerview.widget.RecyclerView.NO_POSITION ||
                    to == androidx.recyclerview.widget.RecyclerView.NO_POSITION
                ) return false
                pages.add(to, pages.removeAt(from))
                savePageOrder()
                pageAdapter.notifyItemMoved(from, to)
                return true
            }

            override fun onSwiped(viewHolder: androidx.recyclerview.widget.RecyclerView.ViewHolder, direction: Int) = Unit
            override fun isLongPressDragEnabled() = !busy
            override fun clearView(
                recyclerView: androidx.recyclerview.widget.RecyclerView,
                viewHolder: androidx.recyclerview.widget.RecyclerView.ViewHolder
            ) {
                super.clearView(recyclerView, viewHolder)
                // 松手后整体重绑，页码角标按新顺序刷新
                pageAdapter.notifyDataSetChanged()
            }
        }).attachToRecyclerView(binding.thumbStrip)

        binding.shutterBtn.setOnClickListener { takePhoto(burst = true) }
        binding.pdfBtn.setOnClickListener { generatePdf() }
        // 长按可自定义 PDF 文件名
        binding.pdfBtn.setOnLongClickListener {
            showPdfNameDialog()
            true
        }
        binding.clearBtn.setOnClickListener { confirmClear() }
        binding.clearBtn.setOnLongClickListener { showTrash(); true }
        binding.importBtn.setOnClickListener {
            if (busy) return@setOnClickListener
            previewOpen = true; updateUi()
            importLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }
        // 长按「相册」：查看/管理已生成的 PDF
        binding.importBtn.setOnLongClickListener {
            AlertDialog.Builder(this).setTitle("文档管理")
                .setItems(arrayOf("已生成 PDF", "回收站（48 小时）", "反转当前页序")) { _, which ->
                    when (which) {
                        0 -> showHistory()
                        1 -> showTrash()
                        2 -> if (!busy && pages.size > 1) {
                            pages.reverse(); savePageOrder(); pageAdapter.notifyDataSetChanged()
                        }
                    }
                }.show()
            true
        }
        binding.torchBtn.setOnClickListener { camera?.cameraControl?.enableTorch(!torchOn) }
        binding.postBtn.setOnClickListener { showPostPanel() }
        binding.homeBtn.setOnClickListener { returnToStudio() }
        binding.zoomDial.onZoomChange = { ratio ->
            camera?.cameraInfo?.zoomState?.value?.let { state ->
                camera?.cameraControl?.setZoomRatio(ratio.coerceIn(state.minZoomRatio, state.maxZoomRatio))
            }
        }
        binding.zoomDial.onReset = {
            camera?.cameraControl?.setZoomRatio(1f)
        }
        binding.frameChip.setOnClickListener {
            frameEnabled = !frameEnabled
            binding.frameChip.isSelected = frameEnabled
            binding.pageFrame.setFrameVisible(frameEnabled)
            syncAnalysis()
            saveSettings()
        }
        binding.correctChip.setOnClickListener {
            cropEnabled = !cropEnabled
            binding.correctChip.isSelected = cropEnabled
            saveSettings()
        }
        binding.ocrChip.setOnClickListener {
            ocrEnabled = !ocrEnabled
            binding.ocrChip.isSelected = ocrEnabled
            saveSettings()
        }
        binding.autoChip.setOnClickListener {
            autoEnabled = !autoEnabled
            binding.autoChip.isSelected = autoEnabled
            autoGate.reset()
            quadMotion.reset()
            binding.pageFrame.setAutoProgress(0f)
            syncAnalysis()
            saveSettings()
        }
        binding.frameChip.isSelected = frameEnabled
        binding.correctChip.isSelected = cropEnabled
        binding.ocrChip.isSelected = ocrEnabled
        binding.autoChip.isSelected = autoEnabled
        syncAnalysis()
        binding.pageFrame.setFrameVisible(frameEnabled)
        binding.retryBtn.setOnClickListener { permissionLauncher.launch(Manifest.permission.CAMERA) }
        binding.cancelBtn.setOnClickListener {
            pdfJob?.cancel()
            binding.cancelBtn.isEnabled = false
            binding.progressText.text = "正在停止，请稍候…"
        }
        binding.openSettingsBtn.setOnClickListener {
            startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", packageName, null)
                )
            )
        }
        mapOf(
            binding.modeColor to EnhanceMode.COLOR,
            binding.modeGray to EnhanceMode.GRAY,
            binding.modeBw to EnhanceMode.BW
        ).forEach { (view, m) ->
            view.setOnClickListener { mode = m; updateModeChips(); saveSettings() }
        }
        updateModeChips()
        restorePages()
        updateUi()

        gestureDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                if (aeafLocked) { toast("对焦/曝光已锁定，双击画面解除"); return true }
                val point = binding.previewView.meteringPointFactory.createPoint(e.x, e.y)
                camera?.cameraControl?.startFocusAndMetering(
                    // 点按处同时对焦 + 测光：拍暗处文字会自动提亮
                    FocusMeteringAction.Builder(
                        point,
                        FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE
                    )
                        .setAutoCancelDuration(3, TimeUnit.SECONDS)
                        .build()
                )
                binding.pageFrame.showFocusAt(e.x, e.y)
                return true
            }

            override fun onDoubleTap(e: MotionEvent): Boolean {
                toggleAeAfLock(e)
                return true
            }
        })
        scaleDetector = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val zoom = camera?.cameraInfo?.zoomState?.value ?: return true
                camera?.cameraControl?.setZoomRatio(
                    (zoom.zoomRatio * detector.scaleFactor)
                        .coerceIn(zoom.minZoomRatio, zoom.maxZoomRatio)
                )
                return true
            }
        })
        binding.previewView.setOnTouchListener { _, event ->
            scaleDetector.onTouchEvent(event)
            if (!scaleDetector.isInProgress) gestureDetector.onTouchEvent(event)
            if (event.actionMasked == MotionEvent.ACTION_UP) binding.previewView.performClick()
            true
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) startCamera() else permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        windowFocused = hasFocus
    }

    override fun onResume() {
        super.onResume()
        // 用户到系统设置授权后返回时自动启动相机
        if (camera == null && binding.permissionTip.visibility == View.VISIBLE &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        ) startCamera()
    }

    /** 取景框或自动拍摄任一开启时都需要帧分析 */
    private fun syncAnalysis() {
        analysisEnabled = frameEnabled || autoEnabled || autoTorchEnabled
    }

    // Camera2Interop 仍标记为实验性 API，但已多年稳定；此处有意使用以打开 ISP 高质量通路
    @SuppressLint("UnsafeOptInUsageError")
    private fun startCamera() {
        binding.permissionTip.visibility = View.GONE
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val preview = Preview.Builder()
                    .setResolutionSelector(
                        ResolutionSelector.Builder()
                            .setResolutionStrategy(
                                ResolutionStrategy(
                                    Size(2400, 1800),
                                    ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                                )
                            )
                            .build()
                    )
                    .build()
                    .also { it.setSurfaceProvider(binding.previewView.surfaceProvider) }
                val captureBuilder = ImageCapture.Builder()
                    // 扫书不需要连拍速度，画质优先
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                    .setJpegQuality(95)
                    .setResolutionSelector(
                        ResolutionSelector.Builder()
                            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                            .setAllowedResolutionMode(ResolutionSelector.PREFER_HIGHER_RESOLUTION_OVER_CAPTURE_RATE)
                            .build()
                    )
                // 请求 ISP 的硬件高质量通路：边缘增强 / 降噪 / 色差校正都走 HIGH_QUALITY 档
                Camera2Interop.Extender(captureBuilder)
                    .setCaptureRequestOption(CaptureRequest.EDGE_MODE, CaptureRequest.EDGE_MODE_HIGH_QUALITY)
                    .setCaptureRequestOption(CaptureRequest.NOISE_REDUCTION_MODE, CaptureRequest.NOISE_REDUCTION_MODE_HIGH_QUALITY)
                    .setCaptureRequestOption(
                        CaptureRequest.COLOR_CORRECTION_ABERRATION_MODE,
                        CaptureRequest.COLOR_CORRECTION_ABERRATION_MODE_HIGH_QUALITY
                    )
                val capture = captureBuilder.build()
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(
                        ResolutionSelector.Builder()
                            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                            .setResolutionStrategy(
                                ResolutionStrategy(
                                    Size(640, 480),
                                    ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                                )
                            )
                            .build()
                    )
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .also { it.setAnalyzer(analysisExecutor, ::analyzeFrame) }
                binding.previewView.display?.rotation?.let { capture.targetRotation = it }
                provider.unbindAll()
                camera = provider.bindToLifecycle(
                    this, CameraSelector.DEFAULT_BACK_CAMERA, preview, capture, analysis
                )
                imageCapture = capture
                // 以相机实际状态为准同步开关显示，并让转盘跟随当前变焦
                binding.torchBtn.isEnabled = camera?.cameraInfo?.hasFlashUnit() == true
                aeafLocked = false
                camera?.cameraInfo?.torchState?.observe(this) { state ->
                    torchOn = state == TorchState.ON
                    binding.torchBtn.isSelected = torchOn
                    binding.torchBtn.contentDescription =
                        getString(if (torchOn) R.string.torch_on else R.string.torch_off)
                }
                camera?.cameraInfo?.zoomState?.observe(this) { state ->
                    binding.zoomDial.setZoom(state.zoomRatio, state.maxZoomRatio, state.minZoomRatio)
                }
            } catch (e: Exception) {
                Toast.makeText(this, "相机启动失败: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    /** 预览帧分析：检测书页边缘，驱动取景框动态贴合；自动模式下检测稳定即拍摄 */
    private fun analyzeFrame(image: ImageProxy) {
        try {
            if (!analysisEnabled) return
            val (gray, w, h) = PageDetect.toUprightGray(image) ?: return
            val raw = PageDetect.detectQuad(gray, w, h)
            val tracked = quadMotion.update(raw)
            val locked = tracked.let { quadMotion.confident && !quadMotion.fallback }
            if (locked) {
                lastDetectedQuad = tracked
                lastDetectedAt = SystemClock.elapsedRealtime()
            }
            val now = SystemClock.elapsedRealtime()
            if (now - lastOverlayPost > 90) {
                lastOverlayPost = now
                val aspect = w.toFloat() / h
                runOnUiThread {
                    binding.pageFrame.setDetection(tracked, aspect, locked)
                    if (!locked) binding.pageFrame.setAutoProgress(0f)
                }
            }
            // 暗光提示（低频刷新）+ 可选自动开闪光灯
            val mean = gray.sum().toDouble() / gray.size
            val dark = mean < 70
            if (now - lastDarkPost > 1000) {
                lastDarkPost = now
                runOnUiThread { binding.pageFrame.setDarkHint(dark) }
            }
            if (dark) {
                if (autoTorchEnabled && !autoTorchUsed && !torchOn && windowFocused && camera?.cameraInfo?.hasFlashUnit() == true) {
                    autoTorchUsed = true
                    runOnUiThread { camera?.cameraControl?.enableTorch(true) }
                }
            } else {
                autoTorchUsed = false
            }
            if (autoEnabled) {
                val signature = IntArray(16*16) { i ->
                    val x = ((i%16+0.5f)*w/16).toInt().coerceIn(0,w-1)
                    val y = ((i/16+0.5f)*h/16).toInt().coerceIn(0,h-1)
                    gray[y*w+x]
                }
                val shoot = autoGate.update(if (locked) tracked else null, signature, now, busy || !windowFocused)
                val progress = autoGate.progress
                runOnUiThread {
                    binding.pageFrame.setAutoProgress(progress)
                    if (shoot) takePhoto()
                }
            }

        } catch (e: Exception) {
            // 单帧分析失败不影响取景
        } finally {
            image.close()
        }
    }

    /** 音量键快门：单手按住书页时另一只手就能拍 */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            if (event?.repeatCount == 0 && !busy) takePhoto()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    /** 双击切换 AE/AF 锁定：同一光照下批量扫描时，页面间曝光不再跳动 */
    @SuppressLint("UnsafeOptInUsageError")
    private fun toggleAeAfLock(e: MotionEvent) {
        val cam = camera ?: return
        aeafLocked = !aeafLocked
        androidx.camera.camera2.interop.Camera2CameraControl.from(cam.cameraControl)
            .setCaptureRequestOptions(androidx.camera.camera2.interop.CaptureRequestOptions.Builder()
                .setCaptureRequestOption(CaptureRequest.CONTROL_AE_LOCK, aeafLocked).build())
        val point = binding.previewView.meteringPointFactory.createPoint(e.x, e.y)
        if (aeafLocked) {
            cam.cameraControl.startFocusAndMetering(
                FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
                    .disableAutoCancel()
                    .build()
            )
            Toast.makeText(this, "已锁定对焦/曝光（双击解除）", Toast.LENGTH_SHORT).show()
        } else {
            cam.cameraControl.startFocusAndMetering(
                FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
                    .setAutoCancelDuration(3, TimeUnit.SECONDS)
                    .build()
            )
            Toast.makeText(this, "已解除锁定", Toast.LENGTH_SHORT).show()
        }
    }

    /** 把当前所有页按序导出为 JPEG 图片到 Download/扫描相机/图片_时间/ 子目录 */
    private fun exportPagesAsImages() {
        if (pages.isEmpty() || busy) return
        processing = true; updateUi()
        val files = pages.map { it.file }
        val settings = currentSettings()
        val currentMode = mode
        val maxDim = Quality.maxDim
        val folder = "图片_"+SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        binding.progress.visibility = View.VISIBLE; binding.cancelBtn.visibility = View.VISIBLE
        pdfJob = lifecycleScope.launch {
            var exported = 0
            try {
                val job = kotlinx.coroutines.currentCoroutineContext()[kotlinx.coroutines.Job]!!
                withContext(Dispatchers.IO) {
                    files.forEachIndexed { index, f ->
                        job.ensureActive()
                        runOnUiThread { binding.progressText.text = getString(R.string.export_progress, index+1, files.size) }
                        val image = ImagePipeline.processed(f, currentMode, settings, maxDim)
                        var uri: Uri? = null
                        var committed = false
                        try {
                            uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, ContentValues().apply {
                                put(MediaStore.MediaColumns.DISPLAY_NAME, "page_${(index+1).toString().padStart(4,'0')}.jpg")
                                put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
                                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS+"/扫描相机/$folder")
                                put(MediaStore.MediaColumns.IS_PENDING, 1)
                            }) ?: error("无法创建图片文件")
                            contentResolver.openOutputStream(uri)?.use {
                                check(image.compress(Bitmap.CompressFormat.JPEG, 95, it)) { "图片写入失败" }
                            } ?: error("无法写入图片文件")
                            job.ensureActive()
                            check(contentResolver.update(uri, ContentValues().apply {
                                put(MediaStore.MediaColumns.IS_PENDING, 0)
                            }, null, null) > 0)
                            committed = true; exported++
                            lastOutputPath = uri.toString()
                            lastOutputTitle = "page_${(index+1).toString().padStart(4,'0')}.jpg"
                            lastOutputSize = runCatching { contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: 0L }.getOrDefault(0L)
                            lastOutputPages = files.size
                        } finally {
                            image.recycle()
                            if (!committed) uri?.let { runCatching { contentResolver.delete(it, null, null) } }
                        }
                    }
                }
                toast("已导出 $exported 张增强图片到 Download/扫描相机/$folder")
            } catch (e: CancellationException) {
                toast("已停止导出，已保存 $exported 张图片到 $folder"); throw e
            } catch (_: OutOfMemoryError) { toast("内存不足，已保存 $exported 张，请调低分辨率重试") }
            catch (e: Exception) { toast("导出失败：${e.message}，已保存 $exported 张") }
            finally { finishOperation() }
        }
    }

    private class HistoryEntry(val id: Long, val name: String, val size: Long)

    /** 长按「相册」进入：列出 Download/扫描相机/ 下已生成的 PDF，可打开/分享/删除 */
    private fun showHistory() {
        if (busy) return
        processing = true; updateUi()
        lifecycleScope.launch {
            try {
                val entries = withContext(Dispatchers.IO) {
                    val found = mutableListOf<HistoryEntry>()
                    contentResolver.query(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE),
                        "${MediaStore.MediaColumns.RELATIVE_PATH} = ? AND ${MediaStore.MediaColumns.MIME_TYPE} = ? AND ${MediaStore.MediaColumns.IS_PENDING} = 0",
                        arrayOf(Environment.DIRECTORY_DOWNLOADS+"/扫描相机/", "application/pdf"),
                        "${MediaStore.MediaColumns.DATE_MODIFIED} DESC")?.use { cursor ->
                        while (cursor.moveToNext()) found.add(HistoryEntry(cursor.getLong(0), cursor.getString(1) ?: "", cursor.getLong(2)))
                    }
                    found
                }
                if (entries.isEmpty()) { toast(getString(R.string.history_empty)); return@launch }
                val container = android.widget.LinearLayout(this@MainActivity).apply {
                    orientation = android.widget.LinearLayout.VERTICAL
                    setPadding(24, 8, 24, 8)
                }
                val search = EditText(this@MainActivity).apply { hint = "搜索 PDF 文件名"; setSingleLine() }
                val listView = android.widget.ListView(this@MainActivity)
                container.addView(search)
                container.addView(listView, android.widget.LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, (resources.displayMetrics.heightPixels*0.5f).toInt()))
                var filtered: List<HistoryEntry> = entries
                fun refresh(query: String) {
                    filtered = entries.filter { it.name.contains(query, ignoreCase = true) }
                    listView.adapter = android.widget.ArrayAdapter(this@MainActivity, android.R.layout.simple_list_item_1,
                        filtered.map { "${it.name}\n${it.size/1024} KB" })
                }
                refresh("")
                val dialog = AlertDialog.Builder(this@MainActivity).setTitle("已生成 PDF · ${entries.size} 份")
                    .setView(container).setNegativeButton("关闭", null).create()
                search.addTextChangedListener(object : android.text.TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { refresh(s.toString()) }
                    override fun afterTextChanged(s: android.text.Editable?) = Unit
                })
                listView.setOnItemClickListener { _, _, position, _ ->
                    val entry = filtered[position]
                    val uri = android.content.ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, entry.id)
                    AlertDialog.Builder(this@MainActivity).setTitle(entry.name)
                        .setItems(arrayOf("打开", "分享", "重命名", "删除 PDF 和同名文字")) { _, action ->
                            when (action) {
                                0 -> openPdf(uri)
                                1 -> sharePdf(uri)
                                2 -> {
                                    val input = EditText(this@MainActivity).apply { setText(entry.name.removeSuffix(".pdf")); setSingleLine() }
                                    AlertDialog.Builder(this@MainActivity).setTitle("重命名 PDF").setView(input)
                                        .setPositiveButton("保存") { _, _ ->
                                            val requestedName = input.text.toString()
                                            mutateHistory {
                                                val base = ExportRules.safeBaseName(requestedName, entry.name.removeSuffix(".pdf"))
                                                check(contentResolver.update(uri, ContentValues().apply {
                                                    put(MediaStore.MediaColumns.DISPLAY_NAME, "$base.pdf")
                                                }, null, null)>0)
                                                val actualName = contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use {
                                                    if (it.moveToFirst()) it.getString(0) else null
                                                } ?: "$base.pdf"
                                                contentResolver.update(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                                                    ContentValues().apply { put(MediaStore.MediaColumns.DISPLAY_NAME, actualName.removeSuffix(".pdf")+".txt") },
                                                    "${MediaStore.MediaColumns.RELATIVE_PATH} = ? AND ${MediaStore.MediaColumns.DISPLAY_NAME} = ?",
                                                    arrayOf(Environment.DIRECTORY_DOWNLOADS+"/扫描相机/", entry.name.removeSuffix(".pdf")+".txt"))
                                            }
                                            dialog.dismiss()
                                        }.setNegativeButton("取消", null).show()
                                }
                                3 -> AlertDialog.Builder(this@MainActivity).setTitle("删除导出文件")
                                    .setMessage("删除 ${entry.name} 及同名 TXT？此操作不进入页面回收站。")
                                    .setPositiveButton("删除") { _, _ ->
                                        mutateHistory {
                                            check(contentResolver.delete(uri, null, null)>0)
                                            contentResolver.delete(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                                                "${MediaStore.MediaColumns.RELATIVE_PATH} = ? AND ${MediaStore.MediaColumns.DISPLAY_NAME} = ?",
                                                arrayOf(Environment.DIRECTORY_DOWNLOADS+"/扫描相机/", entry.name.removeSuffix(".pdf")+".txt"))
                                        }
                                        dialog.dismiss()
                                    }.setNegativeButton("取消", null).show()
                            }
                        }.show()
                }
                dialog.show()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { toast("读取历史失败：${e.message}") }
            finally { processing = false; updateUi() }
        }
    }

    private fun mutateHistory(action: () -> Unit) {
        if (busy) return
        processing = true; updateUi()
        lifecycleScope.launch {
            try { withContext(Dispatchers.IO) { action() }; toast("文件已更新") }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { toast("操作失败：${e.message}，请刷新历史确认文件状态") }
            finally { processing = false; updateUi() }
        }
    }

    private fun showPermissionDenied() {
        binding.permissionTip.visibility = View.VISIBLE
        val permanentlyDenied = !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)
        Toast.makeText(
            this,
            if (permanentlyDenied) "相机权限已被拒绝，请到系统设置中手动开启"
            else getString(R.string.camera_permission_title),
            Toast.LENGTH_LONG
        ).show()
    }

    private fun takePhoto(burst: Boolean = false) {
        if (busy || !lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) return
        val capture = imageCapture ?: return
        captureBusy = true; updateUi()
        val file = pageStore.newCapture()
        if (burst && burstEnabled) startBurst(capture, file) else captureOne(capture, file)
    }

    private fun captureOne(capture: ImageCapture, file: File) {
        capture.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), cameraExecutor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    runOnUiThread { beginCaptureFlow(file) }
                }
                override fun onError(exception: ImageCaptureException) {
                    file.delete()
                    runOnUiThread { captureBusy = false; updateUi(); toast("拍照失败：${exception.message}") }
                }
            })
    }

    private fun beginCaptureFlow(file: File) {
        lifecycleScope.launch {
            try {
                val thumb = withContext(Dispatchers.IO) { Images.thumbnail(file) }
                    ?: error("照片保存失败")
                thumb.recycle()
                if (cropEnabled) {
                    pendingCaptureFile = file
                    val intent = Intent(this@MainActivity, CropActivity::class.java)
                        .putExtra(CropActivity.EXTRA_PATH, file.absolutePath)
                    if (SystemClock.elapsedRealtime()-lastDetectedAt < 2000) {
                        lastDetectedQuad?.let { intent.putExtra(CropActivity.EXTRA_SUGGESTED, it) }
                    }
                    cropLauncher.launch(intent)
                } else {
                    withContext(kotlinx.coroutines.NonCancellable) {
                        val result = withContext(Dispatchers.IO) {
                            ImagePipeline.prepare(file, pageStore, split = splitEnabled)
                        }
                        for (f in result) onCaptureReady(f, null)
                        file.delete()
                    }
                }
            } catch (e: CancellationException) { throw e }
            catch (_: OutOfMemoryError) { toast("内存不足，照片已保留，可在回收站找回") }
            catch (e: Exception) { toast("处理失败：${e.message}") }
            finally {
                if (pendingCaptureFile != file && file.exists()) {
                    withContext(kotlinx.coroutines.NonCancellable + Dispatchers.IO) { pageStore.recoverCapture(file) }
                }
                captureBusy = false; updateUi()
            }
        }
    }

    private fun startBurst(capture: ImageCapture, finalFile: File) {
        val files = List(3) { pageStore.newCapture() }
        val remaining = java.util.concurrent.atomic.AtomicInteger(3)
        files.forEach { f ->
            capture.takePicture(ImageCapture.OutputFileOptions.Builder(f).build(), cameraExecutor,
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) = settle()
                    override fun onError(exception: ImageCaptureException) { f.delete(); settle() }
                    private fun settle() {
                        if (remaining.decrementAndGet() != 0) return
                        // 此回调已在相机工作线程，评分和文件操作不阻塞 UI。
                        val candidates = files.filter { it.isFile && it.length() > 0 }
                        val best = candidates.maxByOrNull { runCatching { Images.sharpnessScore(it) }.getOrDefault(0.0) }
                        files.filter { it != best }.forEach { it.delete() }
                        if (best == null) {
                            runOnUiThread { captureBusy = false; updateUi(); toast("连拍失败，请重试") }
                        } else {
                            val chosen = if (best.renameTo(finalFile)) finalFile else best
                            runOnUiThread { beginCaptureFlow(chosen) }
                        }
                    }
                })
        }
    }

    private suspend fun onCaptureReady(file: File, thumb: Bitmap?) {
        if (pages.any { it.file == file }) return
        val t = thumb ?: withContext(Dispatchers.IO) { Images.thumbnail(file) } ?: error("无法读取页面")
        pages.add(Page(file, t))
        savePageOrder()
        pageAdapter.notifyItemInserted(pages.lastIndex)
        binding.thumbStrip.smoothScrollToPosition(pages.lastIndex)
        updateUi()
        shutterSound?.play(MediaActionSound.SHUTTER_CLICK); vibrate()
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    private fun savePageOrder() {
        try { pageStore.saveOrder(pages.map { it.file }) }
        catch (_: Exception) { toast("页序保存失败，请检查剩余存储空间") }
    }

    private fun finishOperation() {
        processing = false; generating = false; pdfJob = null
        binding.progress.visibility = View.GONE
        binding.cancelBtn.visibility = View.GONE; binding.cancelBtn.isEnabled = true
        updateUi()
    }

    private suspend fun refreshPage(index: Int) {
        val file = pages[index].file
        val thumbnail = withContext(Dispatchers.IO) { Images.thumbnail(file) } ?: error("无法读取页面")
        pages[index] = Page(file, thumbnail)
        PdfCreator.clearCache()
        pageAdapter.notifyItemChanged(index)
        savePageOrder()
    }

    private fun renderEdit(target: File, source: File, quad: FloatArray?, rotation: Int) {
        pageStore.keepOriginal(target, target)
        val results = ImagePipeline.prepare(source, pageStore, quad, rotation)
        try { pageStore.replace(target, results.single()) }
        finally { results.forEach { f -> pageStore.original(f).takeIf { it != f }?.delete(); f.delete() } }
    }

    private fun editPage(index: Int, rotation: Int = 0, restore: Boolean = false) {
        if (busy) return
        processing = true; updateUi()
        binding.progress.visibility = View.VISIBLE; binding.progressText.text = "正在更新页面…"
        lifecycleScope.launch {
            try {
                val file = pages[index].file
                withContext(Dispatchers.IO) {
                    if (restore) {
                        val original = pageStore.original(file)
                        require(original != file) { "此页尚无可还原的原图" }
                        pageStore.replace(file, original)
                    } else renderEdit(file, file, null, rotation)
                }
                refreshPage(index)
            } catch (e: CancellationException) { throw e }
            catch (_: OutOfMemoryError) { toast("内存不足，页面未修改") }
            catch (e: Exception) { toast("编辑失败：${e.message}") }
            finally { processing = false; binding.progress.visibility = View.GONE; updateUi() }
        }
    }

    private fun deletePage(index: Int) {
        val page = pages[index]
        if (!pageStore.moveToTrash(page.file)) { toast("删除失败，页面已保留"); return }
        pages.removeAt(index); savePageOrder(); PdfCreator.clearCache()
        pageAdapter.notifyDataSetChanged(); updateUi()
        Snackbar.make(binding.root, "页面已移入回收站", Snackbar.LENGTH_LONG).setAction("撤销") {
            if (!busy) {
                val restored = pageStore.restore(File(File(filesDir, "trash"), page.file.name))
                if (restored != null) {
                    pages.add(index.coerceAtMost(pages.size), page); savePageOrder()
                    pageAdapter.notifyDataSetChanged(); updateUi()
                }
            }
        }.show()
    }

    private fun showTrash() {
        if (busy) return
        val deleted = pageStore.deleted()
        if (deleted.isEmpty()) { toast("回收站为空（删除后保留 48 小时）"); return }
        AlertDialog.Builder(this).setTitle("回收站 · 保留 48 小时")
            .setItems(deleted.map { "${it.name.takeLast(24)} · ${it.length()/1024} KB" }.toTypedArray()) { _, which ->
                AlertDialog.Builder(this).setTitle("恢复此页？")
                    .setMessage("恢复后添加到当前文档末尾，可拖动调整顺序。")
                    .setPositiveButton("恢复") { _, _ ->
                        val f = pageStore.restore(deleted[which])
                        if (f != null) {
                            processing = true; updateUi()
                            lifecycleScope.launch {
                                try { onCaptureReady(f, null) }
                                catch (e: Exception) { toast("恢复失败：${e.message}") }
                                finally { processing = false; updateUi() }
                            }
                        } else toast("恢复失败，原文件仍在回收站")
                    }.setNegativeButton("取消", null).show()
            }.setPositiveButton("全部恢复") { _, _ ->
                processing = true; updateUi()
                lifecycleScope.launch {
                    try { for (f in deleted.asReversed()) pageStore.restore(f)?.let { onCaptureReady(it, null) } }
                    finally { processing = false; updateUi() }
                }
            }.setNegativeButton("关闭", null).show()
    }

    private fun vibrate() {
        val vibrator = getSystemService(Vibrator::class.java) ?: return
        vibrator.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    private fun tickVibrate() {
        val vibrator = getSystemService(Vibrator::class.java) ?: return
        vibrator.vibrate(VibrationEffect.createOneShot(15, 40))
    }

    private fun openPreview(index: Int) {
        if (busy || index !in pages.indices) return
        previewOpen = true
        previewLauncher.launch(
            Intent(this, PreviewActivity::class.java)
                .putStringArrayListExtra(
                    PreviewActivity.EXTRA_PATHS,
                    ArrayList(pages.map { it.file.absolutePath })
                )
                .putExtra(PreviewActivity.EXTRA_INDEX, index)
        )
    }

    private fun confirmClear() {
        val mb = pages.sumOf { it.file.length() } / (1024.0 * 1024.0)
        val sizeText = if (mb >= 1) String.format(Locale.US, "约 %.1f MB", mb) else "不足 1MB"
        AlertDialog.Builder(this)
            .setTitle("清空页面")
            .setMessage("将删除已拍摄的 ${pages.size} 页（$sizeText，不影响已生成的 PDF），确定吗？")
            .setPositiveButton("清空") { _, _ -> clearPages() }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun clearPages() {
        val retained = pages.filterNot { pageStore.moveToTrash(it.file) }
        pages.clear(); pages.addAll(retained)
        savePageOrder(); PdfCreator.clearCache()
        pageAdapter.notifyDataSetChanged(); updateUi()
        if (retained.isNotEmpty()) toast("部分页面未能删除，已保留")
    }

    private fun purgeTrash() = pageStore.purgeTrash()

    /** 长按「生成 PDF」：自定义文件名后再生成 */
    private fun showPdfNameDialog() {
        if (pages.isEmpty() || busy) return
        val input = EditText(this).apply {
            hint = getString(R.string.pdf_name_hint)
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.pdf_name_title)
            .setView(input)
            .setPositiveButton(R.string.rename_generate) { _, _ ->
                generatePdf(input.text.toString())
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun generatePdf(customName: String? = null, colorCopy: Boolean = false) {
        if (pages.isEmpty() || busy) return
        generating = true; updateUi()
        val files = pages.map { it.file }
        val exportMode = ExportRules.exportMode(mode, colorCopy)
        val settings = currentSettings()
        val useOcr = ocrEnabled
        binding.progress.visibility = View.VISIBLE; binding.cancelBtn.visibility = View.VISIBLE
        pdfJob = lifecycleScope.launch {
            try {
                val job = kotlinx.coroutines.currentCoroutineContext()[kotlinx.coroutines.Job]!!
                val result = withContext(Dispatchers.IO) {
                    PdfCreator.createPdf(files, exportMode, contentResolver, useOcr, settings, customName,
                        { !job.isActive }) { done, total ->
                        runOnUiThread {
                            binding.progressText.text = if (done == total) "正在保存 PDF 和文字…"
                                else "正在处理 ${done+1}/$total 页"+if (useOcr) "（含离线识别）" else ""
                        }
                    }
                }
                showPdfResult(result, colorCopy)
            } catch (e: CancellationException) { toast("已取消生成，未完成文件已清理"); throw e }
            catch (_: OutOfMemoryError) { toast("内存不足，请调低分辨率或分批导出") }
            catch (e: Exception) { toast("生成失败：${e.message}") }
            finally { finishOperation() }
        }
    }

    private fun showPdfResult(result: PdfCreator.Result, colorCopy: Boolean = false) {
        lastOutputPath = result.uri.toString()
        lastOutputTitle = result.displayName
        lastOutputSize = result.size
        lastOutputPages = pages.size
        lastOcrText = result.text.ifBlank { null }
        val details = buildString {
            if (colorCopy) appendLine(getString(R.string.pdf_color_note))
            append("已保存到：\n${result.location}")
            if (result.size > 0) append("\n文件大小：${result.size/1024} KB")
            if (result.ocrRequested) {
                append("\n已识别 ${result.recognizedPages} 页")
                if (result.missedPages.isNotEmpty()) append("；第 ${result.missedPages.joinToString()} 页未识别出文字（无文字、超时或识别失败）")
                if (result.text.isNotBlank()) append(if (result.textSaved) "\n同名 TXT 已保存" else "\nTXT 保存失败，可用「复制全文」保留文字")
            }
        }
        val view = layoutInflater.inflate(R.layout.dialog_pdf_result, binding.root, false)
        view.findViewById<TextView>(R.id.pdfResultMessage).text = details
        var keepPages = false
        lateinit var dialog: AlertDialog
        val colorAction = view.findViewById<TextView>(R.id.pdfColorAction)
        if (colorCopy) colorAction.visibility = View.GONE
        colorAction.setOnClickListener {
            keepPages = true
            dialog.dismiss()
            if (pages.isEmpty()) toast(getString(R.string.color_copy_empty))
            else if (busy) toast("正在处理其他任务，请稍后再试")
            else generatePdf(ExportRules.colorCopyBaseName(result.displayName), colorCopy = true)
        }
        view.findViewById<TextView>(R.id.pdfOpenAction).setOnClickListener {
            dialog.dismiss()
            openPdf(result.uri)
        }
        view.findViewById<TextView>(R.id.pdfShareAction).setOnClickListener {
            dialog.dismiss()
            sharePdf(result.uri)
        }
        val copyAction = view.findViewById<TextView>(R.id.pdfCopyAction)
        if (result.text.isBlank()) copyAction.visibility = View.GONE
        copyAction.setOnClickListener {
            dialog.dismiss()
            copyText(result.text)
        }
        dialog = AlertDialog.Builder(this)
            .setTitle(if (colorCopy) getString(R.string.pdf_color_title) else "PDF 已生成")
            .setView(view)
            .setNegativeButton(R.string.pdf_done, null)
            .create()
        dialog.setOnDismissListener {
            // 彩色版动作要先保留页面；普通完成才按设置清空。存在未识别页时保留，避免吞掉失败材料。
            if (clearAfterPdf && !keepPages && (!result.ocrRequested || result.missedPages.isEmpty())) clearPages()
        }
        dialog.show()
    }

    private fun returnToStudio() {
        if (lastOutputPath.isNotEmpty()) {
            setResult(RESULT_OK, Intent()
                .putExtra("modulePath", lastOutputPath)
                .putExtra("moduleUri", lastOutputPath)
                .putExtra("moduleTitle", lastOutputTitle)
                .putExtra("moduleSize", lastOutputSize)
                .putExtra("modulePages", lastOutputPages))
        }
        finish()
    }

    private fun copyText(text: String) {
        val cm = getSystemService(ClipboardManager::class.java)
        cm?.setPrimaryClip(ClipData.newPlainText("扫描文字", text))
        Toast.makeText(this, "全文已复制，可粘贴到笔记应用", Toast.LENGTH_SHORT).show()
    }

    private fun sharePdf(uri: Uri) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newRawUri("", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(send, "分享 PDF"))
    }

    private fun openPdf(uri: Uri) {
        try {
            startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/pdf")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
            )
        } catch (e: Exception) {
            Toast.makeText(this, "未找到可打开 PDF 的应用", Toast.LENGTH_SHORT).show()
        }
    }

    /** 「后期处理」底部面板：锐化 / 对比 / 分辨率 */
    private fun showPostPanel() {
        val dialog = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.sheet_post, binding.root, false)
        val sharpenSlider = view.findViewById<Slider>(R.id.sharpenSlider)
        val contrastSlider = view.findViewById<Slider>(R.id.contrastSlider)
        val chips = view.findViewById<ChipGroup>(R.id.resChips)

        sharpenSlider.value = sharpen.toFloat()
        contrastSlider.value = contrast.toFloat()
        chips.check(
            when (resOverride) {
                2400 -> R.id.resStd
                2800 -> R.id.resHi
                3200 -> R.id.resUltra
                else -> R.id.resAuto
            }
        )
        sharpenSlider.addOnChangeListener { _, value, fromUser ->
            if (fromUser) sharpen = value.roundToInt()
        }
        contrastSlider.addOnChangeListener { _, value, fromUser ->
            if (fromUser) contrast = value.roundToInt()
        }
        chips.setOnCheckedStateChangeListener { _, ids ->
            resOverride = when (ids.firstOrNull()) {
                R.id.resStd -> 2400
                R.id.resHi -> 2800
                R.id.resUltra -> 3200
                else -> 0
            }
        }
        val splitSwitch = view.findViewById<com.google.android.material.switchmaterial.SwitchMaterial>(
            R.id.splitSwitch
        )
        splitSwitch.isChecked = splitEnabled
        splitSwitch.setOnCheckedChangeListener { _, checked -> splitEnabled = checked }
        val burstSwitch = view.findViewById<com.google.android.material.switchmaterial.SwitchMaterial>(
            R.id.burstSwitch
        )
        burstSwitch.isChecked = burstEnabled
        burstSwitch.setOnCheckedChangeListener { _, checked -> burstEnabled = checked }
        val fitChips = view.findViewById<ChipGroup>(R.id.fitChips)
        fitChips.check(if (fitAuto) R.id.fitAuto else R.id.fitA4)
        fitChips.setOnCheckedStateChangeListener { _, ids ->
            fitAuto = ids.firstOrNull() == R.id.fitAuto
        }
        val clearSwitch = view.findViewById<com.google.android.material.switchmaterial.SwitchMaterial>(
            R.id.clearSwitch
        )
        clearSwitch.isChecked = clearAfterPdf
        clearSwitch.setOnCheckedChangeListener { _, checked -> clearAfterPdf = checked }
        val autoTorchSwitch = view.findViewById<com.google.android.material.switchmaterial.SwitchMaterial>(
            R.id.autoTorchSwitch
        )
        autoTorchSwitch.isChecked = autoTorchEnabled
        autoTorchSwitch.setOnCheckedChangeListener { _, checked ->
            autoTorchEnabled = checked
            if (!checked) autoTorchUsed = false
        }
        view.findViewById<View>(R.id.resetBtn).setOnClickListener {
            sharpen = 50
            contrast = 50
            resOverride = 0
            splitEnabled = false
            fitAuto = false
            burstEnabled = true
            autoTorchEnabled = false
            autoTorchUsed = false
            clearAfterPdf = false
            clearSwitch.isChecked = false
            sharpenSlider.value = 50f
            contrastSlider.value = 50f
            splitSwitch.isChecked = false
            burstSwitch.isChecked = true
            autoTorchSwitch.isChecked = false
            fitChips.check(R.id.fitA4)
            chips.check(R.id.resAuto)
        }
        view.findViewById<View>(R.id.doneBtn).setOnClickListener { dialog.dismiss() }
        view.findViewById<View>(R.id.exportBtn).setOnClickListener {
            dialog.dismiss()
            exportPagesAsImages()
        }
        // 无论怎么关闭面板（完成/点外部/返回键），都应用并保存当前值
        dialog.setOnDismissListener {
            Quality.applyOverride(resOverride)
            syncAnalysis()
            saveSettings()
        }
        dialog.setContentView(
            view,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        )
        dialog.show()
    }

    private fun currentSettings() = AppSettings(
        sharpen = sharpen,
        contrast = contrast,
        resOverride = resOverride,
        mode = mode.name,
        clearAfterPdf = clearAfterPdf,
        auto = autoEnabled,
        burst = burstEnabled,
        autoTorch = autoTorchEnabled,
        split = splitEnabled,
        fitAuto = fitAuto,
        frame = frameEnabled,
        crop = cropEnabled,
        ocr = ocrEnabled
    )

    private fun saveSettings() {
        SettingsStore.save(this, currentSettings())
    }

    private fun modeLabel(m: EnhanceMode): String = getString(
        when (m) {
            EnhanceMode.COLOR -> R.string.mode_color
            EnhanceMode.GRAY -> R.string.mode_gray
            EnhanceMode.BW -> R.string.mode_bw
        }
    )

    private fun updateModeChips() {
        mapOf(
            binding.modeColor to EnhanceMode.COLOR,
            binding.modeGray to EnhanceMode.GRAY,
            binding.modeBw to EnhanceMode.BW
        ).forEach { (view, m) -> view.isSelected = m == mode }
    }

    /** 先按持久化页序恢复，再对账未登记文件；缩略图解码在后台完成。 */
    private fun restorePages() {
        processing = true; updateUi()
        restoreJob = lifecycleScope.launch {
            try {
                val restored = withContext(Dispatchers.IO) {
                    pageStore.load(pendingCaptureFile?.absolutePath).mapNotNull { f ->
                        Images.thumbnail(f)?.let { Page(f, it) }
                    }
                }
                pages.addAll(restored)
                pageAdapter.notifyDataSetChanged()
                if (pages.isNotEmpty()) binding.thumbStrip.scrollToPosition(pages.lastIndex)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { toast("恢复失败：${e.message}，原文件未删除") }
            finally { processing = false; updateUi() }
        }
    }

    private fun updateUi() {
        val n = pages.size
        binding.pdfBtn.text = getString(R.string.make_pdf_count, n)
        binding.pdfBtn.isEnabled = n > 0 && !busy
        binding.clearBtn.isEnabled = n > 0 && !busy
        binding.importBtn.isEnabled = !busy
        binding.shutterBtn.isEnabled = !busy
        binding.postBtn.isEnabled = !busy
        listOf(binding.modeColor, binding.modeGray, binding.modeBw,
            binding.ocrChip, binding.correctChip, binding.autoChip).forEach { it.isEnabled = !busy }
        binding.clearBtn.visibility = if (n > 0) View.VISIBLE else View.GONE
        binding.thumbStrip.visibility = if (n > 0) View.VISIBLE else View.INVISIBLE
        binding.hintEmpty.visibility = if (n > 0) View.GONE else View.VISIBLE
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("pendingCapture", pendingCaptureFile?.absolutePath)
        outState.putString("pendingEdit", pendingEditFile?.absolutePath)
        outState.putBoolean("previewOpen", previewOpen)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
        analysisExecutor.shutdown()
        shutterSound?.release()
    }

    companion object {
        // 取景时最近一次检测到的书页四角（供框选页作为起点）
        @Volatile var lastDetectedQuad: FloatArray? = null
        @Volatile var lastDetectedAt: Long = 0L

    }
}
