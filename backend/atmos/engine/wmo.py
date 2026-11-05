"""Códigos de tempo WMO (usados pela Open-Meteo) → rótulos em português e ícones."""

WMO_PT = {
    0: ("Céu limpo", "clear"),
    1: ("Predomínio de sol", "mostly_clear"),
    2: ("Parcialmente nublado", "partly_cloudy"),
    3: ("Nublado", "cloudy"),
    45: ("Nevoeiro", "fog"),
    48: ("Nevoeiro com geada", "fog"),
    51: ("Garoa fraca", "drizzle"),
    53: ("Garoa", "drizzle"),
    55: ("Garoa forte", "drizzle"),
    56: ("Garoa congelante", "drizzle"),
    57: ("Garoa congelante forte", "drizzle"),
    61: ("Chuva fraca", "rain_light"),
    63: ("Chuva moderada", "rain"),
    65: ("Chuva forte", "rain_heavy"),
    66: ("Chuva congelante", "rain"),
    67: ("Chuva congelante forte", "rain_heavy"),
    71: ("Neve fraca", "snow"),
    73: ("Neve", "snow"),
    75: ("Neve forte", "snow"),
    77: ("Grãos de neve", "snow"),
    80: ("Pancadas fracas", "rain_light"),
    81: ("Pancadas de chuva", "rain"),
    82: ("Pancadas fortes", "rain_heavy"),
    85: ("Pancadas de neve", "snow"),
    86: ("Pancadas fortes de neve", "snow"),
    95: ("Trovoada", "storm"),
    96: ("Trovoada com granizo", "storm"),
    99: ("Trovoada com granizo forte", "storm"),
}


def label(code: int | None) -> str | None:
    if code is None:
        return None
    return WMO_PT.get(int(code), (f"Código {code}", "unknown"))[0]


def icon(code: int | None) -> str:
    if code is None:
        return "unknown"
    return WMO_PT.get(int(code), ("", "unknown"))[1]


def condition_from_consensus(cloud: float | None, precip_3h: float | None, cape: float | None) -> tuple[str, str]:
    """Condição derivada do consenso (não de um único modelo)."""
    if precip_3h is not None and precip_3h >= 0.5:
        rate = precip_3h / 3
        if cape is not None and cape >= 1000 and rate >= 2.5:
            return "Chuva com possível trovoada", "storm"
        if rate < 2.5:
            return "Chuva fraca", "rain_light"
        if rate < 10:
            return "Chuva moderada", "rain"
        return "Chuva forte", "rain_heavy"
    if cloud is None:
        return "—", "unknown"
    if cloud < 20:
        return "Céu limpo", "clear"
    if cloud < 50:
        return "Predomínio de sol", "mostly_clear"
    if cloud < 85:
        return "Parcialmente nublado", "partly_cloudy"
    return "Nublado", "cloudy"
