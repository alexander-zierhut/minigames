/* Puzzle sets: positions with algorithmically proven perfect moves (tests/puzzles/<game>/
   puzzles.json, produced by the per-game solver + generate.mjs). This runner replays a
   puzzle into a rules state and grades a bot: how many puzzles it answers with one of
   the `best` moves. Format (binding for the generators):
     { game, generated, solver, puzzles: [{ id, config, history, toMove, best, value, depth, tags, note }] } */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { ROOT } from "./headless.mjs";

export const PUZZLE_DIR = `${ROOT}tests/puzzles/`;

// games that have a puzzle set on disk
export function puzzleGames() {
    if (!existsSync(PUZZLE_DIR)) return [];
    return readdirSync(PUZZLE_DIR).filter((d) => existsSync(`${PUZZLE_DIR}${d}/puzzles.json`));
}
export function loadPuzzles(game) {
    const file = `${PUZZLE_DIR}${game}/puzzles.json`;
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

// the position of a puzzle, rebuilt with the rules; throws when the puzzle is inconsistent
export function positionOf(H, puzzle) {
    const rules = H.Rules.of(puzzle.config.game || game(puzzle));
    const cfg = { ...puzzle.config };
    const state = rules.create(cfg, H.Rules.base(cfg));
    for (const i of puzzle.history) {
        const p = state.current;
        if (state.over) throw new Error(`${puzzle.id}: history continues after the game ended`);
        if (!rules.isLegal(state, i, p)) throw new Error(`${puzzle.id}: illegal history move ${i} for player ${p}`);
        rules.place(state, i, p);
        rules.settle(state, p);
        const r = rules.conclude(state, p);
        if (r) { state.over = true; state.winner = r.winner; }
    }
    if (state.over) throw new Error(`${puzzle.id}: position is already over`);
    if (state.current !== puzzle.toMove) throw new Error(`${puzzle.id}: toMove ${puzzle.toMove} but ${state.current} is to move`);
    if (!Array.isArray(puzzle.best) || puzzle.best.length === 0) throw new Error(`${puzzle.id}: best is empty`);
    for (const b of puzzle.best) if (!rules.isLegal(state, b, state.current)) throw new Error(`${puzzle.id}: best move ${b} is illegal`);
    return state;
}
const game = (puzzle) => puzzle.id.split("-")[0];

// grade one bot on its game's puzzles: { solved, total, pct, byTag: { tag: { solved, total } }, failures: [{ id, got, best }] }
export async function evaluateBot(H, botId, { difficulty, seed = 1, set } = {}) {
    const def = H.Bots.get(botId);
    if (!def) throw new Error(`unknown bot ${botId}`);
    const data = set || loadPuzzles(def.game);
    if (!data) return null;
    const result = { solved: 0, total: 0, pct: 0, chance: 0, byTag: {}, failures: [] };   // chance = what random picking would score
    let chance = 0;
    for (const puzzle of data.puzzles) {
        const state = positionOf(H, puzzle);
        chance += puzzle.best.length / H.Rules.of(def.game).legalMoves(state, state.current).length;
        const bot = H.Bots.create(botId, { me: state.current, difficulty, seed: seed + result.total, players: state.players });
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
