// scripts/fetch-lfc-ics.mjs
import fs from "node:fs";
import path from "node:path";

const OUT = path.join("public", "data", "lfc-fixtures.json");

const ICS_URL = process.env.LFC_ICS_URL;
if (!ICS_URL) {
  console.error("Missing LFC_ICS_URL env var (set it as a GitHub Actions secret).");
  process.exit(1);
}

// ✅ Keep only 2025/26 season window
const FROM = "2025-08-01";
const TO = "2026-07-31";

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

function unwrapIcsText(raw) {
  // Unfold folded lines (RFC5545)
  return raw.replace(/\r?\n[ \t]/g, "");
}

function parseDTSTART(v) {
  // Handles:
  // 20260131T200000Z
  // 20260131T200000
  // 20260131T200000+0100
  // 20260131
  const s = String(v || "").trim();

  const dateDigits = s.match(/(\d{8})/);
  if (!dateDigits) return null;

  const ymd = dateDigits[1];
  const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

  let hh = "00",
    mm = "00";
  const tIndex = s.indexOf("T");
  if (tIndex !== -1) {
    const timeDigits = s.slice(tIndex + 1).match(/^(\d{2})(\d{2})(\d{2})?/);
    if (timeDigits) {
      hh = timeDigits[1];
      mm = timeDigits[2];
    }
  }

  const time = `${hh}:${mm}`;
  return { date, time, hh, mm };
}

function getLine(block, key) {
  const re = new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, "m");
  const m = block.match(re);
  return m ? (m[1] || "").trim() : "";
}

function parseTeamsAndScore(summary) {
  const s = (summary || "").trim();

  // "Team A v Team B"
  const vs = s.match(/^(.+?)\s+v(?:s)?\.?\s+(.+?)$/i);
  if (vs) return { home: vs[1].trim(), away: vs[2].trim(), homeGoals: null, awayGoals: null };

  // "Team A 2-0 Team B"
  const sc = s.match(/^(.+?)\s+(\d+)\s*[-–]\s*(\d+)\s+(.+?)$/);
  if (sc) {
    return {
      home: sc[1].trim(),
      away: sc[4].trim(),
      homeGoals: Number(sc[2]),
      awayGoals: Number(sc[3]),
    };
  }

  return { home: "", away: "", homeGoals: null, awayGoals: null };
}

function detectCompetition(summary, description, location) {
  const hay = `${summary} ${description} ${location}`.toLowerCase();

  // Champions League
  if (hay.includes("champions league") || hay.includes("uefa champions league") || hay.includes("ucl")) return "UCL";

  // FA Cup
  if (hay.includes("fa cup") || hay.includes("emirates fa cup") || hay.includes("fac")) return "FAC";

  // League Cup / Carabao / EFL Cup
  if (hay.includes("carabao") || hay.includes("league cup") || hay.includes("efl cup") || hay.includes("lc")) return "LC";

  // Premier League
  if (hay.includes("premier league") || hay.includes("pl")) return "PL";

  return "OTHER";
}

function parseICS(icsRaw) {
  const ics = unwrapIcsText(icsRaw);
  const blocks = ics.split("BEGIN:VEVENT").slice(1).map((b) => "BEGIN:VEVENT" + b);

  const out = [];

  for (const block of blocks) {
    const dtstart = getLine(block, "DTSTART");
    if (!dtstart) continue;

    const dt = parseDTSTART(dtstart);
    if (!dt) continue;

    const summary = getLine(block, "SUMMARY");
    const description = getLine(block, "DESCRIPTION");
    const location = getLine(block, "LOCATION");

    const { home, away, homeGoals, awayGoals } = parseTeamsAndScore(summary);

    const LFC = "liverpool";
    let venue = "H";
    let opponent = summary || "—";

    // Note: summary might have emoji prefix, so startsWith can fail.
    // We'll still use parsed home/away when available.
    if (home && home.toLowerCase().includes(LFC)) {
      venue = "H";
      opponent = away || opponent;
    } else if (away && away.toLowerCase().includes(LFC)) {
      venue = "A";
      opponent = home || opponent;
    }

    const competition = detectCompetition(summary, description, location);

    const id = `${dt.date}-${slug(competition)}-${slug(opponent)}-${venue.toLowerCase()}-${dt.time.replace(":", "")}`;

    out.push({
      source: "ics",
      id,
      date: dt.date,
      time: dt.time,
      datetime_utc: `${dt.date}T${dt.hh}:${dt.mm}:00Z`,
      competition, // PL / UCL / FAC / LC / OTHER (matches your filters)
      opponent,
      venue, // H / A
      location: location || "",
      homeGoals,
      awayGoals,
    });
  }

  // De-dupe by id
  const seen = new Set();
  return out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

async function main() {
  const res = await fetch(ICS_URL, { headers: { "user-agent": "TicketHelpLFC-CreditTracker/1.0" } });
  if (!res.ok) throw new Error(`Failed to fetch ICS: HTTP ${res.status}`);

  const text = await res.text();

  // Parse + sort
  const fixturesAll = parseICS(text).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  // ✅ Filter to the 2025/26 window
  const fixturesSeason = fixturesAll.filter((f) => f.date >= FROM && f.date <= TO);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "google-ics",
        seasonWindow: { from: FROM, to: TO },
        count: fixturesSeason.length,
        fixtures: fixturesSeason,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Saved ${fixturesSeason.length} fixtures (filtered ${FROM} → ${TO}) to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
