package br.atmos.meteorologia;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Recebe do app o resumo já calculado pelo motor ATMOS e redesenha os widgets. */
@CapacitorPlugin(name = "AtmosWidget")
public class AtmosWidgetPlugin extends Plugin {
    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("sem dados");
            return;
        }
        WidgetData.save(getContext(), data);
        AtmosWidget.refreshAll(getContext());
        call.resolve();
    }
}
