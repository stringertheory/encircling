# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A generative-art simulation of the Conditional Design "Encircling" workshop
(http://www.conditionaldesign.org/workshops/encircling/). Four simulated players take turns
drawing circles under the workshop's rules. It is a static page using Paper.js, with no
build step or package manager.

A multiplayer version for phones is planned: people take turns on their own devices, a
PartyServer room on Cloudflare enforces the rules with the same `game.js`, and everyone sees
"ghost" circles where others are considering a mark. So far only the engine side exists
(see "Games played by people" below).

## Commands

```sh
python3 -m http.server 8000                       # then open http://localhost:8000
node --test test/*.test.js                        # all tests, about 35 seconds
node --test --test-name-pattern="diagram" test/*.test.js   # tests matching a name
```

The page must be served over HTTP because Paper.js fetches `js/main.js` itself. Reload for a
new drawing, add `?seed=123` to reproduce one, or `?still` to skip the animation. A seed only reproduces a drawing at the
same window size, because the canvas size is part of the game. Tests do not cover rendering,
so check the fill and layout by looking at the page.

## Architecture

**`js/game.js` is the rules engine; `js/main.js` only draws.** `game.js` is plain JavaScript
with no Paper.js dependency, exposed as `window.Encircling` in the browser and through
`module.exports` in Node. `main.js` is PaperScript (`type="text/paperscript"`), so it uses
`Path`, `Point`, and `Color` without a prefix and cannot run in Node. Put rule changes in
`game.js`, where they can be tested.

**The whole game is played at load, then replayed as an animation.** `timeline` lists
everything in drawing order and `main.js` draws one step at a time. Nothing is redrawn on
resize.

**The page calls `play_drawing`, not `play`.** About 7% of games box themselves in before a
core forms: nothing legal is left, not just unfound, and only completing sets brings new free
circles. `play_drawing` then starts again from the next seed, so a seed still reproduces its
drawing. Tests and measurements use `play`, which shows these stalls.

**Each `take_turn` follows the workshop's order:** draw one big circle, draw one new member
per small circle enclosed, then, for each set completed, draw two more members and one free
small circle outside the sets.

**Membership comes from geometry.** `check_big` and `check_small` work out what a proposed
circle would contain and return `null` if it breaks a rule. `examine_big` and
`examine_small` do the same work but say which rule, in words for players (`REASONS`). Placement proposes random
circles and keeps the legal ones, so "no legal move" means none was found. `sets` on a small
and `members` on a big record the same links from both sides; change them only through
`add_small` and `add_big`.

**Players work on a shared honeycomb, and that placement matters far more than scoring.**
Each set has three neighbors, so connected completed sets form a honeycomb, and rings only
close if every set is on the same grid. Sets go on cells (`sites_near`, `propose_site`) with a
slight wobble, and members and free circles go on edges (`edges_of`). Adjacent sets that do
not share a member are illegal, so an off-grid or badly placed circle can block a cell for
good. So the drawing does not look mechanical, `warped` bends the whole grid smoothly, which
keeps neighbors aligned. The room for this is small: a set must reach its members but stay
clear of the sets two cells away, and group size collapses above a `GRID_WARP` of about 0.4,
even with radii fitted to each cell. Play starts near the center and stops at `MAX_TURNS`, which leaves one core with free
circles scattered around it, as in the workshop's photo.

`completed_groups` measures the workshop's goal: the largest group of connected completed
sets. Measure changes against it, because most of `WEIGHTS` barely moves it: `connection`
and the `centered` tie-breaker matter, while `completion` is kept for sensible play. Pass
`strategy: false` to `create_game` for random, off-grid players, which the tests use as a
baseline.

**Games played by people are a log of moves.** `create_shared_game` starts an empty game on
fixed A3 portrait paper, with each player owing a free small circle. `apply_move` plays one
step at a time and returns `{ok: false, reason}` for anything illegal or out of turn;
`check_move` asks the same without changing the game, for previews. Moves are plain JSON
(`{color, kind: 'big' | 'small' | 'pass', x, y, r}`), so the log can be stored and sent, and
`replay` rebuilds a game from it. The game keeps a queue of owed steps (`owed`) and builds
the same `turns` and `initial` as a simulated game, so `timeline` and `main.js` work on both.
Simulated players do not use moves, but a test replays their games move by move, which keeps
the two paths to the same rules. Only moves check sizes (5-10 and 1-2 cm), because test
scenes call `check_big` with any size.

**`test/oracle.js` must stay independent of `js/game.js`.** It re-checks finished games from
positions, sizes, and colors alone, and finds three-way overlaps by brute force. Do not
import engine helpers into it.

## Rules

The workshop's rules, as implemented:

- A set is a big circle (5-10 cm diameter) of one color containing three small circles
  (1-2 cm) of the three other colors, never the same color twice.
- A small circle should belong to two sets, and cannot belong to more.
- No location may be inside three sets (the "wrong intersection" in the workshop's diagram).
- A set is complete when all three members also belong to another set, so it intersects
  exactly three sets. The area not intersected is filled with the color of the player who
  completed it.

Our reading of the diagram: two sets may overlap only around exactly one shared member.

Choices the rules do not cover:

- A player with nothing to encircle passes, rather than drawing an empty big circle.
- A member with no legal position is skipped. People can give up any owed step by passing,
  because nothing can prove a step is impossible.
- The game ends at `MAX_TURNS`, or sooner if every player passes in a row. Random players
  and people have no turn limit; only passing a big circle counts toward the end.
- Packing players only use the honeycomb, so they pass when no cell is legal even if an
  off-grid move exists.
- Circles stay on the paper, small circles do not touch, and no circle crosses a big
  circle's line unless it is a big circle overlapping around a shared member.
- `MIN_SEPARATION` stops crossing sets from nearly coinciding. This is for appearance only.

## Known gaps

- jQuery is loaded but not used.
- Colors differ from the workshop's red, green, blue, and black: orange replaces red, and
  black is dark gray.
