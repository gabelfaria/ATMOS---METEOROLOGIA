package br.atmos.meteorologia;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AtmosWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        // garante a atualização periódica do widget mesmo que o app não seja aberto
        RefreshWorker.schedule(this);
    }
}
