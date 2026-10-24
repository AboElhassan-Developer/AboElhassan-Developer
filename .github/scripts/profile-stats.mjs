// Builds the "GitHub Activity" cards (dark + light) from the GitHub GraphQL API.
// Usage: GITHUB_TOKEN=... GH_USER=... node .github/scripts/profile-stats.mjs <outDir>

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SANS = "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'JetBrains Mono', 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace";

export const THEMES = {
  dark: {
    bg1: '#0f1320', bg2: '#141030', border: '#2a2f45', tile: '#161b2b', tileBorder: '#262c44',
    text: '#e6edf3', muted: '#8b949e', grid: '#232a3d',
    g1: '#b5a4ff', g2: '#7c5cff', g3: '#ff7aa8', line: '#9b87ff', area: '#7c5cff', flame: '#ff7aa8',
  },
  light: {
    bg1: '#ffffff', bg2: '#f5f2ff', border: '#d8d2f0', tile: '#ffffff', tileBorder: '#e4def7',
    text: '#1f2328', muted: '#59636e', grid: '#ece8f8',
    g1: '#512bd4', g2: '#7c5cff', g3: '#d6336c', line: '#6a4cf0', area: '#7c5cff', flame: '#d6336c',
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n).toLocaleString('en-US');

async function gql(query, variables, token) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-stats' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

export async function collect(login, token) {
  const { user } = await gql(
    `query($login: String!) {
      user(login: $login) {
        createdAt
        repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
          totalCount
          nodes { stargazerCount primaryLanguage { name color } }
        }
      }
    }`,
    { login },
    token,
  );

  const now = new Date();
  const days = [];
  for (let year = new Date(user.createdAt).getUTCFullYear(); year <= now.getUTCFullYear(); year++) {
    const from = new Date(Date.UTC(year, 0, 1)).toISOString();
    const to = year === now.getUTCFullYear() ? now.toISOString() : new Date(Date.UTC(year, 11, 31, 23, 59, 59)).toISOString();
    const data = await gql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar { weeks { contributionDays { date contributionCount } } }
          }
        }
      }`,
      { login, from, to },
      token,
    );
    for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
      for (const d of week.contributionDays) days.push({ date: d.date, count: d.contributionCount });
    }
  }

  return {
    repoCount: user.repositories.totalCount,
    repos: user.repositories.nodes.map((r) => ({ stars: r.stargazerCount, language: r.primaryLanguage })),
    days,
  };
}

export function summarize({ repoCount, repos, days }, today = new Date().toISOString().slice(0, 10)) {
  const byDate = new Map();
  for (const d of days) if (d.date <= today) byDate.set(d.date, d.count);
  const sorted = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  const total = sorted.reduce((s, [, c]) => s + c, 0);
  const year = today.slice(0, 4);
  const thisYear = sorted.filter(([d]) => d.startsWith(year)).reduce((s, [, c]) => s + c, 0);

  let longest = 0;
  let run = 0;
  for (const [, c] of sorted) {
    run = c > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  // Today may simply not have contributions yet, so the streak can start from yesterday.
  let current = 0;
  let i = sorted.length - 1;
  if (i >= 0 && sorted[i][1] === 0) i--;
  for (; i >= 0 && sorted[i][1] > 0; i--) current++;

  const last = sorted.slice(-364);
  const activeDays = last.filter(([, c]) => c > 0).length;
  const weeks = [];
  for (let w = 0; w < last.length; w += 7) weeks.push(last.slice(w, w + 7).reduce((s, [, c]) => s + c, 0));

  const langMap = new Map();
  for (const r of repos) {
    if (!r.language) continue;
    const entry = langMap.get(r.language.name) ?? { name: r.language.name, color: r.language.color || '#8b949e', count: 0 };
    entry.count++;
    langMap.set(r.language.name, entry);
  }
  const languages = [...langMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5);

  return {
    total, thisYear, current, longest, activeDays, weeks, languages,
    repoCount, stars: repos.reduce((s, r) => s + r.stars, 0),
    updated: new Date(`${today}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
  };
}

const ICONS = {
  total: 'M4 19h16M7 16V9m5 7V5m5 11v-4',
  fire: 'M12 21c-3.9 0-6-2.6-6-5.6 0-3.2 2.4-4.8 3.4-7.9.9 1.6 2.1 2.4 2.1 2.4S11.4 6.6 13.6 3c.8 3.4 4.4 5.6 4.4 10.1 0 4.6-2.6 7.9-6 7.9z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3m8-4h3v1a3 3 0 0 1-3 3m-4 3v4m-3 3h6',
  repo: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zm0 15A1.5 1.5 0 0 0 6.5 21H19',
};

