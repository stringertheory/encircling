var test = require('node:test');
var assert = require('node:assert');
var Room = require('../server/room.js');

var ANA = 'ana-token-aaaaaaaaaaaa';
var BEN = 'ben-token-bbbbbbbbbbbb';
var EVE = 'eve-token-eeeeeeeeeeee'; // not playing
var BOTH = [ANA, BEN];

var small = function (color, x) {
  return {color: color, kind: 'small', x: x, y: 100, r: 9};
};

// Ana holds orange and blue, Ben green and gray
var started_room = function () {
  var room = Room.create_room();
  [[ANA, 0, 'Ana'], [BEN, 1, 'Ben'], [ANA, 2, 'Ana'], [BEN, 3, 'Ben']]
    .forEach(function (claim) {
      assert.ok(Room.receive(room, claim[0], {type: 'claim', color: claim[1],
                                              name: claim[2]}, BOTH).seats);
    });
  assert.ok(Room.receive(room, ANA, {type: 'start'}, BOTH).seats);
  return room;
};

var send = function (room, token, move, online) {
  return Room.receive(room, token, {type: 'move', at: room.game.log.length,
                                    move: move}, online || BOTH);
};

var refusal = function (result) {
  return result.reply && result.reply.reason;
};

test('people claim colors before the game starts', function () {
  var room = Room.create_room();
  assert.equal(refusal(Room.receive(room, ANA, {type: 'claim', color: 0,
                                                name: '  '}, BOTH)),
               'Type your name first.');
  assert.ok(Room.receive(room, ANA, {type: 'claim', color: 0,
                                     name: '  Ana   Lee '}, BOTH).seats);
  assert.equal(room.seats[0].name, 'Ana Lee');
  assert.equal(refusal(Room.receive(room, BEN, {type: 'claim', color: 0,
                                                name: 'Ben'}, BOTH)),
               'Orange is taken.');
  assert.equal(refusal(Room.receive(room, BEN, {type: 'claim', color: 4,
                                                name: 'Ben'}, BOTH)),
               'That isn\'t a color.');
  // a second color renames the first: one name per phone
  Room.receive(room, ANA, {type: 'claim', color: 2, name: 'Ana'}, BOTH);
  assert.equal(room.seats[0].name, 'Ana');
  assert.equal(refusal(Room.receive(room, BEN, {type: 'release', color: 2},
                                    BOTH)), 'That color isn\'t yours.');
  assert.ok(Room.receive(room, ANA, {type: 'release', color: 2}, BOTH).seats);
  assert.equal(room.seats[2], null);
  assert.equal(refusal(Room.receive(room, ANA, {type: 'claim', color: 1,
                                                name: 'x'.repeat(40)}, BOTH)),
               undefined);
  assert.equal(room.seats[1].name.length, 24);
});

test('a game starts once every color has a player', function () {
  var room = Room.create_room();
  Room.receive(room, ANA, {type: 'claim', color: 0, name: 'Ana'}, BOTH);
  assert.equal(refusal(Room.receive(room, ANA, {type: 'start'}, BOTH)),
               'Every color needs a player.');
  room = started_room();
  assert.equal(room.started, true);
  assert.equal(refusal(Room.receive(room, EVE, {type: 'claim', color: 0,
                                                name: 'Eve'}, BOTH)),
               'The game has started.');
  assert.equal(refusal(Room.receive(room, ANA, {type: 'release', color: 0},
                                    BOTH)), 'The game has started.');
  var early = Room.create_room();
  ['a', 'b', 'c', 'd'].forEach(function (name, color) {
    Room.receive(early, BEN, {type: 'claim', color: color, name: 'Ben'}, BOTH);
  });
  assert.equal(refusal(Room.receive(early, EVE, {type: 'start'}, BOTH)),
               'Take a color first.');
  assert.equal(refusal(send(early, BEN, small(0, 100))),
               'The game hasn\'t started.');
});

