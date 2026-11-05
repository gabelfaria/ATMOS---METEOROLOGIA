// Ícones geométricos próprios (SVG inline, leves).
import { brand } from '../theme';

export function WeatherIcon({ icon, size = 40, night = false }: { icon: string; size?: number; night?: boolean }) {
  const s = size;
  const sun = night ? (
    <path d="M26 8a12 12 0 1 0 10 18A14 14 0 0 1 26 8z" fill={brand.yellow} />
  ) : (
    <g>
      <rect x="14" y="14" width="16" height="16" fill={brand.yellow} transform="rotate(45 22 22)" />
      <rect x="16" y="16" width="12" height="12" fill={brand.yellow} />
    </g>
  );
  const cloud = (fill = '#C9CBD6') => (
    <path d="M12 38h24a8 8 0 0 0 0-16 11 11 0 0 0-21-2 9 9 0 0 0-3 18z" fill={fill} />
  );
  const drops = (n: number, color = brand.blue) => (
    <g fill={color}>
      {Array.from({ length: n }).map((_, i) => (
        <rect key={i} x={14 + i * 8} y={41} width="3" height="7" transform={`skewX(-20)`} />
      ))}
    </g>
  );
  let content;
  switch (icon) {
    case 'clear':
      content = sun;
      break;
    case 'mostly_clear':
    case 'partly_cloudy':
      content = (
        <>
          <g transform="translate(6 -4)">{sun}</g>
          {cloud()}
        </>
      );
      break;
    case 'cloudy':
      content = cloud();
      break;
    case 'fog':
      content = (
        <g fill="#C9CBD6">
          <rect x="6" y="16" width="36" height="4" />
          <rect x="10" y="24" width="32" height="4" />
          <rect x="6" y="32" width="36" height="4" />
        </g>
      );
      break;
    case 'drizzle':
    case 'rain_light':
      content = (
        <>
          {cloud()}
          {drops(2)}
        </>
      );
      break;
    case 'rain':
      content = (
        <>
          {cloud('#AEB1C0')}
          {drops(3)}
        </>
      );
      break;
    case 'rain_heavy':
      content = (
        <>
          {cloud('#8F93A6')}
          {drops(4)}
        </>
      );
      break;
    case 'storm':
      content = (
        <>
          {cloud('#8F93A6')}
          <path d="M24 36l-6 10h5l-3 8 10-12h-6l4-6z" fill={brand.yellow} />
        </>
      );
      break;
    default:
      content = <rect x="12" y="20" width="24" height="6" fill="#8A8A99" />;
  }
  return (
    <svg width={s} height={s} viewBox="0 0 48 56" aria-hidden="true">
      {content}
    </svg>
  );
}