export function render(s, theme) {
  const t = THEMES[theme];
  const W = 840;
  const H = 352;
  const tiles = [
    { label: 'Total contributions', value: fmt(s.total), note: `${fmt(s.thisYear)} this year`, icon: 'total' },
    s.current > 1
      ? { label: 'Current streak', value: `${fmt(s.current)} days`, note: `${fmt(s.activeDays)} active days in 12 months`, icon: 'fire' }
      : { label: 'Active days', value: fmt(s.activeDays), note: 'in the last 12 months', icon: 'fire' },
    { label: 'Longest streak', value: `${fmt(s.longest)} ${s.longest === 1 ? 'day' : 'days'}`, note: 'personal best', icon: 'trophy' },
    { label: 'Public repositories', value: fmt(s.repoCount), note: `${fmt(s.stars)} ${s.stars === 1 ? 'star' : 'stars'} earned`, icon: 'repo' },
  ];

  const tileW = (W - 48 - 3 * 14) / 4;
  const tileSvg = tiles.map((tile, i) => {
    const x = 24 + i * (tileW + 14);
    const begin = (0.15 + i * 0.12).toFixed(2);
    return `
    <g opacity="0" transform="translate(${x} 70)">
      <animate attributeName="opacity" from="0" to="1" dur="0.6s" begin="${begin}s" fill="freeze"/>
      <animateTransform attributeName="transform" type="translate" from="${x} 80" to="${x} 70" dur="0.6s" begin="${begin}s" fill="freeze"/>
      <rect width="${tileW}" height="100" rx="14" fill="${t.tile}" stroke="${t.tileBorder}"/>
      <g transform="translate(16 16)" fill="none" stroke="${tile.icon === 'fire' ? t.flame : t.line}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="${ICONS[tile.icon]}" transform="scale(0.75)">${tile.icon === 'fire' ? '<animate attributeName="opacity" values="1;0.55;1" dur="1.6s" repeatCount="indefinite"/>' : ''}</path>
      </g>
      <text x="40" y="29" font-family="${SANS}" font-size="12" fill="${t.muted}">${esc(tile.label)}</text>
      <text x="16" y="66" font-family="${SANS}" font-size="28" font-weight="700" fill="url(#num)">${esc(tile.value)}</text>
      <text x="16" y="86" font-family="${SANS}" font-size="11.5" fill="${t.muted}">${esc(tile.note)}</text>
    </g>`;
  }).join('');

  // Weekly contributions over the last 12 months.
  const cx = 24;
  const cy = 190;
  const cw = 480;
  const ch = 138;
  const px = cx + 18;
  const pw = cw - 36;
  const py = cy + 42;
  const ph = ch - 60;
  const weeks = s.weeks.length > 1 ? s.weeks : [0, 0];
  const max = Math.max(1, ...weeks);
  const pts = weeks.map((v, i) => [px + (i * pw) / (weeks.length - 1), py + ph - (v / max) * ph]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${(px + pw).toFixed(1)} ${py + ph} L${px} ${py + ph} Z`;
  const peak = pts[weeks.indexOf(max)];
  const gridLines = [0, 0.5, 1].map((f) => `<line x1="${px}" x2="${px + pw}" y1="${(py + ph * f).toFixed(1)}" y2="${(py + ph * f).toFixed(1)}" stroke="${t.grid}" stroke-dasharray="3 5"/>`).join('');

  // Languages by number of repositories.
  const lx = cx + cw + 14;
  const lw = W - 24 - lx;
  const maxLang = Math.max(1, ...s.languages.map((l) => l.count));
  const barMax = lw - 170;
  const short = (name) => (name.length > 12 ? `${name.slice(0, 11)}…` : name);
  const langSvg = s.languages.map((l, i) => {
    const y = cy + 48 + i * 18;
    const w = Math.max(6, (l.count / maxLang) * barMax);
    const begin = (0.9 + i * 0.12).toFixed(2);
    return `
      <circle cx="${lx + 22}" cy="${y - 4}" r="4.5" fill="${esc(l.color)}"/>
      <text x="${lx + 33}" y="${y}" font-family="${SANS}" font-size="12" fill="${t.text}">${esc(short(l.name))}</text>
      <rect x="${lx + 120}" y="${y - 9}" width="0" height="8" rx="4" fill="${esc(l.color)}">
        <animate attributeName="width" from="0" to="${w.toFixed(1)}" dur="0.9s" begin="${begin}s" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1"/>
      </rect>
      <text x="${lw + lx - 16}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="11.5" fill="${t.muted}">${l.count}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title">
  <title id="title">GitHub activity: ${fmt(s.total)} contributions, ${s.activeDays} active days in the last 12 months, longest streak ${s.longest} days, ${s.repoCount} public repositories</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.bg1}"/><stop offset="1" stop-color="${t.bg2}"/></linearGradient>
    <linearGradient id="num" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${t.g1}"/><stop offset="1" stop-color="${t.g3}"/></linearGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.area}" stop-opacity="0.35"/><stop offset="1" stop-color="${t.area}" stop-opacity="0"/></linearGradient>
    <linearGradient id="stroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${t.g2}"/><stop offset="1" stop-color="${t.g3}"/></linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="url(#bg)" stroke="${t.border}"/>

  <text x="24" y="42" font-family="${SANS}" font-size="17" font-weight="700" fill="${t.text}">At a glance</text>
  <text x="${W - 24}" y="42" text-anchor="end" font-family="${MONO}" font-size="11" fill="${t.muted}">updated ${esc(s.updated)}</text>
  ${tileSvg}

  <g opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.6s" begin="0.6s" fill="freeze"/>
    <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="14" fill="${t.tile}" stroke="${t.tileBorder}"/>
    <text x="${cx + 18}" y="${cy + 26}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="${t.text}">Weekly contributions</text>
    <text x="${cx + cw - 18}" y="${cy + 26}" text-anchor="end" font-family="${SANS}" font-size="11.5" fill="${t.muted}">last 12 months</text>
    ${gridLines}
    <path d="${area}" fill="url(#area)" opacity="0"><animate attributeName="opacity" from="0" to="1" dur="1s" begin="1.6s" fill="freeze"/></path>
    <path d="${line}" fill="none" stroke="url(#stroke)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" pathLength="1000" stroke-dasharray="1000" stroke-dashoffset="1000">
      <animate attributeName="stroke-dashoffset" from="1000" to="0" dur="1.8s" begin="0.8s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1"/>
    </path>
    <circle cx="${peak[0].toFixed(1)}" cy="${peak[1].toFixed(1)}" r="3.5" fill="${t.g3}" opacity="0">
      <animate attributeName="opacity" from="0" to="1" dur="0.3s" begin="2.6s" fill="freeze"/>
    </circle>
    <circle cx="${peak[0].toFixed(1)}" cy="${peak[1].toFixed(1)}" r="3.5" fill="none" stroke="${t.g3}" opacity="0">
      <animate attributeName="r" values="3.5;11" dur="2s" begin="2.6s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.8;0" dur="2s" begin="2.6s" repeatCount="indefinite"/>
    </circle>
  </g>

  <g opacity="0">
    <animate attributeName="opacity" from="0" to="1" dur="0.6s" begin="0.75s" fill="freeze"/>
    <rect x="${lx}" y="${cy}" width="${lw}" height="${ch}" rx="14" fill="${t.tile}" stroke="${t.tileBorder}"/>
    <text x="${lx + 18}" y="${cy + 26}" font-family="${SANS}" font-size="12.5" font-weight="600" fill="${t.text}">Top languages</text>
    <text x="${lx + lw - 16}" y="${cy + 26}" text-anchor="end" font-family="${SANS}" font-size="11.5" fill="${t.muted}">by repository</text>
    ${langSvg}
  </g>
</svg>
`;
}

async function main() {
  const outDir = process.argv[2] || 'dist';
  const token = process.env.GITHUB_TOKEN;
  const login = process.env.GH_USER;
  if (!token || !login) throw new Error('GITHUB_TOKEN and GH_USER are required');

  const stats = summarize(await collect(login, token));
  await mkdir(outDir, { recursive: true });
  for (const theme of Object.keys(THEMES)) {
    await writeFile(path.join(outDir, `stats-${theme}.svg`), render(stats, theme));
  }
  console.log(`Wrote stats cards to ${outDir}: ${stats.total} contributions, streak ${stats.current}/${stats.longest}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
