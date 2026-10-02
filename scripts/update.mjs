import { readFile, writeFile } from "node:fs/promises";

const SOURCE_URL = "https://www.oxfordhc.org/teams/259935/league-table?tableId=191993";
const DATA_PATH = new URL("../site/data.json", import.meta.url);

function londonDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function parseTable(html) {
  const marker = html.indexOf("__NEXT_DATA__");
  if (marker < 0) throw new Error("The Oxford HC league data was not found.");
  const start = html.indexOf(">", marker) + 1;
  const end = html.indexOf("</script>", start);
  const data = JSON.parse(html.slice(start, end));
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

const response = await fetch(SOURCE_URL, {
  headers: { "User-Agent": "Oxford-HC-2s-dashboard/1.0", Accept: "text/html" }
});
if (!response.ok) throw new Error(`Oxford HC returned HTTP ${response.status}.`);

const previous = JSON.parse(await readFile(DATA_PATH, "utf8"));
const teams = parseTable(await response.text());
const date = londonDate();
const point = { date, positions: Object.fromEntries(teams.map(team => [team.name, team.position])) };
const history = [...(previous.history || []).filter(item => item.date !== date), point]
  .sort((a, b) => a.date.localeCompare(b.date));
const next = {
  competition: "South Central Open - Men's Division 1 North",
  sourceUrl: SOURCE_URL,
  fetchedAt: new Date().toISOString(),
  teams,
  history
};
await writeFile(DATA_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`Saved ${teams.length} teams for ${date}; Oxford 2 are ${teams.find(t => t.name === "Oxford 2").position}.`);

