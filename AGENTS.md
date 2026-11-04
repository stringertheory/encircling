# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A generative-art simulation of the Conditional Design "Encircling" workshop
(http://www.conditionaldesign.org/workshops/encircling/). Four simulated players take turns
drawing circles under the workshop's rules. It is a static page using Paper.js, with no
build step or package manager.

## Commands

```sh
python3 -m http.server 8000                       # then open http://localhost:8000
node --test test/*.test.js                        # all tests, about 2 minutes
node --test --test-name-pattern="diagram" test/*.test.js   # tests matching a name
```

The page must be served over HTTP because Paper.js fetches `js/main.js` itself. Reload for a
new drawing, or add `?seed=123` to reproduce one. A seed only reproduces a drawing at the
same window size, because the canvas size is part of the game. Tests do not cover rendering,
so check the fill and layout by looking at the page.

## Architecture

**`js/game.js` is the rules engine; `js/main.js` only draws.** `game.js` is plain JavaScript
with no Paper.js dependency, exposed as `window.Encircling` in the browser and through
`module.exports` in Node. `main.js` is PaperScript (`type="text/paperscript"`), so it uses
`Path`, `Point`, and `Color` without a prefix and cannot run in Node. Put rule changes in
`game.js`, where they can be tested.

**The whole game is played synchronously at load, then drawn once.** There is no animation,
and nothing is redrawn on resize.

**Each `take_turn` follows the workshop's order:** draw one big circle, draw one new member
per small circle enclosed, then, for each set completed, draw two more members and one free
small circle outside the sets.

**Membership comes from geometry.** `check_big` and `check_small` work out what a proposed
circle would contain and return `null` if it breaks a rule. Placement proposes random
circles and keeps the legal ones, so "no legal move" means none was found. `sets` on a small
and `members` on a big record the same links from both sides; change them only through
`add_small` and `add_big`.

**Players are greedy, and how they place circles matters more than how they score moves.**
Each set has three neighbors, so connected completed sets form a honeycomb. Players keep sets
a similar size (`PREFERRED_DIAMETER`), spread members 120° apart (`MEMBER_REACH`), and mirror
a set across a member for the next cell (`propose_neighbor`). This raised the largest
connected group of completed sets far more than any change to `WEIGHTS` in `score_move`.
That group size, from `completed_groups`, is the measure of the workshop's goal. Pass
`strategy: false` to `create_game` for random players, which the tests use as a baseline.

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
- A member with no legal position is skipped.
- The game ends when every player passes in a row.
- Circles stay on the paper, small circles do not touch, and no circle crosses a big
  circle's line unless it is a big circle overlapping around a shared member.
- `MIN_SEPARATION` stops crossing sets from nearly coinciding. This is for appearance only.

## Known gaps

- `index.html`'s Underscore fallback points to `js/underscore.min.js`, but the file is
  `js/underscore-min.js`, so the local fallback fails if the CDN is unreachable.
- jQuery is loaded but not used.
- Colors differ from the workshop's red, green, blue, and black: orange replaces red, and
  black is dark gray.
