import fs from "node:fs";

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!TOKEN) {
  console.error("Missing FOOTBALL_DATA_TOKEN env var");
  process.exit(1);
}

const BASE = "https://api.football-data.org/v4";

async function api(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    headers: { "X-Auth-Token": TOKEN }, // football-data auth header :contentReference[oaicite:4]{index=4}
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// Liverpool team id is 64 on football-data.org (we can also discover via /teams?name=... if you prefer)
const LFC_TEAM_ID = 64;

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 370);
  const to   = new Date(now); to.setDate(to.getDate() + 370);

  // Team matches subresource supports dateFrom/dateTo :contentReference[oaicite:5]{index=5}
  const data = await api(`/teams/${LFC_TEAM_ID}/matches`, {
    dateFrom: toISODate(from),
    dateTo: toISODate(to),
  });

  const matches = (data.matches ?? []).map(m => ({
    source: "football-data",
    matchId: m.id,
    utcDate: m.utcDate,
    status: m.status,                // SCHEDULED / FINISHED etc.
    competition: m.competition?.name,
    competitionCode: m.competition?.code,
    home: m.homeTeam?.name,
    away: m.awayTeam?.name,
    homeGoals: m.score?.fullTime?.home,
    awayGoals: m.score?.fullTime?.away,
    matchday: m.matchday,
    stage: m.stage,
  }));

  fs.mkdirSync("public/data", { recursive: true });
  fs.writeFileSync(
    "public/data/lfc-fixtures.json",
    JSON.stringify(
      { generatedAt: new Date().toISOString(), source: "football-data", count: matches.length, fixtures: matches },
      null,
      2
    )
  );

  console.log(`Saved ${matches.length} matches to public/data/lfc-fixtures.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
