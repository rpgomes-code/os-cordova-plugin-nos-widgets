package com.nos.widgets.glance

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.nos.widgets.action.RefreshAction
import com.nos.widgets.store.WidgetStore
import org.json.JSONObject

/**
 * The widget UI — 100% Kotlin/Compose via Jetpack Glance (no RemoteViews / layout XML).
 *
 * Renders one of two states from the shared store:
 *  - logged out  -> a "please log in" prompt (tap opens the app)
 *  - logged in   -> the pushed/fetched title + a refresh button (runs in background)
 */
class NosWidget : GlanceAppWidget() {

    companion object {
        /**
         * Update every placed instance by resolving appWidgetIds directly from
         * AppWidgetManager. Unlike GlanceAppWidget.updateAll(), this does NOT depend on
         * Glance's provider→receiver mapping, which is empty right after (re)install until
         * the receiver's onUpdate has run — the cause of "updateAll OK but no re-render".
         */
        suspend fun updateAllWidgets(context: Context) {
            val manager = GlanceAppWidgetManager(context)
            val appWidgetIds = AppWidgetManager.getInstance(context)
                .getAppWidgetIds(ComponentName(context, NosWidgetReceiver::class.java))
            android.util.Log.d("NosWidget", "updateAllWidgets ids=${appWidgetIds.size}")
            val widget = NosWidget()
            appWidgetIds.forEach { appWidgetId ->
                widget.update(context, manager.getGlanceIdBy(appWidgetId))
            }
        }
    }

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val loggedIn = WidgetStore.isLoggedIn(context)
        val title = parseTitle(WidgetStore.payload(context))
        android.util.Log.d("NosWidget", "provideGlance loggedIn=$loggedIn title='$title'")
        val launchComponent = context.packageManager
            .getLaunchIntentForPackage(context.packageName)?.component

        provideContent {
            WidgetContent(loggedIn, title, launchComponent)
        }
    }

    private fun parseTitle(payload: String): String = try {
        JSONObject(payload).optString("title", "")
    } catch (e: Exception) {
        ""
    }

    @Composable
    private fun WidgetContent(loggedIn: Boolean, title: String, launch: ComponentName?) {
        val openApp = if (launch != null) {
            GlanceModifier.clickable(actionStartActivity(launch))
        } else {
            GlanceModifier
        }

        Box(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(Color(0xFFFFFFFF))
                .padding(12.dp)
                .then(openApp),
            contentAlignment = Alignment.Center
        ) {
            if (!loggedIn) {
                Text(
                    text = "Por favor faça login na App",
                    style = TextStyle(color = ColorProvider(Color(0xFF222222)), fontSize = 16.sp)
                )
            } else {
                Column(modifier = GlanceModifier.fillMaxSize()) {
                    Row(
                        modifier = GlanceModifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.End
                    ) {
                        Text(
                            text = "⟳",
                            modifier = GlanceModifier.clickable(actionRunCallback<RefreshAction>()),
                            style = TextStyle(color = ColorProvider(Color(0xFF0066CC)), fontSize = 20.sp)
                        )
                    }
                    Box(modifier = GlanceModifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            text = title.ifEmpty { "Sem dados" },
                            style = TextStyle(
                                color = ColorProvider(Color(0xFF111111)),
                                fontSize = 20.sp,
                                fontWeight = FontWeight.Bold
                            )
                        )
                    }
                }
            }
        }
    }
}
