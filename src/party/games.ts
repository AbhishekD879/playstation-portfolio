// Content + tiny pure helpers for the party games. All generic — the kind of
// thing you'd play with friends in a room, phones as controllers, one big
// shared screen. Four formats, modelled on the classics:
//   • Trivia  — general-knowledge multiple choice, fastest correct wins more
//   • Bluff   — an obscure true fact; everyone writes a fake answer, then votes
//               for the real one hidden among the lies (à la Fibbage)
//   • Quips   — a silly prompt; everyone answers, head-to-head vote (à la Quiplash)
//   • Draw    — one person draws a word, everyone else races to guess (à la Skribbl)

export interface TriviaQ { q: string; options: string[] } // options[0] = correct

export const TRIVIA: TriviaQ[] = [
  { q: "What is the largest planet in our solar system?", options: ["Jupiter", "Saturn", "Neptune", "Earth"] },
  { q: "How many bones are in the adult human body?", options: ["206", "187", "250", "152"] },
  { q: "What year did the first iPhone launch?", options: ["2007", "2005", "2009", "2010"] },
  { q: "What is the smallest prime number?", options: ["2", "1", "3", "0"] },
  { q: "Which gas do plants mainly absorb from the air?", options: ["Carbon dioxide", "Oxygen", "Nitrogen", "Hydrogen"] },
  { q: "What is the hardest natural substance on Earth?", options: ["Diamond", "Quartz", "Iron", "Titanium"] },
  { q: "What is the capital of Australia?", options: ["Canberra", "Sydney", "Melbourne", "Perth"] },
  { q: "Which ocean is the largest?", options: ["Pacific", "Atlantic", "Indian", "Arctic"] },
  { q: "What is the chemical symbol for gold?", options: ["Au", "Gd", "Go", "Ag"] },
  { q: "How many strings does a standard guitar have?", options: ["6", "4", "8", "5"] },
  { q: "In what year did World War II end?", options: ["1945", "1939", "1918", "1950"] },
  { q: "Which planet is known as the Red Planet?", options: ["Mars", "Venus", "Jupiter", "Mercury"] },
  { q: "How many continents are there?", options: ["7", "5", "6", "8"] },
  { q: "What is the tallest animal in the world?", options: ["Giraffe", "Elephant", "Horse", "Ostrich"] },
];

/** A true, obscure fact with a short answer players can plausibly fake. */
export interface BluffQ { q: string; answer: string }

export const BLUFF: BluffQ[] = [
  { q: "A group of flamingos is called a ______.", answer: "flamboyance" },
  { q: "A group of owls is called a ______.", answer: "parliament" },
  { q: "A group of crows is called a ______.", answer: "murder" },
  { q: "A group of pandas is called an ______.", answer: "embarrassment" },
  { q: "The plastic tip at the end of a shoelace is called an ______.", answer: "aglet" },
  { q: "The dot over a lowercase 'i' is called a ______.", answer: "tittle" },
  { q: "The small space between your two eyebrows is called the ______.", answer: "glabella" },
  { q: "The wobbly flesh at the back of your throat is called the ______.", answer: "uvula" },
  { q: "The study of flags is called ______.", answer: "vexillology" },
  { q: "A group of jellyfish is called a ______.", answer: "smack" },
  { q: "A baby kangaroo is called a ______.", answer: "joey" },
  { q: "The loop that holds the end of your belt in place is called a ______.", answer: "keeper" },
];

export const QUIPS: string[] = [
  "A terrible name for a boat",
  "The worst thing to say on a first date",
  "A rejected slogan for a soft-drink company",
  "The real reason the dinosaurs went extinct",
  "A superpower that would be completely useless",
  "The worst possible name for a pet goldfish",
  "Something you should absolutely never microwave",
  "A bad theme for a wedding",
  "The title of an autobiography nobody wants to read",
  "The worst thing to find waiting in your hotel room",
  "A weird thing to bring to a job interview",
  "The most useless invention of all time",
  "A terrible name for a rock band",
  "The first thing aliens say when they land on Earth",
  "The worst gift to give your boss",
  "A rejected flavour of ice cream",
];

