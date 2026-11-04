var test = require('node:test');
var assert = require('node:assert');
var Encircling = require('../js/game.js');
var find_violations = require('./oracle.js').find_violations;

var RED = 0, GREEN = 1, BLUE = 2, BLACK = 3;
var SEEDS = 20;

var played = {};
var play = function (seed) {
  played[seed] = played[seed] || Encircling.play(Encircling.create_game({
    width: 1280, height: 800, scale: 14, seed: seed
  }));
  return played[seed];
};

// the completed set from the workshop's diagram: a black set whose red,
// blue, and green members are each shared with one other set
var diagram = function () {
  var game = Encircling.create_game({
    width: 800, height: 800, scale: 14, seed: 1
  });
  game.smalls = [];
  var small = function (x, y, color) {
    return Encircling.add_small(game, {x: x, y: y, r: 8, color: color}, []);
  };
  var set = function (x, y, color, enclosed) {
    return Encircling.add_big(
      game, {x: x, y: y, r: 60, color: color}, enclosed
    );
  };
  var red = small(350, 370, RED);
  var blue = small(450, 370, BLUE);
  var green = small(400, 455, GREEN);
  var black_set = set(400, 400, BLACK, [red, blue, green]);
  set(310, 340, GREEN, [red]);
  set(490, 340, GREEN, [blue]);
  return {game: game, set: black_set, last: green};
};

test('a set with an unshared member is not complete', function () {
  var scene = diagram();
  assert.equal(Encircling.is_complete(scene.set), false);
  assert.deepEqual(Encircling.mark_completed(scene.game, RED), []);
  assert.equal(scene.set.completed_by, null);
});

test('a set with two members is not complete', function () {
  var scene = diagram();
  scene.set.members.pop();
  assert.equal(Encircling.is_complete(scene.set), false);
});

test('sharing the last member completes the set', function () {
  var scene = diagram();
  Encircling.add_big(
    scene.game, {x: 400, y: 510, r: 60, color: RED}, [scene.last]
  );
  assert.deepEqual(Encircling.mark_completed(scene.game, RED), [scene.set]);
  assert.equal(scene.set.completed_by, RED);
  assert.equal(Encircling.neighbors_of(scene.set).length, 3);
});

test('a completed set keeps the color that completed it', function () {
  var scene = diagram();
  Encircling.add_big(
    scene.game, {x: 400, y: 510, r: 60, color: RED}, [scene.last]
  );
  Encircling.mark_completed(scene.game, RED);
  assert.deepEqual(Encircling.mark_completed(scene.game, BLUE), []);
  assert.equal(scene.set.completed_by, RED);
});

test('finished games break no rule', function () {
  for (var seed = 1; seed <= SEEDS; seed++) {
    assert.deepEqual(find_violations(play(seed)), [], 'seed ' + seed);
  }
});

test('turns draw only the circles the rules allow', function () {
  var bonuses = 0;
  for (var seed = 1; seed <= SEEDS; seed++) {
    var game = play(seed);
    var drawn = game.players;
    game.turns.forEach(function (turn) {
      var count = turn.completed.length;
      bonuses += count;
      assert.ok(turn.members.length <= turn.enclosed);
      assert.ok(turn.bonus_members.length <= 2 * count);
      assert.ok(turn.bonus_free.length <= count);
      turn.members.concat(turn.bonus_members, turn.bonus_free)
        .forEach(function (small) {
          assert.equal(small.color, turn.color);
        });
      turn.completed.forEach(function (big) {
        assert.equal(big.completed_by, turn.color);
      });
      drawn += turn.members.length + turn.bonus_members.length +
        turn.bonus_free.length;
    });
    assert.equal(game.smalls.length, drawn, 'seed ' + seed);
  }
  assert.ok(bonuses > 0, 'no game completed a set');
});

test('free small circles only come from the start or a bonus', function () {
  for (var seed = 1; seed <= SEEDS; seed++) {
    var game = play(seed);
    var allowed = game.smalls.slice(0, game.players);
    game.turns.forEach(function (turn) {
      allowed = allowed.concat(turn.bonus_free);
    });
    game.smalls.forEach(function (small) {
      if (small.sets.length === 0) {
        assert.ok(allowed.indexOf(small) !== -1, 'seed ' + seed);
      }
    });
  }
});

test('a game ends with almost no legal move left', function () {
  var open = 0;
  var movable = 0;
  for (var seed = 1; seed <= 10; seed++) {
    // packing players stop when the honeycomb has no legal cell left
    var game = Encircling.play(Encircling.create_game({
      width: 1280, height: 800, scale: 14, seed: seed, strategy: false
    }));
    game.smalls.filter(function (small) {
      return small.sets.length < 2;
    }).forEach(function (small) {
      open += 1;
      var found = false;
      for (var i = 0; i < 12000 && !found; i++) {
        var r = 35 + Math.random() * 35;
        var angle = Math.random() * 2 * Math.PI;
        var offset = Math.random() * (r - small.r);
        var enclosed = Encircling.check_big(game, {
          x: small.x + offset * Math.cos(angle),
          y: small.y + offset * Math.sin(angle),
          r: r,
          color: (small.color + 1 + i % 3) % 4
        });
        found = Boolean(enclosed && enclosed.indexOf(small) !== -1);
      }
      movable += found ? 1 : 0;
    });
  }
  assert.ok(open > 0);
  assert.ok(movable / open < 0.1, movable + ' of ' + open + ' still movable');
});
