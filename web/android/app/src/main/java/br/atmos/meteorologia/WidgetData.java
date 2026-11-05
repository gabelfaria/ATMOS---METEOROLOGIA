package br.atmos.meteorologia;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;

/** Resumo exibido no widget (JSON salvo em SharedPreferences). */
final class WidgetData {
    private static final String PREFS = "atmos_widget";
    private static final String KEY = "data";

    static void save(Context c, String json) {
        prefs(c).edit().putString(KEY, json).apply();
    }

    static JSONObject load(Context c) {
        try {
            String s = prefs(c).getString(KEY, null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Códigos WMO → ícone (mesmo conjunto do app). */
    static String iconFor(int code, boolean day) {
        if (code == 0 || code == 1) return day ? "clear" : "night";
        if (code == 2) return day ? "partly" : "partly_night";
        if (code == 3) return "cloudy";
        if (code == 45 || code == 48) return "fog";
        if (code >= 95) return "storm";
        if (code == 65 || code == 67 || code == 82) return "rain_heavy";
        if (code >= 51) return "rain";
        return "cloudy";
    }

    static String labelFor(int code) {
        switch (code) {
            case 0: return "Céu limpo";
            case 1: return "Predomínio de sol";
            case 2: return "Parcialmente nublado";
            case 3: return "Nublado";
            case 45: case 48: return "Nevoeiro";
            case 51: case 53: case 55: return "Garoa";
            case 61: case 80: return "Chuva fraca";
            case 63: case 81: return "Chuva moderada";
            case 65: case 82: return "Chuva forte";
            case 95: return "Trovoada";
            case 96: case 99: return "Trovoada com granizo";
            default: return code > 50 ? "Chuva" : "—";
        }
    }

    private WidgetData() {}
}
