// scripts/fetch-lfc-ics.mjs
import fs from "node:fs";
import path from "node:path";

const OUT = path.join("public", "data", "lfc-fixtures.json");

const ICS_URL = process.env.LFC_ICS_URL;
if (!ICS_URL) {
  console.error("Missing LFC_ICS_URL env var (set it as a GitHub Actions secret).");
  process.exit(1);
}

// Keep only 2025/26 season window
const FROM = "2025-08-01";
const TO   = "2026-07-31";

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
  // 20260131T200000Z / 20260131T200000 / 20260131
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

function cleanSummary(s) {
  // remove common emojis + tidy spaces (incl. NBSP)
  return String(s || "")
    .replace(/[⚽️🔴🟥🟢✅❌⭐️]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTeams(summaryRaw) {
  const s = cleanSummary(summaryRaw);

  // Score format: "Team A 2-0 Team B"
  const sc = s.match(/^(.+?)\s+(\d+)\s*[-–]\s*(\d+)\s+(.+?)$/);
  if (sc) {
    return { a: sc[1].trim(), b: sc[4].trim(), homeGoals: Number(sc[2]), awayGoals: Number(sc[3]) };
  }

  // Vs: "Team A v Team B" / "vs"
  const vs = s.match(/^(.+?)\s+v(?:s)?\.?\s+(.+?)$/i);
  if (vs) {
    return { a: vs[1].trim(), b: vs[2].trim(), homeGoals: null, awayGoals: null };
  }

  // Dash: "Team A – Team B" / "Team A - Team B" / "Team A — Team B"
  const dash = s.match(/^(.+?)\s*[–—-]\s*(.+?)$/);
  if (dash) {
    return { a: dash[1].trim(), b: dash[2].trim(), homeGoals: null, awayGoals: null };
  }

  return { a: "", b: "", homeGoals: null, awayGoals: null };
}

function detectCompetition(summary, description, location) {
  const hay = `${summary} ${description} ${location}`.toLowerCase();

  if (hay.includes("champions league") || hay.includes("uefa champions league") || hay.includes("ucl")) return "UCL";
  if (hay.includes("fa cup") || hay.includes("emirates fa cup")) return "FAC";
  if (hay.includes("carabao") || hay.includes("efl cup") || hay.includes("league cup")) return "LC";

  // Explicit "not league" things should stay OTHER
  if (hay.includes("friendly") || hay.includes("pre-season") || hay.includes("club friendly")) return "OTHER";
  if (hay.includes("community shield") || hay.includes("super cup")) return "OTHER";

  // Google ICS often doesn’t say "Premier League" for actual league matches.
  // For real matches involving Liverpool, default to PL.
  return "PL";
}

function isNonMatchEvent(summaryRaw) {
  const s = cleanSummary(summaryRaw).toLowerCase();
  if (!s) return true;
  // obvious admin items
  if (s.includes("draw")) return true;
  if (s.includes("fixture release")) return true;
  if (s.includes("kick-off times")) return true;
  return false;
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

    // season window filter
    if (dt.date < FROM || dt.date > TO) continue;

    const summaryRaw = getLine(block, "SUMMARY");
    const summary = cleanSummary(summaryRaw);
    const description = getLine(block, "DESCRIPTION");
    const location = getLine(block, "LOCATION");

    if (isNonMatchEvent(summary)) continue;

    const { a: teamA, b: teamB, homeGoals, awayGoals } = splitTeams(summary);

    // Must have 2 teams
    if (!teamA || !teamB) continue;

    const LFC = "liverpool";
    const aIsLfc = teamA.toLowerCase().includes(LFC);
    const bIsLfc = teamB.toLowerCase().includes(LFC);

    // Must include Liverpool
    if (!aIsLfc && !bIsLfc) continue;

    // If Liverpool is left => treat as Home, right => Away
    const venue = aIsLfc ? "H" : "A";
    const opponent = aIsLfc ? teamB : teamA;

    const competition = detectCompetition(summary, description, location);

    const id = `${dt.date}-${slug(competition)}-${slug(opponent)}-${venue.toLowerCase()}-${dt.time.replace(":", "")}`;

    out.push({
      source: "ics",
      id,
      date: dt.date,
      time: dt.time,
      datetime_utc: `${dt.date}T${dt.hh}:${dt.mm}:00Z`,
      competition,     // PL / UCL / FAC / LC / OTHER
      opponent,
      venue,           // H / A
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
        source: "google-ics",
        seasonWindow: { from: FROM, to: TO },
        count: fixtures.length,
        fixtures,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Saved ${fixtures.length} fixtures (filtered ${FROM} → ${TO}) to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
