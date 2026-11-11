var test = require('node:test');
var assert = require('node:assert');
var Encircling = require('../js/game.js');
var oracle = require('./oracle.js');

var RED = 0, GREEN = 1, BLUE = 2, BLACK = 3;
var PAPER = {width: 1280, height: 800, scale: 14};

var circle_move = function (circle, kind) {
  return {color: circle.color, kind: kind, x: circle.x, y: circle.y,
          r: circle.r};
};

var pass = function (color) {
  return {color: color, kind: 'pass'};
};

// The moves people would have made to draw a simulated game. Simulated
// players skip members and free circles they cannot place, which people
// do by passing.
var moves_of = function (sim) {
  var moves = [];
  for (var color = 0; color < sim.players; color++) {
    var start = sim.initial.filter(function (small) {
      return small.color === color;
    })[0];
    moves.push(start ? circle_move(start, 'small') : pass(color));
  }
  var color_up = 0;
  sim.turns.forEach(function (turn) {
    while (color_up !== turn.color) {
      moves.push(pass(color_up));
      color_up = (color_up + 1) % sim.players;
    }
    moves.push(circle_move(turn.big, 'big'));
    for (var i = 0; i < turn.enclosed; i++) {
      moves.push(turn.members[i] ? circle_move(turn.members[i], 'small') :
        pass(turn.color));
    }
    var bonus = turn.bonus_members.slice();
    var free = turn.bonus_free.slice();
    turn.completed.forEach(function () {
      for (var j = 0; j < 2; j++) {
        moves.push(bonus.length ? circle_move(bonus.shift(), 'small') :
          pass(turn.color));
      }
      moves.push(free.length ? circle_move(free.shift(), 'small') :
        pass(turn.color));
    });
    color_up = (color_up + 1) % sim.players;
  });
  return moves;
};

var describe = function (game) {
  var key = function (circle) {
    return [circle.x, circle.y, circle.r, circle.color].join(',');
  };
  return {
    smalls: game.smalls.map(function (small) {
      return key(small) + ' in ' + small.sets.map(key).sort().join(' + ');
    }).sort(),
    bigs: game.bigs.map(function (big) {
      return key(big) + ' completed by ' + big.completed_by;
    }),
    turns: game.turns.map(function (turn) {
      return [turn.color, turn.enclosed, turn.members.length,
              turn.completed.length, turn.bonus_members.length,
              turn.bonus_free.length].join(' ');
    })
  };
};

test('people can replay every simulated game move by move', function () {
  [true, false].forEach(function (strategy) {
    for (var seed = 1; seed <= 15; seed++) {
      var sim = Encircling.play(Encircling.create_game({
        width: PAPER.width, height: PAPER.height, scale: PAPER.scale,
        seed: seed, strategy: strategy
      }));
      var game = Encircling.replay(PAPER, moves_of(sim));
      assert.deepEqual(describe(game), describe(sim), 'seed ' + seed);
      assert.ok(game.bigs.length > 0);
    }
  });
});

test('a game played by people obeys the written rules', function () {
  var sim = Encircling.play(Encircling.create_game({
    width: PAPER.width, height: PAPER.height, scale: PAPER.scale, seed: 3
  }));
  var game = Encircling.replay(PAPER, moves_of(sim));
  assert.deepEqual(oracle.find_violations(game), []);
});

test('a game is a log of moves that survives being sent as JSON', function () {
  var sim = Encircling.play(Encircling.create_game({
    width: PAPER.width, height: PAPER.height, scale: PAPER.scale, seed: 4
  }));
  var game = Encircling.replay(PAPER, moves_of(sim));
  var copy = Encircling.replay(PAPER, JSON.parse(JSON.stringify(game.log)));
  assert.deepEqual(describe(copy), describe(game));
  assert.deepEqual(Encircling.next_step(copy), Encircling.next_step(game));
});

