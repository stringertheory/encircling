/* Encircling for people: names, turns, and touch drawing, with the rules
enforced by js/game.js. Played two ways:

  on one phone   passed round, and saved in the browser after every move
  online         ?game=<id>, each person on their own phone; the game's
                 room (server/) holds the log of moves and checks each one,
                 and every phone replays the moves it sends out

Plain browser JavaScript drawing with SVG. Gesture and view math lives in
js/sketch.js, where it can be tested. */
(function () {
  var E = window.Encircling;
  var S = window.Sketch;
  var STORE = 'encircling-play';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MARGIN = 12; // screen pixels around the paper when it is fitted
  var PASS_WAIT = 3000; // milliseconds to tap Pass again
  var RETRY_MAX = 10000; // milliseconds between attempts to reconnect
  var HERE_EVERY = 20000; // milliseconds between telling the room we're here
  var GHOST_EVERY = 50; // milliseconds between sending our draft as it moves
  var GHOST_EASE = 0.3; // how far others' ghosts close on their target a frame
  var COLORS = ['rgb(237, 87, 0)', 'rgb(34, 174, 58)', 'rgb(52, 189, 238)',
                'rgb(42, 42, 42)'];
  var COLOR_NAMES = ['Orange', 'Green', 'Blue', 'Gray'];

  var el = function (id) {
    return document.getElementById(id);
  };
  var board = el('board');

  var game = null;
  var names = COLOR_NAMES.slice();
  var view = null;
  var draft = null; // the circle being considered, not yet drawn
  var gesture = null;
  var pinching = null;
  var fingers = {}; // screen positions of the pointers that are down
  var wait_for_lift = false; // after a pinch, until every finger is up
  var pass_timer = null;

  // Online play, or null on one phone. seats are as the room sends them:
  // {name, online, mine} or null for an open color.
  var online = null;

  // ---- saving

  var save = function () {
    if (online) {
      return; // the room keeps the game
    }
    try {
      localStorage.setItem(STORE, JSON.stringify({names: names, log: game.log}));
    } catch (error) {
      // private browsing can refuse storage; the game still plays
    }
  };

  var load = function () {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE));
      if (saved && saved.names && saved.log) {
        names = saved.names;
        game = E.replay({}, saved.log);
        return true;
      }
    } catch (error) {
      // a damaged save starts a new game
    }
    return false;
  };

  // ---- drawing the paper

  var make = function (parent, tag, attributes) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attributes).forEach(function (name) {
      node.setAttribute(name, attributes[name]);
    });
    parent.appendChild(node);
    return node;
  };

  var clear = function (node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  };

  var circle_at = function (parent, circle, attributes) {
    attributes.cx = circle.x;
    attributes.cy = circle.y;
    attributes.r = circle.r;
    return make(parent, 'circle', attributes);
  };

  // A completed set is filled where no other set covers it.
  var draw_fill = function (fill, index) {
    var id = 'set-' + index;
    var mask = make(el('masks'), 'mask', {
      id: id, maskUnits: 'userSpaceOnUse',
      x: fill.x - fill.r, y: fill.y - fill.r,
      width: 2 * fill.r, height: 2 * fill.r
    });
    make(mask, 'rect', {
      x: fill.x - fill.r, y: fill.y - fill.r, width: 2 * fill.r,
      height: 2 * fill.r, style: 'fill: #fff'
    });
    fill.cutouts.forEach(function (other) {
      circle_at(mask, other, {style: 'fill: #000'});
    });
    circle_at(el('fills'), fill, {
      style: 'fill: ' + COLORS[fill.color], mask: 'url(#' + id + ')',
      'class': fill.preview ? 'preview' : ''
    });
  };

  // the fills as they are, or as they would be if the move were drawn
  var render_fills = function (move) {
    clear(el('masks'));
    clear(el('fills'));
    E.fills_of(game, move).forEach(draw_fill);
  };

  // the circles drawn so far; render_draft draws the fills
  var render = function () {
    clear(el('lines'));
    var paper = el('paper');
    paper.setAttribute('width', game.width);
    paper.setAttribute('height', game.height);
    game.bigs.concat(game.smalls).forEach(function (circle) {
      circle_at(el('lines'), circle, {stroke: COLORS[circle.color]});
    });
  };

  // A transform rather than a viewBox, so the SVG never rescales the paper
  // on its own when the screen changes size.
  var apply_view = function () {
    el('world').setAttribute('transform', 'translate(' + view.x + ' ' +
      view.y + ') scale(' + view.scale + ')');
  };

  // Fits the paper between the header and footer. Heights, not positions,
  // because a phone may still have the page scrolled for its keyboard.
  var fit_paper = function () {
    window.scrollTo(0, 0);
    var top = el('status').offsetHeight;
    var height = board.clientHeight - top - el('controls').offsetHeight;
    view = S.fit({width: game.width, height: game.height, scale: game.scale}, {
      left: 0, top: top, width: board.clientWidth, height: Math.max(height, 1)
    }, MARGIN);
    apply_view();
  };

  // ---- the current step

  var step_now = function () {
    return game && E.next_step(game);
  };

  var kind_now = function () {
    var next = step_now();
    return next && next.step === 'big' ? 'big' : 'small';
  };

  var overlay_open = function () {
    return ['setup', 'lobby', 'handoff', 'over'].some(function (id) {
      return !el(id).hidden;
    });
  };

  // whether this phone plays the color: every color, on one phone
  var mine = function (color) {
    return !online || !!(online.seats[color] && online.seats[color].mine);
  };

  // whether this phone may draw the draft now
  var can_draw = function () {
    var next = step_now();
    return next && !overlay_open() && mine(next.color) &&
      !(online && (online.waiting || !online.connected));
  };

  // Online, anyone may sketch a draft out of turn, for the others to see
  // as a ghost. It can't be drawn, so it is only ever a big circle: where
  // you'd put your next set.
  var sketching = function () {
    var next = step_now();
    return !!(online && next && !mine(next.color));
  };

  // whether a finger on the paper shapes the draft, rather than panning
  var can_touch = function () {
    return step_now() && !overlay_open() &&
      !(online && (online.waiting || !online.connected));
  };

  // the colors this phone holds online
  var my_colors = function () {
    var colors = [];
    online.seats.forEach(function (seat, color) {
      if (seat && seat.mine) {
        colors.push(color);
      }
    });
    return colors;
  };

  // A sketch carries over into your turn when the turn wants its kind.
  var keep_draft = function () {
    if (draft && (!step_now() || (!sketching() && draft.kind !== kind_now()))) {
      draft = null;
    }
  };

  // On someone else's turn online, Pass becomes Skip if they have gone.
  var skippable = function () {
    var next = step_now();
    if (!online || !next || mine(next.color)) {
      return false;
    }
    var seat = online.seats[next.color];
    return online.seats.some(function (s) {
      return s && s.mine;
    }) && seat && !seat.online;
  };

  var pass_label = function () {
    return skippable() ? 'Skip ' + names[step_now().color] : 'Pass';
  };

  var move_of = function (circle) {
    return {color: step_now().color, kind: circle.kind, x: circle.x,
            y: circle.y, r: circle.r};
  };

  var describe = function (next) {
    var left = game.owed.filter(function (step) {
      return step.color === next.color && step.step === next.step;
    }).length;
    var more = left > 1 ? ' (' + left + ' to go)' : '';
    var praise = next.bonus ? 'Set completed! ' : '';
    if (next.step === 'big') {
      return 'Draw a big circle around one to three small circles of other ' +
        'colors.';
    }
    if (next.step === 'member') {
      return praise + 'Add a small circle to someone else\'s set' + more + '.';
    }
    if (!game.turn) {
      return 'Draw a small circle anywhere on the paper.';
    }
    return praise + 'Draw a small circle outside the sets.';
  };

  var summary = function () {
    var completed = game.bigs.filter(function (big) {
      return big.completed_by !== null;
    }).length;
    var groups = E.completed_groups(game);
    var largest = groups.length ? groups[0].length : 0;
    return completed + (completed === 1 ? ' completed set' : ' completed sets') +
      ', and the largest connected group has ' + largest + '.';
  };

  /* Who plays a color, as this phone should say it. One person may play
  from two phones (or two browsers, which hold separate tokens), so a color
  of theirs held elsewhere is named as their other phone, not as them. */
  var holder = function (color) {
    var name = names[color];
    var same = !mine(color) && my_colors().some(function (held) {
      return names[held] === name;
    });
    return same ? name + '\'s other phone' : name;
  };

  var update_status = function () {
    var next = step_now();
    if (!next) {
      el('dot').style.background = 'transparent';
      el('who').textContent = 'Game over';
      el('what').textContent = summary();
    } else {
      el('dot').style.background = COLORS[next.color];
      var name = names[next.color];
      var color_name = COLOR_NAMES[next.color].toLowerCase();
      if (online && mine(next.color)) {
        el('who').textContent = 'Your turn · ' + color_name;
        el('what').textContent = describe(next);
      } else if (online) {
        var seat = online.seats[next.color];
        var who = holder(next.color);
        el('who').textContent = name + ' · ' + color_name;
        el('what').textContent = seat && !seat.online ?
          who + ' isn\'t here. You can wait, or skip.' :
          'Waiting for ' + who + '.';
      } else {
        el('who').textContent = name === COLOR_NAMES[next.color] ? name :
          name + ' · ' + color_name;
        el('what').textContent = describe(next);
      }
    }
    el('pass').disabled = !next || !(mine(next.color) || skippable()) ||
      !!(online && (online.waiting || !online.connected));
    if (!pass_timer) {
      el('pass').textContent = pass_label();
    }
    if (online) {
      document.title = next && mine(next.color) ? '● Encircling' : 'Encircling';
    }
  };

  // ---- the draft circle

  var render_draft = function () {
    var group = el('draft');
    clear(group);
    var reason = el('reason');
    var sketch = sketching();
    render_fills(draft && step_now() && !sketch ? move_of(draft) : null);
    render_ghosts();
    share_draft();
    el('confirm').textContent = sketch && draft ? 'Clear' : 'Draw it';
    if (!draft || !step_now()) {
      reason.textContent = '';
      el('confirm').disabled = true;
      return;
    }
    var handle = S.handle_of(draft, view.scale);
    handle.r = S.HANDLE_PX * 0.7 / view.scale;
    if (sketch) {
      var mine_now = my_colors();
      var ink = mine_now.length ? COLORS[mine_now[0]] : '#999';
      circle_at(group, draft, {stroke: ink, 'class': 'sketch'});
      circle_at(group, handle, {style: 'fill: ' + ink, 'class': 'handle'});
      reason.textContent = 'A sketch for the others to see. Waiting for ' +
        holder(step_now().color) + '.';
      reason.className = 'fine';
      el('confirm').disabled = false;
      return;
    }
    var verdict = E.check_move(game, move_of(draft));
    var color = COLORS[step_now().color];
    circle_at(group, draft, {
      stroke: color, 'class': verdict.ok ? 'legal' : 'illegal'
    });
    circle_at(group, handle, {style: 'fill: ' + color, 'class': 'handle'});
    reason.textContent = verdict.ok ? 'That works.' : verdict.reason;
    reason.className = verdict.ok ? 'fine' : '';
    el('confirm').disabled = !verdict.ok || !can_draw();
  };

  // ---- turns

  var show_handoff = function (text) {
    var next = step_now();
    el('handoff-dot').style.background = COLORS[next.color];
    el('handoff-text').textContent = text;
    el('handoff').hidden = false;
  };

  var disarm_pass = function () {
    clearTimeout(pass_timer);
    pass_timer = null;
    el('pass').classList.remove('armed');
    el('pass').textContent = pass_label();
  };

  var after_move = function (mover) {
    if (mine(mover)) {
      draft = null;
    }
    keep_draft();
    disarm_pass();
    save();
    render();
    render_draft();
    update_status();
    var next = step_now();
    if (!next) {
      el('summary').textContent = summary();
      el('over').hidden = false;
    } else if (online) {
      if (mine(next.color) && !mine(mover) && navigator.vibrate) {
        navigator.vibrate(60); // your turn
      }
    } else if (names[next.color] !== names[mover]) {
      show_handoff('Pass to ' + names[next.color]);
    }
  };

  var play = function (move) {
    if (online) {
      send({type: 'move', at: game.log.length, move: move});
      online.waiting = true;
      update_status();
      render_draft();
      return;
    }
    var mover = step_now().color;
    var verdict = E.apply_move(game, move);
    if (!verdict.ok) {
      el('reason').textContent = verdict.reason;
      return;
    }
    after_move(mover);
  };

  el('confirm').addEventListener('click', function () {
    if (sketching()) {
      draft = null;
      render_draft();
    } else if (draft && can_draw()) {
      play(move_of(draft));
    }
  });

  el('pass').addEventListener('click', function () {
    if (!step_now()) {
      return;
    }
    if (!pass_timer) {
      el('pass').classList.add('armed');
      el('pass').textContent = skippable() ? 'Tap again to skip' :
        'Tap again to pass';
      pass_timer = setTimeout(disarm_pass, PASS_WAIT);
      return;
    }
    play({color: step_now().color, kind: 'pass'});
  });

  el('fit').addEventListener('click', function () {
    fit_paper();
    render_draft();
  });

  el('ready').addEventListener('click', function () {
    el('handoff').hidden = true;
  });

  el('look').addEventListener('click', function () {
    el('over').hidden = true;
  });

  var new_game = function () {
    if (online) {
      window.location.href = 'play.html'; // the game stays in its room
      return;
    }
    try {
      localStorage.removeItem(STORE);
    } catch (error) {
      // nothing saved to remove
    }
    el('over').hidden = true;
    el('handoff').hidden = true;
    show_setup();
  };

  el('again').addEventListener('click', new_game);

  el('menu').addEventListener('click', function () {
    if (online) {
      if (window.confirm('Leave this game? Its link brings you back.')) {
        new_game();
      }
    } else if (!game ||
               window.confirm('Start a new game? This one will be lost.')) {
      new_game();
    }
  });

  // ---- touch

  var finger_ids = function () {
    return Object.keys(fingers);
  };

  board.addEventListener('pointerdown', function (event) {
    if (overlay_open() || !game) {
      return;
    }
    board.setPointerCapture(event.pointerId);
    fingers[event.pointerId] = {x: event.clientX, y: event.clientY};
    var ids = finger_ids();
    if (ids.length === 2) {
      if (gesture && gesture.mode !== 'pan') {
        draft = S.abandon(gesture);
        render_draft();
      }
      gesture = null;
      pinching = {view: view, ids: ids, a0: fingers[ids[0]], b0: fingers[ids[1]]};
      return;
    }
    if (ids.length > 2 || wait_for_lift) {
      return;
    }
    if (!can_touch()) {
      gesture = {mode: 'pan', view: view, from: fingers[event.pointerId]};
      return;
    }
    var kind = sketching() ? 'big' : kind_now();
    var point = S.to_paper(view, event.clientX, event.clientY);
    gesture = S.begin({
      draft: draft, point: point, kind: kind, scale: view.scale,
      limits: S.radius_limits(game, kind, E.DIAMETERS),
      default_r: S.DEFAULT_DIAMETER[kind] * game.scale / 2
    });
    draft = gesture.mode === 'draw' ? S.follow(gesture, point) : gesture.start;
    render_draft();
  });

  board.addEventListener('pointermove', function (event) {
    if (!(event.pointerId in fingers)) {
      return;
    }
    fingers[event.pointerId] = {x: event.clientX, y: event.clientY};
    if (pinching) {
      var ids = pinching.ids;
      if (fingers[ids[0]] && fingers[ids[1]]) {
        view = S.pinch(pinching.view, pinching.a0, pinching.b0,
                       fingers[ids[0]], fingers[ids[1]]);
        apply_view();
        render_draft();
      }
    } else if (gesture && gesture.mode === 'pan') {
      view = {
        scale: gesture.view.scale,
        min_scale: gesture.view.min_scale,
        max_scale: gesture.view.max_scale,
        x: gesture.view.x + event.clientX - gesture.from.x,
        y: gesture.view.y + event.clientY - gesture.from.y
      };
      apply_view();
    } else if (gesture) {
      draft = S.follow(gesture, S.to_paper(view, event.clientX, event.clientY));
      render_draft();
    }
  });

  var lift = function (event) {
    if (!(event.pointerId in fingers)) {
      return;
    }
    delete fingers[event.pointerId];
    if (pinching) {
      pinching = null;
      wait_for_lift = true;
    }
    gesture = null;
    if (finger_ids().length === 0) {
      wait_for_lift = false;
    }
  };
  board.addEventListener('pointerup', lift);
  board.addEventListener('pointercancel', lift);

  board.addEventListener('wheel', function (event) {
    event.preventDefault();
    if (!view) {
      return;
    }
    view = S.zoom_at(view, Math.exp(-event.deltaY * 0.0015),
                     event.clientX, event.clientY);
    apply_view();
    render_draft();
  }, {passive: false});

  // Safari's own pinch zoom would fight ours
  document.addEventListener('gesturestart', function (event) {
    event.preventDefault();
  });

  // Phones also resize when the keyboard or address bar comes and goes,
  // which only the visual viewport reports.
  var refit = function () {
    if (game) {
      fit_paper();
      render_draft();
    }
  };
  window.addEventListener('resize', refit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', refit);
  }

  // ---- starting

  var show_setup = function () {
    var fields = el('name-fields');
    clear(fields);
    COLOR_NAMES.forEach(function (color_name, color) {
      var label = document.createElement('label');
      label.className = 'field';
      var dot = document.createElement('span');
      dot.style.background = COLORS[color];
      var input = document.createElement('input');
      input.placeholder = color_name;
      input.autocomplete = 'off';
      input.maxLength = 24;
      if (names[color] !== color_name) {
        input.value = names[color];
      }
      label.appendChild(dot);
      label.appendChild(input);
      fields.appendChild(label);
    });
    el('setup').hidden = false;
  };

  var start = function () {
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur(); // closes a phone's keyboard
    }
    el('setup').hidden = true;
    update_status(); // first, since the header's text sets its height
    fit_paper();
    render();
    draft = null;
    render_draft();
    var next = step_now();
    if (next) {
      show_handoff(names[next.color] + '’s turn');
    } else {
      el('summary').textContent = summary();
      el('over').hidden = false;
    }
  };

  el('names').addEventListener('submit', function (event) {
    event.preventDefault();
    var inputs = el('name-fields').querySelectorAll('input');
    names = COLOR_NAMES.map(function (color_name, color) {
      return inputs[color].value.trim() || color_name;
    });
    game = E.create_shared_game({});
    save();
    start();
  });

  // ---- online

  var TOKEN_STORE = 'encircling-token';
  var NAME_STORE = 'encircling-name';
  var ID_LETTERS = 'abcdefghijkmnpqrstuvwxyz23456789';

  var stored = function (key, value) {
    try {
      if (value === undefined) {
        return localStorage.getItem(key);
      }
      localStorage.setItem(key, value);
    } catch (error) {
      // private browsing: remembered for this page only
    }
    return value;
  };

  var random_text = function (length, letters) {
    var bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (byte) {
      return letters[byte % letters.length];
    }).join('');
  };

  // who this browser is to every room: kept, and never shown to anyone
  var token = function () {
    var kept = stored(TOKEN_STORE);
    if (!kept) {
      kept = stored(TOKEN_STORE, random_text(24, ID_LETTERS +
        'ABCDEFGHJKLMNPQRSTUVWXYZ'));
    }
    return kept;
  };

  var send = function (message) {
    if (online.socket && online.socket.readyState === WebSocket.OPEN) {
      online.socket.send(JSON.stringify(message));
    }
  };

  var game_link = function () {
    return window.location.origin + window.location.pathname + '?game=' +
      online.id;
  };

  var lobby_status = function (text) {
    el('lobby-status').textContent = text;
  };

  var my_name = function () {
    return el('my-name').value.replace(/\s+/g, ' ').trim();
  };

  var show_lobby = function () {
    var list = el('seat-list');
    clear(list);
    var holding = false;
    online.seats.forEach(function (seat, color) {
      var row = document.createElement('div');
      row.className = 'seat';
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = COLORS[color];
      var name = document.createElement('span');
      name.className = 'name';
      if (seat) {
        name.textContent = seat.mine ? seat.name + ' (you)' : seat.name;
        if (!seat.online) {
          var away = document.createElement('span');
          away.className = 'away';
          away.textContent = ' · not here';
          name.appendChild(away);
        }
      } else {
        name.textContent = COLOR_NAMES[color] + ' is open';
        name.className = 'name open';
      }
      row.appendChild(dot);
      row.appendChild(name);
      if (!seat || seat.mine) {
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = seat ? 'Let go' : 'Take';
        button.addEventListener('click', function () {
          if (seat) {
            send({type: 'release', color: color});
          } else if (!my_name()) {
            lobby_status('Type your name first.');
            el('my-name').focus();
          } else {
            stored(NAME_STORE, my_name());
            send({type: 'claim', color: color, name: my_name()});
          }
        });
        row.appendChild(button);
      }
      holding = holding || !!(seat && seat.mine);
      list.appendChild(row);
    });
    var full = online.seats.every(function (seat) {
      return seat;
    });
    el('begin').disabled = !(full && holding && online.connected);
    if (!online.connected) {
      lobby_status(online.tries > 1 ? 'Can\'t reach the game. Trying again…' :
        'Connecting…');
    } else if (!holding) {
      lobby_status('Type your name, then take a color.');
    } else if (!full) {
      lobby_status('Share the link. Start once every color is taken.');
    } else {
      lobby_status('Everyone is here. Start when you\'re ready.');
    }
    el('lobby').hidden = false;
  };

  // Brings the page up to date with the room, keeping the view and draft.
  var show_room = function () {
    names = online.seats.map(function (seat, color) {
      return seat ? seat.name : COLOR_NAMES[color];
    });
    el('link-state').hidden = online.connected;
    if (!online.started) {
      show_lobby();
      return;
    }
    var opening = !el('lobby').hidden || !view;
    el('lobby').hidden = true;
    update_status();
    if (opening) {
      fit_paper();
    }
    render();
    var next = step_now();
    keep_draft();
    render_draft();
    if (opening && !next) {
      el('summary').textContent = summary();
      el('over').hidden = false;
    }
  };

  // ---- ghosts: everyone else's drafts, as they move

  // sends this phone's draft, at most every GHOST_EVERY and always the last
  var share_draft = function () {
    if (!online || !online.started) {
      return;
    }
    online.ghost_wanted = draft ?
      {x: draft.x, y: draft.y, r: draft.r, kind: draft.kind} : null;
    if (!online.ghost_timer) {
      flush_ghost();
    }
  };

  var flush_ghost = function () {
    online.ghost_timer = null;
    var text = JSON.stringify(online.ghost_wanted);
    if (text === online.ghost_sent) {
      return;
    }
    send({type: 'ghost', circle: online.ghost_wanted});
    online.ghost_sent = text;
    online.ghost_timer = setTimeout(flush_ghost, GHOST_EVERY);
  };

  // A ghost eases toward where it was last heard, so it glides between
  // updates rather than jumping.
  var hear_ghost = function (message) {
    var circle = message.circle;
    var ghost = online.ghosts[message.from];
    if (!circle) {
      delete online.ghosts[message.from];
    } else {
      if (!ghost || ghost.target.kind !== circle.kind) {
        ghost = {shown: {x: circle.x, y: circle.y, r: circle.r,
                         kind: circle.kind}};
        online.ghosts[message.from] = ghost;
      }
      ghost.target = circle;
      ghost.colors = message.colors;
    }
    glide();
  };

  var glide = function () {
    if (!online.ghost_frame) {
      online.ghost_frame = window.requestAnimationFrame(glide_step);
    }
  };

  var glide_step = function () {
    online.ghost_frame = null;
    var moving = false;
    Object.keys(online.ghosts).forEach(function (id) {
      var ghost = online.ghosts[id];
      ['x', 'y', 'r'].forEach(function (key) {
        var gap = ghost.target[key] - ghost.shown[key];
        if (Math.abs(gap) * view.scale > 0.3) {
          ghost.shown[key] += gap * GHOST_EASE;
          moving = true;
        } else {
          ghost.shown[key] = ghost.target[key];
        }
      });
    });
    render_ghosts();
    if (moving) {
      glide();
    }
  };

  // bold for whoever's turn it is, faint for anyone else, with a name
  var render_ghosts = function () {
    var group = el('ghosts');
    clear(group);
    if (!online || !view) {
      return;
    }
    var next = step_now();
    Object.keys(online.ghosts).forEach(function (id) {
      var ghost = online.ghosts[id];
      var active = !!next && ghost.colors.indexOf(next.color) >= 0;
      var color = active ? next.color : ghost.colors[0];
      var ink = color === undefined ? '#999' : COLORS[color];
      var look = active ? 'active' : 'faint';
      var shown = ghost.shown;
      circle_at(group, shown, {stroke: ink, 'class': look});
      if (color !== undefined) {
        var label = make(group, 'text', {
          x: shown.x, y: shown.y + shown.r + 16 / view.scale,
          'font-size': 13 / view.scale, 'text-anchor': 'middle',
          fill: ink, 'class': look
        });
        label.textContent = names[color];
      }
    });
  };

  var hear = function (message) {
    if (message.type === 'ghost') {
      hear_ghost(message);
    } else if (message.type === 'state') {
      online.ghosts = {}; // the room sends the ones showing now
      online.ghost_sent = null; // and needs ours again
      game = E.replay({}, message.log);
      online.seats = message.seats;
      online.started = message.started;
      online.waiting = false;
      show_room();
    } else if (message.type === 'seats') {
      online.seats = message.seats;
      online.started = message.started;
      show_room();
    } else if (message.type === 'moved') {
      if (message.index !== game.log.length) {
        online.socket.close(); // out of step: reconnecting sends the log
        return;
      }
      var mover = message.move.color;
      E.apply_move(game, message.move);
      online.waiting = false;
      after_move(mover);
    } else if (message.type === 'refused') {
      online.waiting = false;
      if (!el('lobby').hidden) {
        lobby_status(message.reason);
        return;
      }
      update_status();
      render_draft();
      el('reason').textContent = message.reason;
      el('reason').className = '';
    }
  };

  var connect = function () {
    var socket = online.socket;
    if (socket && socket.readyState <= WebSocket.OPEN) {
      return; // connecting or connected already
    }
    if (document.visibilityState === 'hidden') {
      return; // a phone in a pocket isn't here; visible again reconnects
    }
    var scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(scheme + '//' + window.location.host +
      '/parties/game/' + online.id + '?token=' + token());
    online.socket = socket;
    socket.addEventListener('open', function () {
      online.connected = true;
      online.tries = 0;
    });
    socket.addEventListener('message', function (event) {
      try {
        hear(JSON.parse(event.data));
      } catch (error) {
        window.console.error(error);
      }
    });
    socket.addEventListener('close', function () {
      if (online.socket !== socket) {
        return;
      }
      online.connected = false;
      online.waiting = false;
      online.tries += 1;
      show_room();
      clearTimeout(online.retry);
      online.retry = setTimeout(connect, Math.min(RETRY_MAX,
        500 * Math.pow(2, online.tries)));
    });
  };

  var play_online = function (id) {
    online = {id: id, socket: null, seats: [null, null, null, null],
              started: false, connected: false, waiting: false, tries: 0,
              retry: null, ghosts: {}, ghost_wanted: null, ghost_sent: null,
              ghost_timer: null, ghost_frame: null};
    el('my-name').value = stored(NAME_STORE) || '';
    show_lobby();
    connect();
    // Put away, a phone leaves, so others can skip it rather than wait;
    // back, it reconnects and catches up.
    var leave = function () {
      if (online.socket) {
        online.socket.close();
      }
    };
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        clearTimeout(online.retry);
        online.tries = 0;
        connect();
      } else {
        leave();
      }
    });
    window.addEventListener('pagehide', leave);
    setInterval(function () {
      if (online.connected) {
        send({type: 'here'});
      }
    }, HERE_EVERY);
  };

  el('my-name').addEventListener('change', function () {
    if (!my_name()) {
      return;
    }
    stored(NAME_STORE, my_name());
    online.seats.forEach(function (seat, color) {
      if (seat && seat.mine && seat.name !== my_name()) {
        send({type: 'claim', color: color, name: my_name()});
      }
    });
  });

  el('share').addEventListener('click', function () {
    var link = game_link();
    if (navigator.share) {
      navigator.share({title: 'Encircling', url: link}).catch(function () {
        // closed without sharing
      });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(function () {
        lobby_status('Link copied: ' + link);
      }, function () {
        lobby_status(link);
      });
    } else {
      lobby_status(link);
    }
  });

  el('begin').addEventListener('click', function () {
    send({type: 'start'});
  });

  el('go-online').addEventListener('click', function () {
    window.location.href = 'play.html?game=' + random_text(8, ID_LETTERS);
  });

  var wanted = new URLSearchParams(window.location.search).get('game');
  if (wanted && /^[a-z0-9]{4,32}$/.test(wanted)) {
    play_online(wanted);
  } else if (load()) {
    start();
  } else {
    show_setup();
  }
})();
