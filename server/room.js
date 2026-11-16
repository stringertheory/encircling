/* One online game: who holds each color, whether play has started, and
the log of moves, checked with the same js/game.js the phones run.

Plain functions over plain data, so tests run them in Node; index.js
wraps them in a PartyServer room on Cloudflare, which stores and sends
what they return.

People are known by a token their browser makes and keeps. Tokens stay
on the server: what goes out says only which seats are yours. */
var E = require('../js/game.js');

var PLAYERS = 4;
var NAME_LENGTH = 24;
var COLOR_NAMES = ['Orange', 'Green', 'Blue', 'Gray'];

var empty_seats = function () {
  var seats = [];
  for (var color = 0; color < PLAYERS; color++) {
    seats.push(null);
  }
  return seats;
};

// saved is what the room stored: {seats, started, log}
var create_room = function (saved) {
  saved = saved || {};
  return {
    seats: saved.seats || empty_seats(),
    started: !!saved.started,
    game: E.replay({players: PLAYERS}, saved.log || [])
  };
};

var clean_name = function (name) {
  return typeof name === 'string' ?
    name.replace(/\s+/g, ' ').trim().slice(0, NAME_LENGTH) : '';
};

var is_color = function (color) {
  return typeof color === 'number' && color >= 0 && color < PLAYERS &&
    Math.floor(color) === color;
};

var holds = function (room, token, color) {
  return !!room.seats[color] && room.seats[color].token === token;
};

var holds_any = function (room, token) {
  return room.seats.some(function (seat) {
    return seat && seat.token === token;
  });
};

// the seats as one person sees them; online lists connected tokens
var seats_for = function (room, token, online) {
  return {
    type: 'seats',
    started: room.started,
    seats: room.seats.map(function (seat) {
      return seat && {
        name: seat.name,
        online: online.indexOf(seat.token) >= 0,
        mine: seat.token === token
      };
    })
  };
};

// everything a phone needs when it connects or reconnects
var state_for = function (room, token, online) {
  var state = seats_for(room, token, online);
  state.type = 'state';
  state.log = room.game.log;
  return state;
};

var refuse = function (reason) {
  return {reply: {type: 'refused', reason: reason}};
};

// only the fields a move has, so nothing else is stored or sent on
var clean_move = function (move) {
  if (!move || typeof move !== 'object') {
    return null;
  }
  if (move.kind === 'pass') {
    return {color: move.color, kind: 'pass'};
  }
  return {color: move.color, kind: move.kind, x: move.x, y: move.y, r: move.r};
};

var claim = function (room, token, message) {
  var name = clean_name(message.name);
  if (!is_color(message.color)) {
    return refuse('That isn\'t a color.');
  }
  if (!name) {
    return refuse('Type your name first.');
  }
  if (room.started) {
    return refuse('The game has started.');
  }
  if (room.seats[message.color] && !holds(room, token, message.color)) {
    return refuse(COLOR_NAMES[message.color] + ' is taken.');
  }
  room.seats[message.color] = {name: name, token: token};
  room.seats.forEach(function (seat) {
    if (seat && seat.token === token) {
      seat.name = name; // one name for everyone on this phone
    }
  });
  return {seats: true};
};

var release = function (room, token, message) {
  if (room.started) {
    return refuse('The game has started.');
  }
  if (!is_color(message.color) || !holds(room, token, message.color)) {
    return refuse('That color isn\'t yours.');
  }
  room.seats[message.color] = null;
  return {seats: true};
};

var start = function (room, token) {
  if (room.started) {
    return refuse('The game has started.');
  }
  if (!holds_any(room, token)) {
    return refuse('Take a color first.');
  }
  if (room.seats.some(function (seat) {
    return !seat;
  })) {
    return refuse('Every color needs a player.');
  }
  room.started = true;
  return {seats: true};
};

/* A move for one of your colors, or a pass for someone who isn't
connected, so nobody waits on a phone that has gone. at is how long the
log was when the move was made, so a move made before someone else's
arrived is refused rather than applied to a game it never saw. */
var move = function (room, token, message, online) {
  if (!room.started) {
    return refuse('The game hasn\'t started.');
  }
  var game = room.game;
  if (message.at !== game.log.length) {
    return refuse('Someone moved first.');
  }
  var next = E.next_step(game);
  var played = clean_move(message.move);
  if (!next) {
    return refuse('The game is over.');
  }
  if (!played || played.color !== next.color) {
    return refuse('It\'s ' + room.seats[next.color].name + '\'s turn.');
  }
  var seat = room.seats[next.color];
  var skip = seat.token !== token;
  if (skip && !holds_any(room, token)) {
    return refuse('You aren\'t playing in this game.');
  }
  if (skip && played.kind !== 'pass') {
    return refuse('It\'s ' + seat.name + '\'s turn.');
  }
  if (skip && online.indexOf(seat.token) >= 0) {
    return refuse(seat.name + ' is here, so only they can pass.');
  }
  var verdict = E.apply_move(game, played);
  if (!verdict.ok) {
    return refuse(verdict.reason);
  }
  return {
    moved: {type: 'moved', move: played, index: game.log.length - 1,
            skipped: skip}
  };
};

/* What others see of someone's draft: a ghost, relayed but never stored
or checked against the rules, since anyone may sketch, in turn or not.
Returns the colors this person holds, and the circle, or null to clear
it when there is no draft or it isn't a sensible circle on the paper. */
var ghost_of = function (room, token, circle) {
  var colors = [];
  room.seats.forEach(function (seat, color) {
    if (seat && seat.token === token) {
      colors.push(color);
    }
  });
  var game = room.game;
  var number = function (value) {
    return typeof value === 'number' && isFinite(value);
  };
  var fits = circle && typeof circle === 'object' &&
    (circle.kind === 'big' || circle.kind === 'small') &&
    number(circle.x) && number(circle.y) && number(circle.r) &&
    circle.r > 0 && circle.r <= game.width &&
    circle.x >= -circle.r && circle.x <= game.width + circle.r &&
    circle.y >= -circle.r && circle.y <= game.height + circle.r;
  return {
    colors: colors,
    circle: fits ? {x: circle.x, y: circle.y, r: circle.r,
                    kind: circle.kind} : null
  };
};

var HANDLERS = {claim: claim, release: release, start: start, move: move};

/* A message from the person with this token. Returns what to do:
     reply   send back to them
     seats   seats or started changed: store them, send everyone seats_for
     moved   store the move and send it to everyone
   online lists the tokens connected now. */
var receive = function (room, token, message, online) {
  if (!message || typeof message !== 'object' || !HANDLERS[message.type]) {
    return refuse('That message isn\'t understood.');
  }
  return HANDLERS[message.type](room, token, message, online);
};

module.exports = {
  PLAYERS: PLAYERS,
  create_room: create_room,
  seats_for: seats_for,
  state_for: state_for,
  ghost_of: ghost_of,
  receive: receive
};