test('people move only for their own colors, in turn', function () {
  var room = started_room();
  assert.equal(refusal(send(room, BEN, small(0, 100))), 'It\'s Ana\'s turn.');
  assert.equal(refusal(send(room, ANA, small(1, 100))), 'It\'s Ana\'s turn.');
  assert.equal(refusal(send(room, ANA, {color: 0, kind: 'small', x: 100,
                                        y: 100, r: 1})),
               'Small circles are 1 to 2 cm across.');
  var result = send(room, ANA, small(0, 100));
  assert.deepEqual(result.moved, {type: 'moved', move: small(0, 100),
                                  index: 0, skipped: false});
  assert.equal(room.game.log.length, 1);
  assert.ok(send(room, BEN, small(1, 150)).moved);
  assert.ok(send(room, ANA, small(2, 200)).moved);
});

test('a move made before someone else\'s arrived is refused', function () {
  var room = started_room();
  send(room, ANA, small(0, 100));
  var stale = Room.receive(room, BEN, {type: 'move', at: 0,
                                       move: small(1, 150)}, BOTH);
  assert.equal(refusal(stale), 'Someone moved first.');
  assert.equal(room.game.log.length, 1);
});

test('anyone playing can skip a player who has gone', function () {
  var room = started_room();
  var pass = {color: 0, kind: 'pass'};
  assert.equal(refusal(send(room, BEN, pass)),
               'Ana is here, so only they can pass.');
  assert.equal(refusal(send(room, BEN, small(0, 100), [BEN])),
               'It\'s Ana\'s turn.');
  assert.equal(refusal(send(room, EVE, pass, [EVE])),
               'You aren\'t playing in this game.');
  var skipped = send(room, BEN, pass, [BEN]);
  assert.equal(skipped.moved.skipped, true);
  assert.equal(skipped.moved.index, 0);
});

test('only the fields of a move are kept', function () {
  var room = started_room();
  var move = small(0, 100);
  move.note = 'x'.repeat(1000);
  send(room, ANA, move);
  assert.deepEqual(room.game.log[0], small(0, 100));
  send(room, BEN, {color: 1, kind: 'pass', x: 5}, [BEN, ANA]);
  assert.deepEqual(room.game.log[1], {color: 1, kind: 'pass'});
  assert.equal(refusal(Room.receive(room, ANA, {type: 'nonsense'}, BOTH)),
               'That message isn\'t understood.');
  assert.equal(refusal(Room.receive(room, ANA, null, BOTH)),
               'That message isn\'t understood.');
});

test('a room comes back from what it stored', function () {
  var room = started_room();
  send(room, ANA, small(0, 100));
  send(room, BEN, small(1, 150));
  var stored = JSON.parse(JSON.stringify({
    seats: room.seats, started: room.started, log: room.game.log
  }));
  var back = Room.create_room(stored);
  assert.equal(back.started, true);
  assert.equal(back.game.log.length, 2);
  assert.ok(send(back, ANA, small(2, 200)).moved);
});

test('what people are sent says which seats are theirs, never tokens',
     function () {
       var room = started_room();
       var state = Room.state_for(room, BEN, [BEN]);
       assert.equal(state.type, 'state');
       assert.deepEqual(state.seats.map(function (seat) {
         return [seat.name, seat.online, seat.mine];
       }), [['Ana', false, false], ['Ben', true, true],
            ['Ana', false, false], ['Ben', true, true]]);
       assert.equal(JSON.stringify(state).indexOf('token'), -1);
       assert.equal(JSON.stringify(state).indexOf(ANA), -1);
     });

test('a ghost is a draft circle and the colors of whoever drew it',
     function () {
       var room = started_room();
       var circle = {x: 100, y: 120, r: 40, kind: 'big', note: 'x'};
       assert.deepEqual(Room.ghost_of(room, ANA, circle), {
         colors: [0, 2], circle: {x: 100, y: 120, r: 40, kind: 'big'}
       });
       // anyone watching may sketch, holding no color
       assert.deepEqual(Room.ghost_of(room, EVE, circle).colors, []);
       [null, 'circle', {x: 100, y: 120, r: 40},
        {x: 100, y: 120, r: -1, kind: 'big'},
        {x: NaN, y: 120, r: 40, kind: 'big'},
        {x: '100', y: 120, r: 40, kind: 'small'},
        {x: 100, y: 1e9, r: 40, kind: 'big'},
        {x: 100, y: 120, r: 1e9, kind: 'big'}].forEach(function (bad) {
         assert.equal(Room.ghost_of(room, BEN, bad).circle, null,
                      JSON.stringify(bad));
       });
     });
