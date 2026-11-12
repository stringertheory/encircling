/* Encircling for people sharing one phone: names, turns, and touch
drawing, with the rules enforced by js/game.js. The game is saved in the
browser after every move, as its log of moves.

Plain browser JavaScript drawing with SVG. Gesture and view math lives in
js/sketch.js, where it can be tested. */
(function () {
  var E = window.Encircling;
  var S = window.Sketch;
  var STORE = 'encircling-play';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MARGIN = 12; // screen pixels around the paper when it is fitted
  var PASS_WAIT = 3000; // milliseconds to tap Pass again
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

  // ---- saving

  var save = function () {
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
    return ['setup', 'handoff', 'over'].some(function (id) {
      return !el(id).hidden;
    });
  };

  var can_draw = function () {
    return step_now() && !overlay_open();
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

  var update_status = function () {
    var next = step_now();
    if (!next) {
      el('dot').style.background = 'transparent';
      el('who').textContent = 'Game over';
      el('what').textContent = summary();
    } else {
      el('dot').style.background = COLORS[next.color];
      var name = names[next.color];
      el('who').textContent = name === COLOR_NAMES[next.color] ? name :
        name + ' · ' + COLOR_NAMES[next.color].toLowerCase();
      el('what').textContent = describe(next);
    }
    el('pass').disabled = !next;
  };

  // ---- the draft circle

  var render_draft = function () {
    var group = el('draft');
    clear(group);
    var reason = el('reason');
    render_fills(draft && step_now() ? move_of(draft) : null);
    if (!draft || !step_now()) {
      reason.textContent = '';
      el('confirm').disabled = true;
      return;
    }
    var verdict = E.check_move(game, move_of(draft));
    var color = COLORS[step_now().color];
    circle_at(group, draft, {
      stroke: color, 'class': verdict.ok ? 'legal' : 'illegal'
    });
    var handle = S.handle_of(draft, view.scale);
    handle.r = S.HANDLE_PX * 0.7 / view.scale;
    circle_at(group, handle, {style: 'fill: ' + color, 'class': 'handle'});
    reason.textContent = verdict.ok ? 'That works.' : verdict.reason;
    reason.className = verdict.ok ? 'fine' : '';
    el('confirm').disabled = !verdict.ok;
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
    el('pass').textContent = 'Pass';
  };

  var after_move = function (mover) {
    draft = null;
    disarm_pass();
    save();
    render();
    render_draft();
    update_status();
    var next = step_now();
    if (!next) {
      el('summary').textContent = summary();
      el('over').hidden = false;
    } else if (names[next.color] !== names[mover]) {
      show_handoff('Pass to ' + names[next.color]);
    }
  };

  var play = function (move) {
    var mover = step_now().color;
    var verdict = E.apply_move(game, move);
    if (!verdict.ok) {
      el('reason').textContent = verdict.reason;
      return;
    }
    after_move(mover);
  };

  el('confirm').addEventListener('click', function () {
    if (draft && step_now()) {
      play(move_of(draft));
    }
  });

  el('pass').addEventListener('click', function () {
    if (!step_now()) {
      return;
    }
    if (!pass_timer) {
      el('pass').classList.add('armed');
      el('pass').textContent = 'Tap again to pass';
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
    if (!game || window.confirm('Start a new game? This one will be lost.')) {
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
    if (!can_draw()) {
      gesture = {mode: 'pan', view: view, from: fingers[event.pointerId]};
      return;
    }
    var kind = kind_now();
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

  if (load()) {
    start();
  } else {
    show_setup();
  }
})();
