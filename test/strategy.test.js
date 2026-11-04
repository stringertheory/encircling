var test = require('node:test');
var assert = require('node:assert');
var Encircling = require('../js/game.js');

var RED = 0, GREEN = 1, BLUE = 2, BLACK = 3;
var SEEDS = 30;

var played = {};
var play = function (seed, strategy) {
  var key = seed + ':' + strategy;
  played[key] = played[key] || Encircling.play(Encircling.create_game({
    width: 1280, height: 800, scale: 14, seed: seed, strategy: strategy
  }));
  return played[key];
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

// builds a scene on the game's honeycomb
var grid_scene = function (seed) {
  var game = scene(seed);
  game.site = function (x, y) {
    return Encircling.sites_near(game, {x: x, y: y})[0];
  };
  game.edges = function (site) {
    return Encircling.edges_of(game, site);
  };
  game.across = function (site, edge) {
    return {
      x: 2 * edge.x - site.x, y: 2 * edge.y - site.y, up: !site.up
    };
  };
  game.on_edge = function (edge, color) {
    return game.small(edge.x, edge.y, color);
  };
  game.cell = function (site, color, enclosed) {
    return Encircling.add_big(game, {
      x: site.x, y: site.y, r: 50, color: color, site: site
    }, enclosed);
  };
  return game;
};

test('encircling two small circles earns two new members', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var game = grid_scene(seed);
    var site = game.site(400, 400);
    var edges = game.edges(site);
    game.on_edge(edges[0], RED);
    game.on_edge(edges[1], BLUE);
    // two sets with room for new members, but nothing left to connect to
    var far = game.site(650, 650);
    var edge = game.edges(far)[0];
    var shared = game.on_edge(edge, BLUE);
    game.cell(far, BLACK, [shared]);
    game.cell(game.across(far, edge), RED, [shared]);
    var turn = Encircling.take_turn(game, GREEN);
    assert.equal(turn.enclosed, 2, 'seed ' + seed);
    assert.equal(turn.members.length, 2, 'seed ' + seed);
  }
});

test('a player completes a set when they can', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var game = grid_scene(seed);
    var site = game.site(200, 200);
    var edges = game.edges(site);
    var red = game.on_edge(edges[0], RED);
    var blue = game.on_edge(edges[1], BLUE);
    var green = game.on_edge(edges[2], GREEN);
    var target = game.cell(site, BLACK, [red, blue, green]);
    game.cell(game.across(site, edges[0]), GREEN, [red]);
    game.cell(game.across(site, edges[1]), GREEN, [blue]);
    // connects just as well and nearer the center, but completes nothing
    var center = game.site(400, 400);
    game.cell(center, BLACK, [game.on_edge(game.edges(center)[0], GREEN)]);
    var turn = Encircling.take_turn(game, RED);
    assert.deepEqual(turn.completed, [target], 'seed ' + seed);
    assert.equal(target.completed_by, RED);
  }
});

test('a player connects to a set rather than start a new one', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var game = grid_scene(seed);
    var site = game.site(200, 200);
    var member = game.on_edge(game.edges(site)[0], RED);
    game.cell(site, BLACK, [member]);
    // free, so encircling it connects nothing
    game.on_edge(game.edges(game.site(600, 600))[0], RED);
    var turn = Encircling.take_turn(game, GREEN);
    assert.deepEqual(turn.big.members, [member], 'seed ' + seed);
  }
});

test('between equal moves, a player stays near the center', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var game = grid_scene(seed);
    var near = game.site(400, 400);
    var far = game.site(150, 150);
    var close_member = game.on_edge(game.edges(near)[0], RED);
    game.cell(near, BLACK, [close_member]);
    game.cell(far, BLACK, [game.on_edge(game.edges(far)[0], RED)]);
    var turn = Encircling.take_turn(game, GREEN);
    assert.deepEqual(turn.big.members, [close_member], 'seed ' + seed);
  }
});

test('play starts near the center of the paper', function () {
  for (var seed = 1; seed <= SEEDS; seed++) {
    var game = play(seed, true);
    assert.equal(game.initial.length, game.players);
    game.initial.forEach(function (small) {
      assert.ok(Math.abs(small.x - game.width / 2) < 0.2 * game.width);
      assert.ok(Math.abs(small.y - game.height / 2) < 0.2 * game.height);
    });
  }
});

test('new members go to the set closest to being complete', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var game = grid_scene(seed);
    var site = game.site(200, 200);
    var edges = game.edges(site);
    var fuller = game.cell(site, BLACK, [
      game.on_edge(edges[0], RED),
      game.on_edge(edges[1], BLUE)
    ]);
    var other = game.site(600, 600);
    game.cell(other, BLACK, [game.on_edge(game.edges(other)[0], RED)]);
    game.on_edge(game.edges(game.site(400, 500))[0], RED);
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

test('completed sets close into rings rather than branch', function () {
  var sets = 0;
  var links = 0;
  for (var seed = 1; seed <= SEEDS; seed++) {
    var group = Encircling.completed_groups(play(seed, true))[0] || [];
    sets += group.length;
    group.forEach(function (big) {
      Encircling.neighbors_of(big).forEach(function (neighbor) {
        links += group.indexOf(neighbor) === -1 ? 0 : 0.5;
      });
    });
  }
  // a group with no rings has one link fewer than it has sets
  assert.ok(links > sets, links + ' links between ' + sets + ' sets');
});

test('most completed sets join one core', function () {
  var in_core = 0;
  var all = 0;
  for (var seed = 1; seed <= SEEDS; seed++) {
    var game = play(seed, true);
    var groups = Encircling.completed_groups(game);
    in_core += groups.length > 0 ? groups[0].length : 0;
    all += completed_sets(game);
  }
  assert.ok(in_core > 0.65 * all, in_core + ' of ' + all);
});

test('play stops early, leaving free circles on the paper', function () {
  var free = 0;
  for (var seed = 1; seed <= SEEDS; seed++) {
    var game = play(seed, true);
    assert.ok(game.turns.length <= 80);
    free += game.smalls.filter(function (small) {
      return small.sets.length === 0;
    }).length;
  }
  assert.ok(free / SEEDS > 15, free / SEEDS + ' free circles per game');
});

test('the timeline draws everything once, in a drawable order', function () {
  for (var seed = 1; seed <= SEEDS; seed++) {
    var game = play(seed, true);
    var drawn = [];
    var filled = [];
    Encircling.timeline(game).forEach(function (step) {
      if (step.circle) {
        assert.equal(drawn.indexOf(step.circle), -1, 'drawn twice');
        drawn.push(step.circle);
        return;
      }
      assert.equal(filled.indexOf(step.fill), -1, 'filled twice');
      filled.push(step.fill);
      // a fill needs the set and all that intersects it on the paper
      [step.fill].concat(Encircling.neighbors_of(step.fill))
        .forEach(function (big) {
          assert.notEqual(drawn.indexOf(big), -1, 'filled too early');
        });
    });
    assert.equal(drawn.length, game.smalls.length + game.bigs.length);
    assert.equal(filled.length, completed_sets(game));
  }
});