test('replaying refuses a log with an illegal move', function () {
  assert.throws(function () {
    Encircling.replay(PAPER, [
      {color: RED, kind: 'small', x: 100, y: 100, r: 10},
      {color: GREEN, kind: 'small', x: 105, y: 100, r: 10}
    ]);
  }, /move 1 is not allowed: Small circles can't touch/);
});

test('everyone draws a small circle, then takes turns at big ones', function () {
  var game = Encircling.create_shared_game({});
  [RED, GREEN, BLUE, BLACK].forEach(function (color, i) {
    assert.deepEqual(Encircling.next_step(game), {color: color, step: 'free'});
    assert.ok(Encircling.apply_move(game, {
      color: color, kind: 'small', x: 100 + 60 * i, y: 100, r: 10
    }).ok);
  });
  assert.deepEqual(Encircling.next_step(game), {color: RED, step: 'big'});
  assert.equal(game.initial.length, 4);
});

test('people play on fixed portrait paper', function () {
  var game = Encircling.create_shared_game({});
  assert.equal(game.width, Encircling.PAPER.width * 14);
  assert.equal(game.height, Encircling.PAPER.height * 14);
  assert.ok(game.height > game.width);
});

// a game in its first turn: red, green and blue circles near the top left,
// and red to draw a big circle
var started = function () {
  var game = Encircling.create_shared_game({});
  [
    {color: RED, kind: 'small', x: 120, y: 150, r: 10},
    {color: GREEN, kind: 'small', x: 150, y: 150, r: 10},
    {color: BLUE, kind: 'small', x: 300, y: 400, r: 10},
    pass(BLACK)
  ].forEach(function (move) {
    assert.ok(Encircling.apply_move(game, move).ok);
  });
  return game;
};

test('a big circle earns a member for each small circle it encloses', function () {
  var game = started();
  assert.ok(Encircling.apply_move(game, pass(RED)).ok);
  assert.ok(Encircling.apply_move(game, pass(GREEN)).ok);
  var big = {color: BLUE, kind: 'big', x: 135, y: 150, r: 50};
  assert.ok(Encircling.apply_move(game, big).ok);
  assert.deepEqual(Encircling.next_step(game), {color: BLUE, step: 'member'});
  // members join other players' sets, and there are none yet
  assert.equal(refused(game, {color: BLUE, kind: 'small', x: 135, y: 180,
                              r: 9}),
               'It can\'t go in a set of its own color.');
  assert.ok(Encircling.apply_move(game, pass(BLUE)).ok);
  assert.deepEqual(Encircling.next_step(game), {color: BLUE, step: 'member'});
  assert.ok(Encircling.apply_move(game, pass(BLUE)).ok);
  assert.deepEqual(Encircling.next_step(game), {color: BLACK, step: 'big'});
  // black's member can go in blue's set
  assert.ok(Encircling.apply_move(game, {
    color: BLACK, kind: 'big', x: 300, y: 400, r: 40
  }).ok);
  assert.ok(Encircling.apply_move(game, {
    color: BLACK, kind: 'small', x: 135, y: 180, r: 9
  }).ok);
  assert.deepEqual(Encircling.next_step(game), {color: RED, step: 'big'});
  assert.deepEqual(game.turns.map(function (turn) {
    return [turn.color, turn.enclosed, turn.members.length];
  }), [[BLUE, 2, 0], [BLACK, 1, 1]]);
  assert.equal(game.bigs[0].members.length, 3);
});

test('completing a set earns two members and a free circle', function () {
  var sim = Encircling.play(Encircling.create_game({
    width: PAPER.width, height: PAPER.height, scale: PAPER.scale, seed: 1
  }));
  var moves = moves_of(sim);
  var game = Encircling.create_shared_game(PAPER);
  for (var i = 0; i < moves.length; i++) {
    Encircling.apply_move(game, moves[i]);
    var turn = game.turn;
    if (turn && turn.big && turn.members.length === turn.enclosed &&
        game.bigs.some(function (big) { return big.completed_by !== null; })) {
      break;
    }
  }
  var color = game.turn.color;
  assert.deepEqual(game.owed, [
    {color: color, step: 'member', bonus: true},
    {color: color, step: 'member', bonus: true},
    {color: color, step: 'free', bonus: true}
  ].slice(0, game.owed.length));
  assert.equal(game.owed.length % 3, 0);
  assert.ok(game.turn.completed.length >= 1);
  game.turn.completed.forEach(function (big) {
    assert.equal(big.completed_by, color);
  });
});

test('the game ends when everyone passes in a row', function () {
  var game = started();
  [RED, GREEN, BLUE].forEach(function (color) {
    assert.ok(Encircling.apply_move(game, pass(color)).ok);
  });
  assert.ok(!game.over);
  assert.ok(Encircling.apply_move(game, pass(BLACK)).ok);
  assert.ok(game.over);
  assert.equal(Encircling.next_step(game), null);
  assert.deepEqual(Encircling.apply_move(game, pass(RED)),
                   {ok: false, reason: 'The game is over.'});
});

test('giving up a member does not count toward ending the game', function () {
  var game = started();
  [RED, GREEN].forEach(function (color) {
    assert.ok(Encircling.apply_move(game, pass(color)).ok);
  });
  assert.ok(Encircling.apply_move(game, {
    color: BLUE, kind: 'big', x: 135, y: 150, r: 50
  }).ok);
  [BLUE, BLUE, BLACK, RED, GREEN].forEach(function (color) {
    assert.ok(Encircling.apply_move(game, pass(color)).ok);
  });
  assert.ok(!game.over);
  assert.ok(Encircling.apply_move(game, pass(BLUE)).ok);
  assert.ok(game.over);
});

var refused = function (game, move) {
  var before = JSON.stringify(game.log);
  var verdict = Encircling.apply_move(game, move);
  assert.equal(verdict.ok, false);
  assert.equal(JSON.stringify(game.log), before, 'a refused move is not kept');
  return verdict.reason;
};

test('moves out of turn or of the wrong kind are refused', function () {
  var game = started();
  assert.equal(refused(game, pass(GREEN)), 'It\'s not your turn.');
  assert.equal(refused(game, {color: RED, kind: 'small', x: 300, y: 300, r: 10}),
               'Now draw a big circle.');
  assert.equal(refused(game, {color: RED, kind: 'big', x: 'a', y: 1, r: 50}),
               'That isn\'t a circle.');
  assert.equal(refused(game, {color: RED, kind: 'big', y: 1, r: 50}),
               'That isn\'t a circle.');
});

test('circles must be the sizes the rules give', function () {
  var game = started();
  var big = function (diameter) {
    return {color: BLUE, kind: 'big', x: 135, y: 150, r: diameter * 7};
  };
  game.owed = [{color: BLUE, step: 'big'}];
  assert.equal(refused(game, big(4.9)), 'Big circles are 5 to 10 cm across.');
  assert.equal(refused(game, big(10.1)), 'Big circles are 5 to 10 cm across.');
  assert.ok(Encircling.check_move(game, big(5)).ok);
  assert.ok(Encircling.check_move(game, big(10)).ok);
  game.owed = [{color: BLUE, step: 'free'}];
  var small = function (diameter) {
    return {color: BLUE, kind: 'small', x: 300, y: 500, r: diameter * 7};
  };
  assert.equal(refused(game, small(0.9)), 'Small circles are 1 to 2 cm across.');
  assert.equal(refused(game, small(2.1)), 'Small circles are 1 to 2 cm across.');
  assert.ok(Encircling.check_move(game, small(1)).ok);
  assert.ok(Encircling.check_move(game, small(2)).ok);
});

// A scene drawn directly, owing one step. Places small circles at the
// spots asked for, and big circles around them.
var scene = function (step, color) {
  var game = Encircling.create_shared_game({});
  game.owed = [{color: color, step: step}];
  game.turn = {color: color, big: null, enclosed: 0, members: [],
               completed: [], bonus_members: [], bonus_free: []};
  game.small = function (x, y, small_color, sets) {
    return Encircling.add_small(
      game, {x: x, y: y, r: 8, color: small_color}, sets || []
    );
  };
  game.set = function (x, y, r, set_color, enclosed) {
    return Encircling.add_big(
      game, {x: x, y: y, r: r, color: set_color}, enclosed
    );
  };
  return game;
};

// a spot for a small circle inside exactly these sets, found by search
var spot = function (game, sets) {
  for (var x = 0; x < game.width; x += 1) {
    for (var y = 0; y < game.height; y += 1) {
      var small = {x: x, y: y, r: 8};
      var containing = Encircling.check_small(game, small);
      if (containing && containing.length === sets.length &&
          sets.every(function (set) { return containing.indexOf(set) !== -1; })) {
        return small;
      }
    }
  }
  throw new Error('no spot');
};

var big_move = function (x, y, r, color) {
  return {color: color, kind: 'big', x: x, y: y, r: r};
};

test('each broken rule for a big circle gets its own reason', function () {
  var reason = function (setup, move) {
    var game = scene('big', move.color);
    setup(game);
    return refused(game, move);
  };
  var nothing = function () {};
  var cases = [
    ['It has to fit on the paper.', nothing, big_move(30, 300, 40, BLACK)],
    ['Its line can\'t cross a small circle.', function (game) {
      game.small(200, 300, RED);
    }, big_move(240, 300, 40, BLACK)],
    ['It has to encircle at least one small circle.', nothing,
     big_move(200, 300, 40, BLACK)],
    ['It can encircle at most three small circles.', function (game) {
      game.small(180, 300, RED);
      game.small(220, 300, GREEN);
      game.small(200, 280, BLUE);
      game.small(200, 320, RED);
    }, big_move(200, 300, 50, BLACK)],
    ['It can\'t encircle a small circle of its own color.', function (game) {
      game.small(200, 300, BLACK);
    }, big_move(200, 300, 40, BLACK)],
    ['It can\'t encircle two small circles of the same color.', function (game) {
      game.small(185, 300, RED);
      game.small(215, 300, RED);
    }, big_move(200, 300, 40, BLACK)],
    ['A small circle can only be in two sets.', function (game) {
      game.small(200, 300, RED, [{members: []}, {members: []}]);
    }, big_move(200, 300, 40, BLACK)],
    ['Sets can\'t be inside each other.', function (game) {
      var red = game.small(200, 300, RED);
      game.set(200, 300, 60, GREEN, [red]);
    }, big_move(200, 300, 36, BLACK)],
    ['It\'s too close to another set.', function (game) {
      var red = game.small(200, 300, RED);
      game.set(200, 300, 40, GREEN, [red]);
    }, big_move(215, 300, 40, BLACK)],
    ['It can only overlap another set around one shared small circle.',
     function (game) {
       game.set(150, 300, 40, GREEN, [game.small(150, 300, RED)]);
       game.small(230, 300, BLUE);
     }, big_move(215, 300, 40, BLACK)]
  ];
  cases.forEach(function (c) {
    assert.equal(reason(c[1], c[2]), c[0]);
  });
});

test('no spot can be inside three sets', function () {
  var game = scene('big', BLACK);
  var a = game.set(150, 300, 45, GREEN, []);
  var b = game.set(215, 300, 45, BLUE, []);
  // where the new set will go, there while finding spots clear of its line
  var c = {x: 182, y: 352, r: 45, color: BLACK, members: []};
  game.bigs.push(c);
  var shared = spot(game, [a, b]);
  var with_a = spot(game, [a, c]);
  var with_b = spot(game, [b, c]);
  game.bigs.pop();
  Encircling.add_small(game, {x: shared.x, y: shared.y, r: 8, color: RED},
                       [a, b]);
  Encircling.add_small(game, {x: with_a.x, y: with_a.y, r: 8, color: BLUE},
                       [a]);
  Encircling.add_small(game, {x: with_b.x, y: with_b.y, r: 8, color: RED},
                       [b]);
  assert.equal(refused(game, big_move(c.x, c.y, c.r, BLACK)),
               'No spot can be inside three sets.');
});

test('each broken rule for a small circle gets its own reason', function () {
  var game = scene('member', BLUE);
  var red = game.small(200, 300, RED);
  var green = game.small(200, 330, GREEN);
  var set = game.set(200, 300, 50, BLACK, [red, green]);
  game.set(330, 300, 50, BLUE, [game.small(330, 300, RED)]);
  game.set(200, 450, 50, GREEN, [
    game.small(185, 450, RED), game.small(215, 450, BLUE),
    game.small(200, 470, BLACK)
  ]);
  var move = function (x, y, color, r) {
    return {color: color || BLUE, kind: 'small', x: x, y: y, r: r || 8};
  };
  assert.equal(refused(game, move(205, 300)), 'Small circles can\'t touch.');
  assert.equal(refused(game, move(250, 300)), 'It can\'t cross the line of a set.');
  assert.equal(refused(game, move(5, 300)), 'It has to fit on the paper.');
  assert.equal(refused(game, move(100, 100)), 'A member goes inside a set.');
  assert.equal(refused(game, move(330, 270)),
               'It can\'t go in a set of its own color.');
  assert.equal(refused(game, move(200, 430)), 'That set already has three members.');
  game.owed = [{color: GREEN, step: 'member'}];
  assert.equal(refused(game, move(220, 280, GREEN)), 'That set already has this color.');
  game.owed = [{color: BLUE, step: 'member'}];
  assert.ok(Encircling.check_move(game, move(220, 280)).ok);
  assert.equal(set.members.length, 2);
  game.owed = [{color: BLUE, step: 'free'}];
  assert.equal(refused(game, move(220, 280)), 'This one goes outside every set.');
  assert.ok(Encircling.check_move(game, move(100, 100)).ok);
});

test('a new member goes in only one set', function () {
  var game = scene('member', BLUE);
  var a = game.set(150, 300, 45, GREEN, []);
  var b = game.set(215, 300, 45, BLACK, []);
  var both = spot(game, [a, b]);
  assert.equal(refused(game, {color: BLUE, kind: 'small', x: both.x,
                              y: both.y, r: 8}),
               'A new member goes in only one set.');
});
