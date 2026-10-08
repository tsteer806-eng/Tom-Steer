import { readFile, writeFile } from "node:fs/promises";

const SOURCE_URL = "https://www.oxfordhc.org/teams/259935/league-table?tableId=191993";
const FIXTURES_URL = "https://www.oxfordhc.org/teams/259935/fixtures-results";
const COMPETITION = "South Central Open - Men's Division 1 North";
const DATA_PATH = new URL("../site/data.json", import.meta.url);

function londonDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function nextData(html) {
  const marker = html.indexOf("__NEXT_DATA__");
  if (marker < 0) throw new Error("The Oxford HC data was not found.");
  const start = html.indexOf(">", marker) + 1;
  const end = html.indexOf("</script>", start);
  return JSON.parse(html.slice(start, end));
}

function parseTable(html) {
  const data = nextData(html);
  const tables = data?.props?.initialReduxState?.teams?.leagueTable?.tables?.["259935"] || [];
  const current = tables.find(table => table.id === 191993) || tables.at(-1);
  const teams = (current?.rows || []).map(row => {
    const values = Object.fromEntries(row.column_values.map(column => [column.key, column.value]));
    return {
      position: Number(row.rank), name: String(values.team_name), played: Number(values.played),
      won: Number(values.won), drawn: Number(values.drew), lost: Number(values.lost),
      for: Number(values.for), against: Number(values.against), difference: Number(values.diff), points: Number(values.points)
    };
  });
  if (teams.length !== 12 || !teams.some(team => team.name === "Oxford 2")) {
    throw new Error("The published table was incomplete, so the verified snapshot was left unchanged.");
  }
  return teams.sort((a, b) => a.position - b.position);
}

function parseFixtures(html) {
  const data = nextData(html);
  const fixtureMap = data?.props?.initialReduxState?.teams?.fixtures?.fixtures?.["259935"] || {};
  const published = Object.values(fixtureMap)
    .filter(fixture => fixture.division === COMPETITION && !fixture.isCancelledOrPostponed);
  const fixtures = published
    .map(fixture => ({
      id: fixture.id,
      opponent: fixture.opponent,
      homeAway: fixture.ha === "h" ? "Home" : "Away",
      pushback: fixture.dateTime,
      sourceUrl: `https://www.oxfordhc.org/teams/259935/match-centre/${fixture.id}`
    }))
    .sort((a, b) => a.pushback.localeCompare(b.pushback));
  const resultDates = [...new Set(
    published.filter(fixture => fixture.hasOutcome).map(fixture => fixture.dateTime.slice(0, 10))
  )].sort();
  if (!fixtures.length) throw new Error("The published fixtures were incomplete, so the verified snapshot was left unchanged.");
  return { fixtures, resultDates };
}

const headers = { "User-Agent": "Oxford-HC-2s-dashboard/1.0", Accept: "text/html" };
const [tableResponse, fixturesResponse] = await Promise.all([
  fetch(SOURCE_URL, { headers }),
  fetch(FIXTURES_URL, { headers })
]);
if (!tableResponse.ok || !fixturesResponse.ok) {
  throw new Error(`Oxford HC returned HTTP ${tableResponse.status}/${fixturesResponse.status}.`);
}

const previous = JSON.parse(await readFile(DATA_PATH, "utf8"));
const [teams, fixtureData] = await Promise.all([
  tableResponse.text().then(parseTable),
  fixturesResponse.text().then(parseFixtures)
]);
const { fixtures, resultDates } = fixtureData;
const date = resultDates.at(-1) || londonDate();
const point = { date, positions: Object.fromEntries(teams.map(team => [team.name, team.position])) };
const existingHistory = previous.history || [];
const validResultDates = new Set(resultDates);
const history = process.env.RECORD_HISTORY === "true"
  ? [...existingHistory.filter(item => validResultDates.has(item.date) && item.date !== date), point]
      .sort((a, b) => a.date.localeCompare(b.date))
  : existingHistory;
const changed = JSON.stringify({ teams, fixtures, history }) !==
  JSON.stringify({ teams: previous.teams, fixtures: previous.fixtures, history: previous.history });
const next = {
  competition: COMPETITION,
  sourceUrl: SOURCE_URL,
  fixturesSourceUrl: FIXTURES_URL,
  fetchedAt: changed ? new Date().toISOString() : previous.fetchedAt,
  teams,
  fixtures,
  history
};
await writeFile(DATA_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`Saved ${teams.length} teams and ${fixtures.length} fixtures for ${date}; Oxford 2 are ${teams.find(t => t.name === "Oxford 2").position}.`);

