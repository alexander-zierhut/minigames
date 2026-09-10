/* Sounds: Bus event → cue mapping with a fake player, the local human's perspective,
   the preference gates (volume, categories) and the sound set (look / override). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDom } from "./dom.mjs";

function setup(kinds = ["local", "remote"]) {
    const w = loadDom();
    const S = w.eval("Sound"), Bus = w.eval("Bus"), Prefs = w.eval("Prefs"), Skins = w.eval("Skins");
    const played = [];
    let seats = kinds;
    S.init({ seats: () => seats, player: { play: (cue) => played.push(cue) } });
    return { w, S, Bus, Prefs, Skins, played, setSeats: (k) => { seats = k; }, names: () => played.map((c) => c.name) };
}

test("perspective: exactly one local seat among others is me; local-only or spectating is nobody", () => {
    const { S, w } = setup();
    assert.equal(S.me(["local", "remote"]), 0);
    assert.equal(S.me(["remote", "local", "remote"]), 1);
    assert.equal(S.me(["local", "bot"]), 0);
    assert.equal(S.me(["local", "local"]), -1, "two people on one device");
    assert.equal(S.me(["remote", "remote", "remote"]), -1, "spectator");
    assert.equal(S.me([]), -1);
    w.close();
});

test("events map to cues: place, fuse, blast, win/lose/over, your turn, pop, chat", () => {
    const { S, Bus, played, names, setSeats, w } = setup(["local", "remote"]);
    Bus.emit("game:move", { game: "chain", cell: 3, player: 1 });
    Bus.emit("chain:prime", { cells: [3], player: 1, ms: 450 });
    Bus.emit("chain:explode", { cells: [3], player: 1, chain: 1 });
    Bus.emit("chain:explode", { cells: [3, 4, 5], player: 1, chain: 7 });
    assert.equal(JSON.stringify(names()), JSON.stringify(["place", "prime", "explode", "explode"]));
    assert.equal(played[1].until, 450, "the fuse lasts as long as the prime phase");
    assert.ok(played[3].gain > played[2].gain, "a longer chain blasts louder");
    played.length = 0;
    Bus.emit("game:turn", { game: "chain", player: 0 });
    Bus.emit("game:turn", { game: "chain", player: 1 });
    assert.equal(JSON.stringify(names()), JSON.stringify(["turn"]), "cue only when it becomes my turn");
    played.length = 0;
    Bus.emit("game:finish", { game: "chain", winner: 0, why: "x" });
    Bus.emit("game:finish", { game: "chain", winner: 1, why: "x" });
    Bus.emit("game:finish", { game: "chain", winner: -1, why: "x" });
    assert.equal(JSON.stringify(names()), JSON.stringify(["win", "lose", "over"]));
    played.length = 0;
    setSeats(["local", "local"]);                              // same device: no perspective, no turn cue
    Bus.emit("game:finish", { game: "five", winner: 0, why: "x" });
    Bus.emit("game:turn", { game: "five", player: 1 });
    assert.equal(JSON.stringify(names()), JSON.stringify(["over"]));
    played.length = 0;
    setSeats(["local", "bot"]);                                // against a bot: I am seat 0
    Bus.emit("game:finish", { game: "five", winner: 1, why: "x" });
    Bus.emit("game:turn", { game: "five", player: 0 });
    assert.equal(JSON.stringify(names()), JSON.stringify(["lose", "turn"]));
    played.length = 0;
    setSeats(["remote", "remote"]);                            // spectating: neutral end, never "your turn"
    Bus.emit("game:finish", { game: "five", winner: 1, why: "x" });
    Bus.emit("game:turn", { game: "five", player: 0 });
    assert.equal(JSON.stringify(names()), JSON.stringify(["over"]));
    played.length = 0;
    Bus.emit("reaction", { emoji: "🔥", theirs: true });
    Bus.emit("reaction", { emoji: "🔥", theirs: false });
    Bus.emit("chat", { text: "hi", from: 1, mine: false });
    Bus.emit("chat", { text: "hi", from: 0, mine: true });
    assert.equal(JSON.stringify(names()), JSON.stringify(["reaction", "reaction", "chat"]), "own chat lines are silent");
    assert.equal(S.map("something:else", {}, ["local", "remote"]), null);
    w.close();
});

test("preferences gate the cues: master volume, categories; the log remembers what passed", () => {
    const { S, Bus, Prefs, played, names, w } = setup();
    Prefs.set({ volume: 50 });
    Bus.emit("game:move", { player: 0 });
    const loud = played[0].gain;
    Prefs.set({ volume: 25 });
    Bus.emit("game:move", { player: 0 });
    assert.ok(played[1].gain < loud, "volume scales the gain");
    Prefs.set({ volume: 0 });
    Bus.emit("game:move", { player: 0 });
    Bus.emit("chain:explode", { cells: [1], chain: 1 });
    assert.equal(played.length, 2, "volume 0 = silence");
    Prefs.set({ volume: 30, sounds: { explosions: false, turn: false } });
    Bus.emit("chain:explode", { cells: [1], chain: 1 });
    Bus.emit("chain:prime", { cells: [1] });
    Bus.emit("game:turn", { player: 0 });
    Bus.emit("game:move", { player: 1 });
    assert.equal(JSON.stringify(names().slice(2)), JSON.stringify(["place"]), "switched-off categories stay silent");
    assert.equal(JSON.stringify(S.log.map((l) => l.name)), JSON.stringify(["place", "place", "place"]));
    assert.equal(S.play("nonsense"), false);
    w.close();
});

test("sound set follows the look unless overridden; every cue has a file for the mc set", () => {
    const { S, Bus, Prefs, Skins, played, w } = setup();
    assert.equal(S.set, "classic");
    Skins.set("mcboard");
    assert.equal(S.set, "mc");
    Skins.set("mc");
    assert.equal(S.set, "mc");
    Prefs.set({ soundSet: "classic" });
    assert.equal(S.set, "classic", "override wins over the look");
    Prefs.set({ soundSet: "mc" });
    Skins.set("classic");
    assert.equal(S.set, "mc");
    Bus.emit("game:move", { player: 0 });
    assert.equal(played[0].set, "mc");
    assert.match(played[0].url, /^client\/sounds\/[a-z0-9_]+\.ogg$/);
    for (const [name, url] of Object.entries(S.FILES)) { assert.match(url, /^client\/sounds\//, name); assert.ok(S.CATEGORY[name], `${name} has a category`); }
    assert.equal(S.unlocked, false, "a fake player never unlocks audio");
    w.close();
});

test("the real player never throws without an AudioContext (jsdom) and stays locked until a gesture", () => {
    const w = loadDom();
    const S = w.eval("Sound"), Bus = w.eval("Bus");
    S.init({ seats: () => ["local", "remote"] });
    assert.equal(S.unlocked, false);
    assert.doesNotThrow(() => Bus.emit("game:move", { player: 0 }));
    w.window.dispatchEvent(new w.Event("pointerdown"));
    assert.equal(S.state, "none", "no AudioContext in jsdom: still nothing to play with");
    assert.doesNotThrow(() => Bus.emit("chain:explode", { cells: [0], chain: 2 }));
    w.close();
});
