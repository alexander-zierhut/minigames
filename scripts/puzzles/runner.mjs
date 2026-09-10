/* Puzzle sets: positions with algorithmically proven perfect moves (tests/puzzles/<game>/
   puzzles.json, produced by the per-game solver + generate.mjs). This runner replays a
   puzzle into a rules state and grades a bot: how many puzzles it answers with one of
   the `best` moves. Format (binding for the generators):
     { game, variant?, generated, solver, puzzles: [{ id, config, history, toMove, best, value, depth, tags, note }] }
   One folder = one set. A folder may hold a RULE VARIANT of a game (tests/puzzles/five-yavalath):
   `game` is always the rules key the positions are replayed with, `variant` names the variant
   and every puzzle's `config` carries its flags, so a set is graded with those rules. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { ROOT } from "../headless.mjs";

export const PUZZLE_DIR = `${ROOT}tests/puzzles/`;

// the puzzle sets on disk, by folder name (one folder = one set; a set's `game` is the rules key)
export function puzzleSets() {
    if (!existsSync(PUZZLE_DIR)) return [];
    return readdirSync(PUZZLE_DIR).filter((d) => existsSync(`${PUZZLE_DIR}${d}/puzzles.json`)).sort();
}
export const puzzleGames = puzzleSets;          // the folder is the set's name; kept for older callers
export function loadPuzzles(dir) {
    const file = `${PUZZLE_DIR}${dir}/puzzles.json`;
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}
// the rules variant a set is played with (its puzzles all share it), for Bots.supports / benchmarkOf
export const setConfig = (data) => (data && data.puzzles.length ? data.puzzles[0].config : {});

// the position of a puzzle, rebuilt with the rules; throws when the puzzle is inconsistent
export function positionOf(H, puzzle) {
    const key = puzzle.config.game || game(puzzle);
    const rules = H.Rules.of(key);
    const state = H.Rules.create(puzzle.config, key);
    for (const i of puzzle.history) {
        if (state.over) throw new Error(`${puzzle.id}: history continues after the game ended`);
        if (!rules.isLegal(state, i, state.current)) throw new Error(`${puzzle.id}: illegal history move ${i} for player ${state.current}`);
        H.Rules.step(rules, state, i);
    }
    if (state.over) throw new Error(`${puzzle.id}: position is already over`);
    if (state.current !== puzzle.toMove) throw new Error(`${puzzle.id}: toMove ${puzzle.toMove} but ${state.current} is to move`);
    if (!Array.isArray(puzzle.best) || puzzle.best.length === 0) throw new Error(`${puzzle.id}: best is empty`);
    for (const b of puzzle.best) if (!rules.isLegal(state, b, state.current)) throw new Error(`${puzzle.id}: best move ${b} is illegal`);
    return state;
}
const game = (puzzle) => puzzle.id.split("-")[0];

// grade one bot on its game's puzzles: { solved, total, pct, byTag: { tag: { solved, total } }, failures: [{ id, got, best }] }
export async function evaluateBot(H, botId, { difficulty, seed = 1, set, budget } = {}) {
    const def = H.Bots.get(botId);
    if (!def) throw new Error(`unknown bot ${botId}`);
    const data = set || loadPuzzles(def.game);
    if (!data) return null;
    const result = { solved: 0, total: 0, pct: 0, chance: 0, byTag: {}, failures: [] };   // chance = what random picking would score
    let chance = 0;
    for (const puzzle of data.puzzles) {
        const state = positionOf(H, puzzle);
        chance += puzzle.best.length / H.Rules.of(def.game).legalMoves(state, state.current).length;
        const bot = H.Bots.create(botId, { me: state.current, difficulty, seed: seed + result.total, players: state.players, budget });
        const got = await bot.move(bot.tools.clone(state));
        const ok = puzzle.best.includes(got);
        result.total++;
        if (ok) result.solved++; else result.failures.push({ id: puzzle.id, got, best: puzzle.best });
        for (const tag of puzzle.tags || []) {
            const t = result.byTag[tag] || (result.byTag[tag] = { solved: 0, total: 0 });
            t.total++; if (ok) t.solved++;
        }
    }
    result.pct = result.total ? Math.round(result.solved / result.total * 1000) / 10 : 0;
    result.chance = result.total ? Math.round(chance / result.total * 1000) / 10 : 0;
    return result;
}
