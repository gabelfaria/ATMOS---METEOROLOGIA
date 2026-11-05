# Arquitetura

```
PWA (web/)                         Backend (backend/atmos/)
───────────                         ─────────────────────────────────────────────
GPS/busca ──lat,lon (~100 m)──▶   main.py (FastAPI, cache, CORS, serve o PWA)
Tela AGORA / PREVISÃO / ANÁLISE ◀─ engine/service.py  ← Weather Intelligence Engine
ALERTAS                              ├─ adapters/openmeteo.py   modelos, ensembles, previous runs, grade
MAPA (MapLibre) ◀── tiles diretos    ├─ adapters/rainviewer.py  quadros, cobertura, dBZ
  RainViewer, GIBS, OpenFreeMap      ├─ adapters/metar.py       observações
  + /api/grid, /api/alerts/geojson   ├─ adapters/inmet.py       alertas oficiais
                                     ├─ adapters/satellite.py   GOES-19 (GIBS)
                                     ├─ nowcast/radar.py        0–2 h
                                     ├─ engine/consensus.py     pesos, consenso, ensembles
                                     ├─ engine/verdict.py       texto determinístico
                                     ├─ engine/alerts.py        avisos estimados
                                     └─ audit/                  SQLite + verificação
```

## Fluxo do motor (`engine/service.py`)

1. Recebe lat/lon (arredondados a 0,001°).
2. Consulta em paralelo: multimodelo, condição atual, ensemble horário e diário, nowcast, METAR, INMET, auditoria.
   Cada chamada é isolada (`_safe`): uma falha vira um item `status: error` em `sources`, nunca derruba a resposta.
3. Valida idade: observação só conta se ≤25 km e ≤90 min; radar com quadro >40 min → confiança baixa.
4. Normaliza: epoch UTC, °C, mm, km/h, hPa, visibilidade em km; fuso da localização enviado ao cliente.
5. Pesos por modelo = resolução (1,0 ≤13 km; 0,85 ≤16 km; 0,65 acima) × 1/(nº de modelos da mesma família) ×
   desempenho local (EAM de referência ÷ EAM do modelo, limitado a 0,5–1,5, só com n ≥ 48 h).
6. Consenso horário = **mediana ponderada**; faixa = mín/máx entre modelos; dispersão = desvio ponderado.
7. Chuva em blocos de 3 h: mediana dos modelos, fração do peso que prevê chuva (concordância) e, separadamente,
   probabilidade = fração de membros ≥0,5 / ≥7,5 / ≥30 mm em 3 h, média entre os 3 sistemas.
8. Observações locais confirmam/contradizem o radar (reduzem a confiança se houver conflito a ≤15 km).
9. Veredito por regras: alerta oficial → chuva no ponto → chegada calculada → chuva próxima → sem ecos → modelos.
10. Persistência: uma emissão por célula de 0,1° por hora (temperatura consolidada e probabilidade de 3 h).

## Nowcasting (`nowcast/radar.py`)

- Quadro centrado no ponto (512 px no zoom 6 ≈ 1,1 km/px, raio ≈ 290 km), dBZ pela tabela oficial de cores.
- Movimento: correlação de fase (FFT com janela de Hann, subpixel parabólico) entre pares consecutivos dos
  últimos 7 quadros; rejeita quadros repetidos, poucos ecos, picos fracos ou velocidades >200 km/h; mediana.
- Extrapolação semi-Lagrangiana por translação, 10 a 120 min em passos de 10 min.
- Chegada central e janela (velocidade ×1,25 / ×0,75), descontando a idade do último quadro.
- Confiança: no máximo "moderada"; "baixa" se o movimento for inconsistente, a chegada for >60 min, a
  cobertura for parcial ou o dado for antigo. Sem ecos → afirma "sem chuva no radar" e avisa que o radar não
  antecipa células novas.

## Confiança

| Horizonte | Alta | Moderada | Baixa |
|---|---|---|---|
| 0–2 h (radar) | — (extrapolação nunca é "alta") | movimento consistente, chegada ≤60 min | inconsistente, dado antigo, cobertura parcial |
| 2–48 h | ≤24 h, modelos próximos, ensembles concordantes | cada fator de divergência rebaixa um nível | — |
| 3–16 d | só até 2 dias | até 7 dias | após 7 dias, ou faixa P10–P90 >5 °C, ou sistemas divergentes |

## Auditoria (`audit/verify.py`)

- Estação METAR mais próxima (≤60 km); 120 h de observações.
- Previous Runs: previsões emitidas 1 e 2 dias antes, no ponto da estação.
- Temperatura: EAM e viés por modelo e prazo. Chuva: blocos de 3 h, METAR com precipitação × modelo ≥0,5 mm →
  acertos, falsos alarmes, não previstos, POD, FAR, CSI.
- "Melhor modelo" só com n ≥ 72 h e margem ≥0,3 °C; caso contrário a tela diz que não há evidência suficiente.
- Previsões do próprio ATMOS: EAM por prazo e Brier Score (com skill contra a climatologia da amostra).

## Privacidade

Coordenadas arredondadas a ~100 m no cliente; o servidor armazena apenas células de ~11 km sem identificador de
usuário; `DELETE /api/privacy?lat&lon` e o botão "Apagar meus dados" removem o histórico da célula e o armazenamento
local.
