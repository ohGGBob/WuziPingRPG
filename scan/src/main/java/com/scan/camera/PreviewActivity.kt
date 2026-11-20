package com.scan.camera

import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** 分页检查、增强效果比较及页面编辑入口。编辑操作由主界面统一提交到页面存储。 */
class PreviewActivity : AppCompatActivity() {
    private lateinit var paths: List<String>
    private lateinit var pager: ViewPager2
    private var effect = 0
    private var revision = 0
    private val settings by lazy { SettingsStore.load(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_preview)
        paths = intent.getStringArrayListExtra(EXTRA_PATHS) ?: emptyList()
        if (paths.isEmpty()) return finish()
        pager = findViewById(R.id.previewPager)
        val title = findViewById<TextView>(R.id.previewTitle)
        effect = savedInstanceState?.getInt("effect") ?: when (settings.mode) {
            "GRAY" -> 1
            "BW" -> 2
            else -> 0
        }
        pager.adapter = object : RecyclerView.Adapter<PageVH>() {
            override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PageVH =
                PageVH(ZoomImageView(parent.context).apply {
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    contentDescription = "双指放大检查页面，双击复位，左右滑动切页"
                })
            override fun getItemCount() = paths.size
            override fun onBindViewHolder(holder: PageVH, position: Int) {
                holder.job?.cancel()
                holder.image.setImage(null)
                holder.bitmap?.recycle(); holder.bitmap = null
                val requestRevision = revision
                val selected = effect
                holder.job = lifecycleScope.launch {
                    var loaded: Bitmap? = null
                    try {
                        // 不使用会在返回时丢弃 Bitmap 的可取消 withContext：由 finally 管理释放。
                        withContext(Dispatchers.IO) {
                            loaded = ImagePipeline.processed(File(paths[position]), modeFor(selected), settings, 2400)
                        }
                        if (holder.bindingAdapterPosition == position && requestRevision == revision) {
                            holder.bitmap = loaded
                            holder.image.setImage(loaded)
                            loaded = null
                        }
                    } catch (e: CancellationException) { throw e }
                    catch (_: OutOfMemoryError) {
                        Toast.makeText(this@PreviewActivity, "内存不足，尝试切换原色预览", Toast.LENGTH_SHORT).show()
                    } catch (e: Exception) {
                        Toast.makeText(this@PreviewActivity, "预览失败：${e.message}", Toast.LENGTH_SHORT).show()
                    } finally { loaded?.recycle() }
                }
            }
            override fun onViewRecycled(holder: PageVH) {
                holder.job?.cancel(); holder.image.setImage(null)
                holder.bitmap?.recycle(); holder.bitmap = null
            }
        }
        val spinner = findViewById<Spinner>(R.id.previewMode)
        spinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item,
            arrayOf("原色预览", "灰度预览", "黑白预览"))
        spinner.setSelection(effect)
        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (position != effect) {
                    effect = position; revision++
                    pager.adapter?.notifyItemRangeChanged(0, paths.size)
                }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
        pager.setCurrentItem((savedInstanceState?.getInt("index") ?: intent.getIntExtra(EXTRA_INDEX, 0))
            .coerceIn(0, paths.lastIndex), false)
        pager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) { title.text = getString(R.string.page_of, position+1, paths.size) }
        })
        title.text = getString(R.string.page_of, pager.currentItem+1, paths.size)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = result("close")
        })
        findViewById<View>(R.id.closeBtn).setOnClickListener { result("close") }
        findViewById<View>(R.id.editCropBtn).setOnClickListener { result("crop") }
        findViewById<View>(R.id.editRotateBtn).setOnClickListener { result("rotate") }
        findViewById<View>(R.id.editRestoreBtn).setOnClickListener {
            AlertDialog.Builder(this).setTitle("还原页面")
                .setMessage("还原到保留的原始照片，撤销这页的裁边和旋转？")
                .setPositiveButton("还原") { _, _ -> result("restore") }.setNegativeButton("取消", null).show()
        }
        findViewById<View>(R.id.deleteBtn).setOnClickListener {
            AlertDialog.Builder(this).setTitle("删除此页")
                .setMessage("页面会移入回收站，48 小时内可恢复。")
                .setPositiveButton("删除") { _, _ -> result("delete") }.setNegativeButton("取消", null).show()
        }
    }
    private fun result(action: String) {
        val path = paths[pager.currentItem]
        setResult(RESULT_OK, Intent().putExtra(EXTRA_PATH, path)
            .putExtra("modulePath", path)
            .putExtra("moduleTitle", java.io.File(path).name)
            .putExtra("moduleSize", java.io.File(path).length())
            .putExtra("modulePages", paths.size)
            .putExtra(EXTRA_INDEX, pager.currentItem).putExtra(EXTRA_ACTION, action)
            .putExtra(EXTRA_PREVIEW_MODE, modeFor(effect).name))
        finish()
    }

    private fun modeFor(effect: Int): EnhanceMode = when (effect) {
        1 -> EnhanceMode.GRAY
        2 -> EnhanceMode.BW
        else -> EnhanceMode.COLOR
    }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt("effect", effect); outState.putInt("index", pager.currentItem)
        super.onSaveInstanceState(outState)
    }
    private class PageVH(val image: ZoomImageView) : RecyclerView.ViewHolder(image) {
        var job: Job? = null
        var bitmap: Bitmap? = null
    }
    companion object {
        const val EXTRA_PATHS = "paths"
        const val EXTRA_PATH = "path"
        const val EXTRA_ACTION = "action"
        const val EXTRA_INDEX = "index"
        const val EXTRA_PREVIEW_MODE = "previewMode"
    }
}
