// scripts/fetch-lfc-ics.mjs
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = "data";
const PUBLIC_DATA_DIR = path.join("public", "data");
const INDEX_OUT = path.join(DATA_DIR, "lfc-fixtures-index.json");
const PUBLIC_INDEX_OUT = path.join(PUBLIC_DATA_DIR, "lfc-fixtures-index.json");

const ICS_URL = process.env.LFC_ICS_URL;
if (!ICS_URL) {
  console.error("Missing LFC_ICS_URL env var (set it as a GitHub Actions secret).");
  process.exit(1);
}

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

function getLine(block, key) {
  const re = new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, "m");
  const m = block.match(re);
  return m ? (m[1] || "").trim() : "";
}

function parseDTSTART(v) {
  // Examples:
  // 20260131T200000Z
  // 20260131T200000
  // 20260131
  const m = String(v || "").match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const hh = m[4] || "00";
  const mm = m[5] || "00";
  const time = `${hh}:${mm}`;
  return { date, time, hh, mm };
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

  if (hay.includes("champions league") || hay.includes("uefa champions league") || hay.includes("ucl")) return "UCL";
  if (hay.includes("fa cup") || hay.includes("emirates fa cup") || hay.includes("fac")) return "FAC";
  if (hay.includes("carabao") || hay.includes("league cup") || hay.includes("efl cup") || hay.includes("lc")) return "LC";
  if (hay.includes("premier league") || hay.includes("pl")) return "PL";

  return "OTHER";
}

// Manual competition overrides (date|opponentSlug preferred; date-only fallback)
const COMP_OVERRIDES = new Map([
  ["2026-03-21|brighton", "PL"], // Brighton override
]);

function seasonIdForDate(dateStr) {
  // Season runs Aug -> Jul
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const startYear = (m >= 8) ? y : (y - 1);
  return `${startYear}-${String(startYear + 1).slice(-2)}`; // "2025-26"
}

function seasonWindowFromSeasonId(seasonId) {
  // "2025-26" => from "2025-08-01" to "2026-07-31"
  const startYear = Number(String(seasonId).slice(0, 4));
  const endYear = startYear + 1;
  return {
    from: `${startYear}-08-01`,
    to: `${endYear}-07-31`,
    label: `${String(startYear).slice(-2)}/${String(endYear).slice(-2)}`, // "25/26"
  };
}

function parseICS(icsRaw) {
  const ics = unwrapIcsText(icsRaw);
  const blocks = ics.split("BEGIN:VEVENT").slice(1).map((b) => "BEGIN:VEVENT" + b);

  const out = [];
  const LFC = "liverpool";

  for (const block of blocks) {
    const dtstart = getLine(block, "DTSTART");
    if (!dtstart) continue;

    const dt = parseDTSTART(dtstart);
    if (!dt) continue;

    const summary = getLine(block, "SUMMARY");
    const description = getLine(block, "DESCRIPTION");
    const location = getLine(block, "LOCATION");

    const { home, away, homeGoals, awayGoals } = parseTeamsAndScore(summary);

    // Skip non-match events (draws, announcements, etc.)
    const homeIsLfc = home && home.toLowerCase().includes(LFC);
    const awayIsLfc = away && away.toLowerCase().includes(LFC);
    if (!homeIsLfc && !awayIsLfc) continue;

    let venue = "H";
    let opponent = "—";

    if (homeIsLfc) {
      venue = "H";
      opponent = away || opponent;
    } else {
      venue = "A";
      opponent = home || opponent;
    }

    let competition = detectCompetition(summary, description, location);

    // Apply manual overrides
    const key1 = `${dt.date}|${slug(opponent)}`;
    const key2 = `${dt.date}`;
    if (COMP_OVERRIDES.has(key1)) competition = COMP_OVERRIDES.get(key1);
    else if (COMP_OVERRIDES.has(key2)) competition = COMP_OVERRIDES.get(key2);

    const id = `${dt.date}-${slug(competition)}-${slug(opponent)}-${venue.toLowerCase()}-${dt.time.replace(":", "")}`;

    out.push({
      source: "ics",
      id,
      date: dt.date,
      time: dt.time,
      datetime_utc: `${dt.date}T${dt.hh}:${dt.mm}:00Z`,
      competition, // PL / UCL / FAC / LC / OTHER
      opponent,
      venue,       // H / A
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
  const fixturesAll = parseICS(text);

  // Group by seasonId
  const bySeason = new Map();
  for (const f of fixturesAll) {
    const sid = seasonIdForDate(f.date);
    if (!bySeason.has(sid)) bySeason.set(sid, []);
    bySeason.get(sid).push(f);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });

  // Write each season file
  const seasonsOut = [];
  for (const [seasonId, arr] of Array.from(bySeason.entries()).sort(([a],[b]) => a.localeCompare(b))) {
    const win = seasonWindowFromSeasonId(seasonId);
    arr.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    const outFile = path.join(DATA_DIR, `lfc-fixtures-${seasonId}.json`);
    const publicOutFile = path.join(PUBLIC_DATA_DIR, `lfc-fixtures-${seasonId}.json`);
    fs.writeFileSync(
      outFile,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: "google-ics",
          seasonId,
          seasonLabel: win.label,
          seasonWindow: { from: win.from, to: win.to },
          count: arr.length,
          fixtures: arr,
        },
        null,
        2
      ),
      "utf8"
    );
    fs.writeFileSync(publicOutFile, fs.readFileSync(outFile, "utf8"), "utf8");

    seasonsOut.push({
      seasonId,
      seasonLabel: win.label,
      from: win.from,
      to: win.to,
      count: arr.length,
      file: `data/lfc-fixtures-${seasonId}.json`,
    });

    console.log(`Saved ${arr.length} fixtures to ${outFile}`);
  }

  // Write index file listing seasons available
  fs.writeFileSync(
    INDEX_OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "google-ics",
        seasons: seasonsOut,
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(PUBLIC_INDEX_OUT, fs.readFileSync(INDEX_OUT, "utf8"), "utf8");

  console.log(`Saved seasons index to ${INDEX_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
