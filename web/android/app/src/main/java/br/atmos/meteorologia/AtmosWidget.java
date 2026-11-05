package br.atmos.meteorologia;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/** Widget ATMOS: agora, veredito, próximas horas, máx/mín e alerta oficial. */
public class AtmosWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "br.atmos.meteorologia.WIDGET_REFRESH";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
        RefreshWorker.schedule(ctx);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle opts) {
        render(ctx, mgr, id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) RefreshWorker.runNow(ctx);
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, AtmosWidget.class));
        for (int id : ids) render(ctx, mgr, id);
    }

    private static int drawable(Context ctx, String icon) {
        int r = ctx.getResources().getIdentifier("ic_w_" + icon, "drawable", ctx.getPackageName());
        return r != 0 ? r : R.drawable.ic_w_cloudy;
    }

    static void render(Context ctx, AppWidgetManager mgr, int id) {
        Bundle o = mgr.getAppWidgetOptions(id);
        int minW = o == null ? 250 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250);
        boolean wide = minW >= 220;
        RemoteViews v = new RemoteViews(ctx.getPackageName(), wide ? R.layout.widget_wide : R.layout.widget_small);

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        Intent refresh = new Intent(ctx, AtmosWidget.class).setAction(ACTION_REFRESH);
        v.setOnClickPendingIntent(R.id.refresh, PendingIntent.getBroadcast(ctx, 1, refresh, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        JSONObject d = WidgetData.load(ctx);
        if (d == null) {
            v.setTextViewText(R.id.verdict, "Abra o ATMOS e escolha um local para ativar o widget.");
            mgr.updateAppWidget(id, v);
            return;
        }
        try {
            TimeZone tz = TimeZone.getTimeZone(d.optString("tz", TimeZone.getDefault().getID()));
            SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.forLanguageTag("pt-BR"));
            hm.setTimeZone(tz);
            long upd = d.optLong("updatedAt", 0);
            long ageMin = (System.currentTimeMillis() / 1000 - upd) / 60;
            v.setTextViewText(R.id.place, d.optString("place", "ATMOS"));
            v.setTextViewText(R.id.updated, upd > 0 ? (ageMin > 90 ? "há " + (ageMin / 60) + " h" : hm.format(new Date(upd * 1000))) : "");
            v.setTextViewText(R.id.temp, d.isNull("temp") ? "--°" : Math.round(d.getDouble("temp")) + "°");
            v.setImageViewResource(R.id.icon, drawable(ctx, d.optString("icon", "cloudy")));
            v.setTextViewText(R.id.condition, d.optString("condition", ""));
            String minmax = "";
            if (!d.isNull("tmax") && !d.isNull("tmin")) minmax = "Máx " + Math.round(d.getDouble("tmax")) + "° · Mín " + Math.round(d.getDouble("tmin")) + "°";
            if (!d.isNull("feels")) minmax = (minmax.isEmpty() ? "" : minmax + " · ") + "Sens. " + Math.round(d.getDouble("feels")) + "°";
            v.setTextViewText(R.id.minmax, minmax);
            v.setTextViewText(R.id.kind, d.optString("kind", ""));
            v.setTextViewText(R.id.verdict, d.optString("verdict", ""));

            JSONObject alert = d.optJSONObject("alert");
            long now = System.currentTimeMillis() / 1000;
            if (alert != null && alert.optLong("end", Long.MAX_VALUE) > now) {
                v.setViewVisibility(R.id.alert, View.VISIBLE);
                v.setTextViewText(R.id.alert, "ALERTA INMET · " + alert.optString("title"));
            } else v.setViewVisibility(R.id.alert, View.GONE);

            if (wide) {
                JSONArray hrs = d.optJSONArray("hours");
                int[][] ids = {
                    {R.id.h1, R.id.h1_time, R.id.h1_icon, R.id.h1_temp, R.id.h1_p, R.id.h1_bar},
                    {R.id.h2, R.id.h2_time, R.id.h2_icon, R.id.h2_temp, R.id.h2_p, R.id.h2_bar},
                    {R.id.h3, R.id.h3_time, R.id.h3_icon, R.id.h3_temp, R.id.h3_p, R.id.h3_bar},
                    {R.id.h4, R.id.h4_time, R.id.h4_icon, R.id.h4_temp, R.id.h4_p, R.id.h4_bar},
                };
                for (int i = 0; i < 4; i++) {
                    JSONObject h = hrs != null && i < hrs.length() ? hrs.getJSONObject(i) : null;
                    if (h == null) {
                        v.setViewVisibility(ids[i][0], View.INVISIBLE);
                        continue;
                    }
                    v.setViewVisibility(ids[i][0], View.VISIBLE);
                    v.setTextViewText(ids[i][1], h.optString("label"));
                    v.setImageViewResource(ids[i][2], drawable(ctx, h.optString("icon", "cloudy")));
                    v.setTextViewText(ids[i][3], h.isNull("temp") ? "--" : Math.round(h.getDouble("temp")) + "°");
                    int p = h.isNull("p") ? -1 : (int) Math.round(h.getDouble("p"));
                    v.setTextViewText(ids[i][4], p < 0 ? "—" : p + "%");
                    v.setProgressBar(ids[i][5], 100, Math.max(p, 0), false);
                }
            }
        } catch (Exception e) {
            v.setTextViewText(R.id.verdict, "Abra o ATMOS para atualizar.");
        }
        mgr.updateAppWidget(id, v);
    }
}
