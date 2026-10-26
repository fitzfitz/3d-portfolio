// Curated profanity and slur list for message bottles (English + Indonesian).
// Matched as whole words, case-insensitive, after leetspeak mapping, so only
// list the plain lowercase word. Inflections must be listed explicitly.
// Pure data: shared by the client and beacon-api.

export const BOTTLE_PROFANITY_EN: readonly string[] = [
  "fuck", "fucks", "fucked", "fucker", "fuckers", "fucking", "motherfucker", "motherfuckers",
  "shit", "shits", "shitty", "bullshit", "shithead",
  "bitch", "bitches", "bastard", "bastards",
  "asshole", "assholes", "arsehole", "ass", "arse", "dick", "dicks", "dickhead",
  "cock", "cocks", "cunt", "cunts", "pussy", "twat", "wanker", "prick",
  "slut", "sluts", "whore", "whores",
  "piss", "pissed",
  "nigger", "niggers", "nigga", "niggas", "faggot", "faggots", "fag", "retard", "retarded",
  "tranny", "spic", "chink", "kike", "coon", "gook", "wetback",
  "rape", "raped", "rapist", "nazi",
  "porn", "cum", "jizz", "blowjob", "handjob", "dildo",
];

export const BOTTLE_PROFANITY_ID: readonly string[] = [
  "anjing", "anjir", "anjrit", "asu", "babi", "bangsat", "bajingan", "brengsek", "keparat",
  "kontol", "memek", "ngentot", "entot", "jancok", "jancuk", "cuk", "pepek", "titit",
  "pantat", "bego", "goblok", "tolol", "idiot", "bodoh",
  "sialan", "kampret", "monyet", "setan", "tai", "taik",
  "perek", "jablay", "pelacur", "lonte", "bencong", "banci",
  "ngewe", "coli", "colmek", "bokep",
];

export const BOTTLE_PROFANITY: ReadonlySet<string> = new Set([
  ...BOTTLE_PROFANITY_EN,
  ...BOTTLE_PROFANITY_ID,
]);
