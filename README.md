# ATMOS — Inteligência Meteorológica Local

> "O que provavelmente vai acontecer com o tempo exatamente onde estou?"

PWA instalável (Android/desktop) com backend próprio que cruza **radar, satélite, estações, seis modelos
numéricos, três ensembles e alertas oficiais** e entrega uma previsão consolidada, com a origem, o horário e a
confiança de cada número.

```
web/       React + TypeScript + Vite + PWA · Material UI (tokens próprios) · MapLibre GL · TanStack Query
backend/   Python + FastAPI · Weather Intelligence Engine · nowcasting de radar · auditoria (SQLite)
docs/      FONTES.md (fontes, acesso, riscos) · ARQUITETURA.md (motor, regras, limitações)
```

## App Android (APK)

O APK roda o motor meteorológico **no próprio celular**, consultando as fontes diretamente — não precisa de
servidor. Para instalar: copie o `.apk` para o celular, toque nele e permita "instalar apps desta fonte".

Para gerar um novo APK (Android SDK + Java 21):

```bash
cd web && npm install && npm run build
npx cap sync android
cd android && ./gradlew assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
```

O motor do aparelho (`web/src/engine/`) é a mesma lógica do backend Python, com testes próprios
(`npm test`). A versão web continua podendo usar o backend FastAPI.

## Executar localmente

Requisitos: Python ≥ 3.11 e Node ≥ 20.

```bash
# 1. Backend (porta 8000)
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn atmos.main:app --reload --port 8000

# 2. Frontend em modo desenvolvimento (porta 5173, /api é redirecionado ao backend)
cd web
npm install
npm run dev
```

Abra http://localhost:5173, toque em **Usar minha localização** (ou busque cidade, bairro, endereço ou
`-22.9, -43.2`).

### Produção (um único serviço)

```bash
cd web && npm run build            # gera web/dist (PWA + service worker)
cd ../backend && uvicorn atmos.main:app --host 0.0.0.0 --port 8000
```

O FastAPI serve o PWA e a API no mesmo endereço. Também há um `Dockerfile` na raiz:

```bash
docker build -t atmos . && docker run -p 8000:8000 -v atmos-data:/data atmos
```

Hospedagem barata compatível: qualquer serviço que rode um contêiner (Fly.io, Render, Railway, uma VM pequena).
**A geolocalização e a instalação do PWA exigem HTTPS** (exceto em `localhost`).

### Instalar no Android

1. Abra o endereço HTTPS do app no Chrome.
2. Menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").
3. O ATMOS abre em tela cheia, com ícone próprio; a última previsão fica disponível offline, sempre com o
   horário em que foi obtida.

### Variáveis de ambiente (opcionais)

| Variável | Uso |
|---|---|
| `ATMOS_DB_PATH` | Caminho do SQLite de auditoria (padrão `backend/atmos.sqlite3`) |
| `ATMOS_STATIC_DIR` | Diretório do build do frontend (padrão `web/dist`) |
| `OPEN_METEO_API_KEY` | Chave do plano comercial Open-Meteo (fica só no servidor) |
| `ATMOS_USER_AGENT` | User-Agent identificável exigido pelo Nominatim/OSM |
| `VITE_API_BASE` | (build do frontend) URL da API se ela estiver em outro domínio |

## Testes

```bash
cd backend && . .venv/bin/activate && pip install pytest && python -m pytest -q   # 42 testes, offline
cd web && npm test && npm run typecheck                                            # 4 testes + tipos
```

Os testes do backend usam **respostas reais gravadas** das APIs (05/11/2026, Rio de Janeiro) e um
`httpx.MockTransport`; a API inteira é testada de ponta a ponta sem rede. O nowcasting é testado com campos
sintéticos de deslocamento conhecido e com um tile real do RainViewer.

## O que está funcionando

