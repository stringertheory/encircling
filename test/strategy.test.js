var test = require('node:test');
var assert = require('node:assert');
var Encircling = require('../js/game.js');

var RED = 0, GREEN = 1, BLUE = 2, BLACK = 3;
var SEEDS = 60;

var play = function (seed, strategy) {
  return Encircling.play(Encircling.create_game({
    width: 1280, height: 800, scale: 14, seed: seed, strategy: strategy
  }));
};

var completed_sets = function (game) {
  return game.bigs.filter(function (big) {
    return big.completed_by !== null;
  }).length;
};

var total = function (strategy, measure) {
  var sum = 0;
  for (var seed = 1; seed <= SEEDS; seed++) {
    sum += measure(play(seed, strategy));
  }
  return sum;
};

var scene = function (seed) {
  var game = Encircling.create_game({
    width: 800, height: 800, scale: 14, seed: seed
  });
  game.smalls = [];
  game.small = function (x, y, color) {
    return Encircling.add_small(game, {x: x, y: y, r: 8, color: color}, []);
  };
  game.set = function (x, y, color, enclosed) {
    return Encircling.add_big(
      game, {x: x, y: y, r: 60, color: color}, enclosed
    );
  };
  return game;
};

test('one big circle can encircle several small circles', function () {
  var game = scene(1);
  var red = game.small(380, 400, RED);
  var blue = game.small(420, 400, BLUE);
  var enclosed = Encircling.check_big(
    game, {x: 400, y: 400, r: 50, color: BLACK}
  );
  assert.deepEqual(enclosed, [red, blue]);
});

test('encircling two small circles earns two new members', function () {
  var seen = false;
  for (var seed = 1; seed <= 20; seed++) {
    var game = scene(seed);
    game.small(380, 400, RED);
    game.small(420, 400, BLUE);
    var open = game.small(600, 600, RED);
    game.set(600, 600, BLACK, [open]);
    var turn = Encircling.take_turn(game, GREEN);
    assert.equal(turn.enclosed, turn.big.members.length);
    if (turn.enclosed === 2) {
      seen = true;
      assert.ok(turn.members.length <= 2);
    }
  }
  assert.ok(seen);
});

test('a player completes a set when they can', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var game = scene(seed);
    var red = game.small(350, 370, RED);
    var blue = game.small(450, 370, BLUE);
    var green = game.small(400, 455, GREEN);
    var target = game.set(400, 400, BLACK, [red, blue, green]);
    game.set(310, 340, GREEN, [red]);
    game.set(490, 340, GREEN, [blue]);
    // connects just as well as the completing move, but completes nothing
    game.set(650, 650, BLACK, [game.small(690, 650, GREEN)]);
    var turn = Encircling.take_turn(game, RED);
    assert.deepEqual(turn.completed, [target], 'seed ' + seed);
    assert.equal(target.completed_by, RED);
  }
});

test('a player connects to a set rather than start a new one', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var game = scene(seed);
    var member = game.small(240, 200, RED);
    game.set(200, 200, BLACK, [member]);
    game.small(600, 600, RED); // free, so encircling it connects nothing
    var turn = Encircling.take_turn(game, GREEN);
    assert.deepEqual(turn.big.members, [member], 'seed ' + seed);
  }
});

test('new members go to the set closest to being complete', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var game = scene(seed);
    var fuller = game.set(200, 200, BLACK, [
      game.small(160, 180, RED),
      game.small(240, 180, BLUE)
    ]);
    game.set(600, 600, BLACK, [game.small(600, 560, RED)]);
    game.small(400, 400, RED);
    var turn = Encircling.take_turn(game, GREEN);
    assert.ok(turn.members.length > 0, 'seed ' + seed);
    assert.equal(turn.members[0].sets[0], fuller, 'seed ' + seed);
  }
});

test('a big circle can complete itself', function () {
  var game = scene(1);
  var first = game.small(380, 385, RED);
  var second = game.small(420, 385, BLUE);
  var third = game.small(400, 425, GREEN);
  game.set(340, 340, GREEN, [first]);
  game.set(460, 340, GREEN, [second]);
  game.set(400, 480, RED, [third]);
  var big = Encircling.add_big(
    game, {x: 400, y: 400, r: 50, color: BLACK}, [first, second, third]
  );
  assert.deepEqual(Encircling.mark_completed(game, BLACK), [big]);
});

test('players encircle more than one small circle in real games', function () {
  var groups = total(true, function (game) {
    return game.turns.filter(function (turn) {
      return turn.enclosed > 1;
    }).length;
  });
  assert.ok(groups > 0);
});

test('completed sets are grouped by what connects them', function () {
  var game = scene(1);
  var link = game.small(400, 400, BLUE);
  var first = game.set(350, 400, BLACK, [link]);
  var second = game.set(450, 400, GREEN, [link]);
  var apart = game.set(700, 700, BLACK, [game.small(700, 700, RED)]);
  var unfinished = game.set(100, 100, RED, [game.small(100, 100, BLUE)]);
  first.completed_by = second.completed_by = apart.completed_by = RED;
  assert.deepEqual(Encircling.completed_groups(game), [[first, second], [apart]]);
  assert.equal(unfinished.completed_by, null);
});

test('strategy connects far more completed sets than random', function () {
  var largest = function (game) {
    var groups = Encircling.completed_groups(game);
    return groups.length > 0 ? groups[0].length : 0;
  };
  var strategic = total(true, largest);
  var random = total(false, largest);
  assert.ok(
    strategic > 3 * random,
    'strategy ' + strategic + ' vs random ' + random
  );
});

test('strategy completes far more sets than random play', function () {
  var strategic = total(true, completed_sets);
  var random = total(false, completed_sets);
  assert.ok(
    strategic > 1.25 * random,
    'strategy ' + strategic + ' vs random ' + random
  );
});
