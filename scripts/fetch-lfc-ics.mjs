// scripts/fetch-lfc-ics.mjs
import fs from "node:fs";
import path from "node:path";

const OUT = path.join("public", "data", "lfc-fixtures.json");

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

  if (hay.includes("premier league")) return "PL";
  if (hay.includes("champions league") || hay.includes("uefa champions league")) return "UCL";
  if (hay.includes("fa cup")) return "FAC";
  if (hay.includes("carabao") || hay.includes("league cup") || hay.includes("efl cup")) return "LC";

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

    if (home && home.toLowerCase().startsWith(LFC)) {
      venue = "H";
      opponent = away || opponent;
    } else if (away && away.toLowerCase().startsWith(LFC)) {
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
      competition,          // PL / UCL / FAC / LC / OTHER (matches your filters)
      opponent,
      venue,                // H / A
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
  const fixtures = parseICS(text).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "ecal-ics",
        count: fixtures.length,
        fixtures,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Saved ${fixtures.length} fixtures to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
