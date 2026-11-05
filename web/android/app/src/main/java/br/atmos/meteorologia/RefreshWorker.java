package br.atmos.meteorologia;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Atualização em segundo plano (a cada ~30 min): consulta a Open-Meteo para o local salvo e
 * atualiza temperatura, condição e próximas horas. Os dados vindos daqui são marcados como
 * MODELO; o veredito com radar volta a aparecer quando o app é aberto.
 */
public class RefreshWorker extends Worker {
    private static final String PERIODIC = "atmos-widget-periodic";
    private static final String ONCE = "atmos-widget-now";

    public RefreshWorker(@NonNull Context c, @NonNull WorkerParameters p) {
        super(c, p);
    }

    static Constraints net() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    static void schedule(Context c) {
        PeriodicWorkRequest r = new PeriodicWorkRequest.Builder(RefreshWorker.class, 30, TimeUnit.MINUTES).setConstraints(net()).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, r);
    }

    static void runNow(Context c) {
        OneTimeWorkRequest r = new OneTimeWorkRequest.Builder(RefreshWorker.class).setConstraints(net()).build();
        WorkManager.getInstance(c).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, r);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        JSONObject d = WidgetData.load(c);
        if (d == null || d.isNull("lat")) return Result.success();
        try {
            String url = String.format(Locale.US,
                "https://api.open-meteo.com/v1/forecast?latitude=%.3f&longitude=%.3f&timezone=auto&timeformat=unixtime"
                    + "&current=temperature_2m,apparent_temperature,weather_code,is_day"
                    + "&hourly=temperature_2m,precipitation_probability,weather_code,is_day"
                    + "&daily=temperature_2m_max,temperature_2m_min&forecast_days=2",
                d.getDouble("lat"), d.getDouble("lon"));
            JSONObject r = new JSONObject(get(url));
            JSONObject cur = r.getJSONObject("current");
            boolean day = cur.optInt("is_day", 1) == 1;
            int code = cur.optInt("weather_code", 3);
            long now = System.currentTimeMillis() / 1000;
            long appAge = now - d.optLong("appUpdatedAt", 0);

            d.put("temp", cur.getDouble("temperature_2m"));
            d.put("feels", cur.getDouble("apparent_temperature"));
            d.put("tz", r.optString("timezone", d.optString("tz")));
            // A condição observada pelo radar (do app) vale por 45 min; depois, a do modelo
            if (appAge > 45 * 60) {
                d.put("icon", WidgetData.iconFor(code, day));
                d.put("condition", WidgetData.labelFor(code));
                d.put("kind", "MODELO · ATUALIZAÇÃO AUTOMÁTICA");
            }
            JSONObject daily = r.getJSONObject("daily");
            d.put("tmax", daily.getJSONArray("temperature_2m_max").getDouble(0));
            d.put("tmin", daily.getJSONArray("temperature_2m_min").getDouble(0));

            JSONObject h = r.getJSONObject("hourly");
            JSONArray t = h.getJSONArray("time");
            SimpleDateFormat fmt = new SimpleDateFormat("HH'h'", Locale.US);
            fmt.setTimeZone(TimeZone.getTimeZone(d.optString("tz")));
            JSONArray hours = new JSONArray();
            int maxP = -1;
            String maxAt = null;
            for (int i = 0; i < t.length() && hours.length() < 4; i++) {
                long ts = t.getLong(i);
                if (ts <= now) continue;
                if ((ts / 3600) % 2 != 0 && hours.length() > 0) continue; // passos de 2 h
                JSONObject o = new JSONObject();
                o.put("label", fmt.format(new Date(ts * 1000)));
                o.put("temp", h.getJSONArray("temperature_2m").optDouble(i));
                Object p = h.getJSONArray("precipitation_probability").opt(i);
                o.put("p", p instanceof Number ? p : JSONObject.NULL);
                o.put("icon", WidgetData.iconFor(h.getJSONArray("weather_code").optInt(i, 3), h.getJSONArray("is_day").optInt(i, 1) == 1));
                if (p instanceof Number && ((Number) p).intValue() > maxP) {
                    maxP = ((Number) p).intValue();
                    maxAt = o.getString("label");
                }
                hours.put(o);
            }
            d.put("hours", hours);
            if (appAge > 90 * 60 && maxP >= 0) {
                d.put("verdict", maxP >= 50 ? "Chance de chuva de até " + maxP + "% (por volta das " + maxAt + "). Abra o app para ver o radar."
                    : maxP >= 20 ? "Pequena chance de chuva nas próximas horas (até " + maxP + "%)." : "Sem chuva prevista nas próximas horas (modelo).");
            }
            d.put("updatedAt", now);
            WidgetData.save(c, d.toString());
            AtmosWidget.refreshAll(c);
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    private static String get(String u) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(u).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(15000);
        con.setRequestProperty("User-Agent", "ATMOS-Weather/0.3 (Android widget)");
        if (con.getResponseCode() != 200) throw new Exception("HTTP " + con.getResponseCode());
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(con.getInputStream(), "UTF-8"))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }
}
