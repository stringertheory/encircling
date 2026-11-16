/* The Cloudflare Worker: serves the static pages, and gives each online
game a room (a PartyServer on a Durable Object) at /parties/game/<id>.

The room holds the seats and the log of moves in its storage, so a game
outlives every phone disconnecting, and checks each move with room.js.
Keep this file a thin wrapper: the rules live in room.js and game.js. */
import {Server, routePartykitRequest} from 'partyserver';
import Room from './room.js';

var ID = /^[a-z0-9]{4,32}$/;
var TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
var MESSAGE_LENGTH = 2000;
var STALE_MS = 45000; // silent this long, a phone counts as gone
var SWEEP_MS = 30000; // how often to look for silent phones
var GHOST_GAP_MS = 30; // ghosts closer together than this are dropped

// checked before the connection opens, in fetch below
var token_of = function (request) {
  return new URL(request.url).searchParams.get('token') || '';
};

var ghost_message = function (id, ghost) {
  return {type: 'ghost', from: id, colors: ghost.colors, circle: ghost.circle};
};

var pad = function (index) {
  return String(index).padStart(6, '0');
};

export class Game extends Server {
  static options = {hibernate: true};

  async onStart() {
    var storage = this.ctx.storage;
    var saved = await storage.get(['seats', 'started']);
    var moves = await storage.list({prefix: 'move:'});
    this.room = Room.create_room({
      seats: saved.get('seats'),
      started: saved.get('started'),
      log: Array.from(moves.values())
    });
  }

  /* Who is here. A phone closes its connection when it is put away and
  says it is still here every so often (play.js), but a phone that loses
  its signal closes nothing, so anyone silent for STALE_MS counts as gone:
  others may then skip them. */
  heard(connection, changes) {
    connection.setState(Object.assign({}, connection.state, {seen: Date.now()},
                                      changes));
  }

  here(connection, gone) {
    return connection.state && gone.indexOf(connection.id) < 0 &&
      Date.now() - connection.state.seen < STALE_MS;
  }

  // the tokens of everyone here, leaving out connections that have gone
  online(gone) {
    var tokens = [];
    for (var connection of this.getConnections()) {
      if (this.here(connection, gone || [])) {
        tokens.push(connection.state.token);
      }
    }
    return tokens;
  }

  send_seats(gone) {
    gone = gone || [];
    var online = this.online(gone);
    for (var connection of this.getConnections()) {
      if (this.here(connection, gone)) {
        connection.send(JSON.stringify(
          Room.seats_for(this.room, connection.state.token, online)));
      }
    }
  }

  // checks for silent phones while anyone is connected
  async watch() {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    }
  }

  async onAlarm() {
    var gone = [];
    var left = 0;
    for (var connection of this.getConnections()) {
      if (this.here(connection, [])) {
        left += 1;
      } else {
        gone.push(connection.id);
        connection.close(4001, 'Gone quiet');
      }
    }
    if (gone.length > 0) {
      this.send_seats(gone);
      gone.forEach(this.lay_ghost, this);
    }
    if (left > 0) {
      await this.watch();
    }
  }

  async onConnect(connection, context) {
    connection.setState({token: token_of(context.request), seen: Date.now()});
    connection.send(JSON.stringify(
      Room.state_for(this.room, connection.state.token, this.online())));
    for (var other of this.getConnections()) { // drafts already showing
      var ghost = other.state && other.state.ghost;
      if (other !== connection && ghost && ghost.circle) {
        connection.send(JSON.stringify(ghost_message(other.id, ghost)));
      }
    }
    this.send_seats(); // everyone sees who is here
    await this.watch();
  }

  onClose(connection) {
    this.send_seats([connection.id]);
    this.lay_ghost(connection.id);
  }

  /* Ghosts are someone's draft circle, relayed to everyone else as it
  moves. Each connection keeps only its latest, in its state, so a phone
  that joins sees what is showing; nothing is stored. */
  ghost(connection, circle) {
    var now = Date.now();
    if (circle && now - (connection.state.ghost_at || 0) < GHOST_GAP_MS) {
      return; // never a clear, or a ghost could be left behind
    }
    var ghost = Room.ghost_of(this.room, connection.state.token, circle);
    this.heard(connection, {ghost: ghost, ghost_at: now});
    this.broadcast(JSON.stringify(ghost_message(connection.id, ghost)),
                   [connection.id]);
  }

  // clears the ghost of a connection that has gone
  lay_ghost(id) {
    this.broadcast(JSON.stringify({type: 'ghost', from: id, colors: [],
                                   circle: null}), [id]);
  }

  onMessage(connection, text) {
    if (!connection.state || typeof text !== 'string' ||
        text.length > MESSAGE_LENGTH) {
      return;
    }
    var message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      return;
    }
    var was_here = this.here(connection, []);
    this.heard(connection);
    if (!was_here) {
      this.send_seats(); // back from silence
    }
    if (message && message.type === 'here') {
      return;
    }
    if (message && message.type === 'ghost') {
      this.ghost(connection, message.circle);
      return;
    }
    var result = Room.receive(this.room, connection.state.token, message,
                              this.online());
    // Writes go out before any reply: a Durable Object holds outgoing
    // messages until the storage they follow is safe.
    if (result.moved) {
      this.ctx.storage.put('move:' + pad(result.moved.index),
                           result.moved.move);
      this.broadcast(JSON.stringify(result.moved));
    }
    if (result.seats) {
      this.ctx.storage.put({seats: this.room.seats,
                            started: this.room.started});
      this.send_seats();
    }
    if (result.reply) {
      connection.send(JSON.stringify(result.reply));
    }
  }
}

export default {
  async fetch(request, env) {
    var response = await routePartykitRequest(request, env, {
      onBeforeConnect: function (request, room) {
        if (!ID.test(room.name)) {
          return new Response('No such game', {status: 404});
        }
        if (!TOKEN.test(token_of(request))) {
          return new Response('A token is needed', {status: 400});
        }
      },
      onBeforeRequest: function () {
        return new Response('Not found', {status: 404});
      }
    });
    return response || new Response('Not found', {status: 404});
  }
};
