# Fontes, acesso verificado e riscos

Verificação feita em 05/11/2026 a partir do servidor de desenvolvimento.

| Fonte | Verificação | Uso no ATMOS |
|---|---|---|
| Open-Meteo Forecast | 200 OK; modelos `ecmwf_ifs`, `gfs_seamless`, `icon_seamless`, `ukmo_seamless`, `meteofrance_seamless`, `gem_seamless` com dados sobre o RJ. `jma_seamless` sem rajada/probabilidade; `bom_access_global` e `ecmwf_aifs025` vazios no ponto. | Médio prazo (0–72 h) |
| Open-Meteo Ensemble | 200 OK; ECMWF ENS (51 membros), GEFS (31), ICON-EPS (40). ECMWF/GEFS têm passo de 3 h (a série horária repete o valor 3×). | Probabilidades e longo prazo |
| Open-Meteo Previous Runs | 200 OK; `_previous_day1/2` para 5 modelos. | Auditoria imediata |
| Open-Meteo `minutely_15` | Disponível, mas **interpolado de dados horários no Brasil**. | **Não usado** |
| RainViewer | 200 OK; 13 quadros passados (10 min), `nowcast: []`, zoom máx. 7, só esquema de cores 2, máscara de cobertura. | Radar, nowcasting |
| aviationweather.gov (METAR) | 200 OK, CORS; SBRJ, SBGL, SBSC no entorno; histórico de até 5 dias. | Observação local e verificação |
| INMET avisos (`apiprevmet3.inmet.gov.br/avisos/ativos`) | 200 OK, CORS, polígonos GeoJSON. | Alertas oficiais |
| NASA GIBS (GOES-East = GOES-19) | 200 OK; bandas 2 (visível), 13 (IR), GeoColor; DescribeDomains lista horários reais (com lacunas). | Satélite no mapa |
| OpenFreeMap | 200 OK; estilos `positron` e `dark`. | Mapa-base sem chave |
| Nominatim | 200 OK (1 req/s, UA identificável). | Endereços/bairros, reverso |
| INPE `data.inpe.br/dados/goes` | Página HTML de diretório, sem STAC/WMTS documentado. | Futuro |
| INEA alerta de cheias | Sem resposta (timeout). | Bloqueado |
| Cemaden mapa interativo | HTML; dados exigem token. | Bloqueado |
| INMET `apitempo` (estações) | Sem resposta útil sem token. | Bloqueado |

## Riscos

1. **Cota da Open-Meteo.** O plano gratuito é para uso não comercial (~10 mil chamadas/dia por IP; cada modelo,
   cada ponto da grade do mapa e cada bloco de >10 variáveis contam). Em ambiente com IP compartilhado já
   recebemos HTTP 429. Mitigações: cache por 30 min a 3 h, determinísticos limitados a 3 dias, grade do mapa com
   7×7 pontos ancorada em 0,5°, fallback para cópia em cache com idade exibida, e `OPEN_METEO_API_KEY` para o
   plano comercial.
2. **Endpoint do INMET não é uma API formalmente documentada** (é o JSON do próprio portal). Pode mudar sem
   aviso; o adaptador é isolado e a falha aparece como "Avisos INMET · FALHA".
3. **Horário do RainViewer** é o de geração do mosaico; a cobertura no interior do Brasil é irregular. Sempre
   consultamos a máscara de cobertura antes de usar o radar.
4. **METAR representa aeroportos.** Microclimas (serra, orla) podem diferir; mostramos distância e direção.
5. **Probabilidades brutas.** Frações de membros não são calibradas para o local; isso é declarado na interface
   até que o histórico permita calibração.