| Área | Status |
|---|---|
| Geolocalização (consentimento), busca por cidade/bairro/endereço/coordenadas, geocodificação reversa | ✅ |
| Placar AGORA · PRÓXIMA HORA · PRÓXIMAS 24H com tipo do dado (medição/modelo/estimativa/consenso) | ✅ |
| Veredito determinístico com confiança, motivo, fonte principal e horário do dado | ✅ |
| Condições atuais: METAR (medição) quando há estação ≤25 km e ≤90 min, senão modelo, sempre rotulado | ✅ |
| Nowcasting 0–2 h: radar RainViewer, cobertura verificada, correlação de fase, chegada com janela de incerteza, passo real de 10 min | ✅ |
| Médio prazo: 6 modelos (ECMWF IFS, GFS, ICON, UKMO, ARPEGE, GEM), mediana ponderada, painel MODELO · PREVISÃO · CONCORDÂNCIA | ✅ |
| Probabilidades de chuva/rajada por fração de membros (ECMWF ENS 51, GEFS 31, ICON-EPS 40) em blocos de 3 h | ✅ |
| Longo prazo 3–16 d: P10/P50/P90, chance de chuva, divergência entre sistemas, confiança decrescente | ✅ |
| Mapa: radar animado, GOES-19 visível/IR/GeoColor (NASA GIBS), campos de modelo na grade real 0,25° (nuvens, chuva, vento com setas, rajadas, temperatura, pressão), alertas INMET, estações, opacidade, legenda, linha do tempo observado × previsto, toque no mapa | ✅ |
| Alertas oficiais INMET filtrados pelo polígono; avisos estimados separados e justificados | ✅ |
| Notificações locais deduplicadas (app aberto/segundo plano recente) | ✅ |
| Auditoria: EAM/viés de temperatura e acertos/falsos alarmes/não previstos de chuva por modelo e prazo contra METAR; histórico próprio com EAM e Brier | ✅ |
| Pesos calibrados por desempenho local (amostra ≥48 h) | ✅ |
| Modo claro/escuro, navegação inferior (celular) e lateral (telas largas), pt-BR, °C/mm/km/h, fuso da localização | ✅ |
| Degradação: cada fonte falha isoladamente; cache com idade exibida; estados de erro e carregamento | ✅ |

## Depende de integração futura

| Item | Motivo |
|---|---|
| INEA-RJ (radares, pluviômetros, cheias) | Sem API documentada; portal inacessível do servidor de testes. Exige autorização formal. |
| Cemaden (pluviômetros) | Serviço de dados exige cadastro/token; não fazemos scraping do mapa interativo. |
| INMET estações automáticas | `apitempo.inmet.gov.br` exige token. (Os **avisos** do INMET já estão integrados.) |
| INPE/CPTEC GOES-19 (DSAT) | Arquivos sem serviço de tiles; requer ingestão e conversão no backend. GOES-19 já aparece via NASA GIBS. |
| Descargas elétricas | Sem fonte licenciada gratuita (GLM exige processamento; redes comerciais exigem contrato). |
| MapTiler Weather | Requer chave e plano pago; desativado para evitar custo no MVP. |
| Web Push (notificação com app fechado) | Requer servidor VAPID e armazenamento de inscrições. |
| Tendências além de 16 dias | Requer previsão sazonal/subsazonal (ex.: Open-Meteo Seasonal / ECMWF SEAS5). |
| pysteps (Lucas–Kanade denso, S-PROG) | O nowcasting atual usa translação global; a interface já está isolada para a troca. |
| Calibração das probabilidades | O Brier do próprio ATMOS é acumulado; com amostra suficiente, aplicar calibração (ex.: isotônica) por região/prazo. |

## Licenças e atribuições

Dados: Open-Meteo (CC BY 4.0) · RainViewer · NOAA Aviation Weather Center/DECEA · INMET · GOES-19 NOAA via
NASA GIBS · © OpenStreetMap contributors / OpenMapTiles via OpenFreeMap. Nenhuma marca ou elemento proprietário
de terceiros é usado na identidade visual.
