// scripts/fetch-api-football-fixtures.mjs
import fs from "node:fs";

const API_KEY = process.env.API_FOOTBALL_KEY;
if (!API_KEY) {
  console.error("Missing API_FOOTBALL_KEY env var");
  process.exit(1);
}

// API-Football v3 base (fixtures endpoint lives here)
const BASE = "https://v3.football.api-sports.io"; // fixtures base URI 3

async function api(path, params = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-apisports-key": API_KEY, // required header 4
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function getLiverpoolTeamId() {
  // Find team id once (we’ll save it too)
  const data = await api("/teams", { search: "Liverpool" });
  const teams = data?.response ?? [];
  const lfc = teams.find(t => t?.team?.name === "Liverpool" && t?.team?.country === "England")
            ?? teams[0];

  if (!lfc?.team?.id) throw new Error("Could not find Liverpool team id");
  return lfc.team.id;
}

function inferSeasonStartYear(now = new Date()) {
  // Football seasons typically start mid-year; adjust as needed
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-12
  return (m >= 7) ? y : (y - 1);
}

async function main() {
  const teamId = await getLiverpoolTeamId();
  const season = inferSeasonStartYear(); // e.g. 2025 for 2025/26

  // Fixtures endpoint supports team+season, plus timezone / from / to etc. 5
  const fixtures = await api("/fixtures", {
    team: teamId,
    season,
    timezone: "Europe/London",
  });

  // Keep payload slim for your app
  const out = (fixtures.response ?? []).map(f => ({
    fixtureId: f.fixture?.id,
    dateUtc: f.fixture?.date,
    timestamp: f.fixture?.timestamp,
    status: f.fixture?.status?.short,
    venue: f.fixture?.venue?.name,
    competition: f.league?.name,
    round: f.league?.round,
    home: f.teams?.home?.name,
    away: f.teams?.away?.name,
    homeGoals: f.goals?.home,
    awayGoals: f.goals?.away,
    score: f.score?.fulltime,
  }));

  fs.mkdirSync("public/data", { recursive: true });
  fs.writeFileSync("public/data/lfc-fixtures.json", JSON.stringify({
    generatedAt: new Date().toISOString(),
    teamId,
    season,
    count: out.length,
    fixtures: out
  }, null, 2));

  console.log(`Saved ${out.length} fixtures to public/data/lfc-fixtures.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});