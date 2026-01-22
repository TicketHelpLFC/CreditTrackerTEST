// scripts/fetch-footballdata-lfc.mjs
import fs from "node:fs";

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!TOKEN) {
  console.error("Missing FOOTBALL_DATA_TOKEN env var");
  process.exit(1);
}

const BASE = "https://api.football-data.org/v4";
const LFC_TEAM_ID = 64; // Liverpool FC on football-data.org

async function api(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  console.log("GET", url.toString());

  const res = await fetch(url, {
    headers: { "X-Auth-Token": TOKEN }, // required auth header
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}


function seasonStartYear(now = new Date()) {
  // Football seasons typically start around July/Aug
  const m = now.getUTCMonth() + 1; // 1-12
  const y = now.getUTCFullYear();
  return m >= 7 ? y : y - 1;
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function formatLondon(utcIso) {
  const dt = new Date(utcIso);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dt);
}

async function main() {
  // Current season window: Aug 1 -> Jul 31
  const y = seasonStartYear();
  const from = new Date(Date.UTC(y, 7, 1)); // Aug 1 (month is 0-based)
  const to = new Date(Date.UTC(y + 1, 6, 31)); // Jul 31

  const data = await api(`/teams/${LFC_TEAM_ID}/matches`, {
    dateFrom: toISODate(from),
    dateTo: toISODate(to),
  });

  const fixtures = (data.matches ?? [])
    .map((m) => ({
      source: "football-data",
      matchId: m.id,
      utcDate: m.utcDate,
      londonDateTime: formatLondon(m.utcDate),
      status: m.status, // SCHEDULED / TIMED / IN_PLAY / PAUSED / FINISHED, etc.
      competition: m.competition?.name,
      competitionCode: m.competition?.code,
      stage: m.stage,
      matchday: m.matchday,
      home: m.homeTeam?.name,
      away: m.awayTeam?.name,
      homeGoals: m.score?.fullTime?.home,
      awayGoals: m.score?.fullTime?.away,
    }))
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  fs.mkdirSync("public/data", { recursive: true });
  fs.writeFileSync(
    "public/data/lfc-fixtures.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "football-data",
        seasonWindow: { from: toISODate(from), to: toISODate(to) },
        count: fixtures.length,
        fixtures,
      },
      null,
      2
    )
  );

  console.log(`Saved ${fixtures.length} matches to public/data/lfc-fixtures.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
