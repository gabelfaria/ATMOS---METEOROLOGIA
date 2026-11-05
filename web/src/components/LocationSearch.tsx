import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, IconButton, List, ListItemButton, ListItemText, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { geocode } from '../api/client';
import type { GeoResult } from '../api/types';
import { useLocation } from '../lib/location';

export function LocationSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setPlace, requestGps, locating, geoError } = useLocation();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await geocode(q.trim());
      setResults(r.results);
      if (!r.results.length) setErr(r.errors?.length ? `Busca indisponível: ${r.errors.join('; ')}` : 'Nenhum local encontrado.');
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (r: GeoResult) => {
    setPlace({ lat: r.lat, lon: r.lon, label: r.label, source: 'manual' });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pr: 6 }}>
        Escolher local
        <IconButton aria-label="Fechar" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          ✕
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Button
          fullWidth
          variant="contained"
          disabled={locating}
          onClick={() => {
            requestGps();
            onClose();
          }}
          sx={{ mb: 2 }}
        >
          {locating ? 'Localizando…' : 'Usar minha localização (GPS)'}
        </Button>
        {geoError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {geoError}
          </Alert>
        )}
        <form onSubmit={submit}>
          <Stack direction="row" spacing={1}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Cidade, bairro, endereço ou coordenadas"
              placeholder="Ex.: Niterói · Rua X, Botafogo · -22.9, -43.2"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Button type="submit" variant="outlined" disabled={busy}>
              {busy ? '…' : 'Buscar'}
            </Button>
          </Stack>
        </form>
        {err && (
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            {err}
          </Typography>
        )}
        {results && results.length > 0 && (
          <List dense sx={{ mt: 1 }}>
            {results.map((r, i) => (
              <ListItemButton key={i} onClick={() => pick(r)}>
                <ListItemText primary={r.label} secondary={`${r.lat.toFixed(4)}, ${r.lon.toFixed(4)} · ${r.source}`} />
              </ListItemButton>
            ))}
          </List>
        )}
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Busca por nome: Open-Meteo/GeoNames. Endereços e bairros: Nominatim © OpenStreetMap. A posição fica salva só neste aparelho.
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