export const DRAW_WORDS = [
  "cat", "house", "pizza", "robot", "guitar", "rocket", "banana", "laptop",
  "coffee", "dragon", "ghost", "rainbow", "snowman", "bicycle", "octopus",
  "volcano", "penguin", "castle", "spider", "lighthouse", "cactus", "umbrella",
  "dinosaur", "mushroom", "anchor", "balloon", "butterfly", "campfire",
  "telescope", "controller", "keyboard", "headphones", "sunflower", "shark",
];

// Chameleon (social deduction): everyone sees the secret word except one faker.
export interface ChamCategory { name: string; words: string[] }
export const CHAMELEON: ChamCategory[] = [
  { name: "Fruits", words: ["banana", "apple", "mango", "grape", "orange", "strawberry", "pineapple", "watermelon"] },
  { name: "Animals", words: ["lion", "elephant", "penguin", "dolphin", "tiger", "kangaroo", "giraffe", "panda"] },
  { name: "Movies", words: ["Titanic", "Avatar", "Inception", "Jaws", "Frozen", "Gladiator", "Shrek", "The Matrix"] },
  { name: "Countries", words: ["Japan", "Brazil", "Egypt", "Canada", "India", "France", "Kenya", "Norway"] },
  { name: "Sports", words: ["soccer", "tennis", "boxing", "cricket", "golf", "surfing", "skiing", "hockey"] },
  { name: "Jobs", words: ["doctor", "teacher", "chef", "pilot", "farmer", "lawyer", "artist", "plumber"] },
  { name: "Food", words: ["pizza", "sushi", "burger", "tacos", "pasta", "curry", "salad", "pancakes"] },
  { name: "Places", words: ["beach", "airport", "hospital", "school", "museum", "casino", "library", "zoo"] },
];

// Would You Rather (opinion poll, no scoring): each pair is [option A, option B].
export const WOULD_YOU_RATHER: [string, string][] = [
  ["Be able to fly", "Be invisible"],
  ["Have unlimited money", "Have unlimited time"],
  ["Never use social media again", "Never watch films again"],
  ["Fight one horse-sized duck", "Fight 100 duck-sized horses"],
  ["Always be 10 minutes late", "Always be 20 minutes early"],
  ["Live without music", "Live without the internet"],
  ["Read minds", "See the future"],
  ["Have a rewind button for life", "Have a pause button for life"],
  ["Only ever whisper", "Only ever shout"],
  ["Explore outer space", "Explore the deep ocean"],
  ["Never sit in traffic again", "Never wait in a queue again"],
  ["Have a pet dragon", "Have a pet unicorn"],
  ["Teleport anywhere", "Travel through time"],
  ["Give up coffee forever", "Give up dessert forever"],
  ["Be famous but poor", "Be rich but unknown"],
  ["Always know when someone lies", "Always get away with lying"],
];

// Herd Mentality (match the crowd): open prompts where the common answer wins.
export const HERD_PROMPTS: string[] = [
  "Name a colour", "Name a fruit", "Name an animal you'd see at a zoo",
  "Name a pizza topping", "Name a country in Europe", "Name a superhero",
  "Name a day of the week", "Name something in a kitchen", "Name a board game",
  "Name a car brand", "Name a social media app", "Name a season",
  "Name a fast-food chain", "Name a planet", "Name a breakfast food",
];

// Acronym: players invent what a random 3-letter acronym stands for, then vote.
export const ACRONYM_LETTERS = "ABCDEFGHJKLMNPRSTVW"; // skip tricky/ugly Q,X,Y,Z,I,O,U
export const randomAcronym = (n = 3) => Array.from({ length: n }, () => ACRONYM_LETTERS[Math.floor(Math.random() * ACRONYM_LETTERS.length)]).join("");

// Most Likely To: a prompt about the group; everyone votes for a player.
export const LIKELY_PROMPTS: string[] = [
  "Most likely to become famous",
  "Most likely to survive a zombie apocalypse",
  "Most likely to forget their own birthday",
  "Most likely to become a millionaire",
  "Most likely to get lost in their own neighbourhood",
  "Most likely to start a conspiracy podcast",
  "Most likely to cry at a happy movie",
  "Most likely to win a reality TV show",
  "Most likely to talk to their pet like a person",
  "Most likely to sleep through an earthquake",
  "Most likely to become a mad scientist",
  "Most likely to fight a goose and lose",
  "Most likely to text the wrong person",
  "Most likely to trip over nothing",
];

