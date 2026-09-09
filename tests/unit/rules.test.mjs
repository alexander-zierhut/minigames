/* The rules modules are pure: they run in a bare VM context without any DOM.
   This is also what a future bot would drive (legalMoves + place/settle/conclude). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../../", import.meta.url).pathname;
const FILES = ["client/lib/util.js", "client/games/rules.js", "client/games/chain-rules.js", "client/games/five-rules.js"];

function loadRules() {
    const ctx = vm.createContext({ document: undefined });
    for (const f of FILES) vm.runInContext(readFileSync(ROOT + f, "utf8"), ctx, { filename: f });
    return vm.runInContext("({ Rules, ChainRules, FiveRules })", ctx);   // top-level consts are not context properties
}
const chain = (config) => { const { Rules, ChainRules } = loadRules(); return { R: ChainRules, s: ChainRules.create(config, Rules.base(config)) }; };
const five = (config) => { const { Rules, FiveRules } = loadRules(); return { R: FiveRules, s: FiveRules.create(config, Rules.base(config)) }; };
function move(R, s, i) {
    const me = s.current;
    assert.equal(R.isLegal(s, i, me), true, `move ${i} legal for ${me}`);
    R.place(s, i, me);
    R.settle(s, me);
    const r = R.conclude(s, me);
    if (r) { s.over = true; s.winner = r.winner; s.finishWhy = r.why; }
    return r;
}

test("no DOM needed: Util/Rules/ChainRules/FiveRules load in a bare context", () => {
    const { Rules, ChainRules, FiveRules } = loadRules();
    assert.ok(Rules && ChainRules && FiveRules);
    assert.equal(typeof ChainRules.legalMoves, "function");
});

test("Rules.base + pass: rotation and rounds for 2 and 3 players", () => {
    const { Rules } = loadRules();
    const s = Rules.base({ n: 3, players: 3, startPlayer: 1 });
    assert.equal(JSON.stringify(s.movesBy), "[0,0,0]");
    Rules.pass(s); assert.equal(s.current, 2); assert.equal(s.round, 1);
    Rules.pass(s); assert.equal(s.current, 0); assert.equal(s.round, 2, "wrapping starts a new round");
    Rules.pass(s, [true, false, true]); assert.equal(s.current, 2, "eliminated player skipped");
    const t = Rules.base({ n: 3 });
    assert.equal(t.players, 2);
    Rules.pass(t); assert.equal(t.current, 1); Rules.pass(t); assert.equal(t.current, 0); assert.equal(t.round, 2);
});

test("chain: legalMoves, place, settle and conclude agree with the engine tests", () => {
    const { R, s } = chain({ n: 3 });
    assert.equal(R.legalMoves(s, 0).length, 9);
    move(R, s, 0); move(R, s, 8); move(R, s, 0);              // corner explodes into 1 and 3
    assert.equal(s.cells[0].count, 0); assert.equal(s.cells[1].owner, 0); assert.equal(s.cells[3].owner, 0);
    assert.equal(R.legalMoves(s, 1).length, 9 - 2, "p1 may not play on p0's two cells");
    assert.equal(s.current, 1); assert.equal(s.chainBest, 1); assert.equal(s.explosions, 1);
});

test("chain with 3 players: a player who lost every cell is skipped, last owner wins", () => {
    const { R, s } = chain({ n: 3, players: 3 });
    move(R, s, 8); move(R, s, 1); move(R, s, 4);              // p0 corner, p1 edge, p2 centre
    move(R, s, 8);                                            // p0 corner explodes: takes 5 (p1's? no: 5,7) -> 5 and 7
    assert.equal(s.current, 1, "rotation continues");
    move(R, s, 1); move(R, s, 4); move(R, s, 8);              // p0's corner explodes again: 5 and 7 grow
    assert.equal(s.over, false);
    // p1 (edge cell 1, cap 3) has 2 pieces; p1 explodes on its next move into 0, 2, 4 and converts p2's centre
    move(R, s, 1);
    assert.equal(s.cells[4].owner, 1, "centre converted by p1");
    const alive = R.tally(s).map((t, p) => t.cells > 0 || s.movesBy[p] === 0);
    assert.equal(alive[2], false, "p2 owns nothing after having moved");
    assert.equal(s.current, 0, "p2 is skipped: after p1 comes p0");
});

test("chain: chain rule wins at the configured length (instant path)", () => {
    const { R, s } = chain({ n: 3, chainRule: true, chainLen: 2 });
    for (const i of [0, 1, 3, 1, 6, 8]) move(R, s, i);
    const r = move(R, s, 0);
    assert.equal(r.winner, 0); assert.match(r.why, /Chain reaction of 2/);
});

test("five: lineThrough, bestRow, win, draw and legalMoves", () => {
    const { R, s } = five({ n: 5, winLen: 4 });
    for (const i of [0, 5, 1, 6, 2, 7]) move(R, s, i);
    assert.equal(R.bestRow(s, 0), 3); assert.equal(R.lineThrough(s, 6).len, 3);
    assert.equal(R.legalMoves(s).length, 25 - 6);
    const r = move(R, s, 3);
    assert.equal(r.winner, 0); assert.equal(JSON.stringify(s.winLine.sort()), "[0,1,2,3]");
    const d = five({ n: 3, winLen: 3 });
    for (const i of [0, 1, 2, 4, 3, 5, 7, 6]) move(d.R, d.s, i);
    assert.equal(move(d.R, d.s, 8).winner, -1, "full board is a draw");
});
