var test = require('node:test');
var assert = require('node:assert');
var Encircling = require('../js/game.js');
var find_violations = require('./oracle.js').find_violations;

var RED = 0, GREEN = 1, BLUE = 2, BLACK = 3;
var SEEDS = 20;

var empty_game = function () {
  var game = Encircling.create_game({
    width: 800, height: 800, scale: 14, seed: 1
  });
  game.smalls = [];
  return game;
};

var small = function (game, x, y, color, sets) {
  return Encircling.add_small(game, {x: x, y: y, r: 8, color: color}, sets || []);
};

var big = function (x, y, r, color) {
  return {x: x, y: y, r: r, color: color};
};

var set = function (game, x, y, r, color, enclosed) {
  return Encircling.add_big(game, big(x, y, r, color), enclosed);
};

test('a set cannot enclose its own color', function () {
  var game = empty_game();
  small(game, 400, 400, BLACK);
  assert.equal(Encircling.check_big(game, big(400, 400, 50, BLACK)), null);
});

test('a set cannot contain the same color twice', function () {
  var game = empty_game();
  small(game, 380, 400, RED);
  small(game, 420, 400, RED);
  assert.equal(Encircling.check_big(game, big(400, 400, 60, BLACK)), null);
});

test('a big circle cannot run through a small circle', function () {
  var game = empty_game();
  small(game, 400, 400, RED);
  assert.equal(Encircling.check_big(game, big(450, 400, 50, BLACK)), null);
});

test('a small circle cannot be in a third set', function () {
  var game = empty_game();
  var shared = small(game, 400, 400, RED);
  set(game, 350, 400, 62, BLACK, [shared]);
  set(game, 450, 400, 62, GREEN, [shared]);
  assert.equal(Encircling.check_big(game, big(400, 450, 62, BLUE)), null);
});

test('sets may overlap around one shared member', function () {
  var game = empty_game();
  var shared = small(game, 400, 400, BLUE);
  set(game, 350, 400, 62, BLACK, [shared]);
  assert.deepEqual(
    Encircling.check_big(game, big(450, 400, 62, GREEN)), [shared]
  );
});

test('sets may not overlap around nothing', function () {
  var game = empty_game();
  var member = small(game, 300, 400, BLUE);
  var loner = small(game, 520, 400, RED);
  set(game, 340, 400, 62, BLACK, [member]);
  assert.equal(Encircling.check_big(game, big(460, 400, 70, GREEN)), null);
  assert.ok(loner);
});

test('sets may not overlap around two members', function () {
  var game = empty_game();
  var first = small(game, 400, 380, BLUE);
  var second = small(game, 400, 420, RED);
  set(game, 350, 400, 70, BLACK, [first, second]);
  assert.equal(Encircling.check_big(game, big(450, 400, 70, GREEN)), null);
});

test('one big circle cannot sit inside another', function () {
  var game = empty_game();
  var shared = small(game, 400, 400, BLUE);
  set(game, 400, 400, 70, BLACK, [shared]);
  assert.equal(Encircling.check_big(game, big(400, 400, 36, GREEN)), null);
});

// the intersection examples from the workshop's diagram
var diagram = function () {
  var game = empty_game();
  var red = small(game, 392, 412, RED);
  var blue = small(game, 475, 445, BLUE);
  set(game, 420, 460, 70, BLACK, [red, blue]);
  var black = small(game, 462, 362, BLACK);
  set(game, 500, 400, 68, GREEN, [blue, black]);
  return {game: game, red: red, black: black};
};

test('diagram: three sets cannot intersect at one location', function () {
  var scene = diagram();
  // shares a member with both sets, so only the three-way overlap is wrong
  var candidate = big(415, 372, 62, GREEN);
  assert.equal(Encircling.check_big(scene.game, candidate), null);
});

test('diagram: sets cannot touch without a shared member', function () {
  var scene = diagram();
  assert.equal(Encircling.check_big(scene.game, big(405, 375, 60, GREEN)), null);
});

test('diagram: right intersection is accepted', function () {
  var scene = diagram();
  assert.deepEqual(
    Encircling.check_big(scene.game, big(350, 395, 60, GREEN)), [scene.red]
  );
});

test('a new member must land in exactly its own set', function () {
  var game = empty_game();
  var shared = small(game, 400, 400, BLUE);
  var left = set(game, 350, 400, 62, BLACK, [shared]);
  var right = set(game, 450, 400, 62, GREEN, [shared]);
  var in_overlap = {x: 400, y: 435, r: 8, color: RED};
  var in_left = {x: 320, y: 400, r: 8, color: RED};
  assert.deepEqual(Encircling.check_small(game, in_left), [left]);
  var containing = Encircling.check_small(game, in_overlap);
  assert.ok(containing === null || containing.length === 2);
  assert.ok(right);
});

test('sets may not nearly coincide', function () {
  var game = empty_game();
  var shared = small(game, 400, 400, BLUE);
  set(game, 385, 400, 62, BLACK, [shared]);
  assert.equal(Encircling.check_big(game, big(415, 400, 62, GREEN)), null);
});

test('finished games break no rule, with either kind of player', function () {
  [true, false].forEach(function (strategy) {
    for (var seed = 1; seed <= SEEDS; seed++) {
      var game = Encircling.play(Encircling.create_game({
        width: 1280, height: 800, scale: 14, seed: seed, strategy: strategy
      }));
      assert.deepEqual(find_violations(game), [], 'seed ' + seed);
      assert.ok(game.bigs.length > 4, 'seed ' + seed + ' barely played');
    }
  });
});

test('the same seed gives the same game', function () {
  var run = function () {
    var game = Encircling.play(Encircling.create_game({
      width: 1280, height: 800, scale: 14, seed: 7
    }));
    return game.bigs.map(function (b) {
      return [b.x, b.y, b.r, b.color];
    });
  };
  assert.deepEqual(run(), run());
});
