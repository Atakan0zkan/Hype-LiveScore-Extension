const now = Date.now();
export const LEAGUES = [
  {
    code: "eng.1", name: "Premier League", logoTone: "dark",
    matches: [
      { id: "e2e1", leagueCode: "eng.1", homeTeam: "Arsenal", awayTeam: "Chelsea", homeScore: 2, awayScore: 1, state: "live", status: "2H", minute: "67'", kickoff: new Date(now).toISOString(), venue: "Emirates" },
      { id: "e2e2", leagueCode: "eng.1", homeTeam: "Spurs", awayTeam: "Villa", homeScore: 0, awayScore: 0, state: "scheduled", status: "Scheduled", kickoff: new Date(now + 2 * 3600 * 1000).toISOString(), venue: "" },
      { id: "e2e4", leagueCode: "eng.1", homeTeam: "Liverpool", awayTeam: "City", homeScore: 1, awayScore: 1, state: "finished", status: "FT", kickoff: new Date(now - 3 * 3600 * 1000).toISOString(), venue: "Anfield" },
    ],
  },
  { code: "esp.1", name: "LaLiga", logoTone: "dark", matches: [] },
  {
    code: "ita.1", name: "Serie A", logoTone: "dark",
    matches: [
      { id: "e2e3", leagueCode: "ita.1", homeTeam: "Inter", awayTeam: "Milan", homeScore: 1, awayScore: 1, state: "finished", status: "FT", kickoff: new Date(now - 3 * 3600 * 1000).toISOString(), venue: "San Siro" },
    ],
  },
];
export const ALL_MATCHES = LEAGUES.flatMap((l) => l.matches);
export const STANDINGS = [
  { position: 1, team: "Arsenal", logo: null, played: 10, wins: 8, draws: 1, losses: 1, goalsFor: 20, goalsAgainst: 8, goalDifference: "+12", points: 25, zone: {kind:"champions-league",phase:"direct"} },
  { position: 2, team: "Chelsea", logo: null, played: 10, wins: 7, draws: 2, losses: 1, goalsFor: 18, goalsAgainst: 9, goalDifference: "+9", points: 23, zone: {kind:"europa-league",phase:"qualifying"} },
  ...[
    ["Conference fixture", 4, "conference-league", "qualifying"],
    ["Playoff fixture", 17, "relegation", "playoff"],
    ["Relegation fixture", 18, "relegation", "direct"],
  ].map(([team, position, kind, phase]) => ({position,team,logo:null,played:10,wins:2,draws:3,losses:5,goalsFor:8,goalsAgainst:20,goalDifference:"-12",points:9,zone:{kind,phase}})),
];
export const DETAIL = {
  id: "e2e1", leagueCode: "eng.1", title: "Arsenal vs Chelsea",
  teams: { home: { name: "Arsenal" }, away: { name: "Chelsea" } },
  timeline: [
    { minute: "0'", type: "Kickoff", kind: "kickoff" },
    { minute: "23'", type: "Goal", kind: "goal", team: "Arsenal", players: ["Home Forward"], text: "Home Forward scores from inside the penalty area." },
    { minute: "45'+3'", type: "Yellow Card", kind: "yellow-card", team: "Chelsea", players: ["Away Defender"] },
  ],
  stats: [{ label: "Shots", homeValue: "5", awayValue: "10" }, { label: "Possession", homeValue: "35%", awayValue: "65%" }],
  lineups: ["Arsenal", "Chelsea"].map((team, index) => ({
    team, homeAway: index ? "away" : "home", formation: index ? "4-2-3-1" : "4-4-1-1",
    players: (index
      ? ["G", "LB", "CD-L", "CD-R", "RB", "LM", "RM", "AM-L", "AM", "AM-R", "F"]
      : ["G", "LB", "CD-L", "CD-R", "RB", "LM", "RM", "CM-L", "CM-R", "RCF", "F"]).map((position, i) => ({
      id: `${index}-${i}`, name: ["Antonín Kinsky", "Destiny Udogie", "Micky van de Ven", "Kevin Danso", "Pedro Porro", "Conor Gallagher", "João Palhinha", "Mathys Tel", "Rodrigo Bentancur", "Randal Kolo Muani", "Dominic Calvert-Lewin"][i], jersey: String(i + 1), position, starter: true,
      goals: i === 1 ? 5 : i === 10 ? 2 : 0, yellowCards: i === 1 ? 2 : 0, redCards: i === 1 ? 1 : 0,
    })).concat([
      { id: `${index}-sub-1`, name: `${team} Substitute One`, jersey: "12", position: "M", starter: false },
      { id: `${index}-sub-2`, name: `${team} Substitute Two`, jersey: "13", position: "F", starter: false },
    ]),
  })), news: [{ title: "Match report", url: "https://www.espn.com/soccer/report/_/gameId/740954" }],
  videos: [{ title: "Watch the match highlights", url: "https://www.espn.com/video/clip/_/id/12345" }], links: [],
};