// Story: each player writes one blind line; the host stitches them into chaos.
export const STORY_THEMES: string[] = [
  "A hero's absolutely terrible Monday",
  "The day the internet vanished",
  "An alien's first trip to the supermarket",
  "The greatest sandwich ever made",
  "A detective's most confusing case",
  "The robot who wanted to be a chef",
  "A pirate's search for the last phone charger",
  "The office party that went too far",
];

// Celebrity: hint-givers see a famous NAME (photos are copyrighted — a name plays
// the same) and describe it without saying it; one rotating guesser guesses.
// Real, globally-known people + a few public-domain/folk figures. Names are facts.
export const CELEBRITIES: string[] = [
  "Albert Einstein", "Michael Jackson", "Beyoncé", "Cristiano Ronaldo", "Lionel Messi",
  "Taylor Swift", "Tom Hanks", "Morgan Freeman", "Jackie Chan", "Charlie Chaplin",
  "Muhammad Ali", "Serena Williams", "Usain Bolt", "Michael Jordan", "Oprah Winfrey",
  "Steve Jobs", "Mahatma Gandhi", "Nelson Mandela", "Abraham Lincoln", "Cleopatra",
  "Leonardo da Vinci", "Marie Curie", "Isaac Newton", "William Shakespeare", "Elvis Presley",
  "Freddie Mercury", "Bob Marley", "Audrey Hepburn", "Walt Disney", "Barack Obama",
  "Pelé", "Bruce Lee", "Marilyn Monroe", "Mozart", "Vincent van Gogh",
  "Sherlock Holmes", "Santa Claus", "Dracula", "Robin Hood", "Christopher Columbus",
];

// Bot players — so ONE person with ONE phone can still see a game work (several
// of these games need 3+). Deliberately dumb: they pick a random option and say
// canned things. They exist to make the room playable, not to be clever.
// —— custom packs ————————————————————————————————————————————————————————————
// Your own prompts, typed on the console and kept in localStorage, so a group can
// build an in-joke pack that outlives the built-in list. They're mixed INTO the
// pools (never replace them), so a short pack can't make the game repetitive.
const CUSTOM_KEY = "asp.party.custom";
export interface CustomPack { quips: string[]; herd: string[] }
export function loadCustom(): CustomPack {
  try {
    const p = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "{}");
    return { quips: Array.isArray(p.quips) ? p.quips : [], herd: Array.isArray(p.herd) ? p.herd : [] };
  } catch { return { quips: [], herd: [] }; }
}
export function saveCustom(p: CustomPack): void {
  const clean = (a: string[]) => a.map((s) => s.trim()).filter(Boolean).slice(0, 60);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify({ quips: clean(p.quips), herd: clean(p.herd) }));
}
/** The built-in pool plus whatever the group added. */
export const quipsPool = (): string[] => [...loadCustom().quips, ...QUIPS];
export const herdPool = (): string[] => [...loadCustom().herd, ...HERD_PROMPTS];

export const BOT_NAMES = ["Robo", "Bleep", "Circuit", "Widget", "Cog", "Byte"];
export const BOT_LINES = [
  "definitely a banana", "my uncle told me", "the big one", "something shiny",
  "probably illegal", "ask my lawyer", "a small dog", "loud and yellow",
  "the third one", "cheese, obviously", "it was on TV", "a very tall hat",
];
export const BOT_COMMON = ["blue", "apple", "lion", "cheese", "Monday", "France", "Superman", "pizza"];
export const BOT_GUESSES = ["a cat", "a house", "a car", "the moon", "a tree", "a bird"];

export const PLAYER_COLORS = ["#4aa3ff", "#ff5c8a", "#ffc94a", "#43d9a3", "#c07bff", "#ff8f43", "#37d0e0", "#e0d437"];

/** Fisher–Yates; returns a NEW array. */
export function shuffle<T>(a: readonly T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Normalize a guess/word for comparison — folds accents (Pelé→pele, Beyoncé→beyonce)
 *  so a guesser never has to type diacritics, then drops case/spaces/punctuation. */
export const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
