/**
 * Tek serili günlük çubuk grafik (sunucuda çizilir, bağımlılıksız).
 * Tasarım: ince çubuklar, tabana oturan 4 px yuvarlatılmış uç, çubuklar arası boşluk, sessiz ızgara;
 * seri tek olduğu için gösterge yok (başlık seriyi adlandırır). Üzerine gelince tarih + değer (geniş isabet alanı),
 * en yüksek ve son değer doğrudan etiketli; aynı veri açılır tablo olarak da sunulur.
 */
export interface BarPoint {
  day: string; // YYYY-MM-DD
  value: number;
}

const W = 560;
const H = 160;
const PAD = { top: 18, right: 8, bottom: 22, left: 30 };

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

const dm = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}`;
};

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const ml = (iso: string) => {
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
};

export function DailyBarChart({ title, unit, data, format = "day", lastIsToday = true }: { title: string; unit: string; data: BarPoint[]; format?: "day" | "month"; lastIsToday?: boolean }) {
  const label = format === "month" ? ml : dm;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const slot = iw / Math.max(1, data.length);
  const bw = Math.max(4, Math.min(22, slot - 6));
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const peak = data.reduce((a, b, i) => (b.value > data[a].value ? i : a), 0);
  const last = data.length - 1;
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-xs text-muted tabular-nums">toplam {total.toLocaleString("tr-TR")} {unit}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}: ${data.length} gün, toplam ${total} ${unit}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-line)" strokeWidth={1} strokeDasharray={f === 0 ? undefined : "2 4"} />
            <text x={PAD.left - 6} y={y(max * f) + 3} textAnchor="end" fontSize={10} fill="var(--color-muted)" className="tabular-nums">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * ih);
          const top = PAD.top + ih - h;
          const r = Math.min(4, bw / 2, h);
          const path =
            h === 0
              ? ""
              : `M${cx - bw / 2},${PAD.top + ih} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${PAD.top + ih} Z`;
          const labeled = (i === peak && d.value > 0) || i === last;
          return (
            <g key={d.day} className="group">
              <title>{`${label(d.day)}: ${d.value.toLocaleString("tr-TR")} ${unit}`}</title>
              {/* geniş isabet alanı */}
              <rect x={cx - slot / 2} y={PAD.top} width={slot} height={ih} fill="transparent" />
              <rect x={cx - slot / 2 + 1} y={PAD.top} width={slot - 2} height={ih} rx={4} className="fill-transparent group-hover:fill-[rgb(160_122_28/0.10)]" />
              {/* tek seri, tek renk (#a07a1c: açık zeminlerde ≥ 3:1, doğrulayıcıdan geçti); "bugün" etiketle ayrılır */}
              {path && <path d={path} fill="#a07a1c" />}
              {labeled && (
                <text x={cx} y={top - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-text)" className="tabular-nums">
                  {d.value.toLocaleString("tr-TR")}
                </text>
              )}
              {(i % Math.ceil(data.length / 7) === 0 || i === last) && (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
                  {i === last && format === "day" && lastIsToday ? "bugün" : label(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted hover:text-ink">Tablo olarak göster</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead>
            <tr className="text-muted"><th scope="col" className="py-1">Gün</th><th scope="col">{unit}</th></tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day} className="border-t border-line"><td className="py-1">{d.day}</td><td>{d.value}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
